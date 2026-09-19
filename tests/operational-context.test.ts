import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DECISION_FACT_ORACLES, DEFAULT_OPERATIONAL_LIMITS, OBSERVATION_SCHEMA, targetRequirements,
  validateObservationScope, validateOperationalLimits, validateProductionTarget,
} from '@autofactorio/contracts';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import { OperationalStore, OperationalWatches, ObservationSnapshots } from '../packages/core/context/operational.js';
import { ContextAccounting, SessionLifecycle } from '../packages/core/context/lifecycle.js';
import { taskVisibility } from '../packages/core/context/authorization.js';
import { calibrationRateTolerance } from '../scripts/operational-calibration.js';

const runtimes: DurableRuntime[] = [];
afterEach(() => { for (const r of runtimes.splice(0)) r.close(); });
function runtime() {
  const port = { command: async () => '{}', close() {} }; const game = new GameClient(port, () => {});
  const value = new DurableRuntime(mkdtempSync(path.join(os.tmpdir(), 'af-operational-')), 'run', 'epoch', game, new Lifecycle(port, game, () => {})); runtimes.push(value); return value;
}
const scope = (id = 'scope-a', revision = 1) => ({ schema: OBSERVATION_SCHEMA, id, revision, task: `task-${id}`, surface: 'nauvis', area: [{ x: 0, y: 0 }, { x: 10, y: 10 }] as [{ x: number; y: number }, { x: number; y: number }], entityLimit: 100 });
const reading = (kind: 'production' | 'stock', total: number) => ({ kind, name: 'iron-gear-wheel', quality: 'normal', surface: 'nauvis', total, method: 'fixture-v1', coverage: 'complete' as const, evidence: ['fixture'] });

