import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Exact, ProductionPlan, ProductionPlanPage, ProductionPlanSummary, ProductionProduct, ProductionRequest, ProductionSearchResult } from '@autofactorio/contracts';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { Coordinator } from '../packages/core/orchestration/coordinator.js';
import { team } from '../packages/core/orchestration/roles.js';
import { CoordinationGateway } from '../packages/tools/src/coordination.js';
import { CoordinationMcp } from '../packages/tools/src/coordination-mcp.js';
import { PROBE_CAPS } from '../packages/codex/src/budget.js';
import { ProductionFacts } from '../packages/core/production/facts.js';
import { createProfile, listProjectProcesses, startServer, stopProfile, waitForServer } from './dev/game-processes.js';

// This calculation probe never accepts a profile/save argument or submits gameplay work.
if (process.argv.length > 2) throw new Error('Production planning probe accepts no save/profile arguments');
await listProjectProcesses();
const profile = await createProfile(false, true), evidence = await mkdtemp(path.join(profile.dir, 'production-planning-'));
let failure: string | null = null, cleanup = false;
let runtime: DurableRuntime | undefined, port: Awaited<ReturnType<typeof waitForServer>> | undefined;
const checks: string[] = [];
// Deliberately independent arithmetic oracle: cross-multiplied fraction pairs, no planner Q/solver imports.
type Pair = [bigint, bigint];
const exact = (v: Exact): Pair => [BigInt(v.numerator), BigInt(v.denominator)];
const plus = (a: Pair, b: Pair): Pair => [a[0] * b[1] + b[0] * a[1], a[1] * b[1]];
const times = (a: Pair, b: Pair): Pair => [a[0] * b[0], a[1] * b[1]];
const negate = (a: Pair): Pair => [-a[0], a[1]];
const equal = (a: Pair, b: Pair) => a[0] * b[1] === b[0] * a[1];
const decimal = (n: number): Pair => { const s = String(n); assert(!s.includes('e')); const decimals = s.split('.')[1]?.length ?? 0; return [BigInt(s.replace('.', '')), 10n ** BigInt(decimals)]; };
const zero: Pair = [0n, 1n];
const product = (name: string): ProductionProduct => ({ kind: ['water', 'crude-oil', 'heavy-oil', 'light-oil', 'petroleum-gas'].includes(name) ? 'fluid' : 'item', name, quality: 'normal', surface: 'nauvis' });
try {
  await startServer(profile); port = await waitForServer(profile);
  await port.command('/autofactorio {"op":"identity"}');
  await port.command('/autofactorio {"op":"authorize","epoch":"initial","session":"probe"}');
  const game = new GameClient(port, () => {}), life = new Lifecycle(port, game, () => {});
  runtime = new DurableRuntime(path.join(evidence, 'runtime'), path.basename(evidence), 'initial', game, life, [profile.password]);
  const c = new Coordinator(runtime, { ...PROBE_CAPS, tools: 150, turns: 10, turnMs: 600000, runMs: 600000 });
  // This zero-inference scripted matrix has more delivery checks than an ordinary
  // gameplay turn. Its explicit 100-tool role allowance stays below the 150-run cap.
  team().forEach(a => c.register({ ...a, definition: { ...a.definition, limits: { ...a.definition.limits, tools: 100 } } }));
  const mcp = new CoordinationMcp(c, new CoordinationGateway(c));
  const turn = c.budget.admit('foreman'), binding = c.bind('foreman', 'planning-probe', turn.id, async () => {});
  const token = mcp.issue('foreman'); mcp.bind(token, binding);
  // The engine requires a first-console achievement acknowledgement. Use a harmless
  // readiness print twice, then check the actual fixture command's acknowledgement.
  await port.command('/silent-command rcon.print("planning-console-ready")');
  assert.match(await port.command('/silent-command rcon.print("planning-console-ready")'), /planning-console-ready/);
  // Explicit dedicated fixture setup, never gameplay authority. Runtime API 2.0.77
  // exposes writable recipe productivity; record ordinary zero-bonus installed facts.
  assert.match(await port.command('/silent-command for _,t in pairs(game.forces.player.technologies) do t.researched=true end for _,r in pairs(game.forces.player.recipes) do r.productivity_bonus=0 end rcon.print("ordinary-research-ready")'), /ordinary-research-ready/);
  const snapshot = await new ProductionFacts().snapshot({ key: 'public-probe', authorize() {}, query: r => game.request(r) });
  await writeFile(path.join(evidence, 'catalog.json'), JSON.stringify(snapshot, null, 2));
  const sourceNames = ['iron-ore', 'copper-ore', 'coal', 'crude-oil', 'water'];
  const boundary = { externalInputs: sourceNames.map(name => ({ product: product(name), capacity: { kind: 'unlimited' as const } })), initialStock: [], utilities: { electricityWatts: 1_000_000_000 }, constructionEquipment: { 'assembling-machine-2': 1000, 'stone-furnace': 1000, 'chemical-plant': 1000, 'oil-refinery': 1000 }, sinks: ['heavy-oil', 'light-oil', 'petroleum-gas'].map(name => ({ product: product(name), capacity: { kind: 'unlimited' as const } })), machines: {}, fuels: Object.fromEntries(['iron-plate', 'copper-plate', 'steel-plate'].map(name => [`recipe:${name}`, product('coal')])) };
  const requests: ProductionRequest[] = [];
  const tasksBefore = runtime.journal.list(runtime.run, 'tasks').length, commandsBefore = runtime.journal.list(runtime.run, 'commands').length;
  for (const name of ['sulfur', 'processing-unit', 'utility-science-pack']) {
    const discovery = await mcp.call(token, 'production_search', { query: name, product: `item:${name}` }) as ProductionSearchResult;
    const request: ProductionRequest = { schema: 1, target: product(name), mode: 'rate', rate: { numerator: '1', denominator: '1', unit: 'items-per-game-second' }, profile: { id: 'raw-chain', revision: 1, fingerprint: 'installed-ordinary', recipes: null, equipment: Object.keys(boundary.constructionEquipment) }, facts: discovery.facts, ...boundary, routes: name === 'utility-science-pack' ? { 'fluid:petroleum-gas': 'recipe:light-oil-cracking', 'fluid:light-oil': 'recipe:heavy-oil-cracking', 'fluid:heavy-oil': 'recipe:advanced-oil-processing' } : { 'fluid:petroleum-gas': 'recipe:basic-oil-processing' } };
    if (name === 'utility-science-pack') request.sinks = [{ product: product('petroleum-gas'), capacity: { kind: 'unlimited' } }];
    requests.push(request);
    const summary = await mcp.call(token, 'production_plan', { request }) as ProductionPlanSummary;
    await writeFile(path.join(evidence, `${name}-summary.json`), JSON.stringify(summary, null, 2));
    assert.equal(summary.status, 'feasible', JSON.stringify(summary.blockers)); assert(summary.executable);
    const stored: ProductionPlan = runtime.journal.get<{ plan: ProductionPlan }>(runtime.run, 'productionPlans', `${summary.id}.${summary.revision}`)!.plan;
    assert.equal(stored.stages.length, new Set(stored.stages.map(s => s.recipe)).size);
    const received: string[] = []; let cursor: string | undefined;
    do {
      const page = await mcp.call(token, 'production_inspect', { id: summary.id, revision: summary.revision, ...(cursor ? { cursor } : {}) }) as ProductionPlanPage;
      assert(!page.stale); assert.notEqual(page.status, 'expired'); received.push(...page.stages.map(s => s.id)); cursor = page.next ?? undefined;
    } while (cursor);
    assert.deepEqual(received, stored.stages.map(s => s.id));
    for (const balance of stored.balances) {
      let produced = zero, consumed = zero;
      for (const stage of stored.stages) {
        const recipe = snapshot.catalog.recipes.find(r => r.id === stage.recipe)!;
        for (const f of recipe.products) if (`${f.type}:${f.name}` === balance.product) produced = plus(produced, times(decimal(f.amount!), exact(stage.crafts!)));
        for (const f of recipe.ingredients) if (`${f.type}:${f.name}` === balance.product) consumed = plus(consumed, times(decimal(f.amount!), exact(stage.crafts!)));
        if (stage.fuel?.product === balance.product) consumed = plus(consumed, exact(stage.fuel.operating));
        const machine = snapshot.catalog.machines.find(m => m.id === stage.machine)!;
        const load = times(exact(stage.crafts!), times(decimal(recipe.seconds), [decimal(machine.speed)[1], decimal(machine.speed)[0]]));
        assert.equal(stage.machines, Number((load[0] + load[1] - 1n) / load[1]));
      }
      assert(equal(produced, exact(balance.produced))); assert(equal(consumed, exact(balance.consumed)));
      const residual = plus(plus(produced, exact(balance.external)), negate(plus(plus(consumed, exact(balance.delivered)), exact(balance.disposed))));
      assert.equal(residual[0], 0n, balance.product);
      if (!equal(exact(balance.external), zero)) assert(sourceNames.includes(balance.product.split(':')[1]!));
      if (balance.product === `item:${name}`) assert(equal(exact(balance.delivered), [1n, 1n]));
    }
    for (const stage of stored.stages) for (const input of stage.inputs) assert(stored.stages.some(s => s.outputs.includes(input)) || request.externalInputs.some(e => `${e.product.kind}:${e.product.name}` === input), input);
    if (name === 'utility-science-pack') for (const r of ['advanced-oil-processing', 'heavy-oil-cracking', 'light-oil-cracking']) assert(stored.stages.some(s => s.recipe === `recipe:${r}` && exact(s.crafts!)[0] > 0n));
    await writeFile(path.join(evidence, `${name}-plan.json`), JSON.stringify(stored, null, 2));
    checks.push(`Actual MCP ${name} at 1/game second: raw closure, shared stages, independent exact residuals, machine rounding and bounded retrieval`);
  }
  const missingRaw = await mcp.call(token, 'production_plan', { request: { ...requests[0]!, externalInputs: [] } }) as ProductionPlanSummary;
  assert.equal(missingRaw.status, 'incomplete'); assert(!missingRaw.executable);
  for (const id of ['fluid:crude-oil', 'fluid:water']) assert(missingRaw.blockers.some(b => b.code === 'unsupported_extraction' && b.product === id));
  const missingRawPlan = runtime.journal.get<{ plan: ProductionPlan }>(runtime.run, 'productionPlans', `${missingRaw.id}.${missingRaw.revision}`)!.plan;
  assert(!missingRawPlan.stages.some(s => /barrel|ice-melting/.test(s.recipe)));
  await writeFile(path.join(evidence, 'missing-raw-plan.json'), JSON.stringify(missingRawPlan, null, 2));
  checks.push('Missing raw crude/water supplies report extraction prerequisites without implicit conversion stages');
  const batchRequest: ProductionRequest = { ...requests[0]!, target: product('iron-plate'), mode: 'quantity', quantity: 3, externalInputs: [], initialStock: [{ product: product('iron-ore'), quantity: 10 }], routes: {} };
  delete batchRequest.rate;
  const batch = await mcp.call(token, 'production_plan', { request: batchRequest }) as ProductionPlanSummary;
  assert.equal(batch.status, 'feasible', JSON.stringify(batch.blockers)); assert(!batch.executable);
  const batchPlan = runtime.journal.get<{ plan: ProductionPlan }>(runtime.run, 'productionPlans', `${batch.id}.${batch.revision}`)!.plan;
  assert(equal(exact(batchPlan.stockUsed!['item:iron-ore']!), [3n, 1n]));
  for (const b of batchPlan.balances) { assert(equal(exact(b.external), zero)); assert(equal(exact(b.residual), zero)); }
  const shortStock = await mcp.call(token, 'production_plan', { request: { ...batchRequest, initialStock: [{ product: product('iron-ore'), quantity: 2 }] } }) as ProductionPlanSummary;
  assert.equal(shortStock.status, 'incomplete'); assert(!shortStock.executable);
  assert(shortStock.blockers.some(b => b.code === 'unsupported_extraction' && b.product === 'item:iron-ore'));
  const stockRateRequest: ProductionRequest = { ...batchRequest, mode: 'rate', rate: { numerator: '1', denominator: '1', unit: 'items-per-game-second' } };
  delete stockRateRequest.quantity;
  const stockRate = await mcp.call(token, 'production_plan', { request: stockRateRequest }) as ProductionPlanSummary;
  assert.equal(stockRate.status, 'incomplete'); assert(!stockRate.executable);
  assert(stockRate.blockers.some(b => b.code === 'unsupported_extraction' && b.product === 'item:iron-ore'));
  await writeFile(path.join(evidence, 'stock-only-batch-plan.json'), JSON.stringify(batchPlan, null, 2));
  await writeFile(path.join(evidence, 'short-stock-summary.json'), JSON.stringify(shortStock, null, 2));
  await writeFile(path.join(evidence, 'stock-rate-summary.json'), JSON.stringify(stockRate, null, 2));
  checks.push('Finite stock-only batch accounts exact ore use; insufficient stock and sustained stock-only rate remain incomplete');
  const records = runtime.journal.list<{ plan: ProductionPlan }>(runtime.run, 'productionPlans');
  const first = records.find(r => r.plan.request.target.name === 'sulfur' && r.plan.status === 'feasible')!.plan;
  c.budget.finish(turn.id);
  const replacementTurn = c.budget.admit('foreman'), replacementBinding = c.bind('foreman', 'replacement-planning-probe', replacementTurn.id, async () => {});
  const replacement = new CoordinationMcp(c, new CoordinationGateway(c)), replacementToken = replacement.issue('foreman'); replacement.bind(replacementToken, replacementBinding);
  const restored = await replacement.call(replacementToken, 'production_inspect', { id: first.id, revision: first.revision }) as ProductionPlanPage;
  assert.deepEqual(restored.stages, first.stages.slice(0, 8));
  const revision = await replacement.call(replacementToken, 'production_plan', { request: { ...requests[0]!, headroom: 0.1 }, prior: { id: first.id, revision: first.revision } }) as ProductionPlanSummary;
  assert.equal(revision.id, first.id); assert.equal(revision.revision, 2);
  assert.deepEqual(runtime.journal.get<{ plan: ProductionPlan }>(runtime.run, 'productionPlans', `${first.id}.1`)!.plan, first);
  assert.equal(runtime.journal.list(runtime.run, 'tasks').length, tasksBefore); assert.equal(runtime.journal.list(runtime.run, 'commands').length, commandsBefore);
  checks.push('Replacement gateway restores exact immutable revisions; planning and revisions create no tasks or commands');
  await port.command('/silent-command game.forces.player.recipes.sulfur.enabled=false rcon.print("availability-changed")');
  const stale = await replacement.call(replacementToken, 'production_inspect', { id: first.id, revision: first.revision }) as ProductionPlanPage;
  assert(stale.stale); assert(stale.revalidation.includes('availability_changed')); assert.deepEqual(stale.stages, first.stages);
  const pending = replacement.call(replacementToken, 'production_inspect', { id: first.id, revision: first.revision }); replacement.revoke(replacementToken);
  await assert.rejects(pending, /Unauthenticated/);
  checks.push('Changed availability is explicitly stale without rewriting history; in-flight revocation prevents detail delivery');
} catch (error) { failure = String(error); process.exitCode = 1; console.error(failure.slice(0, 1800)); }
finally {
  runtime?.close(); port?.close();
  try { await stopProfile(profile.config); cleanup = !(await listProjectProcesses()).some(p => p.config === profile.config); }
  catch (error) { failure ??= String(error); process.exitCode = 1; }
  if (!cleanup) { failure ??= 'Owned profile cleanup unresolved'; process.exitCode = 1; }
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed: failure === null, checks, failure, cleanup, modelInference: false }, null, 2));
  console.log(JSON.stringify({ evidence, checks: checks.length, failure, cleanup }));
}
