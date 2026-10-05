import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { effectReceipt } from '@autofactorio/contracts';
import type { BlueprintDocument, WorkshopEvaluationReport } from '@autofactorio/contracts';
import { preserveSnapshot, snapshotFile, snapshotHash } from '../apps/runtime/workshop-snapshot.js';
import { LiveWorkshopGame, LiveWorkshopHost } from '../apps/runtime/workshop-live-host.js';
import type { WorkshopActivity, WorkshopGame, WorkshopInference } from '../apps/runtime/workshop-live-host.js';
import { composeWorkshop } from '../apps/runtime/workshop-composition.js';
import type { EventContext } from '../packages/core/execution/durable.js';
import { SqliteJournal } from '../packages/storage/src/journal.js';
import { WorkspaceCatalog } from '../packages/storage/src/workspace-catalog.js';

const selected = { provider: 'openai' as const, modelId: 'gpt-6-astra', reasoningEffort: 'low' };
const request = (id: string, overrides: Record<string, unknown> = {}) => ({
  schema: 1, id, revision: 1, comparisonSeries: `series-${id}`, objective: 'Produce 60 electronic circuits per minute',
  source: { kind: 'brief', id: null }, profileId: 'starter-assembly', construction: 'direct', libraryAccess: false,
  improveRevision: null, requestedSpeed: { numerator: '10', denominator: '1' }, settlingTicks: 0, windowTicks: 60, windows: 1,
  rubric: { version: 'rubric-1', weights: { throughput: { numerator: '1', denominator: '1' } }, materiality: { throughput: { numerator: '0', denominator: '1' } }, directions: { throughput: 'maximize' } },
  iterations: { attempts: 1, mode: 'exact', earlyStop: false, plateauRounds: 1 },
  checkpoints: { brief: false, afterScore: false, libraryAdmission: false, learningActivation: false, timeoutMs: 1000, timeoutAction: 'finish' },
  budgets: { wallMs: 60000, gameTicks: 600, turns: 3, toolCalls: 8, reportedTokens: 1000, learningReservedTurns: 1, learningReservedTools: 2 },
  models: { sessionDefault: selected, overrides: {} },
  learning: { cadence: 'off', batchSessions: 2, candidateCap: 2, attemptsPerCandidate: 1, autoActivate: false }, ...overrides,
});
const installed = {
  gameVersion: '2.0.77', mods: { base: '2.0.77' }, profileId: 'starter-assembly', profileRevision: 1, surface: 'nauvis',
  technologies: ['automation'], allowedEquipment: ['assembling-machine-1'], modules: [], beacons: [],
  recipe: { id: 'electronic-circuit', category: 'crafting', energy: 0.5, ingredients: [{ type: 'item' as const, name: 'iron-plate', amount: 1 }], products: [{ type: 'item' as const, name: 'electronic-circuit', amount: 1 }] },
  machine: 'assembling-machine-1',
};
const png = () => Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5xkAAAAASUVORK5CYII=', 'base64');
const inferenceResult = (text: string) => ({ text, usage: { turns: 1, tools: 1, elapsedMs: 1, tokens: 1 } });
const document = (ports: BlueprintDocument['ports']): BlueprintDocument => ({
  schema: 1, label: 'Measured gallery cell', description: 'Gallery regression candidate',
  entities: [{ id: 'assembler', entityNumber: 1, name: 'assembling-machine-1', position: { x: 0, y: 0 }, direction: 0, quality: 'normal', recipe: 'electronic-circuit' }],
  wires: [], ports, icons: [{ index: 1, name: 'electronic-circuit' }], tiles: [],
});

