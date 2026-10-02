import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createWorkspaceRunIdentity, immutableAssignmentHash, projectWorkspaceLifecycle, selectBriefGroup, summarizeWorkspaceGroup } from '@autofactorio/contracts';
import type { WorkshopAssignment, WorkspaceAttemptIdentity, WorkspaceGroupIdentity, WorkspaceRunIdentity } from '@autofactorio/contracts';
import type { Event, Journal } from '../../core/execution/durable.js';
import { latestEventTime } from './journal.js';

type Source = { id: string; relativePath: string; runtimeRun: string | null; availability: 'available' | 'journal-missing' | 'unsupported' };
type RunRow = { identity: WorkspaceRunIdentity; sourceId: string; availability: Source['availability']; registration: 'pending' | 'journaled' | 'legacy'; timeCoverage: 'recorded' | 'legacy-unknown'; requestState:string|null };
export type WorkspaceRequest = { id: string; kind: 'workshop' | 'scenario'; requestHash: string; state: 'preparing' | 'active' | 'stopping' | 'held' | 'completed' | 'cancelled' | 'failed'; reason: string | null; createdAt: string };
export class WorkspaceOwnershipConflict extends Error {
  constructor(readonly owner: WorkspaceRequest) { super(`Managed game owned by ${owner.id} (${owner.state})`); }
}
export type WorkspacePage<T> = { items: T[]; next: string | null; unavailable?: string };
const key = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);
const parse = <T>(text: string) => JSON.parse(text) as T;
const within = (root: string, candidate: string) => candidate === root || candidate.startsWith(root + path.sep);

/** Stable project catalog. Runtime journals remain the evidence authority. */
export class WorkspaceCatalog {
  private readonly db: Database.Database;
  private readonly root: string;