describe('decision-focused operational context', () => {
  it('keeps interval-skew tolerance nonnegative for stock depletion', () => {
    const tolerance = calibrationRateTolerance(4, -10, 20, 21);
    expect(tolerance).toBeGreaterThanOrEqual(4 / 20); expect(tolerance).toBeCloseTo(4 / 20 + 10 * Math.abs(1 / 20 - 1 / 21));
  });
  it('validates unambiguous targets, scopes and manifest limits while preserving optional migration', () => {
    expect(validateProductionTarget({ name: 'gear', quality: 'normal', surface: 'nauvis', rate: 2.5, unit: 'items-per-game-second', recipe: 'gear' }).rate).toBe(2.5);
    expect(() => validateProductionTarget({ name: 'gear', quality: 'normal', surface: 'nauvis', rate: 2.5, unit: 'per-minute', recipe: 'gear' })).toThrow('unit');
    expect(() => validateObservationScope({ ...scope(), id: '', revision: 1 })).toThrow('scope id');
    expect(validateOperationalLimits(DEFAULT_OPERATIONAL_LIMITS)).toEqual(DEFAULT_OPERATIONAL_LIMITS);
    expect(() => validateOperationalLimits({ ...DEFAULT_OPERATIONAL_LIMITS, maxWatchesPerRole: 33, maxWatchesPerRun: 32 })).toThrow('exceeds');
    expect(Object.keys(DECISION_FACT_ORACLES)).toEqual(['supply-deficit', 'idle-machine', 'partial-command', 'replacement']);
  });
  it('derives target demand from supported recipe facts and leaves rich mechanics unsupported', () => {
    const target = validateProductionTarget({ name: 'science', quality: 'normal', surface: 'nauvis', rate: 0.5, unit: 'items-per-game-second', recipe: 'science' });
    expect(targetRequirements(target, { name: 'science', category: 'crafting', energy: 5, ingredients: [{ type: 'item', name: 'gear', amount: 1 }, { type: 'item', name: 'copper', amount: 1 }], products: [{ type: 'item', name: 'science', amount: 1 }] })).toMatchObject({ supported: true, inputs: [{ name: 'gear', rate: 0.5 }, { name: 'copper', rate: 0.5 }] });
    expect(targetRequirements(target, { name: 'science', category: 'chemistry', energy: 5, ingredients: [], products: [{ type: 'item', name: 'science', amount: 1 }] })).toEqual({ supported: false, reason: 'unsupported_recipe' });
  });
  it('keeps equal revisions independent by stable scope ID and invalidates only changed membership', () => {
    const r = runtime(); const store = new OperationalStore(r); const visibleA = taskVisibility('task-scope-a'); const visibleB = taskVisibility('task-scope-b');
    store.register(scope('scope-a'), visibleA); store.register(scope('scope-b'), visibleB);
    for (const [id, visibility, amount] of [['scope-a', visibleA, 60], ['scope-b', visibleB, 120]] as const) {
      store.ingest({ schema: 1, epoch: 'epoch', scopeId: id, scopeRevision: 1, membershipHash: 'members', tick: 0, readings: [reading('production', 0)] }, visibility);
      store.ingest({ schema: 1, epoch: 'epoch', scopeId: id, scopeRevision: 1, membershipHash: id === 'scope-a' ? 'changed' : 'members', tick: 600, readings: [reading('production', amount)] }, visibility);
    }
    expect(store.metrics('scope-a', 600)[0]).toMatchObject({ coverage: 'unknown', reason: 'scope_membership_changed', rate: null });
    expect(store.metrics('scope-b', 600)[0]).toMatchObject({ coverage: 'complete', rate: 12 });
  });
  it('does not hide an intermediate membership change or counter reset when endpoints match', () => {
    const r = runtime(); const store = new OperationalStore(r); const visibility = taskVisibility('task-scope-a'); store.register(scope(), visibility);
    store.ingest({ schema: 1, epoch: 'epoch', scopeId: 'scope-a', scopeRevision: 1, membershipHash: 'm', tick: 0, readings: [reading('production', 100)] }, visibility);
    store.ingest({ schema: 1, epoch: 'epoch', scopeId: 'scope-a', scopeRevision: 1, membershipHash: 'recipe-changed', tick: 300, readings: [{ ...reading('production', 0), coverage: 'unknown', reason: 'counter_reset' }] }, visibility);
    store.ingest({ schema: 1, epoch: 'epoch', scopeId: 'scope-a', scopeRevision: 1, membershipHash: 'm', tick: 600, readings: [reading('production', 10)] }, visibility);
    expect(store.metrics('scope-a', 600)[0]).toMatchObject({ coverage: 'unknown', reason: 'scope_membership_changed', rate: null });
  });
  it('reports stable stock independently from nonzero production flow', () => {
    const r = runtime(); const store = new OperationalStore(r); store.register(scope(), taskVisibility('task-scope-a'));
    store.ingest({ schema: 1, epoch: 'epoch', scopeId: 'scope-a', scopeRevision: 1, membershipHash: 'm', tick: 0, readings: [reading('production', 0), reading('stock', 50)] }, taskVisibility('task-scope-a'));
    store.ingest({ schema: 1, epoch: 'epoch', scopeId: 'scope-a', scopeRevision: 1, membershipHash: 'm', tick: 600, readings: [reading('production', 100), reading('stock', 50)] }, taskVisibility('task-scope-a'));
    expect(store.metrics('scope-a', 600).find(m => m.kind === 'production')).toMatchObject({ quantity: 100, rate: 10, coverage: 'complete' });
    expect(store.metrics('scope-a', 600).find(m => m.kind === 'stock')).toMatchObject({ quantity: 0, rate: null, coverage: 'complete' });
  });
  it('keeps item quality distinct and rejects readings from another surface', () => {
    const r = runtime(); const store = new OperationalStore(r); const visibility = taskVisibility('task-scope-a'); store.register(scope(), visibility);
    const qualities = (tick: number, normal: number, uncommon: number) => ({ schema: 1 as const, epoch: 'epoch', scopeId: 'scope-a', scopeRevision: 1, membershipHash: 'm', tick, readings: [reading('production', normal), { ...reading('production', uncommon), quality: 'uncommon' }] });
    store.ingest(qualities(0, 0, 0), visibility); store.ingest(qualities(600, 60, 30), visibility);
    expect(store.metrics('scope-a', 600, undefined, ['production'], ['iron-gear-wheel']).map(metric => [metric.quality, metric.rate])).toEqual([['normal', 6], ['uncommon', 3]]);
    expect(() => store.ingest({ ...qualities(660, 66, 33), readings: [{ ...reading('production', 66), surface: 'orbit' }] }, visibility)).toThrow('outside scope surface');
  });
  it('coalesces sustained watch state and emits separate recovery with bounded overflow indication', () => {
    const r = runtime(); const watches = new OperationalWatches(r, { ...DEFAULT_OPERATIONAL_LIMITS, maxPendingTransitions: 1 }); const visibility = taskVisibility('task');
    watches.register({ id: 'shortfall', role: 'engineer', task: 'task', scopeId: 'scope', scopeRevision: 1, metric: { kind: 'production', name: 'gear', quality: 'normal', surface: 'nauvis' }, threshold: 1, recovery: 1.05, persistenceTicks: 300 }, visibility);
    expect(watches.evaluate('shortfall', 0, 0.5, visibility)).toBeNull(); expect(watches.evaluate('shortfall', 300, 0.5, visibility)).toMatchObject({ state: 'active' });
    expect(watches.evaluate('shortfall', 600, 0.5, visibility)).toBeNull(); expect(watches.evaluate('shortfall', 700, 1.1, visibility)).toBeNull();
    expect(watches.evaluate('shortfall', 1000, 1.1, visibility)).toMatchObject({ state: 'recovered' });
    expect(watches.pending('engineer')).toMatchObject({ gap: true, transitions: [{ state: 'recovered' }] });
    const delivered = watches.pendingFor('engineer', new Set(['shortfall'])); expect(delivered).toMatchObject({ gap: true, transitions: [{ state: 'recovered' }] });
    watches.acknowledge('engineer', delivered.transitions); expect(new OperationalWatches(r, { ...DEFAULT_OPERATIONAL_LIMITS, maxPendingTransitions: 1 }).pendingFor('engineer', new Set(['shortfall']))).toEqual({ transitions: [], gap: false });
  });
  it('resumes durable watch state after restart and replaces a revoked scope revision in place', () => {
    const r = runtime(); const visibility = taskVisibility('task'); const limits = { ...DEFAULT_OPERATIONAL_LIMITS, maxWatchesPerRole: 1, maxWatchesPerRun: 1 };
    const first = new OperationalWatches(r, limits); first.register({ id: 'target.scope', role: 'engineer', task: 'task', scopeId: 'scope', scopeRevision: 1, metric: { kind: 'production', name: 'gear', quality: 'normal', surface: 'nauvis' }, threshold: 1, recovery: 1.05, persistenceTicks: 300 }, visibility);
    first.evaluate('target.scope', 0, 0.5, visibility);
    const restarted = new OperationalWatches(r, limits); expect(restarted.evaluate('target.scope', 300, 0.5, visibility)).toMatchObject({ state: 'active' });
    restarted.register({ id: 'target.scope', role: 'engineer', task: 'task', scopeId: 'scope', scopeRevision: 2, metric: { kind: 'production', name: 'gear', quality: 'normal', surface: 'nauvis' }, threshold: 2, recovery: 2.1, persistenceTicks: 300 }, visibility);
    expect(restarted.list()).toMatchObject([{ id: 'target.scope', scopeRevision: 2, state: 'healthy', sequence: 1 }]);
  });
  it('keeps watch sequences monotonic across scope revisions after acknowledgement', () => {
    const r = runtime(); const visibility = taskVisibility('task'); const watches = new OperationalWatches(r);
    const definition = { id: 'target.scope', role: 'engineer', task: 'task', scopeId: 'scope', scopeRevision: 1, metric: { kind: 'production' as const, name: 'gear', quality: 'normal', surface: 'nauvis' }, threshold: 1, recovery: 1.05, persistenceTicks: 1 };
    watches.register(definition, visibility); watches.evaluate('target.scope', 0, 0, visibility); watches.evaluate('target.scope', 1, 0, visibility);
    const first = watches.pendingFor('engineer', new Set(['target.scope'])); watches.acknowledge('engineer', first.transitions);
    watches.register({ ...definition, scopeRevision: 2 }, visibility); watches.evaluate('target.scope', 2, 0, visibility); watches.evaluate('target.scope', 3, 0, visibility);
    expect(watches.pendingFor('engineer', new Set(['target.scope']))).toMatchObject({ gap: false, transitions: [{ watch: 'target.scope', sequence: 2, state: 'active' }] });
  });
  it('binds filtered snapshots to principal, task revision and exact filter and expires explicitly', () => {
    let now = 0; const snapshots = new ObservationSnapshots({ ...DEFAULT_OPERATIONAL_LIMITS, maxSnapshots: 1, snapshotTtlMs: 10 }, () => now);
    const filter = { types: ['assembling-machine'], fields: ['name', 'status'] }; const id = snapshots.create('engineer', 'task', 1, 10, filter, [{ name: 'assembler', status: 'no_power' }]);
    expect(snapshots.read(id, 'engineer', 'task', 1, filter).entities).toHaveLength(1);
    expect(() => snapshots.read(id, 'foreman', 'task', 1, filter)).toThrow('scope'); expect(() => snapshots.read(id, 'engineer', 'task', 2, filter)).toThrow('scope');
    expect(() => snapshots.read(id, 'engineer', 'task', 1, { ...filter, fields: ['name'] })).toThrow('scope'); now = 11;
    expect(() => snapshots.read(id, 'engineer', 'task', 1, filter)).toThrow('expired');
  });
  it('accounts every delivery category once, labels repetition and never invents occupancy or allowance', () => {
    const r = runtime(); const accounting = new ContextAccounting(r);
    for (const category of ['prompt', 'catalog', 'tool-arguments', 'tool-result', 'provider-output'] as const) accounting.record('engineer', 'session', 'turn', category, { same: true });
    accounting.record('engineer', 'session', 'turn-2', 'tool-result', { same: true }, 2);
    expect(accounting.summary('engineer', 'session')).toMatchObject({ calls: 1, omissions: 2, repeated: 1, providerContextOccupancy: null, subscriptionBalance: null });
  });
  it('rotates repeatedly without resetting durable budget identity and fences mutation until reconstruction', () => {
    const r = runtime(); const accounting = new ContextAccounting(r); const lifecycle = new SessionLifecycle(r, accounting, { schema: 1, maxTurns: 1, maxDeliveredBytes: 512 });
    for (let i = 0; i < 100; i++) {
      const oldSession = `old-${i}`; const session = `new-${i}`; accounting.record('engineer', oldSession, `turn-${i}`, 'prompt', 'x'.repeat(600));
      expect(lifecycle.due('engineer', oldSession, 1).due).toBe(true); lifecycle.begin('engineer', oldSession, session);
      const binding = { agent: 'engineer', session, generation: i + 1, epoch: 'epoch', turn: `turn-${i}` };
      expect(() => lifecycle.mutation(binding)).toThrow('Mutation closed'); lifecycle.complete(binding, true); expect(() => lifecycle.mutation(binding)).not.toThrow();
    }
    expect(lifecycle.get('engineer')).toMatchObject({ generation: 100, state: 'ready', requiredReplacement: false });
  });
  it('keeps a retryable mutation gate closed until known pending work settles', () => {
    const r = runtime(); const lifecycle = new SessionLifecycle(r); lifecycle.begin('engineer', 'old', 'new');
    const binding = { agent: 'engineer', session: 'new', generation: 1, epoch: 'epoch', turn: 'turn' };
    lifecycle.complete(binding, false, 'deterministic command work must settle'); expect(() => lifecycle.mutation(binding)).toThrow('Mutation closed');
    lifecycle.complete(binding, true); expect(() => lifecycle.mutation(binding)).not.toThrow();
  });
  it('defers approximate rotation while deterministic work is active', () => {
    const r = runtime(); const lifecycle = new SessionLifecycle(r); expect(lifecycle.request('engineer', 'old', true)).toMatchObject({ state: 'deferred-active-work', requiredReplacement: true });
  });
});
