import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OBSERVATION_SCHEMA, type OperationalReading, type OperationalSample } from '@autofactorio/contracts';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import type { ControlState } from '../packages/factorio/src/lifecycle.js';
import { OperationalStore } from '../packages/core/context/operational.js';
import { OperationalWatches } from '../packages/core/context/operational.js';
import { taskVisibility } from '../packages/core/context/authorization.js';

const runtimes: DurableRuntime[] = [];
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.close(); });
function setup() {
  const port = { command: async () => '{}', close() {} };
  const game = new GameClient(port, () => {});
  const control: ControlState = { ok: true, epoch: 'epoch', session: 'session', revision: 1, generation: 1, armed: false, ready: false, paused: true, neutral: true, ticksToRun: 0, tick: 0, ticksPlayed: 0, experimentTick: 0, scenarioElapsed: 0, injections: 0, checkpoint: false, ledger: {}, intents: {}, production: {}, mods: {} };
  const life = new Lifecycle(port, game, () => {});
  life.inspect = async () => structuredClone(control); life.pause = async () => structuredClone(control);
  life.reconcile = async () => structuredClone(control);
  life.arm = async () => { control.armed = true; control.paused = false; return structuredClone(control); };
  const runtime = new DurableRuntime(mkdtempSync(path.join(os.tmpdir(), 'af-production-observations-')), 'run', 'epoch', game, life);
  runtimes.push(runtime);
  const store = new OperationalStore(runtime);
  const visibility = taskVisibility('task-scope-a');
  store.register({ schema: OBSERVATION_SCHEMA, id: 'scope-a', revision: 1, task: 'task-scope-a', surface: 'nauvis', area: [{ x: 0, y: 0 }, { x: 10, y: 10 }], entityLimit: 100 }, visibility);
  return { store, visibility, runtime, restoreEpoch: async (epoch: string, tick: number) => { Object.assign(control, { epoch, tick, ticksPlayed: tick, experimentTick: tick, scenarioElapsed: tick, armed: false, ready: false, paused: true }); await runtime.resume(control); } };
}
const reading = (kind: 'production' | 'stock', total: number, extra: Partial<OperationalReading> = {}): OperationalReading => ({
  kind, name: 'water', productKind: 'fluid', quality: 'normal', surface: 'nauvis', total,
  method: 'fixture-v1', coverage: 'complete', evidence: ['fixture'], ...extra,
});
function sample(tick: number, readings: OperationalReading[], extra: Partial<OperationalSample> = {}): OperationalSample {
  return { schema: OBSERVATION_SCHEMA, epoch: 'epoch', scopeId: 'scope-a', scopeRevision: 1, membershipHash: 'members', tick, readings, ...extra };
}

