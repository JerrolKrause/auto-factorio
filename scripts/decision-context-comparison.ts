import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DECISION_FACT_ORACLES } from '@autofactorio/contracts';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { PROBE_CAPS } from '../packages/codex/src/budget.js';
import { taskVisibility } from '../packages/core/context/authorization.js';
import { bytes, paginate } from '../packages/core/context/archive.js';
import type { Entry, Page } from '../packages/core/context/archive.js';
import { OperationalWatches } from '../packages/core/context/operational.js';
import { AgentContext } from '../packages/core/context/service.js';
import { Coordinator } from '../packages/core/orchestration/coordinator.js';
import type { TaskInput } from '../packages/core/orchestration/coordinator.js';
import { team } from '../packages/core/orchestration/roles.js';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';

type CaseName = keyof typeof DECISION_FACT_ORACLES;
type Measurement = { value: unknown; bytes: number; toolCalls: number; engineCalls: number; elapsedMs: number };
const cap = { bytes: 4096, entities: 30 };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const elapsed = async <T>(work: () => Promise<T> | T) => { const start = performance.now(); const value = await work(); return { value, elapsedMs: performance.now() - start }; };
const machine = (i: number) => ({ name: 'assembling-machine-1', quality: 'normal', type: 'assembling-machine', unit: i + 1, position: { x: i % 20, y: Math.floor(i / 20) }, inventories: { input: [{ name: 'iron-gear-wheel', quality: 'normal', count: i ? 2 : 0 }], output: [] }, status: i ? 'working' : 'no_power', recipe: 'automation-science-pack', power: i ? 1000 : 0 });
const belt = (i: number) => ({ name: 'transport-belt', quality: 'normal', type: 'transport-belt', unit: i + 1, position: { x: i % 20, y: Math.floor(i / 20) }, inventories: {}, status: 'working', recipe: null, power: null });
const entities = Array.from({ length: 300 }, (_, i) => i % 10 === 0 ? machine(i) : belt(i));
const area = { kind: 'area' as const, surface: 'nauvis', bounds: [{ x: 0, y: 0 }, { x: 20, y: 20 }] as [{ x: number; y: number }, { x: number; y: number }] };
const readings = (tick: number) => [
  { kind: 'production', name: 'automation-science-pack', quality: 'normal', surface: 'nauvis', total: tick / 20, method: 'fixture-counter-v1', coverage: 'complete', evidence: ['fixture'] },
  { kind: 'configured-supply', name: 'iron-gear-wheel', quality: 'normal', surface: 'nauvis', total: tick / 10, method: 'fixture-boundary-v1', coverage: 'complete', evidence: ['fixture'] },
  { kind: 'stock', name: 'automation-science-pack', quality: 'normal', surface: 'nauvis', total: 50 - tick / 20, stock: 50 - tick / 20, method: 'fixture-stock-v1', coverage: 'complete', evidence: ['fixture'] },
];
const samples = [0, 600].map(tick => ({ schema: 1 as const, epoch: 'epoch', scopeId: 'work.area.0', scopeRevision: 1, membershipHash: 'stable-membership', tick, readings: readings(tick) }));

function task(): TaskInput {
  return {
    id: 'work', goal: 'Restore automation science production', parent: null, dependencies: [], scope: { surface: 'nauvis' }, resources: {}, successCriteria: ['verified receipt'], deadline: null,
    committedPlan: 'Repair the input path, then verify the partial command before retrying.', actor: null, reservations: [],
    criteria: [{ kind: 'command-completed', id: 'partial-61' }], productionTarget: { name: 'automation-science-pack', quality: 'normal', surface: 'nauvis', rate: 0.5, unit: 'items-per-game-second', recipe: 'automation-science-pack' },
  };
}

