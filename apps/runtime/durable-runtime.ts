import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateReceipt, validateRequest } from '@autofactorio/contracts';
import type { Batch, GameRequest, RunManifest, TaskRecord } from '@autofactorio/contracts';
import { Budget } from '../../packages/codex/src/budget.js';
import type { BudgetState, Caps, StopCallback } from '../../packages/codex/src/budget.js';
import { DurableExecution } from '../../packages/core/execution/durable.js';
import { Ownership } from '../../packages/core/execution/ownership.js';
import type { Change, EventContext, Reference, Visibility } from '../../packages/core/execution/durable.js';
import { SqliteJournal } from '../../packages/storage/src/journal.js';
import { Artifacts, redactor } from '../../packages/storage/src/artifacts.js';
import type { Artifact, Audience } from '../../packages/storage/src/artifacts.js';
import type { GameClient } from '../../packages/factorio/src/client.js';
import { barrier, captureCheckpoint, validateCheckpoint, verifyLoaded, fence } from '../../packages/factorio/src/lifecycle.js';
import type { Lifecycle, ControlState } from '../../packages/factorio/src/lifecycle.js';
interface SavedBudget { caps: Caps; state: BudgetState; savedAt: number }
interface CheckpointRecord { manifest: string; save: string; eventCursor: number; source: 'managed-disarmed' }
/** Local composition root. Archive APIs here are operator-internal; no gameplay history endpoint yet. */
export class DurableRuntime {
  readonly journal: SqliteJournal;
  readonly artifacts: Artifacts;
  readonly execution: DurableExecution;
  readonly ownership: Ownership;
  private session = '';
  private ready = false;
  private active = false;
  private budget?: Budget;
  /** Additional synchronous scheduler admission check, including the post-inspection send boundary. */
  admissionGuard: ((batch: Batch) => void) | undefined;
  constructor(readonly directory: string, readonly run: string, private epoch: string, private game: GameClient, private lifecycle: Lifecycle, secrets: string[] = []) {
    mkdirSync(directory, { recursive: true });
    const sanitize = redactor(secrets);
    this.journal = new SqliteJournal(path.join(directory, 'runtime.sqlite'), sanitize);
    this.artifacts = new Artifacts(path.join(directory, 'artifacts'), sanitize);
    this.game.admission = false;
    this.ownership = new Ownership(this.journal, () => this.context(), { control: request => this.lifecycle.ownership(request) }, () => this.session);
    this.execution = new DurableExecution(this.journal, () => this.context(), {
      inspect: () => this.lifecycle.inspect(),
      authorize: batch => this.authorize(batch),
      submit: async batch => {
        const result = await this.game.request({ op: 'submit', batch });
        const receipt = validateReceipt(result.receipt); if (!receipt) throw new Error('Missing command acknowledgement'); return receipt;
      },
    });
  }
  context(visibility: Visibility = { kind: 'operator' }): EventContext { return { run: this.run, epoch: this.epoch, wallTime: new Date().toISOString(), gameTick: null, actor: null, task: null, causation: null, correlation: null, visibility }; }
  record(type: string, changes: Change[], visibility: Visibility = { kind: 'operator' }, gameTick: number | null = null): void { this.journal.append({ ...this.context(visibility), gameTick }, type, changes); }
  initialize(manifest: RunManifest): void {
    if (this.journal.get(this.run, 'runs', this.run)) throw new Error('Run already exists');
    this.record('run/created', [{ entity: 'runs', id: this.run, value: { ...manifest } }]);
  }
  task(task: TaskRecord): void {
    const prior = this.journal.get<TaskRecord>(this.run, 'tasks', task.id);
    if (prior && task.revision <= prior.revision) throw new Error('Task revision must increase');
    for (const r of this.ownership.list().filter(r => r.task === task.id && r.state !== 'released')) this.ownership.revoke(r.id);
    this.record('task/committed', [{ entity: 'tasks', id: task.id, value: { ...task } }]);
  }
  private authorize(batch: Batch): void {
    this.checkBudget();
    this.admissionGuard?.(batch);
    const task = this.journal.get<TaskRecord>(this.run, 'tasks', batch.task);
    if (!task?.owner || task.revision !== batch.revision || ['cancelled', 'superseded', 'succeeded', 'failed'].includes(task.status)) throw new Error('Task admission closed');
    this.ownership.authorize(batch, task.owner);
  }
  createBudget(caps: Caps, now: () => number, stop: StopCallback): Budget {
    if (this.budget) throw new Error('One roster budget per runtime');
    const saved = this.journal.get<SavedBudget>(this.run, 'budgets', this.run);
    if (saved && JSON.stringify(saved.caps) !== JSON.stringify(caps)) throw new Error('Budget caps cannot reset on replacement');
    const prior = saved ? structuredClone(saved.state) : undefined;
    if (saved && prior) {
      const downtime = Math.max(0, Date.now() - saved.savedAt); prior.elapsedMs += downtime;
      for (const turn of prior.turns) if (!turn.finished) turn.elapsedMs += downtime;
    }
    this.budget = new Budget(caps, now, stop, prior, state => this.record('budget/accounted', [{ entity: 'budgets', id: this.run, value: { caps, state, savedAt: Date.now() } }]));
    return this.budget;
  }
  evidence(purpose: Artifact['purpose'], value: unknown, visibility: Visibility): Artifact {
    const artifact = this.artifacts.put(this.context(visibility), purpose, value);
    this.record('artifact/recorded', [{ entity: 'artifacts', id: artifact.id, value: { ...artifact } }], visibility); return artifact;
  }
  /** Return precisely the recorded sanitized response; richer telemetry is a separate operator artifact. */
  observation(response: unknown, telemetry: unknown, visibility: Visibility, sources: Reference[] = []): unknown {
    const exact = this.artifacts.put(this.context(visibility), 'agent-observation', response);
    const full = this.artifacts.put(this.context(), 'operator-telemetry', telemetry);
    this.record('observation/returned', [
      { entity: 'artifacts', id: exact.id, value: { ...exact }, visibility, sources }, { entity: 'artifacts', id: full.id, value: { ...full } },
      { entity: 'observations', id: exact.id, value: { response: exact.id, telemetry: full.id, visibility } },
    ], { kind: 'operator' }, response && typeof response === 'object' && 'tick' in response && Number.isSafeInteger(response.tick) ? Number(response.tick) : null); // Operator reference keeps this envelope operator-only.
    const read = this.artifacts.read(exact, { kind: 'operator' });
    if (!read.available) throw new Error('Exact observation evidence unavailable');
    return JSON.parse(read.bytes.toString());
  }
  readArtifact(id: string, audience: Audience) {
    const a = this.journal.get<Artifact>(this.run, 'artifacts', id);
    return a ? this.artifacts.read(a, audience) : { available: false as const, reason: 'missing' as const };
  }
  query(request: Extract<GameRequest, { op: 'observe' | 'recipe' | 'operational-register' | 'operational-read' }>) { return this.game.request(request); }
  inspectControl() { return this.lifecycle.inspect(); }
  hasControlSession(): boolean { return this.session.length > 0; }
  heartbeat(control: ControlState) { return this.lifecycle.heartbeat(control); }
  humanEdits(after: number) { return this.lifecycle.edits(after); }
  recovery() {
    const evidence = this.journal.list<Artifact>(this.run, 'artifacts').map(a => ({ id: a.id, ...this.artifacts.read(a, { kind: 'operator' }), bytes: undefined }));
    return { run: this.journal.get<RunManifest>(this.run, 'runs', this.run), agents: this.journal.list(this.run, 'agents'), tasks: this.journal.list<TaskRecord>(this.run, 'tasks'), messages: this.journal.list(this.run, 'messages'), budget: this.journal.get<SavedBudget>(this.run, 'budgets', this.run), commands: this.execution.pending(), checkpoints: this.journal.list(this.run, 'checkpoints'), evidence, complete: evidence.every(e => e.available) };
  }
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.active) throw new Error('Runtime operation in progress'); this.active = true;
    try { return await work(); } finally { this.active = false; }
  }
  private async hold(): Promise<ControlState> {
    this.game.admission = false;
    const current = await this.lifecycle.inspect();
    // A second pause RPC on an already held world can leave pausePending for its next engine update.
    if (!current.armed && current.paused && current.neutral && current.ticksToRun === 0) { barrier(current); return current; }
    return this.lifecycle.pause(current);
  }
  private syncClientUncertainty(): void {
    for (const command of this.execution.pending()) {
      if (command.state === 'acknowledged' || command.state === 'rolled_back') this.game.unresolved.delete(command.batch.commandId);
    }
  }
  private checkBudget(): void {
    if (this.journal.get(this.run, 'budgets', this.run) && !this.budget) throw new Error('Persisted budget must be reconstructed before admission');
    if (this.budget?.snapshot().closed) throw new Error('Runtime admission closed by budget');
  }
  async recover(): Promise<ControlState> {
    return this.exclusive(async () => {
      this.ready = false; this.game.admission = false;
      const control = await this.hold();
      this.epoch = control.epoch;
      this.session = control.session;
      await this.execution.reconcile(); this.syncClientUncertainty();
      if (!this.recovery().complete) throw new Error('Incomplete evidence blocks recovery');
      if (this.execution.pending().some(c => c.state === 'unknown' || c.state === 'sending')) throw new Error('Unknown effects require managed checkpoint reconciliation');
      // Holding the world does not authorize new effects; explicit arm remains required.
      return control;
    });
  }
  async resume(control: ControlState, verification = false): Promise<ControlState> {
    return this.exclusive(async () => {
      this.ready = false; this.checkBudget();
      if (!this.recovery().complete) throw new Error('Incomplete evidence blocks resume');
      await this.execution.reconcile();
      if (this.execution.pending().some(c => c.state === 'unknown' || c.state === 'sending')) throw new Error('Unknown effects block resume');
      if (verification) {
        barrier(control);
        const resumed = await this.lifecycle.rpc({ op: 'resume-verification', ...fence(control) });
        if (!resumed.armed || resumed.paused || resumed.epoch !== control.epoch || resumed.session !== control.session) throw new Error('Verification resume unconfirmed');
        // The game retains its mutation guard; no construction authority is restored here.
        this.ready = false; this.game.admission = false; return resumed;
      }
      const reconciled = await this.lifecycle.reconcile(control, []);
      this.epoch = reconciled.epoch;
      this.session = reconciled.session;
      this.ownership.restoreHeld();
      // Reconcile cancels suspended work and changes epochs. Retire all old intents against its held ledger.
      barrier(reconciled); this.execution.checkpointLedger(reconciled); this.syncClientUncertainty();
      const armed = await this.lifecycle.arm(reconciled);
      this.epoch = armed.epoch;
      await this.execution.reconcile(); this.ready = true; return armed;
    });
  }
  intent(batch: Batch, visibility: Visibility = { kind: 'operator' }): void { validateRequest({ op: 'submit', batch }); if (!this.ready) throw new Error('Runtime admission closed'); this.authorize(batch); this.execution.intent(batch, visibility); }
  async dispatch(id: string) {
    return this.exclusive(async () => {
      this.checkBudget();
      if (!this.ready || !this.recovery().complete) throw new Error('Runtime admission closed');
      try { return await this.execution.dispatch(id); } catch (error) { this.ready = false; this.game.admission = false; throw error; }
    });
  }
  async capture(options: Omit<Parameters<typeof captureCheckpoint>[0], 'lifecycle' | 'paused' | 'eventCursor'>): Promise<string> {
    return this.exclusive(async () => {
      this.ready = false;
      const paused = await this.hold();
      this.epoch = paused.epoch;
      await this.execution.reconcile();
      if (!this.recovery().complete || this.execution.pending().some(c => c.state === 'unknown')) throw new Error('Incomplete evidence or unknown effects blocks checkpoint');
      const manifestPath = await captureCheckpoint({ ...options, lifecycle: this.lifecycle, paused, eventCursor: () => this.journal.cursor() });
      await this.publishCheckpoint(manifestPath, options.modHash); return manifestPath;
    });
  }
  private async publishCheckpoint(file: string, modHash: string): Promise<void> {
    const m = await validateCheckpoint(file, modHash);
    if (m.eventCursor > this.journal.cursor()) throw new Error('Checkpoint cursor is beyond journal');
    const save = this.artifacts.bytes(this.context(), 'save', readFileSync(path.join(path.dirname(file), m.save)), 'application/zip');
    if (save.sha256 !== m.sha256) throw new Error('Checkpoint save changed before registration');
    const manifest = this.artifacts.put(this.context(), 'checkpoint', m);
    this.record('checkpoint/published', [
      { entity: 'artifacts', id: save.id, value: { ...save } }, { entity: 'artifacts', id: manifest.id, value: { ...manifest } },
      { entity: 'checkpoints', id: m.name, value: { manifest: manifest.id, save: save.id, eventCursor: m.eventCursor, source: m.source } },
    ], { kind: 'operator' }, m.captured.tick);
  }
  async restoreHeld(name: string, modHash: string, loaded: ControlState, world: Record<string, unknown>): Promise<void> {
    return this.exclusive(async () => {
      this.ready = false; this.game.admission = false; barrier(loaded);
      const checkpoint = this.journal.get<CheckpointRecord>(this.run, 'checkpoints', name);
      if (!checkpoint || !this.recovery().complete) throw new Error('Incomplete checkpoint evidence');
      const manifestEvidence = this.readArtifact(checkpoint.manifest, { kind: 'operator' });
      const saveEvidence = this.readArtifact(checkpoint.save, { kind: 'operator' });
      if (!manifestEvidence.available || !saveEvidence.available) throw new Error('Incomplete checkpoint evidence');
      // Materialize an isolated managed pair, then reuse phase 04 validation, including ZIP completion.
      const { writeFileSync } = await import('node:fs');
      const m = JSON.parse(manifestEvidence.bytes.toString()) as { save: string; name: string };
      if (m.name !== name || m.save !== name + '.zip' || !/^[\w.-]{1,100}$/.test(name)) throw new Error('Invalid checkpoint identity');
      const dir = path.join(this.directory, 'validation-' + randomUUID()); mkdirSync(dir);
      const file = path.join(dir, name + '.json'); writeFileSync(file, manifestEvidence.bytes); writeFileSync(path.join(dir, m.save), saveEvidence.bytes);
      const validated = await validateCheckpoint(file, modHash); verifyLoaded(validated, loaded, world);
      this.epoch = loaded.epoch; this.execution.checkpointLedger(loaded); this.syncClientUncertainty();
      this.session = loaded.session; this.ownership.restoreHeld();
      this.record('checkpoint/restored-held', [{ entity: 'checkpoints', id: name, value: { ...checkpoint, restoredHeld: true } }], { kind: 'operator' }, loaded.tick);
    });
  }
  async backup(destination: string): Promise<{ cursor: number; complete: boolean }> {
    mkdirSync(destination); // Never overwrite a prior backup or its evidence.
    const file = path.join(destination, 'runtime.sqlite');
    await this.journal.backup(file);
    const snapshot = new SqliteJournal(file);
    try {
      const artifactDirectory = path.join(destination, 'artifacts'); mkdirSync(artifactDirectory);
      const manifest = snapshot.list<Artifact>(this.run, 'artifacts').map(a => {
        const result = this.artifacts.read(a, { kind: 'operator' });
        if (result.available) writeFileSync(path.join(artifactDirectory, a.id), result.bytes, { flag: 'wx' });
        return { ...a, available: result.available, reason: result.available ? null : result.reason };
      });
      const result = { cursor: snapshot.cursor(), complete: manifest.every(a => a.available) };
      writeFileSync(path.join(destination, 'backup-manifest.json'), JSON.stringify({ ...result, run: this.run, artifacts: manifest }, null, 2));
      return result;
    } finally { snapshot.close(); }
  }
  close(): void { if (this.active) throw new Error('Runtime operation in progress'); this.ready = false; this.game.admission = false; this.journal.close(); }
}
