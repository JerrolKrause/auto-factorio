import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_OPERATIONAL_LIMITS, validateRequest, type MachineFact, type OperationalLimits, type ProductionAvailability, type ProductionCatalog, type ProductionProduct, type ProductionProfile, type ProductionRequest, type RecipeFact, type OperationalSample } from '@autofactorio/contracts';
import { diagnosticAssignment, type Receipt } from '@autofactorio/contracts';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import type { ControlState } from '../packages/factorio/src/lifecycle.js';
import { PROBE_CAPS } from '../packages/codex/src/budget.js';
import { Coordinator } from '../packages/core/orchestration/coordinator.js';
import type { TaskInput } from '../packages/core/orchestration/coordinator.js';
import { team } from '../packages/core/orchestration/roles.js';
import { CoordinationGateway } from '../packages/tools/src/coordination.js';
import { CoordinationMcp } from '../packages/tools/src/coordination-mcp.js';
import { OperationalWatches } from '../packages/core/context/operational.js';
import { operatorPlans, operatorStages } from '../packages/core/production/operator.js';

const caps = { ...PROBE_CAPS, turns: 30, tools: 100, runMs: 300_000, turnMs: 300_000 };
const item = (name: string): ProductionProduct => ({ kind: 'item', name, quality: 'normal', surface: 'nauvis' });
const flow = (name: string, amount: number) => ({ type: 'item' as const, name, amount });
const recipes: RecipeFact[] = [
  { id: 'recipe:plate', name: 'plate', category: 'crafting', seconds: 1, ingredients: [flow('ore', 1)], products: [flow('plate', 1)], unlocks: [], surfaceConditions: [] },
  { id: 'recipe:gear', name: 'gear', category: 'crafting', seconds: 1, ingredients: [flow('plate', 1)], products: [flow('gear', 1)], unlocks: [], surfaceConditions: [] },
];
const machine: MachineFact = { id: 'machine:assembler', name: 'assembler', type: 'assembling-machine', categories: ['crafting'], speed: 1, ingredientLimit: 20, collisionBox: [{ x: -1, y: -1 }, { x: 1, y: 1 }], fluidBoxes: [], placementItems: ['assembler'], energy: { kind: 'electric', maxJoulesPerTick: 0, drainJoulesPerTick: 0 }, baseEffects: {}, surfaceConditions: [] };
const catalog: ProductionCatalog = { schema: 1, mods: { base: 'fixture' }, fingerprint: 'a'.repeat(64), products: ['ore', 'plate', 'gear'].map(name => ({ id: `item:${name}`, kind: 'item' as const, name })), recipes, machines: [machine] };
const availability: ProductionAvailability = { tick: 600, force: 'player', researched: [], surfaceProperties: {}, recipes: Object.fromEntries(recipes.map(recipe => [recipe.name, { enabled: true, productivity: 0 }])) };
const profile: ProductionProfile = { id: 'nauvis', revision: 1, fingerprint: 'profile-1', recipes: null, equipment: null };
const active: DurableRuntime[] = [];
afterEach(() => { for (const runtime of active.splice(0)) runtime.close(); });