function factMap(name: CaseName, value: unknown): Record<string, boolean> {
  const root = value as Record<string, unknown>; const list = (root.metrics ?? []) as Record<string, unknown>[];
  const briefing = ((root.briefing as Page | undefined)?.items ?? []).map(entry => entry.value as Record<string, unknown>);
  const machines = (root.entities ?? []) as Record<string, unknown>[]; const first = machines[0] ?? {};
  if (name === 'supply-deficit') return {
    'target-demand': list.some(metric => metric.kind === 'target-demand'), 'measured-supply': list.some(metric => metric.kind === 'production' || metric.kind === 'configured-supply'),
    'stock-trend': list.some(metric => metric.kind === 'stock'), coverage: list.length > 0 && list.every(metric => typeof metric.coverage === 'string'),
    'scope-identity': typeof (root.scope as Record<string, unknown> | undefined)?.id === 'string',
  };
  if (name === 'idle-machine') return { 'machine-status': 'status' in first, recipe: 'recipe' in first, inputs: 'inventories' in first, outputs: 'inventories' in first, power: 'power' in first, tick: Number.isSafeInteger(root.tick) };
  if (name === 'partial-command') return { 'command-id': typeof root.commandId === 'string', 'task-revision': Number.isSafeInteger(root.revision), certainty: typeof root.certainty === 'string', 'completed-count': Number.isSafeInteger(root.completed), 'remaining-count': Number.isSafeInteger(root.remaining), failure: root.reason !== undefined, 'detail-reference': root.detail !== undefined };
  const taskView = briefing.find(item => item.id === 'work'); const pending = briefing.find(item => item.kind === 'command-outcome');
  return {
    objective: briefing.some(item => typeof item.objective === 'string'), ownership: Array.isArray(taskView?.reservations) && typeof taskView?.owner === 'string',
    'committed-plan': typeof taskView?.committedPlan === 'string', 'pending-or-unknown-effects': pending?.certainty === 'unknown', steering: briefing.some(item => typeof item.text === 'string'),
    conditions: briefing.some(item => item.kind === 'operational-conditions'), 'fresh-world': Number.isSafeInteger((root.world as Record<string, unknown> | undefined)?.tick), budget: typeof root.budget === 'object' && root.budget !== null,
  };
}
function oracle(name: CaseName, value: unknown) {
  const facts = factMap(name, value); const missing = DECISION_FACT_ORACLES[name].filter(fact => !facts[fact]);
  return { required: DECISION_FACT_ORACLES[name], observed: Object.keys(facts).filter(key => facts[key]), missing, passed: missing.length === 0 };
}

