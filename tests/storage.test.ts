import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { SqliteJournal, entities } from '../packages/storage/src/journal.js';
import { Artifacts, redactor } from '../packages/storage/src/artifacts.js';
import { DurableExecution } from '../packages/core/execution/durable.js';
import type { Command, EventContext, WorldReceipts } from '../packages/core/execution/durable.js';
import type { Batch, Receipt } from '@autofactorio/contracts';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import type { ControlState } from '../packages/factorio/src/lifecycle.js';
import { Budget, PROBE_CAPS } from '../packages/codex/src/budget.js';
const context: EventContext = { run: 'run', epoch: 'e1', wallTime: '2026-09-15T12:00:00Z', gameTick: 100, actor: 'engineer', task: 'task', causation: 'cause', correlation: 'correlation', visibility: { kind: 'operator' } };
const temp = () => mkdtempSync(path.join(os.tmpdir(), 'af-durable-'));
const batch: Batch = { commandId: 'command', epoch: 'e1', session: 's1', actor: 'builder-1', task: 'task', revision: 1, surface: 'nauvis', grant: { id: 'test-area', generation: 1 }, deadline: 1000, steps: [{ kind: 'place', item: 'wooden-chest', quality: 'normal', direction: 0, position: { x: 2.5, y: 2.5 } }] };
const receipt: Receipt = { commandId: 'command', status: 'completed', acceptedTick: 100, endedTick: 101, completed: 1, unexecuted: 0, steps: [{ index: 1, status: 'completed', startedTick: 100, endedTick: 101, before: [], after: [], delta: [] }] };
const change = (id = 'task') => [{ entity: 'tasks' as const, id, value: { owner: 'engineer', committedPlan: 'place one chest', status: 'pending', evidence: [] } }];
function fakeRuntime(dir: string, configure?: (game: GameClient, control: ControlState, life: Lifecycle) => void) {
  const control: ControlState = { ok: true, epoch: 'e1', session: 's1', revision: 1, generation: 1, armed: false, ready: false, paused: true, neutral: true, ticksToRun: 0, tick: 100, ticksPlayed: 200, experimentTick: 100, scenarioElapsed: 100, injections: 1, checkpoint: false, ledger: {}, intents: {}, production: {}, mods: {} };
  const port = { command: async () => JSON.stringify(control), close: () => {} };
  const game = new GameClient(port, () => {}); const life = new Lifecycle(port, game, () => {});
  configure?.(game, control, life);
  return new DurableRuntime(dir, 'run', 'e1', game, life, ['private-credential']);
}
describe('phase 05 durable storage', () => {
  it('migrates, retains envelope and rebuilds every current projection plus outbox', () => {
    const file = path.join(temp(), 'runtime.sqlite'); let j = new SqliteJournal(file);
    for (const entity of entities) j.append(context, entity + '/recorded', [{ entity, id: entity, value: { revision: 1 } }]);
    j.append(context, 'task/revised', change()); const expected = j.snapshot(); const events = j.events();
    expect(events.map(e => e.sequence)).toEqual(Array.from({ length: entities.length + 1 }, (_, i) => i + 1));
    expect(events[0]).toMatchObject({ ...context, version: 1 });
    j.close(); j = new SqliteJournal(file); expect(j.snapshot()).toEqual(expected); j.rebuild(); expect(j.snapshot()).toEqual(expected); j.close();
  });
  it('rolls back an event and all projections/outbox on a projection failure', () => {
    const file = path.join(temp(), 'runtime.sqlite'); let j = new SqliteJournal(file); j.close();
    const db = new Database(file); db.exec("CREATE TRIGGER fail_projection BEFORE INSERT ON projections WHEN NEW.entity='commands' BEGIN SELECT RAISE(ABORT,'injected failure'); END;"); db.close();
    j = new SqliteJournal(file); expect(() => j.append(context, 'atomic', [...change(), { entity: 'commands', id: 'command', value: { batch } }])).toThrow('injected failure'); j.close();
    j = new SqliteJournal(file); expect(j.cursor()).toBe(0); expect(j.list('run', 'tasks')).toEqual([]); expect(j.snapshot()).toEqual({ projections: [], outbox: [] }); j.close();
  });
  it.each(['before-projection', 'after-commit'])('survives abrupt process exit %s', point => {
    const dir = temp(); const file = path.join(dir, 'runtime.sqlite');
    // Use the actual compiled adapter. verify builds before running tests.
    const script = `import {SqliteJournal} from './dist/packages/storage/src/journal.js';
      const j=new SqliteJournal(process.argv[1]);
      if(process.argv[2]==='before-projection') { j.db.function('crash',()=>process.exit(71)); j.db.exec('CREATE TRIGGER crash_projection BEFORE INSERT ON projections BEGIN SELECT crash(); END;'); }
      j.append(${JSON.stringify(context)},'task/committed',${JSON.stringify(change())}); process.exit(72);`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, file, point], { encoding: 'utf8', windowsHide: true });
    expect(child.stderr).toBe(''); expect(child.status).toBe(point === 'before-projection' ? 71 : 72);
    const j = new SqliteJournal(file); expect(j.cursor()).toBe(point === 'before-projection' ? 0 : 1);
    expect(j.list('run', 'tasks')).toHaveLength(point === 'before-projection' ? 0 : 1); j.close();
  });
  it('enforces one writer and releases the lock after close', () => {
    const file = path.join(temp(), 'runtime.sqlite'); const j = new SqliteJournal(file);
    expect(() => new SqliteJournal(file)).toThrow(/locked/); j.close(); new SqliteJournal(file).close();
  });
  it('rejects future migrations and protects append-only rows', () => {
    const file = path.join(temp(), 'runtime.sqlite'); const j = new SqliteJournal(file); j.append(context, 'task/committed', change()); j.close();
    const db = new Database(file); expect(() => db.exec('DELETE FROM events')).toThrow('append-only'); expect(() => db.exec("UPDATE events SET json='{}'")).toThrow('append-only'); db.pragma('user_version=99'); db.close();
    expect(() => new SqliteJournal(file)).toThrow('Unsupported');
  });
  it('backs up active WAL while queued producers append, then rebuilds an identical snapshot', async () => {
    const dir = temp(); const j = new SqliteJournal(path.join(dir, 'runtime.sqlite'));
    for (let i = 0; i < 150; i++) j.append(context, 'task/committed', [{ entity: 'tasks', id: 'task-' + i, value: { text: 'x'.repeat(5000) } }]);
    let writes = 0;
    await j.backup(path.join(dir, 'backup.sqlite'), () => { if (writes < 8) j.append(context, 'task/concurrent', change('new-' + writes++)); return 8; });
    expect(writes).toBeGreaterThan(0);
    const backup = new SqliteJournal(path.join(dir, 'backup.sqlite')); const snapshot = backup.snapshot(); backup.rebuild(); expect(backup.snapshot()).toEqual(snapshot);
    expect(backup.cursor()).toBeGreaterThanOrEqual(150); expect(backup.cursor()).toBeLessThanOrEqual(j.cursor()); backup.close(); j.close();
  });
});
describe('intent/outbox recovery', () => {
  it.each(['before-send', 'after-effect', 'after-ack'])('reconciles %s across controller replacement without duplicate effect', async point => {
    const file = path.join(temp(), 'runtime.sqlite'); let j = new SqliteJournal(file); let effects = 0;
    const world: WorldReceipts = { epoch: 'e1', session: 's1', ledger: {} };
    const game = { inspect: async () => world, submit: async () => { effects++; world.ledger.command = receipt; if (point === 'after-effect') throw new Error('process lost acknowledgement'); return receipt; } };
    let execution = new DurableExecution(j, () => context, game); execution.intent(batch);
    expect(j.get<Command>('run', 'commands', 'command')?.state).toBe('pending');
    if (point !== 'before-send') { await execution.reconcile(); if (point === 'after-effect') await expect(execution.dispatch('command')).rejects.toThrow(); else await execution.dispatch('command'); }
    j.close(); j = new SqliteJournal(file); execution = new DurableExecution(j, () => context, game);
    await expect(execution.dispatch('command')).rejects.toThrow('Reconciliation'); await execution.reconcile();
    if (point === 'before-send') await execution.dispatch('command'); else await expect(execution.dispatch('command')).rejects.toThrow('unsent');
    expect(effects).toBe(1); expect(j.get<Command>('run', 'commands', 'command')?.receipt).toEqual(receipt); j.close();
  });
  it('retains uncertainty for missing receipts, epoch changes and conflicting admission', async () => {
    const j = new SqliteJournal(path.join(temp(), 'runtime.sqlite')); const world: WorldReceipts = { epoch: 'e1', session: 's1', ledger: {} };
    const execution = new DurableExecution(j, () => context, { inspect: async () => world, submit: async () => { throw new Error('disconnected'); } });
    execution.intent(batch); await execution.reconcile(); await expect(execution.dispatch('command')).rejects.toThrow('disconnected'); await execution.reconcile();
    expect(j.get<Command>('run', 'commands', 'command')?.state).toBe('unknown'); expect(() => execution.intent({ ...batch, commandId: 'conflict' })).toThrow('Unresolved');
    world.epoch = 'restored'; world.ledger.command = receipt; await execution.reconcile(); expect(j.get<Command>('run', 'commands', 'command')?.receipt).toBeNull(); j.close();
  });
  it('does not submit if committing the send boundary fails', async () => {
    const j = new SqliteJournal(path.join(temp(), 'runtime.sqlite')); let sends = 0;
    const port = { append: j.append.bind(j), get: j.get.bind(j), list: j.list.bind(j) };
    const e = new DurableExecution(port, () => context, { inspect: async () => ({ epoch: 'e1', session: 's1', ledger: {} }), submit: async () => { sends++; return receipt; } });
    e.intent(batch); await e.reconcile(); port.append = () => { throw new Error('disk full'); }; await expect(e.dispatch('command')).rejects.toThrow('disk full'); expect(sends).toBe(0); j.close();
  });
  it('replaces post-checkpoint effect claims with the validated held ledger', () => {
    const j = new SqliteJournal(path.join(temp(), 'runtime.sqlite')); const e = new DurableExecution(j, () => context, { inspect: async () => ({ epoch: 'e1', session: 's1', ledger: {} }), submit: async () => receipt });
    e.intent(batch); e.checkpointLedger({ epoch: 'saved', session: 'saved', ledger: {} });
    expect(e.pending()[0]).toMatchObject({ state: 'rolled_back', receipt: null, reason: 'managed_checkpoint_requires_fresh_authorization' }); j.close();
  });
});
describe('artifacts and model-independent state', () => {
  it('redacts credentials in nested fields and free text with explicit visibility', () => {
    const a = new Artifacts(temp(), redactor(['private-credential']));
    const artifact = a.put(context, 'public-transcript', { password: 'hidden', value: 'Bearer abc123 private-credential api_key=hidden' });
    const read = a.read(artifact, { kind: 'operator' }); expect(read.available).toBe(true);
    if (read.available) { expect(read.bytes.toString()).not.toMatch(/hidden|abc123|private-credential/); expect(artifact.redacted).toBe(true); }
    expect(() => a.put({ ...context, visibility: undefined as never }, 'public-transcript', {})).toThrow('visibility');
  });
  it('distinguishes missing, corrupt and unauthorized evidence and denies cross-run reads', () => {
    const dir = temp(); const a = new Artifacts(dir, redactor()); const artifact = a.put(context, 'public-transcript', { data: 'fact' });
    expect(a.read(artifact, { kind: 'agent', run: 'run', agent: 'a', role: 'engineer', task: null })).toEqual({ available: false, reason: 'unauthorized' });
    const shared = a.put({ ...context, visibility: { kind: 'shared' } }, 'agent-observation', {});
    expect(a.read(shared, { kind: 'agent', run: 'different', agent: 'a', role: 'engineer', task: null }).available).toBe(false);
    writeFileSync(path.join(dir, artifact.id), 'broken'); expect(a.read(artifact, { kind: 'operator' })).toEqual({ available: false, reason: 'corrupt' });
    unlinkSync(path.join(dir, artifact.id)); expect(a.read(artifact, { kind: 'operator' })).toEqual({ available: false, reason: 'missing' });
  });
  it('retains the exact response returned to the agent separately from operator telemetry', () => {
    const runtime = fakeRuntime(temp()); const response = { entities: [1], truncated: true, nextOffset: 1 };
    expect(runtime.observation(response, { ...response, evaluator: 'hidden', password: 'private-credential' }, { kind: 'restricted', agents: ['engineer'], roles: [], tasks: [] })).toEqual(response);
    const observation = runtime.journal.list<{ response: string; telemetry: string }>('run', 'observations')[0]!;
    const exact = runtime.readArtifact(observation.response, { kind: 'agent', run: 'run', agent: 'engineer', role: 'engineer', task: null });
    expect(exact.available).toBe(true); if (exact.available) expect(JSON.parse(exact.bytes.toString())).toEqual(response);
    expect(runtime.readArtifact(observation.telemetry, { kind: 'agent', run: 'run', agent: 'engineer', role: 'engineer', task: null }).available).toBe(false); runtime.close();
  });
  it('reconstructs objective, ownership, plan, pending work and budgets without transcripts', () => {
    const dir = temp(); let runtime = fakeRuntime(dir); let clock = 0;
    runtime.record('run/created', [{ entity: 'runs', id: 'run', value: { objective: 'one chest' } }, ...change()]);
    const budget = runtime.createBudget(PROBE_CAPS, () => clock, () => {}); const turn = budget.admit('engineer'); budget.attempt(turn.id); budget.usage('old-session', 42); clock = 1234; budget.snapshot(); runtime.execution.intent(batch); runtime.close();
    runtime = fakeRuntime(dir); const stopped: string[] = []; const recovered = runtime.createBudget(PROBE_CAPS, () => 0, t => stopped.push(t.id));
    expect(recovered.state.spentTurns).toBe(1); expect(recovered.state.attempts).toBe(1); expect(recovered.state.reportedTokens).toBe(42); expect(recovered.state.elapsedMs).toBeGreaterThanOrEqual(1234); expect(stopped).toEqual([turn.id]);
    expect(runtime.recovery()).toMatchObject({ run: { objective: 'one chest' }, tasks: [{ owner: 'engineer', committedPlan: 'place one chest' }], commands: [{ state: 'pending' }], complete: true });
    recovered.usage('old-session', 42); expect(recovered.state.reportedTokens).toBe(42); runtime.close();
  });
  it('blocks recovery on missing evidence and reports incomplete backup bundles', async () => {
    const dir = temp(); const runtime = fakeRuntime(dir); const artifact = runtime.evidence('public-transcript', { text: 'visible activity' }, { kind: 'operator' });
    unlinkSync(path.join(dir, 'artifacts', artifact.id)); expect(runtime.recovery().complete).toBe(false); await expect(runtime.recover()).rejects.toThrow('Incomplete evidence');
    expect((await runtime.backup(path.join(dir, 'backup'))).complete).toBe(false); runtime.close();
  });
  it('backs up database and artifact references from the same recorded point', async () => {
    const dir = temp(); const runtime = fakeRuntime(dir); runtime.observation({ allowed: 1 }, { private: 2 }, { kind: 'shared' });
    const backup = path.join(dir, 'backup'); const running = runtime.backup(backup); for (let i = 0; i < 8; i++) runtime.evidence('public-transcript', { i }, { kind: 'operator' });
    expect((await running).complete).toBe(true); const copied = fakeRuntime(backup); expect(copied.recovery().complete).toBe(true);
    const manifest = JSON.parse(readFileSync(path.join(backup, 'backup-manifest.json'), 'utf8')) as { cursor: number; artifacts: unknown[] };
    expect(copied.journal.cursor()).toBe(manifest.cursor); expect(copied.journal.list('run', 'artifacts')).toHaveLength(manifest.artifacts.length); copied.close(); runtime.close();
  });
});