function harness(gameOverrides: Partial<WorkshopGame> = {}, withHistory = false) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'af-workshop-gallery-'));
  const journal = new SqliteJournal(path.join(root, 'run.sqlite'));
  const runtimeDirectory = withHistory ? path.join(root, 'runs', 'live') : root;
  mkdirSync(runtimeDirectory, { recursive: true });
  const activities: WorkshopActivity[] = [];
  let clock = 0;
  const context = (): EventContext => ({ run: 'run', epoch: 'epoch', wallTime: new Date(1_800_000_000_000 + clock++).toISOString(), gameTick: null, actor: 'operator', task: null, causation: null, correlation: null, visibility: { kind: 'operator' } });
  const game: WorkshopGame = {
    async resolveProfile() { return structuredClone(installed); },
    async build(session) { return { id: `${session.id}-${session.activeIteration}`, generation: 1, surface: 'af-test', characterEvidence: null }; },
    async measure(session): Promise<WorkshopEvaluationReport> {
      const rule = session.assignment.throughput[0]!, port = session.assignment.ports.find(value => value.id === rule.portId)!;
      return { schema: 1, attemptId: `${session.id}:${session.activeIteration}`, valid: true, passed: true, reasons: [], ports: [{ portId: port.id, windows: [{ index: 0, required: { numerator: '1', denominator: '1' }, productionLower: { numerator: '60', denominator: '1' }, deliveryLower: { numerator: '60', denominator: '1' }, passed: true, reasons: [] }] }], evidence: ['measured-window'] };
    },
    cancel(sessionId) { return effectReceipt(`game:${sessionId}`, 'cancelled'); },
    ...gameOverrides,
  };
  const inference: WorkshopInference = {
    async invoke(_session, role, _selection, observation) {
      if (role === 'workshop-designer') {
        const assignment = (observation as { assignment: { ports: BlueprintDocument['ports'] } }).assignment;
        return inferenceResult(JSON.stringify(document(assignment.ports)));
      }
      return inferenceResult(JSON.stringify({ schema: 1, summary: 'Measured facts reviewed', findings: [] }));
    },
    cancel: sessionId => effectReceipt(`inference:${sessionId}`, 'cancelled'),
    async close() {},
  };
  const host = new LiveWorkshopHost(runtimeDirectory, inference, game, activity => activities.push(activity));
  const store = { directory: runtimeDirectory, run: 'run', journal, context, record(type: string, changes: Parameters<SqliteJournal['append']>[2]) { journal.append(context(), type, changes); } };
  const catalog = withHistory ? new WorkspaceCatalog(root) : null;
  const options = { workshopHost: host, managedModels: [{ id: selected.modelId, displayName: 'Astra', efforts: [selected.reasoningEffort] }], ...(catalog ? { workspaceCatalog: catalog } : {}) };
  const composition = composeWorkshop(store as never, options);
  const orchestrator = composition.orchestrator, library = composition.library, runtime = composition.controller!;
  return { root, journal, host, game, store, options, catalog, composition, orchestrator, library, runtime, activities, async close() { await runtime.close(); library.close(); catalog?.close(); journal.close(); rmSync(root, { recursive: true, force: true }); } };
}

