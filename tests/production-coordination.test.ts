import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MachineFact, ProductionAvailability, ProductionCatalog, ProductionCommitment, ProductionProduct, ProductionProfile, ProductionRequest, RecipeFact } from '@autofactorio/contracts';
import type { Batch, Receipt } from '@autofactorio/contracts';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import { sha256 } from '../packages/factorio/src/lifecycle.js';
import type { Checkpoint, ControlState } from '../packages/factorio/src/lifecycle.js';
import { PROBE_CAPS } from '../packages/codex/src/budget.js';
import { Coordinator } from '../packages/core/orchestration/coordinator.js';
import type { TaskInput } from '../packages/core/orchestration/coordinator.js';
import { team } from '../packages/core/orchestration/roles.js';
import { CoordinationGateway } from '../packages/tools/src/coordination.js';
import { CoordinationMcp, toolCatalog } from '../packages/tools/src/coordination-mcp.js';
import { diagnosticAssignment } from '@autofactorio/contracts';

const caps = { ...PROBE_CAPS, turns: 20, tools: 100, runMs: 300_000, turnMs: 300_000 };
const item = (name: string): ProductionProduct => ({ kind: 'item', name, quality: 'normal', surface: 'nauvis' });
const flow = (name: string, amount: number) => ({ type: 'item' as const, name, amount });
const recipe = (name: string, input: string, output: string): RecipeFact => ({ id: `recipe:${name}`, name, category: 'crafting', seconds: 1, ingredients: [flow(input, 1)], products: [flow(output, 1)], unlocks: [], surfaceConditions: [] });
const machine = (): MachineFact => ({ id: 'machine:assembler', name: 'assembler', type: 'assembling-machine', categories: ['crafting'], speed: 1, ingredientLimit: 20, collisionBox: [{ x: -1, y: -1 }, { x: 1, y: 1 }], fluidBoxes: [], placementItems: ['assembler'], energy: { kind: 'electric', maxJoulesPerTick: 0, drainJoulesPerTick: 0 }, baseEffects: {}, surfaceConditions: [] });
const profile: ProductionProfile = { id: 'nauvis', revision: 1, fingerprint: 'profile-1', recipes: null, equipment: null };
const recipes = [recipe('plate', 'ore', 'plate'), recipe('gear', 'plate', 'gear')];
const catalog: ProductionCatalog = { schema: 1, mods: { base: 'fixture' }, fingerprint: 'a'.repeat(64), products: ['ore', 'plate', 'gear'].map(name => ({ id: `item:${name}`, kind: 'item', name })), recipes, machines: [machine()] };
const availability: ProductionAvailability = { tick: 100, force: 'player', researched: [], surfaceProperties: {}, recipes: Object.fromEntries(recipes.map(r => [r.name, { enabled: true, productivity: 0 }])) };
function completedZip() { const bytes = Buffer.alloc(68); bytes.writeUInt32LE(0x02014b50); bytes.writeUInt32LE(0x06054b50, 46); bytes.writeUInt16LE(1, 54); bytes.writeUInt16LE(1, 56); bytes.writeUInt32LE(46, 58); return bytes; }
const active: { runtimes: DurableRuntime[]; root: string }[] = [];
afterEach(() => { for (const f of active.splice(0)) { for (const runtime of f.runtimes) runtime.close(); rmSync(f.root, { recursive: true, force: true }); } });