describe('production observations', () => {
  it('keeps item and fluid products with the same name as separate measurements', () => {
    const { store, visibility } = setup();
    const both = (item: number, fluid: number) => [reading('production', item, { productKind: 'item' }), reading('production', fluid, { productKind: 'fluid' })];
    store.ingest(sample(0, both(0, 0)), visibility);
    store.ingest(sample(60, both(10, 25)), visibility);
    expect(store.metrics('scope-a', 60).map(metric => [metric.productKind, metric.rate, metric.unit])).toEqual([
      ['item', 10, 'items-per-game-second'], ['fluid', 25, 'units-per-game-second'],
    ]);
  });

  it('reports gross fluid flow and current stock independently with conservative endpoint error bounds', () => {
    const { store, visibility } = setup();
    const values = (production: number, stock: number) => [
      reading('production', production, { errorBound: 1 }),
      reading('stock', stock, { errorBound: 2 }),
    ];
    store.ingest(sample(0, values(100, 500)), visibility);
    store.ingest(sample(60, values(160, 500)), visibility);
    const metrics = store.metrics('scope-a', 60);
    expect(metrics.find(metric => metric.kind === 'production')).toMatchObject({ productKind: 'fluid', quantity: 60, rate: 60, errorBound: 2, rateBounds: { lower: 58, upper: 62 }, unit: 'units-per-game-second' });
    expect(metrics.find(metric => metric.kind === 'stock')).toMatchObject({ quantity: 0, rate: null, stock: 500, errorBound: 4, rateBounds: null });
  });

  it('excludes a foreign epoch frame without affecting an independent scope', () => {
    const { store, visibility } = setup();
    store.register({ schema: OBSERVATION_SCHEMA, id: 'scope-b', revision: 1, task: 'task-scope-b', surface: 'nauvis', area: [{ x: 0, y: 0 }, { x: 10, y: 10 }], entityLimit: 100 }, taskVisibility('task-scope-b'));
    store.ingest(sample(0, [reading('production', 0)]), visibility);
    store.ingest(sample(60, [reading('production', 10)], { epoch: 'restored' }), visibility);
    store.ingest({ ...sample(0, [reading('production', 0)]), scopeId: 'scope-b' }, taskVisibility('task-scope-b'));
    store.ingest({ ...sample(60, [reading('production', 20)]), scopeId: 'scope-b' }, taskVisibility('task-scope-b'));
    expect(store.metrics('scope-a', 60)[0]).toMatchObject({ coverage: 'unknown', reason: 'insufficient_history', rate: null, epoch: 'epoch', endTick: 0 });
    expect(store.metrics('scope-b', 60)[0]).toMatchObject({ coverage: 'complete', rate: 20 });
  });

  it('keeps restored low-tick measurements and symptoms isolated from high-tick prior-epoch frames', async () => {
    const { store, visibility, runtime, restoreEpoch } = setup();
    const symptoms = (tick: number, power: number) => [{ unit: 17, name: 'assembler', position: { x: 1, y: 2 }, tick, status: power === 0 ? 'no_power' : 'working', recipe: 'gear', power, coverage: 'complete' as const, evidence: [`tick:${tick}`] }];
    store.ingest(sample(5940, [reading('production', 90)], { symptoms: symptoms(5940, 0) }), visibility);
    store.ingest(sample(6000, [reading('production', 100)], { symptoms: symptoms(6000, 0) }), visibility);
    expect(store.metrics('scope-a', 60)[0]).toMatchObject({ coverage: 'complete', rate: 10, epoch: 'epoch', endTick: 6000 });

    await restoreEpoch('epoch-restored', 12);
    expect(store.metrics('scope-a', 60, 12)[0]).toMatchObject({ coverage: 'unknown', reason: 'epoch_changed', rate: null, epoch: 'epoch', endTick: 6000 });
    const cursorTick = store.samples('scope-a', 1, runtime.context().epoch).at(-1)?.tick ?? -1;
    expect(cursorTick).toBe(-1);

    store.ingest(sample(12, [reading('production', 0)], { epoch: runtime.context().epoch, symptoms: symptoms(12, 0) }), visibility);
    expect(store.metrics('scope-a', 60, 12)[0]).toMatchObject({ coverage: 'unknown', reason: 'insufficient_history', epoch: 'epoch-restored', endTick: 12 });
    store.ingest(sample(72, [reading('production', 5)], { epoch: runtime.context().epoch, symptoms: symptoms(72, 8) }), visibility);
    expect(store.metrics('scope-a', 60, 72)[0]).toMatchObject({ coverage: 'complete', rate: 5, startTick: 12, endTick: 72, epoch: 'epoch-restored' });
    expect(store.samples('scope-a', 1, runtime.context().epoch).map(frame => frame.tick)).toEqual([12, 72]);
    expect(store.samples('scope-a', 1, runtime.context().epoch).at(-1)?.symptoms).toEqual(symptoms(72, 8));
    expect(() => store.ingest(sample(72, [reading('production', 6)], { epoch: runtime.context().epoch }), visibility)).toThrow('Operational sample tick did not advance');
  });

  it('marks a missing cadence sample and an unsupported middle reading unknown', () => {
    const { store, visibility } = setup();
    store.ingest(sample(0, [reading('production', 0)]), visibility);
    store.ingest(sample(120, [reading('production', 20)]), visibility);
    expect(store.metrics('scope-a', 120)[0]).toMatchObject({ coverage: 'unknown', reason: 'missing_sample_tick', rate: null });

    const second = setup();
    second.store.ingest(sample(0, [reading('production', 0)]), second.visibility);
    second.store.ingest(sample(60, [reading('production', 10, { coverage: 'partial', method: 'unsupported-v2' })]), second.visibility);
    expect(second.store.metrics('scope-a', 60)[0]).toMatchObject({ coverage: 'unknown', rate: null, reason: 'missing_or_unsupported_interval' });
  });

  it('rejects a counter reset, invalid precision, and invalid product identity', () => {
    const { store, visibility } = setup();
    store.ingest(sample(0, [reading('production', 50)]), visibility);
    store.ingest(sample(60, [reading('production', 5)]), visibility);
    expect(store.metrics('scope-a', 60)[0]).toMatchObject({ coverage: 'unknown', reason: 'counter_reset', rate: null });
    expect(() => store.ingest(sample(60, [reading('production', 6)]), visibility)).toThrow('Operational sample tick did not advance');
    expect(() => store.ingest(sample(120, [reading('production', 6, { errorBound: -1 })]), visibility)).toThrow('Invalid metric identity or precision');
    expect(() => store.ingest(sample(120, [reading('production', 6, { productKind: 'gas' as 'fluid' })]), visibility)).toThrow('Invalid metric identity or precision');
  });

  it('invalidates pending activation and recovery across unknown gaps without flooding transitions', () => {
    const { store } = setup(); const watches = new OperationalWatches(store.runtime);
    const visibility = taskVisibility('watch-task');
    const watch = { id: 'gap-watch', role: 'engineer', task: 'watch-task', scopeId: 'scope-a', scopeRevision: 1, metric: { kind: 'production' as const, name: 'water', quality: 'normal', surface: 'nauvis' }, threshold: 1, recovery: 1.1, persistenceTicks: 300 };
    watches.register(watch, visibility);
    expect(watches.evaluate(watch.id, 0, 0.5, visibility)).toBeNull();
    expect(watches.evaluate(watch.id, 240, 0.5, visibility)).toBeNull();
    watches.invalidate(watch.id, 300, visibility);
    expect(watches.list()[0]).toMatchObject({ state: 'healthy', sinceTick: 300, sequence: 0 });
    expect(watches.evaluate(watch.id, 360, 0.5, visibility)).toBeNull();
    expect(watches.evaluate(watch.id, 600, 0.5, visibility)).toBeNull();
    expect(watches.evaluate(watch.id, 660, 0.5, visibility)).toMatchObject({ state: 'active', sequence: 1 });
    for (const tick of [720, 780, 840, 900]) expect(watches.evaluate(watch.id, tick, 0.5, visibility)).toBeNull();
    expect(watches.evaluate(watch.id, 960, 1.2, visibility)).toBeNull();
    watches.invalidate(watch.id, 1020, visibility);
    expect(watches.list()[0]).toMatchObject({ state: 'active', sinceTick: 1020, sequence: 1 });
    expect(watches.evaluate(watch.id, 1080, 1.2, visibility)).toBeNull();
    expect(watches.evaluate(watch.id, 1380, 1.2, visibility)).toMatchObject({ state: 'recovered', sequence: 2 });
    expect(watches.pendingFor('engineer', new Set([watch.id])).transitions.map(t => t.state)).toEqual(['active', 'recovered']);
    expect(store.runtime.journal.list('run', 'watchTransitions')).toHaveLength(2);
  });
});