const directory = await mkdtemp(path.join(os.tmpdir(), 'af-decision-context-'));
const engineLog: string[] = []; const port = { command: async () => '{}', close() {} };
const game = new GameClient(port, () => {}); const lifecycle = new Lifecycle(port, game, () => {}); const runtime = new DurableRuntime(directory, 'run', 'epoch', game, lifecycle);
try {
  game.request = async request => {
    const input = request as Record<string, unknown>; engineLog.push(String(input.op));
    if (input.op === 'observe') {
      const start = Number(input.offset); const limit = Number(input.limit); const page = entities.slice(start, start + limit);
      return { tick: 600, entities: page, total: entities.length, nextOffset: start + page.length < entities.length ? start + page.length : undefined, actors: { 'builder-1': { position: { x: 1, y: 1 }, surface: 'nauvis', inventory: Array.from({ length: 8 }, (_, i) => ({ name: `item-${i}`, quality: 'normal', count: 100 })), connected: true } } };
    }
    if (input.op === 'operational-register') return { ok: true, tick: 600 };
    if (input.op === 'operational-read') return { tick: 600, samples };
    if (input.op === 'recipe') return { tick: 600, mods: { base: '2.0.77' }, recipe: { name: 'automation-science-pack', enabled: true, energy: 5, category: 'crafting', ingredients: [{ type: 'item', name: 'iron-gear-wheel', amount: 1 }, { type: 'item', name: 'copper-plate', amount: 1 }], products: [{ type: 'item', name: 'automation-science-pack', amount: 1 }] } };
    throw new Error(`Unexpected fixture operation ${String(input.op)}`);
  };
  const coordinator = new Coordinator(runtime, { ...PROBE_CAPS, tools: 1000, turns: 30, runMs: 300_000, turnMs: 300_000 });
  team().forEach(agent => coordinator.register({ ...agent, definition: { ...agent.definition, limits: { tools: 1000 } } })); coordinator.propose('foreman', task()); const assigned = coordinator.task('work');
  runtime.record('fixture/assigned', [{ entity: 'tasks', id: assigned.id, value: { ...assigned, owner: 'engineer', status: 'assigned', actor: 'builder-1', reservations: [area] }, visibility: taskVisibility(assigned.id) }]);
  const steps = Array.from({ length: 61 }, (_, i) => ({ index: i + 1, status: i < 37 ? 'completed' : i === 37 ? 'failed' : 'cancelled', ...(i === 37 ? { reason: 'entity_precondition_failed' } : {}), startedTick: i, endedTick: i + 1, before: [], after: [], delta: [] }));
  runtime.record('fixture/partial', [{ entity: 'commands', id: 'partial-61', value: { state: 'acknowledged', batch: { commandId: 'partial-61', task: 'work', revision: 1, steps: Array(61).fill({ kind: 'walk' }) }, receipt: { status: 'partial', completed: 37, unexecuted: 24, steps } }, visibility: taskVisibility('work') }]);
  runtime.record('fixture/pending', [{ entity: 'commands', id: 'unknown-effect', value: { state: 'unknown', batch: { commandId: 'unknown-effect', task: 'work', revision: 1 }, reason: 'verify before retry' }, visibility: taskVisibility('work') }]);
  runtime.record('fixture/steering', [{ entity: 'interventions', id: 'steering', value: { text: 'Preserve the expansion lane.', recipient: 'engineer', delivery: 'pending' } }], { kind: 'restricted', agents: ['engineer'], roles: [], tasks: [] });
  const turn = coordinator.budget.admit('engineer'); const binding = coordinator.bind('engineer', `session-${turn.id}`, turn.id, async () => {}); const context = new AgentContext(coordinator, binding, cap);

  let toolCalls = 0;
  const worldAll = async (machineOnly = false) => { const collected: unknown[] = []; let next: number | null = 0; let cursor: string | undefined; let first: Record<string, unknown> | undefined; while (next !== null) { toolCalls++; const page = await (machineOnly ? context.machines('work', 0, next, undefined, undefined, cursor) : context.world('work', 0, next, {}, cursor)) as Record<string, unknown>; first ??= page; collected.push(...page.entities as unknown[]); next = page.next as number | null; cursor = page.snapshot as string; } return { ...first, entities: collected, next: null, truncated: false }; };
  const briefAll = () => { const collected: Entry[] = []; let next: number | null = 0; while (next !== null) { toolCalls++; const page = context.briefing(next) as Page; collected.push(...page.items); next = page.next; } return { items: collected }; };
  const payload = (ref: { entity: 'commands'; id: string }) => { let text = ''; let next: number | null = 0; while (next !== null) { toolCalls++; const page = context.download(ref, next) as { available: boolean; text?: string; next?: number | null }; assert(page.available && page.text !== undefined); text += page.text; next = page.next ?? null; } return JSON.parse(text); };
  const measure = async (work: () => Promise<unknown> | unknown): Promise<Measurement> => { const startTools = toolCalls; const startEngine = engineLog.length; const result = await elapsed(work); return { value: result.value, bytes: bytes(result.value), toolCalls: toolCalls - startTools, engineCalls: engineLog.length - startEngine, elapsedMs: result.elapsedMs }; };

  const supplyBaseline = await measure(() => worldAll()); const supplyCandidate = await measure(async () => { toolCalls++; return context.metrics('work', 0, 600); });
  const watches = new OperationalWatches(runtime); watches.evaluate('target.work.area.0', 0, 0, taskVisibility('work')); watches.evaluate('target.work.area.0', 300, 0, taskVisibility('work'));
  const idleBaseline = await measure(() => worldAll()); const idleCandidate = await measure(async () => { toolCalls++; return context.machines('work', 0, 0); });
  const commandBaseline = await measure(() => payload({ entity: 'commands', id: 'partial-61' })); const commandCandidate = await measure(() => { toolCalls++; return context.command('partial-61'); });
  const replacementBaseline = await measure(async () => ({ briefing: briefAll(), world: await worldAll() })); const replacementCandidate = await measure(async () => { toolCalls++; return context.replacement('work', 0, 0); });
  const candidates: Record<CaseName, { baseline: Measurement; candidate: Measurement }> = { 'supply-deficit': { baseline: supplyBaseline, candidate: supplyCandidate }, 'idle-machine': { baseline: idleBaseline, candidate: idleCandidate }, 'partial-command': { baseline: commandBaseline, candidate: commandCandidate }, replacement: { baseline: replacementBaseline, candidate: replacementCandidate } };
  const cases = Object.entries(candidates).map(([key, pair]) => { const name = key as CaseName; const candidateOracle = oracle(name, pair.candidate.value); assert(candidateOracle.passed, `${name}: ${candidateOracle.missing.join(',')}`); return { name, oracle: candidateOracle, baseline: { ...pair.baseline, value: undefined, omissions: oracle(name, pair.baseline.value).missing }, candidate: { ...pair.candidate, value: undefined, omissions: candidateOracle.missing } }; });
  assert(supplyCandidate.bytes <= cap.bytes); assert(idleCandidate.bytes <= cap.bytes); assert(commandCandidate.bytes <= cap.bytes); assert(replacementCandidate.bytes <= cap.bytes);
  const scoped = supplyCandidate.value; const scaling = [30, 300, 3_000].map(count => { const entries = Array.from({ length: count }, (_, i): Entry => ({ ref: { entity: 'observations', id: `scale.${i}` }, value: i % 10 === 0 ? machine(i) : belt(i) })); let next: number | null = 0; let calls = 0; let totalBytes = 0; while (next !== null) { const page = paginate(entries, next, cap); calls++; totalBytes += bytes(page); next = page.next; } return { entities: count, productionPath: 'packages/core/context/archive.paginate', baselineBytes: totalBytes, baselineToolCalls: calls, candidateBytes: bytes(scoped), candidateHash: hash(scoped), essentialFacts: oracle('supply-deficit', scoped).passed }; });
  assert.equal(new Set(scaling.map(item => item.candidateHash)).size, 1, 'unrelated world growth changed scoped operational content');
  const report = { schema: 2, kind: 'decision-context-production-path-comparison', modelInference: false, fixture: { productionPaths: ['AgentContext.world', 'AgentContext.machines', 'AgentContext.metrics', 'AgentContext.command', 'AgentContext.briefing', 'AgentContext.replacement', 'ContextArchive.download', 'paginate'], entities: entities.length }, units: { bytes: 'UTF-8 JSON bytes from actual returned values', calls: 'actual context method invocations and engine requests', timing: 'local wall milliseconds', tokens: 'not measured' }, cases, scaling, limits: { metricUnder4096: true, commandUnder4096: true, briefingUnder4096: true }, claims: { informationSufficiency: true, deterministicSizeAndCalls: true, tokenSavings: 'unknown', reasoningQuality: 'unverified', gameplayImprovement: 'unverified' } };
  const flag = process.argv.indexOf('--output'); const output = path.resolve(flag >= 0 ? process.argv[flag + 1]! : '.runtime/decision-context-comparison/report.json'); await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ output, ...report }));
} finally { runtime.close(); await rm(directory, { recursive: true, force: true }); }