describe('phase 05 recovery regressions', () => {
  it.each(['turn', 'run'])('stops all active work despite a failed durable %s closure', scope => {
    let fail = false; const stopped: string[] = [];
    const budget = new Budget(PROBE_CAPS, () => 0, t => { stopped.push(t.id); if (stopped.length === 1) throw new Error('stop transport failed'); }, undefined, () => { if (fail) throw new Error('disk full'); });
    const first = budget.admit('engineer'); const second = budget.admit('foreman'); fail = true;
    expect(() => scope === 'turn' ? budget.closeTurn(first, 'time') : budget.closeRun('time')).toThrow('disk full');
    expect(budget.state.closed).toBe(true); expect(stopped).toEqual([first.id, second.id]);
    expect(budget.state.turns.every(t => t.closed && t.interrupt === 'unconfirmed' && t.cancellation === 'unconfirmed')).toBe(true);
  });
  it('notifies each stop once under reentrant persistence failure and later cancellation confirmation', () => {
    let fail = false; const stopped: string[] = [];
    const budget = new Budget(PROBE_CAPS, () => 0, t => { stopped.push(t.id); budget.attempt(t.id); }, undefined, () => { if (fail) throw new Error('disk full'); });
    const first = budget.admit('engineer'); const second = budget.admit('foreman'); fail = true;
    expect(() => budget.closeRun('time')).toThrow('disk full'); expect(stopped).toEqual([first.id, second.id]);
    expect(() => budget.confirmCancellation(first.id)).toThrow('disk full'); expect(stopped).toEqual([first.id, second.id]);
  });
  it('requires a saved budget controller and refuses exhausted admission after replacement', async () => {
    const dir = temp(); let runtime = fakeRuntime(dir); const budget = runtime.createBudget(PROBE_CAPS, () => 0, () => {}); budget.closeRun('exhausted'); runtime.close();
    runtime = fakeRuntime(dir); const held = await runtime.recover();
    await expect(runtime.resume(held)).rejects.toThrow('budget must be reconstructed');
    await expect(runtime.dispatch('command')).rejects.toThrow('budget must be reconstructed');
    runtime.createBudget(PROBE_CAPS, () => 0, () => {});
    await expect(runtime.resume(held)).rejects.toThrow('closed by budget'); await expect(runtime.dispatch('command')).rejects.toThrow('closed by budget'); runtime.close();
  });
  it('clears client uncertainty only for commands with authoritative receipt evidence', async () => {
    let client!: GameClient;
    const runtime = fakeRuntime(temp(), (game, control) => { client = game; control.ledger.command = receipt; game.unresolved.add('command'); game.unresolved.add('untracked'); });
    runtime.execution.intent(batch); await runtime.recover();
    expect(client.unresolved.has('command')).toBe(false); expect(client.unresolved.has('untracked')).toBe(true); runtime.close();
  });
  it('does not repeat pause on an already verified held world', async () => {
    const runtime = fakeRuntime(temp(), (_game, _control, life) => { life.pause = async () => { throw new Error('must not re-pause held world'); }; });
    expect((await runtime.recover()).paused).toBe(true); runtime.close();
  });
  it('records actual observation and receipt ticks, and null when game time is unknown', async () => {
    const runtime = fakeRuntime(temp(), (_game, control) => { control.ledger.command = receipt; }); await runtime.recover();
    runtime.observation({ tick: 900, entities: [] }, { tick: 900 }, { kind: 'shared' });
    expect(runtime.journal.events().at(-1)?.gameTick).toBe(900);
    runtime.evidence('public-transcript', { text: 'later public activity' }, { kind: 'operator' }); expect(runtime.journal.events().at(-1)?.gameTick).toBeNull();
    runtime.execution.intent(batch); expect(runtime.journal.events().at(-1)?.gameTick).toBeNull(); await runtime.execution.reconcile();
    expect(runtime.journal.events().at(-1)).toMatchObject({ gameTick: 101, task: 'task', actor: 'builder-1', correlation: 'command' }); runtime.close();
  });
});