describe('workshop screenshot gallery', () => {
  it.each(['invalid','aborted'])('does not reserve observation for a confirmed %s measurement',async state=>{
    let reserved=0;
    const game=new LiveWorkshopGame({} as never,{} as never,{} as never,()=>{},async()=>{reserved++;return()=>{};});
    Object.assign(game,{control:{measureStatus:async()=>({present:true,finished:true,state}),observe:async()=>{throw new Error('must not start');}}});
    expect(await game.observe({id:'terminal',activeIteration:1} as never,{id:'terminal-1',generation:1,surface:'af',characterEvidence:null})).toBe(false);
    expect(reserved).toBe(0);
  });

  it('retains an unknown observation until exact terminal Stop acknowledges release',async()=>{
    let released=0,state='finished',present=true,stops=0;
    const game=new LiveWorkshopGame({} as never,{} as never,{} as never,()=>{},async()=>()=>{released++;});
    const session={id:'unknown-observation',activeIteration:1} as never,built={id:'unknown-observation-1',generation:1,surface:'af',characterEvidence:null};
    Object.assign(game,{control:{measureStatus:async()=>({present,finished:true,state}),observe:async(_id:string,_generation:number,stop:boolean)=>{if(!stop)throw new Error('response lost');stops++;return false;}}});
    await expect(game.observe(session,built)).rejects.toThrow();
    present=false;state='not-admitted';await expect(game.stopObservation(session,built)).rejects.toThrow();expect(released).toBe(0);
    present=true;state='invalid';await game.stopObservation(session,built);expect(stops).toBe(1);expect(released).toBe(1);
  });

  it('preserves the actual PNG bytes and hashes the saved screenshot', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'af-gallery-snapshot-'));
    try {
      const source = path.join(root, 'render.png'), destination = snapshotFile(root, 'gallery-session', 2), bytes = png();
      writeFileSync(source, bytes);
      const hash = await preserveSnapshot(source, destination);
      expect(readFileSync(destination)).toEqual(bytes);
      expect(hash).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(snapshotHash(readFileSync(destination))).toBe(hash);
      expect(snapshotFile(root, 'gallery-session', 2)).toContain(path.join('workshop-live', 'gallery-session', 'attempt-2.png'));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('rejects invalid PNG bytes and unsafe snapshot identities', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'af-gallery-invalid-'));
    try {
      const source = path.join(root, 'not-png.bin'), destination = snapshotFile(root, 'session', 1);
      writeFileSync(source, Buffer.from('not a png image'));
      await expect(preserveSnapshot(source, destination)).rejects.toThrow('Invalid build screenshot');
      expect(() => snapshotHash(Buffer.alloc(24, 2))).toThrow('Invalid build screenshot');
      expect(() => snapshotFile(root, '../outside', 1)).toThrow('Invalid snapshot identity');
      expect(() => snapshotFile(root, 'session', 0)).toThrow('Invalid snapshot identity');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('captures after measurement and before scoring, then observes the scored final attempt until Stop', async () => {
    const calls: string[] = [], bytes = png();
    const f = harness({
      async screenshot() { const file = path.join(f.root, 'rendered.png'); writeFileSync(file, bytes); calls.push('snapshot'); return { path: file, tick: 731 }; },
      async observe() { calls.push('observe'); return true; },
      async stopObservation(session) { calls.push(`stop:${session.stage}`); },
    });
    try {
      const expectedHash = createHash('sha256').update(bytes).digest('hex');
      await f.runtime.launch(request('gallery-live'));
      await f.runtime.pending('gallery-live');
      const state = f.orchestrator.get('gallery-live');
      expect(state.stopReason, JSON.stringify(state)).toBeNull();
      expect(calls).toEqual(['snapshot', 'observe']);
      expect(state).toMatchObject({ stage: 'observing', activeIteration: 1, finalOutcome: 'best-valid', operationResults: { 'gallery-live:observe': true } });
      expect(state.iterations[0]).toMatchObject({ evaluation: { passed: true }, score: { eligible: true }, snapshot: { status: 'available', sha256: expectedHash, tick: 731 } });
      expect(f.library.search({ product: 'electronic-circuit' })).toHaveLength(0);

      const stopped = await f.runtime.stop('gallery-live', 'operator_stop');
      expect(stopped).toMatchObject({ stage: 'complete', finalOutcome: 'best-valid', iterations: [{ score: { eligible: true }, snapshot: { status: 'available', sha256: expectedHash } }] });
      expect(calls).toEqual(['snapshot', 'observe', 'stop:observing']);
      expect(f.journal.events().some(event => event.type === 'workshop/scored')).toBe(true);
    } finally { await f.close(); }
  });

  it('records unavailable screenshots and continues scoring when bytes are invalid', async () => {
    const calls: string[] = [];
    const f = harness({
      async screenshot() { const file = path.join(f.root, 'invalid.png'); writeFileSync(file, Buffer.from('bad')); return { path: file, tick: 1 }; },
      async observe() { calls.push('observe'); return false; },
    });
    try {
      await f.runtime.launch(request('gallery-invalid-image'));
      await f.runtime.pending('gallery-invalid-image');
      const state = f.orchestrator.get('gallery-invalid-image');
      expect(state.stopReason, JSON.stringify(state)).toBeNull();
      expect(state.stage).toBe('complete');
      expect(state.iterations[0]).toMatchObject({ score: { eligible: true }, snapshot: { status: 'unavailable', reason: expect.any(String) } });
      expect(calls).toEqual(['observe']);
    } finally { await f.close(); }
  });

  it('does not invoke observation when the attempt has no measured evaluation', async () => {
    const calls: string[] = [];
    const f = harness({ async observe() { calls.push('observe'); return true; } });
    try {
      const session = await f.host.resolve(request('gallery-unmeasured'));
      const state = f.orchestrator.configure(session.id, session, 'baseline');
      expect(await f.host.observe(state)).toBe(false);
      expect(calls).toEqual([]);
    } finally { await f.close(); }
  });

  it('keeps the owner held after an unknown Stop receipt and completes only after an exact retry', async () => {
    let unknown = true, released = false;
    const f = harness({
      async screenshot() { const file = path.join(f.root, 'retry.png'); writeFileSync(file, png()); return { path: file, tick: 812 }; },
      async observe() { return true; },
      async cancel(sessionId) {
        if (unknown) return { schema: 1, effectId: `game:${sessionId}`, outcome: 'unknown', failures: ['game_control:response_lost'] };
        return effectReceipt(`game:${sessionId}`, 'cancelled');
      },
      async stopObservation() { if (!unknown) released = true; },
    }, true);
    try {
      await f.runtime.launch(request('gallery-retry'));
      await f.runtime.pending('gallery-retry');
      const captured = f.orchestrator.get('gallery-retry').iterations[0];
      expect(captured).toMatchObject({ score: { eligible: true }, snapshot: { status: 'available' } });
      expect(f.catalog?.owner()).toMatchObject({ id: 'gallery-retry', state: 'active' });

      const held = await f.runtime.stop('gallery-retry', 'operator_stop');
      expect(held).toMatchObject({ stage: 'held', iterations: [{ score: { eligible: true }, snapshot: { status: 'available' } }] });
      expect(f.catalog?.owner()).toMatchObject({ id: 'gallery-retry', state: 'held' });
      expect(released).toBe(false);

      unknown = false;
      const completed = await f.runtime.stop('gallery-retry', 'operator_stop');
      expect(completed).toMatchObject({ stage: 'complete', finalOutcome: 'best-valid', iterations: [{ score: { eligible: true }, snapshot: captured!.snapshot }] });
      expect(f.catalog?.owner()).toBeNull();
      expect(released).toBe(true);
    } finally { await f.close(); }
  });

  it('rechecks an observing run on replacement recovery without changing its owner or evidence', async () => {
    const observeCalls: string[] = [], bytes = png();
    const f = harness({
      async screenshot() { const file = path.join(f.root, 'recovered.png'); writeFileSync(file, bytes); return { path: file, tick: 913 }; },
      async observe(session) { observeCalls.push(`${session.id}:${session.stage}`); return true; },
      async stopObservation() {},
    }, true);
    let replacement: ReturnType<typeof composeWorkshop> | null = null;
    try {
      await f.runtime.launch(request('gallery-recovery'));
      await f.runtime.pending('gallery-recovery');
      const before = f.orchestrator.get('gallery-recovery');
      const snapshot = before.iterations[0]!.snapshot, score = before.iterations[0]!.score;
      expect(before.stage).toBe('observing');
      expect(f.catalog?.owner()).toMatchObject({ id: 'gallery-recovery', state: 'active' });

      replacement = composeWorkshop(f.store as never, f.options);
      await replacement.controller!.pending('gallery-recovery');
      const recovered = replacement.orchestrator.get('gallery-recovery');
      expect(observeCalls).toEqual(['gallery-recovery:reported', 'gallery-recovery:observing']);
      expect(recovered).toMatchObject({ stage: 'observing', iterations: [{ score, snapshot }] });
      expect(f.catalog?.owner()).toMatchObject({ id: 'gallery-recovery', state: 'active' });

      const completed = await replacement.controller!.stop('gallery-recovery', 'operator_stop');
      expect(completed).toMatchObject({ stage: 'complete', finalOutcome: 'best-valid', iterations: [{ score, snapshot }] });
      expect(f.catalog?.owner()).toBeNull();
    } finally {
      if (replacement) { await replacement.controller?.close(); replacement.library.close(); }
      await f.close();
    }
  });
});