async function fixture(operationalLimits?: OperationalLimits) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'af-production-status-'));
  const control: ControlState = { ok: true, epoch: 'epoch', session: 'session', revision: 1, generation: 1, armed: false, ready: false, paused: true, neutral: true, ticksToRun: 0, tick: 600, ticksPlayed: 600, experimentTick: 600, scenarioElapsed: 600, injections: 1, checkpoint: false, ledger: {}, intents: {}, production: {}, mods: {} };
  const port = { command: async () => JSON.stringify(control), close() {} };
  const game = new GameClient(port, () => {}); const life = new Lifecycle(port, game, () => {});
  life.inspect = async () => structuredClone(control); life.pause = async () => structuredClone(control); life.reconcile = async () => structuredClone(control);
  life.arm = async () => { control.armed = true; control.paused = false; return structuredClone(control); };
  life.ownership = async request => ({ request, tick: 600, receipts: [] as Receipt[] });
  let sampleMode: 'healthy' | 'deficit' | 'unknown-input' | 'reset' | 'short-window' | 'symptom' = 'healthy';
  let operations: string[] = [];
  let pauseRead: (() => void) | null = null; let releaseRead: Promise<void> | null = null;
  let pauseFacts: (() => void) | null = null; let releaseFacts: Promise<void> | null = null;
  const gameRequest = async (requestValue: unknown) => {
    validateRequest(requestValue);
    const request = requestValue as Record<string, unknown>;
    operations.push(String(request.op));
    if (request.op === 'production-facts') {
      if (releaseFacts) { pauseFacts?.(); await releaseFacts; releaseFacts = null; }
      const section = request.section as 'products' | 'recipes' | 'machines' | 'availability';
      const rows = section === 'products' ? catalog.products : section === 'recipes' ? catalog.recipes : section === 'machines' ? catalog.machines : Object.entries(availability.recipes).map(([name, value]) => ({ name, ...value }));
      return { ok: true, schema: 1, section, mods: catalog.mods, tick: 600, total: rows.length, items: rows.slice(Number(request.offset), Number(request.offset) + Number(request.limit)), next: null, contentIdentity: 'status-fixture', availabilityIdentity: 'availability-fixture', force: availability.force, researched: [], surfaceProperties: {} };
    }
    if (request.op === 'operational-register') return { ok: true, tick: 600 };
    if (request.op === 'operational-read') {
      if (releaseRead) { pauseRead?.(); await releaseRead; releaseRead = null; }
      const scopeId = String(request.scopeId), points: number[] = sampleMode === 'short-window' ? [540, 600] : Array.from({ length: 11 }, (_, i) => i * 60);
      const total = (kind: 'production' | 'consumption', tick: number) => {
        const rate = sampleMode === 'deficit' && kind === 'production' ? 0.5 : 1;
        if (sampleMode === 'reset' && kind === 'production' && tick >= 300) return Math.max(0, 5 - (tick - 300) / 60);
        return tick / 60 * rate;
      };
      const samples: OperationalSample[] = points.map(tick => ({ schema: 1, epoch: 'epoch', scopeId, scopeRevision: 1, membershipHash: 'same-members', tick, readings: [
        { kind: 'production', productKind: 'item', name: 'gear', quality: 'normal', surface: 'nauvis', total: total('production', tick), coverage: 'complete' as const, method: 'fixture-v1', evidence: ['ordinary-sample'], errorBound: sampleMode === 'deficit' ? 0.05 : 0 },
        { kind: 'consumption', productKind: 'item', name: 'plate', quality: 'normal', surface: 'nauvis', total: total('consumption', tick), ...(sampleMode === 'unknown-input' && tick === 300 ? { coverage: 'unknown' as const, reason: 'input_counter_reset' } : { coverage: 'complete' as const }), method: 'fixture-v1', evidence: ['ordinary-sample'], errorBound: sampleMode === 'deficit' ? 0.05 : 0 },
      ], ...(sampleMode === 'symptom' ? { symptoms: [{ unit: 17, name: 'assembler', position: { x: 1, y: 2 }, tick, status: 'no_power', recipe: 'gear', power: 0, coverage: 'complete' as const, evidence: ['ordinary-game-state'] }] } : {}) }));
      return { tick: 600, samples };
    }
    if (request.op === 'submit') throw new Error('unexpected game mutation');
    throw new Error(`Unexpected fake game operation: ${String(request.op)}`);
  };
  game.request = gameRequest as never;
  const runtime = new DurableRuntime(root, 'run', 'epoch', game, life); active.push(runtime);
  if (operationalLimits) runtime.initialize({ objective: 'status test', scenario: 'fixture', scenarioVersion: '1', seed: 1, codeCommit: 'fixture', gameVersion: '2.0.77', mods: { base: 'fixture' }, roster: [], model: 'fixture', effort: 'medium', instructionHashes: {}, assisted: false, status: 'running', operationalLimits });
  const coordinator = new Coordinator(runtime, caps); team().forEach(agent => coordinator.register(agent)); await runtime.recover(); await runtime.resume(control);
  const gateway = new CoordinationGateway(coordinator), mcp = new CoordinationMcp(coordinator, gateway);
  const start = (agent = 'foreman') => { const turn = coordinator.budget.admit(agent); const binding = coordinator.bind(agent, `${agent}-session-${turn.id}`, turn.id, async () => {}); const key = mcp.issue(agent); mcp.bind(key, binding); return { key, turn, call: (name: string, args: unknown) => mcp.call(key, name, args) }; };
  const foreman = start();
  const facts = await foreman.call('production_search', { query: '', product: 'item:gear' }) as { facts: ProductionRequest['facts'] };
  const request: ProductionRequest = { schema: 1, target: item('gear'), mode: 'rate', rate: { numerator: '1', denominator: '1', unit: 'items-per-game-second' }, profile, facts: facts.facts, externalInputs: [{ product: item('ore'), capacity: { kind: 'unlimited' } }], initialStock: [], utilities: { electricityWatts: null }, constructionEquipment: { assembler: 100 }, sinks: [], routes: {}, machines: {}, fuels: {} };
  const plan = await foreman.call('production_plan', { request }) as { id: string; revision: number; status: string };
  const inspect = () => foreman.call('production_inspect', { id: plan.id, revision: plan.revision }) as Promise<{ stages: { id: string; recipe: string; outputs: string[]; evidence: string[] }[] }>;
  const proposal = (id: string, stage: string, withArea = false): TaskInput => ({ id, goal: `construct ${stage}`, parent: null, dependencies: [], scope: {}, resources: {}, successCriteria: ['construction complete'], deadline: null, committedPlan: `${plan.id}.${plan.revision}/${stage}`, actor: withArea ? 'builder-1' : null, reservations: withArea ? diagnosticAssignment(1).resources.map(r => r.resource) : [], criteria: [{ kind: 'message-delivered', id: `${id}-report` }] });
  const commit = async (stage: string, task: TaskInput) => foreman.call('production_commit', { requestId: task.id, id: plan.id, revision: plan.revision, assignments: [{ stage, task }] });
  const assign = async (taskId: string) => { coordinator.send('foreman', { id: `${taskId}-handoff`, recipient: 'engineer', task: taskId, revision: 1, intent: 'handoff', content: 'construct the assigned stage', evidence: [] }); await coordinator.pump(); };
  const status = (agent: ReturnType<typeof start>, stage?: string, windowTicks = 600, offset = 0) => agent.call('production_status', { id: plan.id, revision: plan.revision, ...(stage ? { stage } : {}), windowTicks, offset });
  return { root, runtime, coordinator, gateway, mcp, foreman, start, plan, inspect, proposal, commit, assign, status, setSampleMode(value: typeof sampleMode) { sampleMode = value; }, resetOperations() { operations = []; }, ops() { return operations; }, pauseNextRead() { let entered!: () => void, release!: () => void; const waiting = new Promise<void>(resolve => { entered = resolve; }); releaseRead = new Promise<void>(resolve => { release = resolve; }); pauseRead = entered; return { waiting, release }; }, pauseNextFacts() { let entered!: () => void, release!: () => void; const waiting = new Promise<void>(resolve => { entered = resolve; }); releaseFacts = new Promise<void>(resolve => { release = resolve; }); pauseFacts = entered; return { waiting, release }; } };
}