async function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'af-production-commit-'));
  const control: ControlState = { ok: true, epoch: 'epoch', session: 'session', revision: 1, generation: 1, armed: false, ready: false, paused: true, neutral: true, ticksToRun: 0, tick: 100, ticksPlayed: 100, experimentTick: 100, scenarioElapsed: 100, injections: 1, checkpoint: false, ledger: {}, intents: {}, production: {}, mods: {} };
  const port = { command: async () => JSON.stringify(control), close() {} };
  const game = new GameClient(port, () => {}); const life = new Lifecycle(port, game, () => {});
  life.inspect = async () => structuredClone(control); life.pause = async () => structuredClone(control); life.reconcile = async () => structuredClone(control);
  life.arm = async () => { control.armed = true; control.paused = false; return structuredClone(control); };
  let ownershipReceipts: Receipt[] = [];
  life.ownership = async request => ({ request, tick: 101, receipts: ownershipReceipts });
  let availabilityEnabled = true;
  game.request = async req => {
    const request = req as Extract<import('@autofactorio/contracts').GameRequest, { op: 'production-facts' }>;
    const rows = request.section === 'products' ? catalog.products : request.section === 'recipes' ? catalog.recipes : request.section === 'machines' ? catalog.machines : Object.entries(availability.recipes).map(([name, value]) => ({ name, ...value, enabled: availabilityEnabled && value.enabled }));
    return { ok: true, schema: 1, section: request.section, mods: catalog.mods, tick: 100, total: rows.length, items: rows.slice(request.offset, request.offset + request.limit), next: request.offset + request.limit < rows.length ? request.offset + request.limit : null, contentIdentity: 'commit-fixture', ...(request.section === 'availability' ? { availabilityIdentity: JSON.stringify(rows), force: availability.force, researched: [], surfaceProperties: {} } : {}) } as never;
  };
  const runtime = new DurableRuntime(root, 'run', 'epoch', game, life); const ownership = { runtimes: [runtime], root }; active.push(ownership);
  const c = new Coordinator(runtime, caps); team().forEach(agent => c.register(agent)); await runtime.recover(); await runtime.resume(control);
  const gateway = new CoordinationGateway(c); const mcp = new CoordinationMcp(c, gateway);
  const start = (agent = 'foreman') => { const turn = c.budget.admit(agent); const binding = c.bind(agent, `${agent}-session-${turn.id}`, turn.id, async () => {}); const key = mcp.issue(agent); mcp.bind(key, binding); return { key, turn, call: (name: string, args: unknown) => mcp.call(key, name, args) }; };
  const foreman = start();
  const factsResult = await foreman.call('production_search', { query: '', product: 'item:gear' }) as { facts: ProductionRequest['facts'] };
  const request: ProductionRequest = { schema: 1, target: item('gear'), mode: 'rate', rate: { numerator: '1', denominator: '1', unit: 'items-per-game-second' }, profile, facts: factsResult.facts, externalInputs: [{ product: item('ore'), capacity: { kind: 'unlimited' } }], initialStock: [], utilities: { electricityWatts: null }, constructionEquipment: { assembler: 100 }, sinks: [], routes: {}, machines: {}, fuels: {} };
  const summary = await foreman.call('production_plan', { request }) as { id: string; revision: number; status: string };
  const inspect = () => foreman.call('production_inspect', { id: summary.id, revision: summary.revision }) as Promise<{ stages: { id: string; meaning: string; inputs: string[]; outputs: string[]; evidence: string[] }[]; commitments?: { stage: string; task: string; taskRevision: number; construction: string; evidence: string[]; commissioning: string; health: string; scenarioVerdict: string; suppliers: string[] }[] }>;
  const proposal = (id: string, stage: string, dependencies: string[] = [], actor: string | null = null): TaskInput => ({ id, goal: `construct ${stage}`, parent: null, dependencies, scope: {}, resources: {}, successCriteria: ['construction complete'], deadline: null, committedPlan: `${summary.id}.${summary.revision}/${stage}`, actor, reservations: [], criteria: [{ kind: 'message-delivered', id: `${id}-report` }] });
  const commit = (assignments: { stage: string; task: TaskInput | { id: string; revision: number } }[], requestId = 'commit-one') => foreman.call('production_commit', { requestId, id: summary.id, revision: summary.revision, assignments });
  return { root, runtime, c, game, control, gateway, foreman, start, summary, request, inspect, proposal, commit, changeAvailability() { availabilityEnabled = false; }, setOwnershipReceipts(receipts: Receipt[]) { ownershipReceipts = receipts; }, async restart() { runtime.close(); const r = new DurableRuntime(root, 'run', 'epoch', game, life); ownership.runtimes.push(r); const next = new Coordinator(r, caps); const g = new CoordinationGateway(next); await r.execution.reconcile(); return { runtime: r, c: next, gateway: g, start(agent = 'foreman') { const turn = next.budget.admit(agent); return { turn, token: g.issue(next.bind(agent, `${agent}-replacement-${turn.id}`, turn.id, async () => {})) }; } }; } };
}

