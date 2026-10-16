import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProductionSearchResult } from '@autofactorio/contracts';
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

// This diagnostic always creates its own disposable project world. No save/profile argument
// can redirect it into an operator's held experiment or a personal save.
if (process.argv.length > 2) throw new Error('Production facts probe accepts no save/profile arguments');
await listProjectProcesses();
const profile = await createProfile(false, true);
const evidence = await mkdtemp(path.join(profile.dir, 'production-facts-'));
let failure: string | null = null, cleanup = false;
let runtime: DurableRuntime | undefined;
let port: Awaited<ReturnType<typeof waitForServer>> | undefined;
const checks: string[] = [];
console.log(JSON.stringify({ evidence, profile: profile.config }));
try {
  await startServer(profile); port = await waitForServer(profile);
  await port.command('/silent-command rcon.print("production facts authorization")');
  await port.command('/silent-command rcon.print("production facts ready")');
  const game = new GameClient(port, () => {}), life = new Lifecycle(port, game, () => {});
  runtime = new DurableRuntime(path.join(evidence, 'runtime'), path.basename(evidence), 'initial', game, life, [profile.password]);
  const c = new Coordinator(runtime, { ...PROBE_CAPS, tools: 100, turns: 10, turnMs: 600000, runMs: 600000 });
  team().forEach(a => c.register(a));
  const gateway = new CoordinationGateway(c), mcp = new CoordinationMcp(c, gateway);
  const turn = c.budget.admit('foreman'), binding = c.bind('foreman', 'facts-probe', turn.id, async () => {});
  const token = mcp.issue('foreman'); mcp.bind(token, binding);
  const search = async (query: string) => await mcp.call(token, 'production_search', { query }) as ProductionSearchResult;
  const locked = await search('blue circuits');
  await writeFile(path.join(evidence, 'locked.json'), JSON.stringify(locked, null, 2));
  assert.equal(locked.items[0]?.product.name, 'processing-unit');
  assert(locked.items[0]!.producers.some(p => p.blockers.some(b => b.startsWith('research_locked:'))));
  checks.push('Authenticated production MCP discovery resolves blue circuits and exposes research blockers');
  // Fixture research is explicit setup in this dedicated world, outside gameplay authority.
  await port.command('/silent-command for _,t in pairs(game.forces.player.technologies) do t.researched=true end rcon.print("research-ready")');
  const unlocked = await search('blue circuits'), yellow = await search('yellow science'), petroleum = await search('petroleum gas');
  const sulfur = await mcp.call(token, 'production_search', { query: 'sulfur', product: 'item:sulfur', recipe: 'recipe:sulfur' }) as ProductionSearchResult;
  assert.notEqual(locked.availability.revision, unlocked.availability.revision);
  assert.equal(locked.facts.fingerprint, unlocked.facts.fingerprint);
  assert.equal(yellow.items[0]?.product.name, 'utility-science-pack');
  assert.equal(petroleum.items[0]?.product.kind, 'fluid');
  const basic = petroleum.items.flatMap(i => i.producers).find(p => p.recipe.name === 'basic-oil-processing');
  assert(basic); assert.notEqual(basic.recipe.id, `fluid:${petroleum.items[0]!.product.name}`);
  const refinery = basic.machines.find(m => m.fact.name === 'oil-refinery');
  assert(refinery); assert(refinery.fact.fluidBoxes.some(b => b.connections.some(connection => connection.positions.length === 4)));
  assert(refinery.fact.collisionBox.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  const chemical = sulfur.items.flatMap(i => i.producers).find(p => p.recipe.name === 'sulfur');
  assert(chemical); assert(chemical.machines.some(m => m.fact.name === 'chemical-plant'));
  assert(chemical.recipe.category.includes('chemistry'));
  checks.push('Effective installed Space Age recipes, product/recipe distinction, compatible refinery/chemical geometry and fluid ports delivered through MCP');
  const restricted = await mcp.call(token, 'production_search', { query: 'petroleum gas', profile: { id: 'restricted', revision: 1, fingerprint: 'probe', recipes: ['basic-oil-processing'], equipment: ['chemical-plant'] } }) as ProductionSearchResult;
  assert(restricted.items.flatMap(i => i.producers).find(p => p.recipe.name === 'basic-oil-processing')!.machines.find(m => m.fact.name === 'oil-refinery')!.blockers.includes('profile_machine_denied'));
  checks.push('Profile exclusion remains an explicit blocker without widening equipment');
  const rawRecipes: Record<string, unknown>[] = [];
  const snapshot = await new ProductionFacts().snapshot({ key: 'probe-public-facts', authorize() {}, query: async request => {
    const response = await game.request(request);
    if (request.section === 'recipes' && Array.isArray(response.items)) rawRecipes.push(...response.items as Record<string, unknown>[]);
    return response;
  } });
  assert.equal(snapshot.catalog.fingerprint, unlocked.facts.fingerprint);
  const metadataCounts = { extra_count_fraction: 0, percent_spoiled: 0, fluidbox_multiplier: 0 };
  for (const raw of rawRecipes) {
    const normalized = snapshot.catalog.recipes.find(r => r.id === raw.id)!;
    for (const section of ['ingredients', 'products'] as const) {
      const flows = Array.isArray(raw[section]) ? raw[section] as Record<string, unknown>[] : [];
      flows.forEach((f, i) => {
        for (const field of ['extra_count_fraction', 'percent_spoiled', 'fluidbox_multiplier'] as const) {
          if (f[field] !== undefined) { metadataCounts[field]++; assert.equal(normalized[section][i]![field], f[field]); }
        }
      });
    }
  }
  assert(Object.values(metadataCounts).every(count => count > 0));
  checks.push('All installed fractional-output, spoilage and fluid-multiplier metadata survives normalized fact delivery');
  await writeFile(path.join(evidence, 'metadata.json'), JSON.stringify(metadataCounts, null, 2));
  await writeFile(path.join(evidence, 'catalog.json'), JSON.stringify(snapshot, null, 2));
  const pending = mcp.call(token, 'production_search', { query: 'yellow science' }); mcp.revoke(token);
  await assert.rejects(pending, /Unauthenticated/);
  checks.push('Revocation during installed-data retrieval prevents result delivery');
  await writeFile(path.join(evidence, 'facts.json'), JSON.stringify({ locked, unlocked, yellow, petroleum, sulfur, restricted }, null, 2));
} catch (error) { failure = String(error); process.exitCode = 1; console.error(failure.slice(0, 1500)); }
finally {
  runtime?.close(); port?.close();
  try { await stopProfile(profile.config); cleanup = !(await listProjectProcesses()).some(p => p.config === profile.config); }
  catch (error) { failure ??= String(error); process.exitCode = 1; }
  if (!cleanup) { failure ??= 'Owned profile cleanup unresolved'; process.exitCode = 1; }
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed: failure === null, checks, failure, cleanup, modelInference: false }, null, 2));
  console.log(JSON.stringify({ evidence, checks: checks.length, failure, cleanup }));
}