  constructor(runtimeRoot: string) {
    mkdirSync(runtimeRoot, { recursive: true });
    this.root = realpathSync(runtimeRoot);
    const directory = path.join(this.root, 'workspace');
    mkdirSync(directory, { recursive: true });
    this.db = new Database(path.join(directory, 'catalog.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, relative_path TEXT NOT NULL UNIQUE, runtime_run TEXT, availability TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS groups(id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, group_id TEXT NOT NULL, source_id TEXT NOT NULL, created_at TEXT NOT NULL, registration TEXT NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS runs_group_order ON runs(group_id, created_at, id);
      CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, ordinal INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS attempts_run_order ON attempts(run_id, ordinal, id);
      CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, kind TEXT NOT NULL, request_hash TEXT NOT NULL, state TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS owner(singleton INTEGER PRIMARY KEY CHECK(singleton=1), request_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS stop_intents(id TEXT PRIMARY KEY, reason TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS request_sources(request_id TEXT PRIMARY KEY, source_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS legacy_sessions(run_id TEXT PRIMARY KEY, session_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fresh_game_boundaries(id TEXT PRIMARY KEY, profile TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS legacy_ownership_candidates(id TEXT PRIMARY KEY);`);
  }

  close(): void { this.db.close(); }

  request(id: string): WorkspaceRequest | null {
    const row = this.db.prepare('SELECT id,kind,request_hash,state,reason,created_at FROM requests WHERE id=?').get(id) as
      { id: string; kind: WorkspaceRequest['kind']; request_hash: string; state: WorkspaceRequest['state']; reason: string | null; created_at: string } | undefined;
    return row ? { id: row.id, kind: row.kind, requestHash: row.request_hash, state: row.state, reason: row.reason, createdAt: row.created_at } : null;
  }

  owner(): WorkspaceRequest | null {
    const row = this.db.prepare('SELECT request_id FROM owner WHERE singleton=1').get() as { request_id: string } | undefined;
    return row ? this.request(row.request_id) : null;
  }
  owns(id:string):boolean {const owner=this.owner();return owner?.id===id&&owner.state==='active';}

  /** Trusted startup only: a newly created sandbox cannot inherit legacy game work.
   * This retires ownership, not unknown outcomes in the original evidence journals.
   * Native admitted requests still require their existing exact recovery path.
   */
  retireLegacyForFreshGame(id: string, profile: string): number {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid fresh game boundary');
    const resolved = realpathSync(profile);
    if (!within(this.root, resolved) || resolved === this.root) throw new Error('Fresh game profile outside project runtime');
    return this.db.transaction(() => {
      const prior = this.db.prepare('SELECT profile FROM fresh_game_boundaries WHERE id=?').get(id) as {profile:string}|undefined;
      if (prior) {
        if (prior.profile !== resolved) throw new Error('Fresh game boundary identity collision');
        return 0;
      }
      this.db.prepare('INSERT INTO fresh_game_boundaries VALUES(?,?,?)').run(id,resolved,new Date().toISOString());
      const legacy = this.db.prepare("SELECT runs.id,source_id FROM runs JOIN legacy_ownership_candidates ON legacy_ownership_candidates.id=runs.id WHERE registration='legacy'").all() as {id:string;source_id:string}[];
      let retired = 0;
      for (const run of legacy) {
        const request = this.request(run.id);
        if (request && ['completed','cancelled','failed'].includes(request.state)) continue;
        // Import's synthetic request IDs are scoped to immutable original sources.
        // Preserve each retained run while preventing repeated import resurrection.
        if (!request) {
          const kind = this.run(run.id)!.identity.kind;
          this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?)').run(run.id,kind,immutableAssignmentHash({legacy:run.id}),'failed',`historical_game_replaced:${id}`,new Date().toISOString());
          this.db.prepare('INSERT OR IGNORE INTO request_sources VALUES(?,?)').run(run.id,run.source_id);
        } else this.transitionRequest(run.id,'failed',`historical_game_replaced:${id}`);
        retired++;
      }
      return retired;
    })();
  }

  stopIntent(id: string, reason: string): WorkspaceRequest | null {
    if (!/^[\w.-]{1,160}$/.test(id) || !reason.trim()) throw new Error('Invalid workspace stop intent');
    return this.db.transaction(() => {
      const existing = this.request(id);
      if (existing && ['completed', 'cancelled', 'failed'].includes(existing.state)) return existing;
      this.db.prepare('INSERT OR IGNORE INTO stop_intents VALUES(?,?,?)').run(id, reason, new Date().toISOString());
      if (existing && existing.state !== 'held') this.db.prepare('UPDATE requests SET state=?,reason=? WHERE id=?').run('stopping', reason, id);
      return this.request(id);
    })();
  }

  stopRequested(id: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM stop_intents WHERE id=?').get(id));
  }

  /** Stop an older runtime's owner without replaying it or rewriting its journal. */
  stopRetiredWorkshop(id: string, reason: string, currentDirectory: string, currentRun: string, currentJournal: Journal): WorkspaceRequest | null {
    const request = this.request(id);
    if (!request) return null;
    if (request.kind !== 'workshop') throw new Error('Workshop Stop cannot stop a scenario');
    const source = this.db.prepare(`SELECT sources.relative_path,sources.runtime_run FROM request_sources JOIN sources ON sources.id=request_sources.source_id
      WHERE request_sources.request_id=?`).get(id) as { relative_path: string; runtime_run: string | null } | undefined;
    const sourcePath = source ? path.resolve(this.root, source.relative_path) : null;
    const registeredRun = this.run(id);
    const sourceRun = registeredRun?.identity.runtimeRun ?? source?.runtime_run;
    const sourceSession = this.workshopSourceId(id) ?? id;
    if (sourcePath && existsSync(sourcePath) && realpathSync(sourcePath) === realpathSync(currentDirectory) &&
        (!sourceRun || sourceRun === currentRun) && sourceSession === id &&
        (currentJournal.get(currentRun,'workshopSessions',id) ||
          registeredRun?.registration !== 'journaled' && currentJournal.hasOtherRun?.(currentRun,'workshopSessions',id) === false)) return null;
    if (['completed', 'cancelled', 'failed'].includes(request.state)) return request;
    if (this.owner()?.id !== id) throw new Error('Workshop request does not own the managed game');
    this.stopIntent(id, reason);
    const reconciled = this.reconcileStartup(currentDirectory, currentRun, currentJournal)!;
    // Only fully settled durable effects permit retirement. An empty replacement
    // controller's cancellation receipt says nothing about an older runtime.
    if (reconciled.state === 'held' && reconciled.reason === 'runtime_replacement_requires_reconciliation') {
      return this.transitionRequest(id, 'cancelled', reason);
    }
    return reconciled;
  }

  /** Transactionally owns preparation before any resolver, provider or game await. */
  admit(id: string, kind: WorkspaceRequest['kind'], payload: unknown, directory?: string): { request: WorkspaceRequest; newlyAdmitted: boolean } {
    if (!/^[\w.-]{1,160}$/.test(id)) throw new Error('Invalid workspace request identity');
    const requestHash = immutableAssignmentHash(payload);
    const source = directory ? this.source(directory, null, 'available') : null;
    return this.db.transaction(() => {
      const existing = this.request(id);
      if (existing) {
        if (existing.requestHash !== requestHash || existing.kind !== kind) throw new Error('Workspace request identity collision');
        return { request: existing, newlyAdmitted: false };
      }
      const tombstone = this.db.prepare('SELECT reason,created_at FROM stop_intents WHERE id=?').get(id) as { reason: string; created_at: string } | undefined;
      if (tombstone) {
        const cancelled: WorkspaceRequest = { id, kind, requestHash, state: 'cancelled', reason: tombstone.reason, createdAt: tombstone.created_at };
        this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?)').run(cancelled.id, cancelled.kind, cancelled.requestHash, cancelled.state, cancelled.reason, cancelled.createdAt);
        return { request: cancelled, newlyAdmitted: false };
      }
      const owner = this.owner();
      if (owner) throw new WorkspaceOwnershipConflict(owner);
      const value: WorkspaceRequest = { id, kind, requestHash, state: 'preparing', reason: null, createdAt: new Date().toISOString() };
      this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?)').run(value.id, value.kind, value.requestHash, value.state, value.reason, value.createdAt);
      this.db.prepare('INSERT INTO owner VALUES(1,?)').run(id);
      if (source) this.db.prepare('INSERT INTO request_sources VALUES(?,?)').run(id, source.id);
      return { request: value, newlyAdmitted: true };
    })();
  }

  /** Startup may settle only exact pre-dispatch absence or a fully recorded terminal run. */
  reconcileStartup(currentDirectory: string, currentRun: string, currentJournal: Journal): WorkspaceRequest | null {
    const owner = this.owner();
    if (!owner) return null;
    if (owner.reason === 'legacy_ownership_requires_exact_reconciliation') return owner;
    if (owner.kind !== 'workshop') return owner;
    const sourceRow = this.db.prepare(`SELECT sources.relative_path,sources.runtime_run FROM request_sources JOIN sources ON sources.id=request_sources.source_id
      WHERE request_sources.request_id=?`).get(owner.id) as { relative_path: string; runtime_run: string | null } | undefined;
    if (!sourceRow) return this.transitionRequest(owner.id,'held','workspace_source_unknown');
    const candidate = path.resolve(this.root,sourceRow.relative_path);
    if (!existsSync(candidate)) return this.transitionRequest(owner.id,'held','workspace_journal_missing');
    const directory = realpathSync(candidate);
    if (!within(this.root,directory)) throw new Error('Workspace source outside project runtime');
    const file = path.join(directory,'runtime.sqlite');
    if (!existsSync(file)) return this.transitionRequest(owner.id,'held','workspace_journal_missing');
    let session: Record<string, unknown> | undefined;
    const sourceRun = this.run(owner.id)?.identity.runtimeRun ?? sourceRow.runtime_run;
    const sessionId = this.workshopSourceId(owner.id) ?? owner.id;
    try {
      if (realpathSync(currentDirectory) === directory) {
        const expectedRun = sourceRun ?? currentRun;
        session=currentJournal.get<Record<string,unknown>>(expectedRun,'workshopSessions',sessionId);
        if (!session && currentJournal.hasOtherRun?.(expectedRun,'workshopSessions',sessionId) !== false) {
          return this.transitionRequest(owner.id,'held','workspace_session_identity_unconfirmed');
        }
      }
      else {
        // A live SqliteJournal retains an exclusive lock. A failed historical
        // read must hold ownership; it cannot prove the old writer has stopped.
        const journal = new Database(file,{readonly:true,fileMustExist:true});
        try {
          const rows = journal.prepare("SELECT run,json FROM projections WHERE entity='workshopSessions' AND id=?").all(sessionId) as {run:string;json:string}[];
          const row = sourceRun ? rows.find(value => value.run === sourceRun) : rows.length === 1 ? rows[0] : undefined;
          if (rows.length && !row) return this.transitionRequest(owner.id,'held','workspace_session_identity_unconfirmed');
          session=row?parse<Record<string,unknown>>(row.json):undefined;
        }
        finally {journal.close();}
      }
    } catch { return this.transitionRequest(owner.id,'held','workspace_journal_unreadable'); }
    if (!session) {
      if (this.run(owner.id)?.registration === 'journaled') return this.transitionRequest(owner.id,'held','workspace_session_identity_unconfirmed');
      // The catalog request precedes journal configuration, and no provider/game effect
      // can dispatch until that configuration has been durably recorded.
      return this.transitionRequest(owner.id,this.stopRequested(owner.id)?'cancelled':'failed','preparation_not_admitted');
    }
    const operationIntents = session.operationIntents && typeof session.operationIntents === 'object' ? session.operationIntents as Record<string,{status?:string}> : {};
    const intents = Object.values(operationIntents);
    const uncertain = intents.some(value => !['acknowledged','failed'].includes(String(value.status)));
    const providerFile=path.join(directory,'workshop-live',owner.id,'provider-budget.json');
    const providerEffects=Object.keys(operationIntents).some(id=>/:design$|:score$|:learning-/.test(id));
    let providerSettled=!providerEffects;
    if (existsSync(providerFile)) try {
      const usage=parse<{invocations?:Record<string,{status:string}>}>(readFileSync(providerFile,'utf8'));
      const invocations=Object.values(usage.invocations??{});
      providerSettled=(!providerEffects||invocations.length>0)&&invocations.every(value=>value.status==='complete');
    } catch {providerSettled=false;}
    const stage=String(session.stage);
    if (['complete','stopped'].includes(stage) && !uncertain && providerSettled) {
      const outcome=stage==='complete'?'completed':String(session.stopReason??'').includes('failed')?'failed':'cancelled';
      return this.transitionRequest(owner.id,outcome,typeof session.stopReason==='string'?session.stopReason:null);
    }
    if (realpathSync(currentDirectory) === directory && (!sourceRun || sourceRun === currentRun) && !this.stopRequested(owner.id) && !uncertain && providerSettled) return owner;
    return this.transitionRequest(owner.id,'held',uncertain||!providerSettled?'unresolved_effect_receipt':'runtime_replacement_requires_reconciliation');
  }

  transitionRequest(id: string, state: WorkspaceRequest['state'], reason: string | null = null): WorkspaceRequest {
    return this.db.transaction(() => {
      const current = this.request(id);
      if (!current) throw new Error('Workspace request missing');
      const terminal = ['completed', 'cancelled', 'failed'].includes(current.state);
      if (terminal && current.state !== state) throw new Error('Terminal workspace request cannot change state');
      this.db.prepare('UPDATE requests SET state=?,reason=? WHERE id=?').run(state, reason, id);
      if (['completed', 'cancelled', 'failed'].includes(state)) this.db.prepare('DELETE FROM owner WHERE singleton=1 AND request_id=?').run(id);
      return this.request(id)!;
    })();
  }

  /** Called only after the prior checkpoint and disarmed game barrier are verified. */
  transferScenario(previousId: string, nextId: string, payload: unknown): WorkspaceRequest {
    if (!/^[\w.-]{1,160}$/.test(nextId)) throw new Error('Invalid successor request identity');
    return this.db.transaction(() => {
      const owner = this.owner();
      if (!owner || owner.id !== previousId || owner.kind !== 'scenario' || owner.state !== 'active') throw new Error('Scenario handoff owner is not safely active');
      if (this.request(nextId)) throw new Error('Scenario successor identity collision');
      const value: WorkspaceRequest = { id: nextId, kind: 'scenario', requestHash: immutableAssignmentHash(payload), state: 'preparing', reason: null, createdAt: new Date().toISOString() };
      this.db.prepare('UPDATE requests SET state=?,reason=? WHERE id=?').run('cancelled', `reset_successor:${nextId}`, previousId);
      this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?)').run(value.id, value.kind, value.requestHash, value.state, value.reason, value.createdAt);
      this.db.prepare('UPDATE owner SET request_id=? WHERE singleton=1 AND request_id=?').run(nextId, previousId);
      return value;
    })();
  }

  private source(directory: string, runtimeRun: string | null, availability: Source['availability']): Source {
    const resolved = realpathSync(directory);
    if (!within(this.root, resolved) || resolved === this.root || resolved === path.join(this.root, 'workspace')) throw new Error('Workspace source outside project runtime');
    const relativePath = path.relative(this.root, resolved).replaceAll('\\', '/');
    const value: Source = { id: `source-${key(relativePath)}`, relativePath, runtimeRun, availability };
    this.db.prepare(`INSERT INTO sources(id,relative_path,runtime_run,availability) VALUES(@id,@relativePath,@runtimeRun,@availability)
      ON CONFLICT(id) DO UPDATE SET runtime_run=COALESCE(excluded.runtime_run,sources.runtime_run),availability=excluded.availability`).run(value);
    return value;
  }

  registerCurrent(directory: string, runtimeRun: string): Source {
    return this.source(directory, runtimeRun, 'available');
  }

  syncCurrent(directory: string, runtimeRun: string, journal: Journal): number {
    const source = this.registerCurrent(directory, runtimeRun);
    const records = (['workspaceGroups', 'workspaceRuns', 'workspaceAttempts'] as const).flatMap(entity =>
      journal.list<Record<string, unknown>>(runtimeRun, entity).map(value => ({ run: runtimeRun, entity, id: String(value.id), json: JSON.stringify(value) })));
    return this.db.transaction(() => this.importRecords(source, records))();
  }

  beginWorkshop(directory: string, runtimeRun: string, assignment: WorkshopAssignment, selectedGroupId: string | null = null): { group: WorkspaceGroupIdentity; run: WorkspaceRunIdentity } {
    const source = this.registerCurrent(directory, runtimeRun);
    return this.db.transaction(() => {
      const existing = this.db.prepare('SELECT json,group_id FROM runs WHERE id=?').get(assignment.id) as { json: string; group_id: string } | undefined;
      if (existing) {
        const run = parse<WorkspaceRunIdentity>(existing.json);
        if (run.runtimeRun !== runtimeRun || JSON.stringify(run.assignment) !== JSON.stringify(assignment)) throw new Error('Workspace run identity collision');
        if (!this.run(run.id)?.registration || this.run(run.id)?.registration === 'pending') throw new Error('Workspace preparation pending or interrupted; reconcile before retry');
        const group = this.group(existing.group_id);
        if (!group) throw new Error('Workspace run group missing');
        return { group, run };
      }
      const selected = selectedGroupId ? this.group(selectedGroupId) : null;
      if (selectedGroupId && !selected) throw new Error('Selected brief group unavailable');
      const group = selectBriefGroup(`brief-${key(assignment.id)}`, assignment.objective, selected);
      this.db.prepare('INSERT OR IGNORE INTO groups(id,json) VALUES(?,?)').run(group.id, JSON.stringify(group));
      const run = createWorkspaceRunIdentity({ id: assignment.id, groupId: group.id, runtimeRun, kind: 'workshop',
        assignment, comparisonSeries: assignment.comparisonSeries, createdAt: new Date().toISOString() });
      this.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?)').run(run.id, run.groupId, source.id, run.createdAt, 'pending', JSON.stringify(run));
      return { group, run };
    })();
  }

  beginScenario(directory: string, runtimeRun: string, requestId: string, assignment: { scenario: string; scenarioVersion: string; objective: string; [key: string]: unknown }): { group: WorkspaceGroupIdentity; run: WorkspaceRunIdentity } {
    const source = this.registerCurrent(directory, runtimeRun);
    return this.db.transaction(() => {
      const existing = this.run(requestId);
      if (existing) {
        if (existing.identity.runtimeRun !== runtimeRun || existing.identity.assignmentHash !== immutableAssignmentHash(assignment)) throw new Error('Workspace run identity collision');
        const group = this.group(existing.identity.groupId);
        if (!group) throw new Error('Scenario group missing');
        return { group, run: existing.identity };
      }
      const group: WorkspaceGroupIdentity = { schema: 1, id: `scenario-${key(`${assignment.scenario}:${assignment.scenarioVersion}`)}`,
        kind: 'scenario', title: assignment.objective, objective: null,
        scenario: { id: assignment.scenario, version: assignment.scenarioVersion }, parentGroupId: null, coverage: 'recorded' };
      this.db.prepare('INSERT OR IGNORE INTO groups VALUES(?,?)').run(group.id, JSON.stringify(group));
      const run = createWorkspaceRunIdentity({ id: requestId, groupId: group.id, runtimeRun, kind: 'scenario', assignment,
        comparisonSeries: null, createdAt: this.request(requestId)?.createdAt ?? new Date().toISOString() });
      this.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?)').run(run.id, group.id, source.id, run.createdAt, 'pending', JSON.stringify(run));
      return { group, run };
    })();
  }

  journaled(runId: string, attempts: WorkspaceAttemptIdentity[] = []): void {
    this.db.transaction(() => {
      if (!this.db.prepare('UPDATE runs SET registration=? WHERE id=?').run('journaled', runId).changes) throw new Error('Workspace run missing');
      for (const attempt of attempts) {
        if (attempt.runId !== runId) throw new Error('Attempt belongs to another run');
        this.db.prepare('INSERT OR IGNORE INTO attempts VALUES(?,?,?,?)').run(attempt.id, runId, attempt.ordinal, JSON.stringify(attempt));
      }
    })();
  }

  recordAttempt(attempt: WorkspaceAttemptIdentity): void {
    if (!this.run(attempt.runId)) throw new Error('Workspace attempt run missing');
    const existing = this.db.prepare('SELECT json FROM attempts WHERE id=?').get(attempt.id) as { json: string } | undefined;
    if (existing && existing.json !== JSON.stringify(attempt)) throw new Error('Workspace attempt identity collision');
    this.db.prepare('INSERT OR IGNORE INTO attempts VALUES(?,?,?,?)').run(attempt.id, attempt.runId, attempt.ordinal, JSON.stringify(attempt));
  }

  group(id: string): WorkspaceGroupIdentity | null {
    const row = this.db.prepare('SELECT json FROM groups WHERE id=?').get(id) as { json: string } | undefined;
    return row ? parse<WorkspaceGroupIdentity>(row.json) : null;
  }

  run(id: string): RunRow | null {
    const row = this.db.prepare(`SELECT runs.json,runs.source_id,runs.registration,sources.relative_path,sources.availability
      FROM runs JOIN sources ON sources.id=runs.source_id WHERE runs.id=?`).get(id) as { json: string; source_id: string; registration: RunRow['registration']; relative_path: string; availability: Source['availability'] } | undefined;
    if (!row) return null;
    const journal = path.join(this.root, row.relative_path, 'runtime.sqlite');
    return { identity: parse<WorkspaceRunIdentity>(row.json), sourceId: row.source_id,
      availability: existsSync(journal) ? row.availability : 'journal-missing', registration: row.registration,
      timeCoverage: parse<WorkspaceRunIdentity>(row.json).createdAt === '1970-01-01T00:00:00.000Z' ? 'legacy-unknown' : 'recorded',
      requestState:this.request(id)?.state??null };
  }

  sourceDirectory(runId:string):string|null{const run=this.run(runId);if(!run)throw new Error('Workspace run unavailable');if(run.availability!=='available')return null;
    const source=this.db.prepare('SELECT relative_path FROM sources WHERE id=?').get(run.sourceId) as{relative_path:string};
    const directory=realpathSync(path.join(this.root,source.relative_path));if(!within(this.root,directory))throw new Error('Workspace source outside project runtime');return directory;}

  /** Navigation IDs never replace the original journal/artifact session identity. */
  workshopSourceId(runId:string):string|null {
    const run=this.run(runId);
    if(!run||run.identity.kind!=='workshop')return null;
    if(run.registration!=='legacy')return runId;
    const row=this.db.prepare('SELECT session_id FROM legacy_sessions WHERE run_id=?').get(runId) as {session_id:string}|undefined;
    return row?.session_id??null;
  }

  /** Exact, source-scoped projection read for run detail; old journals stay read only. */
  detail(runId: string, current?: { directory: string; journal: Journal }): {
    run: RunRow; group: WorkspaceGroupIdentity | null; request: WorkspaceRequest | null;
    session: Record<string, unknown> | null; scenarioControl: Record<string, unknown> | null;
    scenarioVerification: Record<string, unknown> | null; learningOutcome:Record<string,unknown>|null;
    learningCandidate:Record<string,unknown>|null; learningBundle:Record<string,unknown>|null;
    activationCatalog:Record<string,unknown>|null;usage:Record<string,unknown>|null;
    operations:Record<string,unknown>[];operationCoverage:'first-500'|'complete'|'unavailable';
    terminalAt:string|null;
    lifecycle: ReturnType<typeof projectWorkspaceLifecycle>;
  } {
    const run=this.run(runId);
    if(!run)throw new Error('Workspace run unavailable');
    const source=this.db.prepare('SELECT relative_path FROM sources WHERE id=?').get(run.sourceId) as {relative_path:string};
    const candidate=path.resolve(this.root,source.relative_path);
    const directory=existsSync(candidate)?realpathSync(candidate):candidate;
    if(!within(this.root,directory))throw new Error('Workspace source outside project runtime');
    const read=(entity:'workshopSessions'|'runs'|'learningOutcomes'|'learningCandidates'|'learningBundles'|'activations'|'usage',id:string):Record<string,unknown>|null=>{
      if(run.availability!=='available')return null;
      if(current&&realpathSync(current.directory)===directory)return current.journal.get<Record<string,unknown>>(run.identity.runtimeRun,entity,id)??null;
      const db=new Database(path.join(directory,'runtime.sqlite'),{readonly:true,fileMustExist:true});
      try{const row=db.prepare('SELECT json FROM projections WHERE run=? AND entity=? AND id=?').get(run.identity.runtimeRun,entity,id) as{json:string}|undefined;return row?parse<Record<string,unknown>>(row.json):null;}
      finally{db.close();}
    };
    const sessionId=this.workshopSourceId(runId);
    const session=sessionId?read('workshopSessions',sessionId):null;
    const scenarioControl=run.identity.kind==='scenario'?read('runs','operator-control'):null;
    const scenarioVerification=run.identity.kind==='scenario'?read('runs','verification'):null;
    const learningOutcome=sessionId?read('learningOutcomes',`${sessionId}-learning`):null;
    const learningCandidate=learningOutcome?read('learningCandidates',`${sessionId}-learning`):null;
    const learningBundle=typeof learningOutcome?.bundleHash==='string'?read('learningBundles',learningOutcome.bundleHash):null;
    const activationCatalog=run.identity.kind==='workshop'?read('activations','catalog'):null;
    const usage=sessionId?read('usage',sessionId):null;
    let operations:Record<string,unknown>[]=[];
    if(sessionId&&run.availability==='available'){
      if(current&&realpathSync(current.directory)===directory)operations=current.journal.list<Record<string,unknown>>(run.identity.runtimeRun,'workshopOperations').filter(value=>value.sessionId===sessionId).slice(0,501);
      else{const db=new Database(path.join(directory,'runtime.sqlite'),{readonly:true,fileMustExist:true});try{operations=(db.prepare("SELECT json FROM projections WHERE run=? AND entity='workshopOperations' AND json_extract(json,'$.sessionId')=? ORDER BY id LIMIT 501").all(run.identity.runtimeRun,sessionId) as{json:string}[]).map(row=>parse<Record<string,unknown>>(row.json));}finally{db.close();}}
    }
    const operationCoverage: 'first-500'|'complete'|'unavailable'=run.availability!=='available'?'unavailable':operations.length>500?'first-500':'complete';
    if(operations.length>500)operations.pop();
    let terminalAt:string|null=null;
    if(sessionId&&run.availability==='available'){
      const types=['workshop/complete','workshop/stopped','workshop/failed'];
      // The live journal holds an exclusive lock: all live reads must share its connection.
      if(current&&realpathSync(current.directory)===directory){
        terminalAt=current.journal.latestEventTime?.(run.identity.runtimeRun,'workshopSessions',sessionId,types)??null;
      }else{
        const db=new Database(path.join(directory,'runtime.sqlite'),{readonly:true,fileMustExist:true});
        try{terminalAt=latestEventTime(db,run.identity.runtimeRun,'workshopSessions',sessionId,types);}
        finally{db.close();}
      }
    }
    const request=this.request(runId);
    return{run,group:this.group(run.identity.groupId),request,session,scenarioControl,scenarioVerification,learningOutcome,learningCandidate,learningBundle,activationCatalog,usage,operations,operationCoverage,terminalAt,
      lifecycle:projectWorkspaceLifecycle({kind:run.identity.kind,request,session:session as NonNullable<Parameters<typeof projectWorkspaceLifecycle>[0]['session']>|null,
        scenario:{control:scenarioControl as {status?:string}|null,verification:scenarioVerification as {valid?:boolean;passed?:boolean}|null}})};
  }

  listGroups(limit = 50, after = ''): WorkspaceGroupIdentity[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 101) throw new Error('Invalid workspace page size');
    const [afterTime, afterId] = after ? after.split('\0') : ['', ''];
    return (this.db.prepare(`SELECT groups.json FROM groups JOIN runs ON runs.group_id=groups.id GROUP BY groups.id
      HAVING MIN(runs.created_at)>? OR (MIN(runs.created_at)=? AND groups.id>?)
      ORDER BY MIN(runs.created_at),groups.id LIMIT ?`).all(afterTime, afterTime, afterId, limit) as { json: string }[]).map(row => parse(row.json));
  }

  listRuns(groupId: string, limit = 50, after = ''): RunRow[] {
    if (!this.group(groupId)) throw new Error('Workspace group unavailable');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 101) throw new Error('Invalid workspace page size');
    const [afterTime, afterId] = after ? after.split('\0') : ['', ''];
    const rows = this.db.prepare(`SELECT id FROM runs WHERE group_id=? AND (created_at>? OR (created_at=? AND id>?)) ORDER BY created_at,id LIMIT ?`)
      .all(groupId, afterTime, afterTime, afterId, limit) as { id: string }[];
    return rows.map(row => this.run(row.id)!);
  }

  groupSummary(groupId:string,current?:{directory:string;journal:Journal}){
    if(!this.group(groupId))throw new Error('Workspace group unavailable');
    const rows=this.db.prepare('SELECT id FROM runs WHERE group_id=? ORDER BY created_at,id LIMIT 501').all(groupId) as{id:string}[];
    const lifecycles=rows.slice(0,500).map(row=>this.detail(row.id,current).lifecycle);
    return{...summarizeWorkspaceGroup(lifecycles),coverage:rows.length>500?'first-500-runs':'all-recorded-runs',runCount:lifecycles.length};
  }

  listAttempts(runId: string, limit = 50, after = 0): WorkspaceAttemptIdentity[] {
    if (!this.run(runId)) throw new Error('Workspace run unavailable');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 101 || !Number.isSafeInteger(after) || after < 0) throw new Error('Invalid workspace page');
    return (this.db.prepare('SELECT json FROM attempts WHERE run_id=? AND ordinal>? ORDER BY ordinal,id LIMIT ?')
      .all(runId, after, limit) as { json: string }[]).map(row => parse<WorkspaceAttemptIdentity>(row.json));
  }

  private decodeCursor(cursor: string | undefined, kind: string, scope: string): string | number {
    if (!cursor) return kind === 'attempts' || kind === 'events' ? 0 : '';
    let value: Record<string, unknown>;
    try { value = parse<Record<string, unknown>>(Buffer.from(cursor, 'base64url').toString('utf8')); }
    catch { throw new Error('Invalid workspace cursor'); }
    if (value.v !== 1 || value.kind !== kind || value.scope !== scope || (typeof value.after !== 'string' && typeof value.after !== 'number')) throw new Error('Workspace cursor scope mismatch');
    return value.after;
  }

  private encodeCursor(kind: string, scope: string, after: string | number): string {
    return Buffer.from(JSON.stringify({ v: 1, kind, scope, after })).toString('base64url');
  }

  pageGroups(limit = 50, cursor?: string): WorkspacePage<WorkspaceGroupIdentity> {
    const after = this.decodeCursor(cursor, 'groups', 'workspace');
    if (typeof after !== 'string') throw new Error('Invalid workspace cursor');
    const items = this.listGroups(limit + 1, after);
    const more = items.length > limit;
    if (more) items.pop();
    const last = items.at(-1);
    const first = last ? this.db.prepare('SELECT MIN(created_at) AS first FROM runs WHERE group_id=?').get(last.id) as { first: string } : null;
    return { items, next: more && last && first ? this.encodeCursor('groups', 'workspace', `${first.first}\0${last.id}`) : null };
  }

  pageRuns(groupId: string, limit = 50, cursor?: string): WorkspacePage<RunRow> {
    const after = this.decodeCursor(cursor, 'runs', groupId);
    if (typeof after !== 'string') throw new Error('Invalid workspace cursor');
    const items = this.listRuns(groupId, limit + 1, after);
    const more = items.length > limit;
    if (more) items.pop();
    const last = items.at(-1)?.identity;
    return { items, next: more && last ? this.encodeCursor('runs', groupId, `${last.createdAt}\0${last.id}`) : null };
  }

  pageAttempts(runId: string, limit = 50, cursor?: string): WorkspacePage<WorkspaceAttemptIdentity> {
    const after = this.decodeCursor(cursor, 'attempts', runId);
    if (typeof after !== 'number') throw new Error('Invalid workspace cursor');
    const items = this.listAttempts(runId, limit + 1, after);
    const more = items.length > limit;
    if (more) items.pop();
    return { items, next: more ? this.encodeCursor('attempts', runId, items.at(-1)!.ordinal) : null };
  }

  private eventBelongs(run: WorkspaceRunIdentity, event: Event): boolean {
    if (event.run !== run.runtimeRun) return false;
    if (run.kind === 'scenario') return !event.type.startsWith('workshop/') && !event.type.startsWith('workspace/');
    const sourceId=this.workshopSourceId(run.id);
    if(!sourceId)return false;
    return event.changes.some(change => {
      const value = change.value;
      return change.id === sourceId || change.id.startsWith(`${sourceId}:`) || value.sessionId === sourceId ||
        (value.assignment && typeof value.assignment === 'object' && (value.assignment as Record<string, unknown>).id === sourceId);
    });
  }

  pageEvents(runId: string, limit = 50, cursor?: string, current?: { directory: string; journal: { page(run: string, after: number, limit: number): Event[] } }): WorkspacePage<Event> {
    const row = this.run(runId);
    if (!row) throw new Error('Workspace run unavailable');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid workspace page size');
    const after = this.decodeCursor(cursor, 'events', runId);
    if (typeof after !== 'number' || !Number.isSafeInteger(after) || after < 0) throw new Error('Invalid workspace cursor');
    if (row.availability !== 'available') return { items: [], next: null, unavailable: row.availability };
    const source = this.db.prepare('SELECT relative_path FROM sources WHERE id=?').get(row.sourceId) as { relative_path: string };
    const directory = realpathSync(path.join(this.root, source.relative_path));
    if (!within(this.root, directory)) throw new Error('Workspace source outside project runtime');
    const active = current && realpathSync(current.directory) === directory;
    const read = (start: number, count: number): Event[] => {
      if (active) return current.journal.page(row.identity.runtimeRun, start, count);
      const journal = new Database(path.join(directory, 'runtime.sqlite'), { readonly: true, fileMustExist: true });
      try {
        return (journal.prepare("SELECT sequence,json FROM events WHERE sequence>? AND json_extract(json,'$.run')=? ORDER BY sequence LIMIT ?")
          .all(start, row.identity.runtimeRun, count) as { sequence: number; json: string }[]).map(value => ({ ...parse<Event>(value.json), sequence: value.sequence }));
      } finally { journal.close(); }
    };
    const items: Event[] = [];
    let position = after, scanned = 0, more = false;
    while (scanned < 2000 && items.length <= limit) {
      const batch = read(position, Math.min(100, 2000 - scanned));
      if (!batch.length) break;
      for (const event of batch) {
        position = event.sequence; scanned++;
        if (this.eventBelongs(row.identity, event)) items.push(event);
        if (items.length > limit) { more = true; break; }
      }
      if (more || batch.length < 100) break;
    }
    if (items.length > limit) items.pop();
    const next = more || scanned >= 2000 ? this.encodeCursor('events', runId, items.at(-1)?.sequence ?? position) : null;
    return { items, next };
  }

  /** Scan only the three known project roots, never arbitrary client paths. */
  importLegacy(maxDirectories = 500, currentDirectory?: string): { inspected: number; registered: number } {
    let inspected = 0, registered = 0;
    for (const [parent, prefix] of [['startup', 'dashboard-'], ['dashboard', 'run-'], [path.join('scenarios', 'runs'), 'run-']] as const) {
      const base = path.join(this.root, parent);
      if (!existsSync(base)) continue;
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (!entry.name.startsWith(prefix) || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
        if (++inspected > maxDirectories) throw new Error('Legacy workspace scan limit exceeded');
        const directory = path.join(base, entry.name);
        const resolved = realpathSync(directory);
        if (!within(this.root, resolved)) throw new Error('Legacy workspace path escapes project runtime');
        if (currentDirectory && resolved === realpathSync(currentDirectory)) continue;
        const file = path.join(resolved, 'runtime.sqlite');
        if (!existsSync(file)) {
          const source = this.source(resolved, null, 'journal-missing');
          const prior = this.db.prepare('SELECT COUNT(*) AS count FROM runs WHERE source_id=?').get(source.id) as { count: number };
          if (prior.count) continue;
          const id = `unavailable-${key(source.id)}`;
          const group: WorkspaceGroupIdentity = { schema: 1, id: `legacy-group-${id}`, kind: 'legacy', title: 'Unavailable retained dashboard', objective: null,
            scenario: null, parentGroupId: null, coverage: 'legacy-unknown' };
          registered += this.db.transaction(() => this.importLegacyRun(source, group, id, 'unknown', 'scenario', { evidence: 'journal-missing' }, null))();
          continue;
        }
        const source = this.source(resolved, null, 'available');
        const legacy = new Database(file, { readonly: true, fileMustExist: true });
        try {
          const records = legacy.prepare("SELECT run,entity,id,json FROM projections WHERE entity IN ('runs','workshopSessions','workspaceRuns','workspaceGroups','workspaceAttempts') ORDER BY run,entity,id LIMIT 10001")
            .all() as { run: string; entity: string; id: string; json: string }[];
          if (records.length > 10000) throw new Error('Legacy workspace journal scan limit exceeded');
          const firstSeen = new Map<string, string>();
          // Import identity metadata only. Raw activity volume must not prevent startup;
          // each bounded projection lookup returns just its first recorded timestamp.
          const firstEvent = legacy.prepare(`SELECT json_extract(json,'$.wallTime') AS wallTime FROM events
            WHERE json_extract(events.json,'$.run')=? AND EXISTS (SELECT 1 FROM json_each(events.json,'$.changes')
              WHERE json_extract(value,'$.entity')=? AND json_extract(value,'$.id')=?)
            ORDER BY sequence LIMIT 1`);
          for (const row of records) {
            if(row.entity!=='runs'&&row.entity!=='workshopSessions')continue;
            const event = firstEvent.get(row.run,row.entity,row.id) as {wallTime:string}|undefined;
            if(event)firstSeen.set(`${row.run}\0${row.entity}\0${row.id}`,event.wallTime);
          }
          registered += this.db.transaction(() => this.importRecords(source, records, firstSeen))();
        } catch (error) {
          if (String(error).includes('scan limit')) throw error;
          this.source(resolved, null, 'unsupported');
        } finally { legacy.close(); }
      }
    }
    return { inspected, registered };
  }

  private importRecords(source: Source, records: { run: string; entity: string; id: string; json: string }[], firstSeen: Map<string, string> = new Map()): number {
    let registered = 0;
    const byRun = new Map<string, typeof records>();
    for (const row of records) byRun.set(row.run, [...byRun.get(row.run) ?? [], row]);
    for (const [runtimeRun, rows] of byRun) {
      this.source(path.join(this.root, source.relativePath), runtimeRun, 'available');
      const nativeGroups = new Map(rows.filter(row => row.entity === 'workspaceGroups').map(row => [row.id, parse<WorkspaceGroupIdentity>(row.json)]));
      for (const group of nativeGroups.values()) this.db.prepare('INSERT OR IGNORE INTO groups VALUES(?,?)').run(group.id, JSON.stringify(group));
      let nativeScenario = false;
      for (const row of rows.filter(row => row.entity === 'workspaceRuns')) {
        const run = parse<WorkspaceRunIdentity>(row.json);
        if (!nativeGroups.has(run.groupId)) continue;
        registered += this.db.prepare('INSERT OR IGNORE INTO runs VALUES(?,?,?,?,?,?)').run(run.id, run.groupId, source.id, run.createdAt, 'journaled', JSON.stringify(run)).changes;
        if (run.kind === 'scenario') nativeScenario = true;
      }
      for (const row of rows.filter(row => row.entity === 'workspaceAttempts')) {
        const attempt = parse<WorkspaceAttemptIdentity>(row.json);
        if (this.run(attempt.runId)) this.db.prepare('INSERT OR IGNORE INTO attempts VALUES(?,?,?,?)').run(attempt.id, attempt.runId, attempt.ordinal, JSON.stringify(attempt));
      }
      const scenario = rows.find(row => row.entity === 'runs' && typeof parse<Record<string, unknown>>(row.json).scenario === 'string');
      if (scenario && !nativeScenario) {
        const manifest = parse<Record<string, unknown>>(scenario.json);
        const id = `legacy-scenario-${key(source.id + ':' + scenario.id)}`;
        const group: WorkspaceGroupIdentity = { schema: 1, id: `legacy-group-${id}`, kind: 'legacy', title: String(manifest.objective ?? 'Legacy scenario'),
          objective: typeof manifest.objective === 'string' ? manifest.objective : null,
          scenario: typeof manifest.scenario === 'string' ? { id: manifest.scenario, version: typeof manifest.scenarioVersion === 'string' ? manifest.scenarioVersion : null } : null,
          parentGroupId: null, coverage: 'legacy-unknown' };
        registered += this.importLegacyRun(source, group, id, runtimeRun, 'scenario', manifest, null, firstSeen.get(`${runtimeRun}\0runs\0${scenario.id}`));
        const control=rows.find(row=>row.entity==='runs'&&row.id==='operator-control');
        const status=control?parse<{status?:string}>(control.json).status:null;
        if (status && !['stopped','disconnected'].includes(status)) this.adoptLegacyOwner(id,source.id,'scenario');
      }
      for (const row of rows.filter(row => row.entity === 'workshopSessions')) {
        const session = parse<Record<string, unknown>>(row.json);
        if (rows.some(value => value.entity === 'workspaceRuns' && value.id === row.id)) continue;
        const assignment = session.assignment && typeof session.assignment === 'object' ? session.assignment : { legacySessionId: row.id };
        const objective = (assignment as Record<string, unknown>).objective;
        const id = `legacy-workshop-${key(source.id + ':' + row.id)}`;
        const group: WorkspaceGroupIdentity = { schema: 1, id: `legacy-group-${id}`, kind: 'legacy', title: typeof objective === 'string' ? objective : 'Legacy workshop',
          objective: typeof objective === 'string' ? objective : null, scenario: null, parentGroupId: null, coverage: 'legacy-unknown' };
        registered += this.importLegacyRun(source, group, id, runtimeRun, 'workshop', assignment, typeof (assignment as Record<string, unknown>).comparisonSeries === 'string' ? String((assignment as Record<string, unknown>).comparisonSeries) : null,
          firstSeen.get(`${runtimeRun}\0workshopSessions\0${row.id}`));
        // Repeated import also repairs catalogs created before source-session mapping existed.
        this.db.prepare('INSERT OR IGNORE INTO legacy_sessions VALUES(?,?)').run(id,row.id);
        if (!['complete','stopped'].includes(String(session.stage))) this.adoptLegacyOwner(id,source.id);
        const iterations = Array.isArray(session.iterations) ? session.iterations : [];
        for (const [index, raw] of iterations.entries()) {
          const value = raw as Record<string, unknown>;
          const attempt: WorkspaceAttemptIdentity = { schema: 1, id: `${id}:${index + 1}`, runId: id, ordinal: index + 1,
            sourceId: typeof value.id === 'string' ? value.id : null, coverage: typeof value.id === 'string' ? 'recorded' : 'legacy-unknown' };
          this.db.prepare('INSERT OR IGNORE INTO attempts VALUES(?,?,?,?)').run(attempt.id, id, attempt.ordinal, JSON.stringify(attempt));
        }
      }
    }
    return registered;
  }

  private adoptLegacyOwner(id:string,sourceId:string,kind:'scenario'|'workshop'='workshop'):void {
    this.db.prepare('INSERT OR IGNORE INTO legacy_ownership_candidates VALUES(?)').run(id);
    if(this.owner())return;
    const prior = this.request(id);
    if (prior && ['completed','cancelled','failed'].includes(prior.state)) return; // Import cannot resurrect a retired request.
    const value:WorkspaceRequest={id,kind,requestHash:immutableAssignmentHash({legacy:id}),state:'held',reason:'legacy_ownership_requires_exact_reconciliation',createdAt:new Date().toISOString()};
    this.db.prepare('INSERT OR IGNORE INTO requests VALUES(?,?,?,?,?,?)').run(value.id,value.kind,value.requestHash,value.state,value.reason,value.createdAt);
    this.db.prepare('INSERT OR IGNORE INTO owner VALUES(1,?)').run(id);
    this.db.prepare('INSERT OR IGNORE INTO request_sources VALUES(?,?)').run(id,sourceId);
  }

  private importLegacyRun(source: Source, group: WorkspaceGroupIdentity, id: string, runtimeRun: string, kind: 'workshop' | 'scenario', assignment: unknown, comparisonSeries: string | null, createdAt?: string): number {
    this.db.prepare('INSERT OR IGNORE INTO groups VALUES(?,?)').run(group.id, JSON.stringify(group));
    const run = createWorkspaceRunIdentity({ id, groupId: group.id, runtimeRun, kind, assignment, comparisonSeries,
      createdAt: createdAt && Number.isFinite(Date.parse(createdAt)) ? createdAt : '1970-01-01T00:00:00.000Z' });
    return this.db.prepare('INSERT OR IGNORE INTO runs VALUES(?,?,?,?,?,?)').run(run.id, group.id, source.id, run.createdAt, 'legacy', JSON.stringify(run)).changes;
  }
}