describe('production coordination S3', () => {
  it('S3-01 retries an exact request after a lost response and restart with one durable task mapping', async () => {
    const f = await fixture(); const stages = (await f.inspect()).stages; const assignment = { stage: stages[0]!.id, task: f.proposal('task-plate', stages[0]!.id) };
    const first = await f.commit([assignment]) as ProductionCommitment;
    const lost = await f.commit([assignment]); expect(lost).toEqual(first);
    f.c.finish(f.foreman.turn.id);
    const restarted = await f.restart();
    const replacement = restarted.start();
    const retried = await restarted.gateway.call(replacement.token, 'production_commit', { requestId: 'commit-one', id: f.summary.id, revision: 1, assignments: [assignment] });
    expect(retried).toEqual(first); expect(restarted.runtime.journal.get('run', 'productionCommitments', first.id)).toEqual(first);
    expect(restarted.runtime.journal.list('run', 'tasks')).toHaveLength(1); expect(restarted.runtime.journal.list('run', 'productionBindings')).toHaveLength(1);
  });

  it('S3-01 conflicts on a changed payload and denies engineer and bodyless resource reservation', async () => {
    const f = await fixture(); const stages = (await f.inspect()).stages; const first = f.proposal('task-plate', stages[0]!.id);
    await f.commit([{ stage: stages[0]!.id, task: first }]);
    await expect(f.commit([{ stage: stages[0]!.id, task: { ...first, goal: 'different meaning' } }])).rejects.toThrow(/conflict/i);
    const engineer = f.start('engineer'); await expect(engineer.call('production_commit', { requestId: 'engineer-commit', id: f.summary.id, revision: 1, assignments: [{ stage: stages[1]!.id, task: f.proposal('engineer-task', stages[1]!.id) }] })).rejects.toThrow();
    const bad = f.proposal('bodyless-reserved', stages[1]!.id); bad.reservations = [{ kind: 'actor', actor: 'builder-1' }];
    await expect(f.commit([{ stage: stages[1]!.id, task: bad }], 'bodyless')).rejects.toThrow(/bodyless|reserve/i);
    expect(f.c.task('task-plate').id).toBe('task-plate'); expect(f.c.tasks()).toHaveLength(1);
  });

  it('S3-01 exposes the committed request shape only to planning roles', async () => {
    const f = await fixture();
    const schema = toolCatalog(f.c, 'foreman').find(tool => tool.name === 'production_commit')!.inputSchema;
    expect(schema.required).toEqual(['requestId', 'id', 'revision', 'assignments']);
    expect((schema.properties as Record<string, { type: string }>).requestId?.type).toBe('string');
    expect(toolCatalog(f.c, 'engineer').some(tool => tool.name === 'production_commit')).toBe(false);
  });

  it('S3-01 rejects a mapped actor without a registered execute-capable agent', async () => {
    const f = await fixture(); const stage = (await f.inspect()).stages[0]!;
    const unstaffed = { ...f.proposal('unstaffed-builder', stage.id), actor: 'builder-999', reservations: diagnosticAssignment(1).resources.map(resource => resource.resource) };
    await expect(f.commit([{ stage: stage.id, task: unstaffed }], 'unstaffed-builder')).rejects.toThrow(/actor|agent|authorized|assignment/i);
    expect(f.c.tasks()).toHaveLength(0); expect(f.runtime.journal.list('run', 'productionBindings')).toHaveLength(0);
  });

  it('S3-02 rejects stale stage facts, foreign task ownership, and profile denied routes without partial admission', async () => {
    const f = await fixture(); const stages = (await f.inspect()).stages; const before = f.c.tasks().length;
    await expect(f.commit([{ stage: 'unknown-stage', task: f.proposal('bad-stage', 'unknown-stage') }], 'unknown')).rejects.toThrow();
    f.c.propose('foreman', f.proposal('engineer-owned', stages[0]!.id));
    f.c.send('foreman', { id: 'foreign-handoff', recipient: 'engineer', task: 'engineer-owned', revision: 1, intent: 'handoff', content: 'assigned', evidence: [] }); await f.c.pump();
    await expect(f.commit([{ stage: stages[0]!.id, task: { id: 'engineer-owned', revision: 2 } }], 'stale-task-revision')).rejects.toThrow(/ownership|managed|stale/i);
    expect(f.c.tasks()).toHaveLength(before + 1); expect(f.runtime.journal.list('run', 'productionBindings')).toHaveLength(0);
    const denied = await f.foreman.call('production_plan', { request: { ...f.request, profile: { ...profile, recipes: [] } } }) as { id: string; revision: number; status: string };
    expect(denied.status).not.toBe('feasible');
    await expect(f.foreman.call('production_commit', { requestId: 'profile-denied', id: denied.id, revision: denied.revision, assignments: [{ stage: stages[0]!.id, task: f.proposal('profile-denied-task', stages[0]!.id) }] })).rejects.toThrow(/executable|feasible/i);
    expect(f.c.tasks()).toHaveLength(before + 1); expect(f.runtime.journal.list('run', 'productionBindings')).toHaveLength(0);
  });

  it('S3-02 rejects changed availability at commit time without admitting any tasks', async () => {
    const f = await fixture(); const stage = (await f.inspect()).stages[0]!;
    f.changeAvailability();
    await expect(f.commit([{ stage: stage.id, task: f.proposal('stale-facts-task', stage.id) }], 'stale-facts')).rejects.toThrow(/stale facts|availability/i);
    expect(f.c.tasks()).toHaveLength(0); expect(f.runtime.journal.list('run', 'productionBindings')).toHaveLength(0);
  });

  it('S3-02 keeps task creation and stage mappings atomic when the SQLite journal refuses the transaction', async () => {
    const f = await fixture(); const stages = (await f.inspect()).stages;
    const db = (f.runtime.journal as unknown as { db: { exec(sql: string): void } }).db;
    db.exec("CREATE TRIGGER reject_binding_projection BEFORE INSERT ON projections WHEN NEW.entity='productionBindings' BEGIN SELECT RAISE(ABORT, 'injected binding projection failure'); END;");
    await expect(f.commit(stages.slice(0, 2).map(stage => ({ stage: stage.id, task: f.proposal(`atomic-${stage.id}`, stage.id) })), 'atomic-failure')).rejects.toThrow('injected binding projection failure');
    db.exec('DROP TRIGGER reject_binding_projection;');
    expect(f.c.tasks()).toHaveLength(0); expect(f.runtime.journal.list('run', 'productionBindings')).toHaveLength(0); expect(f.runtime.journal.list('run', 'productionCommitments')).toHaveLength(0);
    expect(f.runtime.journal.events().some(event => event.type === 'production/committed')).toBe(false);
  });

  it('S3-03 constructs downstream stages without implied material dependencies and keeps commissioning, health and verdict unknown', async () => {
    const f = await fixture(); const stages = (await f.inspect()).stages;
    const assigned = await f.commit(stages.map(stage => ({ stage: stage.id, task: f.proposal(`build-${stage.id}`, stage.id) }))) as ProductionCommitment;
    expect(assigned.mappings).toHaveLength(stages.length);
    const detail = await f.inspect();
    expect(detail.commitments).toHaveLength(stages.length);
    expect(detail.commitments).toEqual(expect.arrayContaining(stages.map(stage => expect.objectContaining({ stage: stage.id, construction: 'pending', commissioning: 'unknown', health: 'unknown', scenarioVerdict: 'not-evaluated' }))));
    for (const stage of stages) expect(f.c.task(`build-${stage.id}`).dependencies).toEqual([]);
    const gear = stages.find(stage => stage.outputs.includes('item:gear'))!;
    expect(detail.commitments!.find(s => s.stage === gear.id)?.suppliers.length).toBeGreaterThan(0);
  });

  it('S3-03 honors explicit scheduler dependencies while material supplier links remain informational', async () => {
    const f = await fixture(); const stages = (await f.inspect()).stages;
    const upstream = stages.find(stage => stage.outputs.includes('item:plate'))!, downstream = stages.find(stage => stage.outputs.includes('item:gear'))!;
    const upstreamId = 'dependency-upstream', downstreamId = 'dependency-downstream';
    await f.commit([{ stage: upstream.id, task: f.proposal(upstreamId, upstream.id) }, { stage: downstream.id, task: { ...f.proposal(downstreamId, downstream.id), dependencies: [upstreamId] } }]);
    f.c.send('foreman', { id: 'dependency-upstream-handoff', recipient: 'engineer', task: upstreamId, revision: 1, intent: 'handoff', content: 'construct supplier stage', evidence: [] });
    f.c.send('foreman', { id: 'dependency-downstream-handoff', recipient: 'engineer', task: downstreamId, revision: 1, intent: 'handoff', content: 'construct dependent stage', evidence: [] }); await f.c.pump();
    expect(f.c.task(downstreamId)).toMatchObject({ status: 'proposed', wait: 'dependency', dependencies: [upstreamId] });
    f.c.send('engineer', { id: `${upstreamId}-report`, recipient: 'foreman', task: upstreamId, revision: 1, intent: 'report', content: 'supplier construction complete', evidence: [] }); await f.c.pump();
    f.c.report('engineer', upstreamId, 1, [`${upstreamId}-report`]); await f.c.pump();
    expect(f.c.task(upstreamId).status).toBe('succeeded'); expect(f.c.task(downstreamId).status).not.toBe('succeeded');
    expect((await f.inspect()).commitments?.find(binding => binding.stage === downstream.id)?.suppliers).toContain(upstream.id);
  });

  it('S3-03 reports message completion as construction evidence only, never as sustained production', async () => {
    const f = await fixture(); const stage = (await f.inspect()).stages[0]!;
    await f.commit([{ stage: stage.id, task: f.proposal('reported-build', stage.id) }]);
    f.c.send('foreman', { id: 'reported-build-handoff', recipient: 'engineer', task: 'reported-build', revision: 1, intent: 'handoff', content: 'build', evidence: [] }); await f.c.pump();
    f.c.send('engineer', { id: 'reported-build-report', recipient: 'foreman', task: 'reported-build', revision: 1, intent: 'report', content: 'construction report', evidence: [] }); await f.c.pump();
    f.c.report('engineer', 'reported-build', 1, ['reported-build-report']); await f.c.pump();
    expect(f.c.task('reported-build').status).toBe('succeeded');
    const progress = (await f.inspect()).commitments?.[0]; expect(progress?.construction).toBe('complete'); expect(progress?.evidence).toContain('reported-build-report'); expect(progress?.commissioning).toBe('unknown'); expect(progress?.health).toBe('unknown'); expect(progress?.scenarioVerdict).toBe('not-evaluated');
  });

  it('S3-03 serializes an assigned-stage response without disclosing manager plan aggregates', async () => {
    const f = await fixture(); const stages = (await f.inspect()).stages; const stage = stages.find(candidate => candidate.outputs.includes('item:plate'))!;
    const neighbor = stages.find(candidate => candidate.id !== stage.id)!;
    const planKey = `${f.summary.id}.1`, planRecord = f.runtime.journal.get<{ plan: { stages: typeof stages } }>('run', 'productionPlans', planKey)!;
    planRecord.plan.stages.find(candidate => candidate.id === neighbor.id)!.evidence = ['private-neighbor-evidence'];
    f.runtime.journal.append({ run: 'run', epoch: 'epoch', wallTime: new Date().toISOString(), gameTick: null, actor: 'test', task: null, causation: null, correlation: null, visibility: { kind: 'operator' } }, 'test/private-neighbor-evidence', [{ entity: 'productionPlans', id: planKey, value: planRecord }]);
    await f.commit([{ stage: stage.id, task: f.proposal('scoped-stage', stage.id) }]);
    f.c.send('foreman', { id: 'scoped-handoff', recipient: 'engineer', task: 'scoped-stage', revision: 1, intent: 'handoff', content: 'build this stage', evidence: [] }); await f.c.pump();
    const engineer = f.start('engineer');
    const exactStage = await engineer.call('production_inspect', { id: f.summary.id, revision: 1, stage: stage.id, depth: 0 }) as { summary: Record<string, unknown>; stages: { id: string; meaning: string; evidence: string[] }[]; balances: unknown[]; commitments?: { stage: string; evidence: string[] }[] };
    expect(exactStage.stages.map(row => row.id)).toEqual([stage.id]);
    expect(exactStage.summary).toMatchObject({ schema: 1, id: f.summary.id, revision: 1, scope: 'assigned-stage', stage: stage.id });
    for (const field of ['target', 'mode', 'targetDemand', 'headroomDemand', 'status', 'executable', 'stageCount', 'blockers', 'assumptions', 'invalidatedEvidence']) expect(exactStage.summary).not.toHaveProperty(field);
    expect(exactStage.balances).toEqual([]);
    expect(exactStage.stages[0]).not.toHaveProperty('neighbors');
    expect(exactStage.commitments?.every(binding => binding.stage === stage.id)).toBe(true);
    expect(JSON.stringify(exactStage)).not.toMatch(/item:gear|items-per-game-second|targetDemand|stageCount|assumptions|private-neighbor-evidence/);
    expect(exactStage.commitments?.map(binding => binding.stage)).toEqual([stage.id]);
    const owner = await f.inspect() as unknown as { summary: Record<string, unknown>; stages: { id: string }[]; balances: unknown[] };
    expect(owner.summary).toMatchObject({ target: item('gear'), mode: 'rate', status: 'feasible' });
    expect(owner.summary).toHaveProperty('stageCount', stages.length);
    expect(owner.stages.map(row => row.id)).toEqual(stages.map(row => row.id));
    expect(owner.balances.length).toBeGreaterThan(0);
    const expired = await engineer.call('production_inspect', { id: f.summary.id, revision: 1, stage: stage.id, depth: 0, cursor: 'expired-or-foreign-cursor' }) as { summary: Record<string, unknown>; stages: unknown[]; balances: unknown[]; status: string };
    expect(expired.status).toBe('expired'); expect(expired.stages).toEqual([]); expect(expired.balances).toEqual([]);
    expect(expired.summary.scope).toBe('assigned-stage'); expect(expired.summary.stage).toBe(stage.id);
    const other = stages.find(candidate => candidate.id !== stage.id)!;
    await expect(engineer.call('production_inspect', { id: f.summary.id, revision: 1, stage: other.id, depth: 0 })).rejects.toThrow(/unavailable|authorized|assigned/i);
    f.c.cancel('foreman', 'scoped-stage', 1);
    await expect(engineer.call('production_inspect', { id: f.summary.id, revision: 1, stage: stage.id, depth: 0 })).rejects.toThrow(/unavailable|authorized|assigned/i);
  });

  it('S3-03 reapplies assigned-stage authorization after the asynchronous facts refresh', async () => {
    const f = await fixture(); const stage = (await f.inspect()).stages[0]!;
    await f.commit([{ stage: stage.id, task: f.proposal('revoked-during-inspect', stage.id) }]);
    f.c.send('foreman', { id: 'revocation-handoff', recipient: 'engineer', task: 'revoked-during-inspect', revision: 1, intent: 'handoff', content: 'inspect stage', evidence: [] }); await f.c.pump();
    const engineer = f.start('engineer'); const originalRequest = f.game.request.bind(f.game);
    let entered!: () => void; let release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let pausedOnce = false;
    f.game.request = async request => { if (!pausedOnce && typeof request === 'object' && request !== null && 'op' in request && request.op === 'production-facts') { pausedOnce = true; entered(); await gate; } return originalRequest(request); };
    const inspection = engineer.call('production_inspect', { id: f.summary.id, revision: 1, stage: stage.id, depth: 0 });
    await waiting; f.c.cancel('foreman', 'revoked-during-inspect', 1); release();
    await expect(inspection).rejects.toThrow(/unavailable|authorized|assigned/i);
  });

  it('S3-04 retains unchanged stage evidence and invalidates evidence when meaning changes', async () => {
    const f = await fixture(); const stages = (await f.inspect()).stages; const stagesUnderTest = [stages[0]!]; const assignments = stagesUnderTest.map(stage => ({ stage: stage.id, task: f.proposal(`evidence-${stage.id}`, stage.id) }));
    const originalCommitment = await f.commit(assignments);
    const taskId = assignments[0]!.task.id;
    f.c.send('foreman', { id: `${taskId}-handoff`, recipient: 'engineer', task: taskId, revision: 1, intent: 'handoff', content: 'construct stage', evidence: [] }); await f.c.pump();
    f.c.send('engineer', { id: `${taskId}-report`, recipient: 'foreman', task: taskId, revision: 1, intent: 'report', content: 'construction complete', evidence: [] }); await f.c.pump();
    f.c.report('engineer', taskId, 1, [`${taskId}-report`]); await f.c.pump(); expect(f.c.task(taskId).status).toBe('succeeded');
    const priorKey = `${f.summary.id}.1`, prior = f.runtime.journal.get<{ plan: { stages: typeof stages } }>('run', 'productionPlans', priorKey)!;
    prior.plan.stages[0]!.evidence = ['observation:accepted-stage'];
    f.runtime.journal.append({ run: 'run', epoch: 'epoch', wallTime: new Date().toISOString(), gameTick: null, actor: 'test', task: null, causation: null, correlation: null, visibility: { kind: 'operator' } }, 'test/stage-evidence', [{ entity: 'productionPlans', id: priorKey, value: prior }]);
    const unchanged = await f.foreman.call('production_plan', { request: f.request, prior: { id: f.summary.id, revision: 1 } }) as { revision: number; invalidatedEvidence: string[] };
    expect(unchanged.revision).toBe(2); expect(unchanged.invalidatedEvidence).toEqual([]);
    const unchangedInspect = await f.foreman.call('production_inspect', { id: f.summary.id, revision: 2 }) as { stages: typeof stages; commitments?: { stage: string }[] };
    expect(unchangedInspect.stages.map(stage => stage.id)).toEqual(stages.map(stage => stage.id));
    expect(unchangedInspect.stages[0]?.evidence).toContain('observation:accepted-stage');
    expect(unchangedInspect.commitments).toContainEqual(expect.objectContaining({ stage: stagesUnderTest[0]!.id, construction: 'complete', evidence: [`${taskId}-report`] }));
    const changed = await f.foreman.call('production_plan', { request: { ...f.request, headroom: 0.25 }, prior: { id: f.summary.id, revision: 2 } }) as { revision: number; invalidatedEvidence: string[] };
    expect(changed.revision).toBe(3); expect(changed.invalidatedEvidence).toContain('observation:accepted-stage');
    const changedInspect = await f.foreman.call('production_inspect', { id: f.summary.id, revision: 3 }) as { stages: typeof stages; commitments?: { stage: string }[] };
    expect(changedInspect.stages[0]?.evidence).not.toContain('observation:accepted-stage');
    expect(changedInspect.commitments ?? []).toEqual([]);
    expect(await f.commit(assignments)).toEqual(originalCommitment);
  });

  it('S3-04 fences commitment while a dispatched effect has an unknown outcome', async () => {
    const f = await fixture(); const stage = (await f.inspect()).stages[0]!;
    const task: TaskInput = { ...f.proposal('effect-build', stage.id), actor: 'builder-1', reservations: diagnosticAssignment(1).resources.map(resource => resource.resource) };
    await f.commit([{ stage: stage.id, task }]);
    f.c.send('foreman', { id: 'effect-assign', recipient: 'engineer', task: task.id, revision: 1, intent: 'handoff', content: 'build', evidence: [] }); await f.c.pump();
    const reservation = f.runtime.ownership.list().find(entry => entry.task === task.id && entry.state === 'active')!;
    const batch: Batch = { commandId: 'unknown-effect', epoch: reservation.request.epoch, session: reservation.request.session, task: task.id, revision: 1, actor: reservation.actor, surface: 'nauvis', grants: reservation.resources.map(resource => resource.grant), deadline: 1000, steps: [{ kind: 'place', position: { x: 1, y: 1 }, item: 'wooden-chest', quality: 'normal', direction: 0 }] };
    const checkpointName = 'before-unknown-place', bytes = completedZip(), captured = { ...structuredClone(f.control), checkpoint: checkpointName, armed: false, paused: true, neutral: true, ticksToRun: 0 };
    const save = f.runtime.artifacts.bytes(f.runtime.context(), 'save', bytes, 'application/zip');
    f.runtime.record('artifact/recorded', [{ entity: 'artifacts', id: save.id, value: { ...save } }]);
    const manifest: Checkpoint = { schema: 1, source: 'managed-disarmed', name: checkpointName, save: `${checkpointName}.zip`, sha256: sha256(bytes), size: bytes.length, eventCursor: f.runtime.journal.cursor(), captured, world: { tick: 100, entities: [], actors: {} }, modHash: 'fixture-mod' };
    const manifestArtifact = f.runtime.evidence('checkpoint', manifest, { kind: 'operator' });
    f.runtime.record('checkpoint/published', [{ entity: 'checkpoints', id: checkpointName, value: { manifest: manifestArtifact.id, save: save.id, eventCursor: manifest.eventCursor, source: 'managed-disarmed' } }]);
    f.c.submit('engineer', batch);
    const factsQuery = f.game.request.bind(f.game);
    let placements = 0;
    f.game.request = async () => { placements++; throw new Error('transport disconnected after send'); };
    await expect(f.runtime.dispatch(batch.commandId)).rejects.toThrow(/disconnected/i);
    expect(f.runtime.execution.pending().find(command => command.batch.commandId === batch.commandId)?.state).toBe('unknown');
    expect(placements).toBe(1);
    f.game.request = factsQuery;
    const held = f.runtime.ownership.revoke(reservation.id);
    await expect(f.runtime.ownership.flush(held.id)).rejects.toThrow(/final command receipt/i);
    expect(f.runtime.ownership.list().find(entry => entry.id === reservation.id)?.state).toBe('revoking');
    f.c.cancel('foreman', task.id, 1);
    const beforeBudget = f.c.budget.snapshot();
    const restarted = await f.restart();
    const afterBudget = restarted.c.budget.snapshot(); expect(afterBudget.spentTurns).toBe(beforeBudget.spentTurns); expect(afterBudget.attempts).toBe(beforeBudget.attempts);
    expect(restarted.runtime.execution.pending().find(entry => entry.batch.commandId === batch.commandId)?.state).toBe('unknown');
    const finalReceipt: Receipt = { commandId: batch.commandId, status: 'cancelled', acceptedTick: 100, endedTick: 101, completed: 0, unexecuted: 1, steps: [] };
    f.control.ledger[batch.commandId] = finalReceipt; f.setOwnershipReceipts([finalReceipt]);
    await restarted.runtime.execution.reconcile();
    expect(restarted.runtime.execution.pending().find(entry => entry.batch.commandId === batch.commandId)?.state).toBe('acknowledged');
    await restarted.runtime.ownership.flush(reservation.id);
    expect(restarted.runtime.ownership.list().find(entry => entry.id === reservation.id)?.state).toBe('released');
    const loaded = captured;
    await restarted.runtime.restoreHeld(checkpointName, 'fixture-mod', loaded, manifest.world);
    const command = restarted.runtime.execution.pending().find(entry => entry.batch.commandId === batch.commandId);
    expect(command?.state).toBe('rolled_back'); expect(restarted.runtime.ownership.list().find(entry => entry.id === reservation.id)?.state).toBe('released');
    await restarted.c.pump();
    expect(placements).toBe(1); expect(restarted.c.tasks().find(entry => entry.id === task.id)?.status).toBe('cancelled');
  });

  it('S3-04 Stop closes admission for new production commitments', async () => {
    const f = await fixture(); const stage = (await f.inspect()).stages[0]!; f.c.stop('operator_stop');
    await expect(f.commit([{ stage: stage.id, task: f.proposal('after-stop', stage.id) }], 'after-stop')).rejects.toThrow();
    expect(f.c.tasks()).toHaveLength(0); expect(f.runtime.journal.list('run', 'productionBindings')).toHaveLength(0);
  });

  it('S3-04 rebuilds durable stage mappings from SQLite after restart without duplicating task admission', async () => {
    const f = await fixture(); const stage = (await f.inspect()).stages[0]!; const assignment = [{ stage: stage.id, task: f.proposal('durable-build', stage.id) }];
    await f.commit(assignment); const restarted = await f.restart();
    expect(restarted.runtime.journal.list('run', 'productionBindings')).toHaveLength(1); expect(restarted.c.tasks().map(t => t.id)).toEqual(['durable-build']);
    restarted.runtime.close();
  });

  it('S3-04 holds a revised unknown PLACE binding through Stop, restart and restore until its receipt is resolved', async () => {
    const f = await fixture(); const stage = (await f.inspect()).stages[0]!;
    const task: TaskInput = { ...f.proposal('revision-unknown-place', stage.id), actor: 'builder-1', reservations: diagnosticAssignment(1).resources.map(resource => resource.resource) };
    await f.commit([{ stage: stage.id, task }]);
    f.c.send('foreman', { id: 'revision-effect-handoff', recipient: 'engineer', task: task.id, revision: 1, intent: 'handoff', content: 'construct', evidence: [] }); await f.c.pump();
    const reservation = f.runtime.ownership.list().find(entry => entry.task === task.id && entry.state === 'active')!;
    const batch: Batch = { commandId: 'revision-unknown-place', epoch: reservation.request.epoch, session: reservation.request.session, task: task.id, revision: 1, actor: reservation.actor, surface: 'nauvis', grants: reservation.resources.map(resource => resource.grant), deadline: 1000, steps: [{ kind: 'place', position: { x: 2, y: 1 }, item: 'wooden-chest', quality: 'normal', direction: 0 }] };
    const checkpointName = 'revision-before-unknown-place', bytes = completedZip(), captured = { ...structuredClone(f.control), checkpoint: checkpointName, armed: false, paused: true, neutral: true, ticksToRun: 0 };
    const save = f.runtime.artifacts.bytes(f.runtime.context(), 'save', bytes, 'application/zip');
    f.runtime.record('artifact/recorded', [{ entity: 'artifacts', id: save.id, value: { ...save } }]);
    const manifest: Checkpoint = { schema: 1, source: 'managed-disarmed', name: checkpointName, save: `${checkpointName}.zip`, sha256: sha256(bytes), size: bytes.length, eventCursor: f.runtime.journal.cursor(), captured, world: { tick: 100, entities: [], actors: {} }, modHash: 'fixture-mod' };
    const manifestArtifact = f.runtime.evidence('checkpoint', manifest, { kind: 'operator' });
    f.runtime.record('checkpoint/published', [{ entity: 'checkpoints', id: checkpointName, value: { manifest: manifestArtifact.id, save: save.id, eventCursor: manifest.eventCursor, source: 'managed-disarmed' } }]);
    f.c.submit('engineer', batch);
    const factsQuery = f.game.request.bind(f.game); let placements = 0;
    f.game.request = async () => { placements++; throw new Error('transport disconnected after send'); };
    await expect(f.runtime.dispatch(batch.commandId)).rejects.toThrow(/disconnected/i);
    f.game.request = factsQuery;
    expect(placements).toBe(1); expect(f.runtime.execution.pending().find(entry => entry.batch.commandId === batch.commandId)?.state).toBe('unknown');
    const revised = await f.foreman.call('production_plan', { request: { ...f.request, headroom: 0.25 }, prior: { id: f.summary.id, revision: 1 } }) as { revision: number };
    expect(revised.revision).toBe(2); expect(f.c.task(task.id).status).toBe('cancelled');
    expect(f.runtime.journal.list<{ active: boolean }>('run', 'productionBindings').every(binding => !binding.active)).toBe(true);
    const replacement = { ...task, id: 'revision-replacement', committedPlan: `${f.summary.id}.2/${stage.id}` };
    await expect(f.foreman.call('production_commit', { requestId: 'conflicting-revision-placement', id: f.summary.id, revision: 2, assignments: [{ stage: stage.id, task: replacement }] })).rejects.toThrow(/unresolved effects/i);
    expect(f.c.tasks()).toHaveLength(1); expect(placements).toBe(1);
    const held = f.runtime.ownership.revoke(reservation.id);
    await expect(f.runtime.ownership.flush(held.id)).rejects.toThrow(/final command receipt/i);
    expect(f.runtime.ownership.list().find(entry => entry.id === reservation.id)?.state).toBe('revoking');
    f.c.stop('operator_stop'); const beforeBudget = f.c.budget.snapshot(); const restarted = await f.restart();
    expect(restarted.c.budget.snapshot().closed).toBe(true);
    expect(restarted.c.budget.snapshot().spentTurns).toBe(beforeBudget.spentTurns);
    expect(restarted.c.budget.snapshot().attempts).toBe(beforeBudget.attempts);
    expect(restarted.runtime.execution.pending().find(entry => entry.batch.commandId === batch.commandId)?.state).toBe('unknown');
    const receipt: Receipt = { commandId: batch.commandId, status: 'completed', acceptedTick: 100, endedTick: 101, completed: 1, unexecuted: 0, steps: [{ index: 1, status: 'completed', startedTick: 100, endedTick: 101, before: [{ name: 'wooden-chest', quality: 'normal', count: 1 }], after: [], delta: [{ name: 'wooden-chest', quality: 'normal', count: -1 }] }] };
    f.control.ledger[batch.commandId] = receipt; f.setOwnershipReceipts([receipt]); await restarted.runtime.execution.reconcile();
    expect(restarted.runtime.execution.pending().find(entry => entry.batch.commandId === batch.commandId)?.state).toBe('acknowledged');
    await restarted.runtime.ownership.flush(reservation.id);
    expect(restarted.runtime.ownership.list().find(entry => entry.id === reservation.id)?.state).toBe('released');
    await restarted.runtime.restoreHeld(checkpointName, 'fixture-mod', captured, manifest.world);
    expect(restarted.runtime.execution.pending().find(entry => entry.batch.commandId === batch.commandId)?.state).toBe('rolled_back');
    expect(restarted.runtime.ownership.list().find(entry => entry.id === reservation.id)?.state).toBe('released');
    await restarted.c.pump();
    expect(placements).toBe(1); expect(restarted.c.tasks().find(entry => entry.id === task.id)?.status).toBe('cancelled');
    expect(restarted.c.budget.snapshot().spentTurns).toBe(beforeBudget.spentTurns); expect(restarted.c.budget.snapshot().attempts).toBe(beforeBudget.attempts);
    expect(restarted.runtime.journal.get('run', 'productionPlans', `${f.summary.id}.2`)).toBeDefined();
    expect(restarted.runtime.journal.events().filter(event => event.type === 'command/intent')).toHaveLength(1);
  });

  it('S3-03 admits downstream reservations and placement before its upstream supplier operates', async () => {
    const f = await fixture(); const stages = (await f.inspect()).stages;
    const upstream = stages.find(stage => stage.outputs.includes('item:plate'))!;
    const downstream = stages.find(stage => stage.outputs.includes('item:gear'))!;
    const down = { ...f.proposal('downstream-before-supplier', downstream.id), actor: 'builder-1', reservations: diagnosticAssignment(1).resources.map(entry => entry.resource) };
    await f.commit([{ stage: upstream.id, task: f.proposal('supplier-not-started', upstream.id) }, { stage: downstream.id, task: down }]);
    f.c.send('foreman', { id: 'downstream-before-supplier-handoff', recipient: 'engineer', task: down.id, revision: 1, intent: 'handoff', content: 'build downstream', evidence: [] }); await f.c.pump();
    expect(f.c.task(down.id).status).toBe('assigned'); expect(f.c.task('supplier-not-started').owner).toBeNull();
    const reservation = f.runtime.ownership.list().find(entry => entry.task === down.id)!;
    expect(reservation.state).toBe('active'); expect(reservation.resources).toHaveLength(3);
    const batch: Batch = { commandId: 'downstream-before-supplier-place', epoch: reservation.request.epoch, session: reservation.request.session, task: down.id, revision: 1, actor: reservation.actor, surface: 'nauvis', grants: reservation.resources.map(entry => entry.grant), deadline: 1000, steps: [{ kind: 'place', position: { x: 1, y: 1 }, item: 'wooden-chest', quality: 'normal', direction: 0 }] };
    let placements = 0; const query = f.game.request.bind(f.game);
    const receipt: Receipt = { commandId: batch.commandId, status: 'completed', acceptedTick: 100, endedTick: 101, completed: 1, unexecuted: 0, steps: [{ index: 1, status: 'completed', startedTick: 100, endedTick: 101, before: [], after: [], delta: [] }] };
    f.game.request = async request => { if (typeof request === 'object' && request !== null && 'op' in request && request.op === 'submit') { placements++; return { ok: true, receipt } as never; } return query(request); };
    f.c.submit('engineer', batch); await f.c.pump();
    expect(placements).toBe(1); expect(f.runtime.execution.pending()[0]?.receipt?.status).toBe('completed');
    expect(f.c.task('supplier-not-started').status).not.toBe('succeeded');
    const progress = (await f.inspect()).commitments!.find(binding => binding.stage === downstream.id)!;
    expect(progress.commissioning).toBe('unknown'); expect(progress.scenarioVerdict).toBe('not-evaluated');
  });
});