describe('production status through the authenticated coordination surface', () => {
  it('accepts exact recipe and machine selectors on operational scope registration', () => {
    const request = { op: 'operational-register', scope: { schema: 1, id: 'stage-scope', revision: 1, task: 'task-stage', surface: 'nauvis', area: [{ x: 0, y: 0 }, { x: 10, y: 10 }], entityLimit: 100, recipe: 'gear', machine: 'assembler' }, sampleTicks: 60, historySamples: 120 };
    expect(validateRequest(request)).toEqual(request);
    expect(() => validateRequest({ ...request, scope: { ...request.scope, evaluatorFixture: 'private' } })).toThrow(/unexpected or missing fields/i);
    expect(() => validateRequest({ ...request, scope: { ...request.scope, recipe: 'recipe:gear' } })).toThrow(/invalid identifier/i);
  });

  it('keeps a persisted stage scope but denies repeated watch registration while at the run cap', async () => {
    const limits = { ...DEFAULT_OPERATIONAL_LIMITS, maxWatchesPerRole: 1, maxWatchesPerRun: 1 };
    const f = await fixture(limits); const stage = (await f.inspect()).stages.find(s => s.outputs.includes('item:gear'))!;
    await f.commit(stage.id, f.proposal('status-watch-cap', stage.id, true)); await f.assign('status-watch-cap');
    const watches = new OperationalWatches(f.runtime, limits), visibility = { kind: 'operator' as const };
    watches.register({ id: 'watch-cap-filler', role: 'engineer', task: 'other-task', scopeId: 'other-scope', scopeRevision: 1, metric: { kind: 'production', name: 'other', quality: 'normal', surface: 'nauvis' }, threshold: 1, recovery: 1.1, persistenceTicks: 300 }, visibility);
    const engineer = f.start('engineer');
    await expect(f.status(engineer, stage.id)).rejects.toThrow(/watch limit reached/i);
    expect(f.runtime.journal.list('run', 'operationalScopes')).toHaveLength(1);
    const existing = watches.list(); expect(existing).toHaveLength(1); expect(existing[0]).toMatchObject({ id: 'watch-cap-filler', state: 'healthy', sequence: 0 });
    await expect(f.status(engineer, stage.id)).rejects.toThrow(/watch limit reached/i);
    expect(watches.list()).toEqual(existing);
    expect(f.runtime.journal.list('run', 'productionStatuses')).toHaveLength(0);
  });
  it('bounds owner pages and does not execute game actions', async () => {
    const f = await fixture();
    const original = f.runtime.journal.get<{ plan: { stages: { id: string }[] } }>('run', 'productionPlans', `${f.plan.id}.1`)!;
    original.plan.stages = Array.from({ length: 6 }, (_, i) => ({ ...original.plan.stages[i % original.plan.stages.length]!, id: `stage-page-${i}` }));
    f.runtime.record('test/extended-plan', [{ entity: 'productionPlans', id: `${f.plan.id}.1`, value: original }]);
    f.resetOperations();
    const page = await f.status(f.foreman) as { stages: unknown[]; next: number | null; omitted: number; scenarioVerdict: string };
    expect(page).toMatchObject({ next: 4, omitted: 2, scenarioVerdict: 'not-evaluated' }); expect(page.stages).toHaveLength(4);
    expect(f.ops()).not.toContain('submit'); expect(f.ops()).not.toContain('build');
    expect(f.runtime.execution.pending()).toHaveLength(0);
    const operator = operatorPlans(f.coordinator); expect(operator.plans.length).toBeLessThanOrEqual(10);
    expect(operatorStages(f.coordinator, f.plan.id, 1).stages.length).toBeLessThanOrEqual(4);
  });

  it('limits an assigned engineer to the committed stage without owner aggregates or neighbor evidence', async () => {
    const f = await fixture(); const stages = (await f.inspect()).stages; const stage = stages.find(s => s.outputs.includes('item:gear'))!;
    const neighbor = stages.find(s => s.id !== stage.id)!;
    const planKey = `${f.plan.id}.1`, plan = f.runtime.journal.get<{ plan: { stages: typeof stages } }>('run', 'productionPlans', planKey)!;
    plan.plan.stages.find(s => s.id === neighbor.id)!.evidence = ['private-neighbor-evidence'];
    f.runtime.record('test/private-status-neighbor', [{ entity: 'productionPlans', id: planKey, value: plan }]);
    await f.commit(stage.id, f.proposal('status-private', stage.id, true)); await f.assign('status-private');
    const engineer = f.start('engineer'); const result = await f.status(engineer, stage.id) as { stages: Array<Record<string, unknown>>; omitted: number; scenarioVerdict: string };
    expect(result.stages).toHaveLength(1); expect(result.omitted).toBe(0); expect(result.scenarioVerdict).toBe('not-evaluated');
    const text = JSON.stringify(result); expect(text).toContain(stage.id); expect(text).not.toContain(neighbor.id); expect(text).not.toContain('private-neighbor-evidence');
    expect(text).not.toMatch(/balances|targetDemand|headroomDemand|ownerRequest/i);
    await expect(f.status(engineer)).rejects.toThrow(/unavailable|assigned stage/i);
    await expect(f.status(engineer, neighbor.id)).rejects.toThrow(/unavailable|authorized/i);
  });

  it('rechecks revoked grants and changed task assignments after the asynchronous status query', async () => {
    const f = await fixture(); const stage = (await f.inspect()).stages.find(s => s.outputs.includes('item:gear'))!;
    await f.commit(stage.id, f.proposal('status-revoke', stage.id, true)); await f.assign('status-revoke');
    const engineer = f.start('engineer'), firstGate = f.pauseNextFacts();
    const revoked = f.status(engineer, stage.id); await firstGate.waiting; f.mcp.revoke(engineer.key); firstGate.release();
    await expect(revoked).rejects.toThrow(/unauthenticated|authorized/i);
    expect(f.runtime.journal.list('run', 'productionStatuses')).toHaveLength(0);

    const g = await fixture(); const stageTwo = (await g.inspect()).stages.find(s => s.outputs.includes('item:gear'))!;
    await g.commit(stageTwo.id, g.proposal('status-reassigned', stageTwo.id, true)); await g.assign('status-reassigned');
    const worker = g.start('engineer'), secondGate = g.pauseNextRead();
    const inFlight = g.status(worker, stageTwo.id); await secondGate.waiting;
    g.coordinator.revise('foreman', 'status-reassigned', 1, g.proposal('status-reassigned', stageTwo.id, true)); secondGate.release();
    await expect(inFlight).rejects.toThrow(/scope changed|unavailable|authorized/i);
    expect(g.runtime.journal.list('run', 'productionStatuses')).toHaveLength(0);
  });

  it('keeps construction completion separate from physical health and evaluator verdict', async () => {
    const f = await fixture(); const stage = (await f.inspect()).stages.find(s => s.outputs.includes('item:gear'))!;
    await f.commit(stage.id, f.proposal('status-built', stage.id, true)); await f.assign('status-built');
    f.coordinator.send('engineer', { id: 'status-built-report', recipient: 'foreman', task: 'status-built', revision: 1, intent: 'report', content: 'construction complete', evidence: [] }); await f.coordinator.pump();
    f.coordinator.report('engineer', 'status-built', 1, ['status-built-report']); await f.coordinator.pump();
    f.setSampleMode('short-window');
    const page = await f.status(f.foreman, stage.id) as { stages: Array<Record<string, unknown>>; scenarioVerdict: string };
    expect(page.stages[0]).toMatchObject({ health: 'unknown', scenarioVerdict: 'not-evaluated', progress: { construction: 'complete', health: 'unknown', commissioning: 'unknown', scenarioVerdict: 'not-evaluated' } });
    expect(page.scenarioVerdict).toBe('not-evaluated'); expect(f.ops()).not.toContain('verify');
  });

  it('reports an empty electrical buffer as a measured symptom while leaving cause and verdict unproven', async () => {
    const f = await fixture(); const stage = (await f.inspect()).stages.find(s => s.outputs.includes('item:gear'))!;
    await f.commit(stage.id, f.proposal('status-symptom', stage.id, true)); await f.assign('status-symptom'); f.setSampleMode('symptom');
    const engineer = f.start('engineer');
    const page = await f.status(engineer, stage.id) as { stages: Array<{ symptoms?: Array<Record<string, unknown>>; exceptions: Array<{ kind: string; detail: string }>; scenarioVerdict: string }>; scenarioVerdict: string };
    expect(page.stages[0]?.symptoms).toEqual(expect.arrayContaining([expect.objectContaining({ unit: 17, name: 'assembler', recipe: 'gear', power: 0, tick: 600, evidence: ['ordinary-game-state'] })]));
    expect(page.stages[0]?.exceptions).toContainEqual(expect.objectContaining({ kind: 'measured-symptom', detail: expect.stringMatching(/empty electrical energy buffer.*supply cause is unverified/i) }));
    expect(page.stages[0]?.scenarioVerdict).toBe('not-evaluated'); expect(page.scenarioVerdict).toBe('not-evaluated');
  });

  it('uses uncertainty upper bounds for deficits and preserves unknown interval and hypothesis separately', async () => {
    const prepare = async (id: string, mode: 'deficit' | 'unknown-input' | 'reset' | 'short-window') => {
      const f = await fixture(); const stage = (await f.inspect()).stages.find(s => s.outputs.includes('item:gear'))!;
      await f.commit(stage.id, f.proposal(id, stage.id, true)); await f.assign(id); f.setSampleMode(mode);
      return { f, stage, engineer: f.start('engineer') };
    };
    const d = await prepare('status-deficit', 'deficit');
    const deficit = await d.f.status(d.engineer, d.stage.id) as { stages: Array<{ health: string; exceptions: Array<{ kind: string; product?: string; detail: string }>; hypotheses: string[] }> };
    expect(deficit.stages[0]?.health).toBe('shortfall');
    expect(deficit.stages[0]?.exceptions).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'measured-shortfall', product: 'item:gear' })]));
    expect(deficit.stages[0]?.hypotheses.length).toBeGreaterThan(0);
    expect(deficit.stages[0]?.hypotheses[0]).toMatch(/hypotheses, not established root causes/i);

    const u = await prepare('status-unknown-input', 'unknown-input');
    const unknown = await u.f.status(u.engineer, u.stage.id) as { stages: Array<{ exceptions: Array<{ kind: string; product?: string; detail: string }> }> };
    expect(unknown.stages[0]?.exceptions).toContainEqual(expect.objectContaining({ kind: 'unknown', product: 'item:plate', detail: 'input_counter_reset' }));

    const r = await prepare('status-reset', 'reset');
    const reset = await r.f.status(r.engineer, r.stage.id) as { stages: Array<{ exceptions: Array<{ kind: string; product?: string; detail: string }> }> };
    expect(reset.stages[0]?.exceptions).toContainEqual(expect.objectContaining({ kind: 'unknown', product: 'item:gear', detail: 'counter_reset' }));

    const w = await prepare('status-short-window', 'short-window');
    const short = await w.f.status(w.engineer, w.stage.id, 600) as { stages: Array<{ exceptions: Array<{ kind: string; product?: string; detail: string }> }> };
    expect(short.stages[0]?.exceptions).toContainEqual(expect.objectContaining({ kind: 'unknown', product: 'item:gear', detail: 'insufficient_history' }));
    await expect(w.f.status(w.engineer, w.stage.id, 30)).rejects.toThrow(/invalid production status selector/i);
  });

  it('marks stale facts explicitly and persists task-only status without supplier data or private evaluator records', async () => {
    const f = await fixture(); const stage = (await f.inspect()).stages.find(s => s.outputs.includes('item:gear'))!;
    await f.commit(stage.id, f.proposal('status-persist', stage.id, true)); await f.assign('status-persist');
    const engineer = f.start('engineer');
    const result = await f.status(engineer, stage.id) as { stages: Array<Record<string, unknown>> };
    const stored = f.runtime.journal.list<Record<string, unknown>>('run', 'productionStatuses')[0]!;
    expect(stored).not.toHaveProperty('scenarioEvaluator'); expect(JSON.stringify(stored)).not.toMatch(/private-evaluator/i);
    expect(stored.progress).toMatchObject({ suppliers: [] });
    const statusEvent = f.runtime.journal.events().find(event => event.type === 'production/status' && event.changes.some(change => change.entity === 'productionStatuses' && change.id === stored.id));
    const statusChange = statusEvent?.changes.find(change => change.entity === 'productionStatuses' && change.id === stored.id);
    expect(statusChange?.sources).toEqual(expect.arrayContaining([expect.objectContaining({ entity: 'tasks', id: 'status-persist' }), expect.objectContaining({ entity: 'operationalScopes' })]));
    expect(result.stages[0]).toMatchObject({ health: 'healthy', scenarioVerdict: 'not-evaluated' });
    expect(JSON.stringify(result.stages[0]?.metrics)).toContain('operationalSamples:');

    const record = f.runtime.journal.get<{ plan: { fingerprint: string } }>('run', 'productionPlans', `${f.plan.id}.1`)!;
    record.plan.fingerprint = 'changed-facts-fingerprint';
    f.runtime.record('test/stale-plan-facts', [{ entity: 'productionPlans', id: `${f.plan.id}.1`, value: record }]);
    const stale = await f.status(engineer, stage.id) as { stages: Array<{ stale: boolean; health: string; exceptions: Array<{ kind: string; detail: string }> }> };
    expect(stale.stages[0]).toMatchObject({ stale: true, health: 'unknown' });
    expect(stale.stages[0]?.exceptions).toContainEqual(expect.objectContaining({ kind: 'unknown', detail: expect.stringMatching(/facts or research changed/i) }));
  });
});
