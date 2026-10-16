import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { diagnosticAssignment } from '@autofactorio/contracts';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { Coordinator } from '../packages/core/orchestration/coordinator.js';
import { team } from '../packages/core/orchestration/roles.js';
import { CoordinationGateway } from '../packages/tools/src/coordination.js';
import { CoordinationMcp } from '../packages/tools/src/coordination-mcp.js';
import { PROBE_CAPS } from '../packages/codex/src/budget.js';
import type { ProductionRequest, ProductionSearchResult, ProductionPlanSummary, ProductionPlanPage, ProductionStatusPage, OperationalSample } from '@autofactorio/contracts';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle, barrier } from '../packages/factorio/src/lifecycle.js';
import { createProfile, listProjectProcesses, startServer, stopProfile, waitForServer } from './dev/game-processes.js';

// Isolated calibration fixtures, never a gameplay build or a physical chain verdict.
// No caller can select a save/profile or alter a held operator experiment.
if (process.argv.length > 2) throw new Error('Observation probe accepts no save/profile arguments');
await listProjectProcesses();
const profile = await createProfile(false, true), evidence = await mkdtemp(path.join(profile.dir, 'production-observations-'));
const checks: string[] = [], calibration: Record<string, unknown>[] = [];
let failure: string | null = null, cleanup = false;
let runtime: DurableRuntime | undefined;
let port: Awaited<ReturnType<typeof waitForServer>> | undefined;
try {
  await startServer(profile); port = await waitForServer(profile);
  const game = new GameClient(port, () => {}), life = new Lifecycle(port, game, () => {});
  await port.command('/silent-command rcon.print("observation-ready")');
  assert.match(await port.command('/silent-command rcon.print("observation-ready")'), /observation-ready/);
  let control = await life.pause(await life.inspect()); barrier(control);
  // Recipe inputs are finite, injected once into disconnected machines. Independent
  // endpoint inventories therefore measure consumption/production without force totals.
  const setup = `local s=game.surfaces.nauvis;s.request_to_generate_chunks({0,0},2);s.force_generate_chunk_requests();for _,e in pairs(s.find_entities_filtered{area={{-16,-16},{40,16}}}) do if e.type~='character' then e.destroy() end end;for _,t in pairs(game.forces.player.technologies) do t.researched=true end;for _,r in pairs(game.forces.player.recipes) do r.productivity_bonus=0 end;storage.af_calibration={};local function make(name,x) local e=s.create_entity{name=name,position={x,0},force='player'};assert(e,name);storage.af_calibration[#storage.af_calibration+1]=e;return e end;local f=make('stone-furnace',0);f.get_inventory(defines.inventory.furnace_source).insert{name='iron-ore',count=50};f.get_inventory(defines.inventory.fuel).insert{name='coal',count=20};local c=make('chemical-plant',12);c.set_recipe('sulfur');local r=make('oil-refinery',24);r.set_recipe('advanced-oil-processing');for _,e in ipairs({c,r}) do for i=1,#e.fluidbox do local filter=e.fluidbox.get_filter(i);if filter and (filter.name=='water' or filter.name=='petroleum-gas' or filter.name=='crude-oil') then local p=e.fluidbox.get_prototype(i);if p.production_type=='input' then e.fluidbox[i]={name=filter.name,amount=500,temperature=25} end end end end;local tank=make('storage-tank',36);tank.fluidbox[1]={name='water',amount=1234.567,temperature=25};local power=s.create_entity{name='electric-energy-interface',position={18,5},force='player'};power.electric_buffer_size=100000000;power.power_production=10000000;power.energy=100000000;s.create_entity{name='substation',position={18,2},force='player'};rcon.print('calibration-fixtures-ready')`;
  assert.match(await port.command(`/silent-command ${setup}`), /calibration-fixtures-ready/);
  const scopes = ['furnace', 'chemical', 'refinery', 'tank'].map((id, index) => ({ schema: 1 as const, id, revision: 1, task: 'calibration', surface: 'nauvis', area: [{ x: index * 12 - 3, y: -3 }, { x: index * 12 + 3, y: 3 }] as [{ x: number; y: number }, { x: number; y: number }], entityLimit: 20 }));
  for (const scope of scopes) await game.request({ op: 'operational-register', scope, sampleTicks: 60, historySamples: 120 });
  const samples = async (id: string) => {
    const result = await game.request({ op: 'operational-read', scopeId: id, scopeRevision: 1, afterTick: -1 });
    assert(!result.error, String(result.error)); assert(Array.isArray(result.samples));
    return result.samples as OperationalSample[];
  };
  const raw = async () => JSON.parse(await port!.command(`/silent-command local out={tick=game.tick,machines={}};for _,e in ipairs(storage.af_calibration) do local row={name=e.name,fluids=e.get_fluid_contents(),items={}};if e.type=='furnace' or e.type=='assembling-machine' then row.finished=e.products_finished;local r=e.get_recipe();row.recipe=r and r.name;local inv=e.get_inventory(e.type=='furnace' and defines.inventory.furnace_result or defines.inventory.assembling_machine_output);row.items=inv.get_contents();local input=e.get_inventory(e.type=='furnace' and defines.inventory.furnace_source or defines.inventory.assembling_machine_input);row.inputs=input.get_contents() end;out.machines[#out.machines+1]=row end;rcon.print(helpers.table_to_json(out))`)) as { tick: number; machines: { name: string; finished?: number; fluids: Record<string, number>; items: { name: string; count: number }[]; inputs?: { name: string; count: number }[] }[] };
  const before = await raw();
  control = await life.reconcile(control); control = await life.arm(control);
  await port.command('/silent-command game.speed=4;rcon.print("calibration-speed")');
  const startTick = (await life.inspect()).tick;
  const endTime = Date.now() + 60_000;
  while ((await life.inspect()).tick - startTick < 1200) { assert(Date.now() < endTime, 'Calibration game-time timeout'); await life.heartbeat(control); await delay(200); }
  control = await life.pause(await life.inspect()); barrier(control);
  const after = await raw(), all: OperationalSample[][] = [];
  // One RCON socket permits one request at a time.
  for (const scope of scopes) all.push(await samples(scope.id));
  await writeFile(path.join(evidence, 'endpoints.json'), JSON.stringify({ before, after, all }, null, 2));
  for (let index = 0; index < 3; index++) {
    const list = all[index]!, a = list[0]!, b = list.at(-1)!;
    assert(b.tick > a.tick); assert(b.readings.some(r => r.kind === 'production' && r.coverage === 'complete' && Number(r.total) > 0), `${scopes[index]!.id} must produce`);
    const direct = after.machines[index]!;
    for (const reading of b.readings.filter(r => r.kind === 'production' && r.coverage === 'complete')) {
      const base = a.readings.find(r => r.kind === reading.kind && r.name === reading.name && r.productKind === reading.productKind);
      // Scope cadence may end up to one craft before the held direct endpoint.
      const observed = reading.total! - (base?.total ?? 0);
      const expected = reading.productKind === 'fluid' ? direct.fluids[reading.name] ?? 0 : direct.items.find(i => i.name === reading.name)?.count ?? 0;
      const oneCraft = direct.finished ? expected / direct.finished : 0;
      const tolerance = oneCraft + 0.002;
      assert(Math.abs(expected - observed) <= tolerance, `Uncalibrated ${reading.name}: ${observed}/${expected}`);
      calibration.push({ scope: scopes[index]!.id, product: reading.name, productKind: reading.productKind, expected, observed, tolerance, completedCrafts: direct.finished, precisionPerEndpoint: reading.productKind === 'fluid' ? 0.001 : 0 });
    }
  }
  for (let index = 0; index < 3; index++) {
    const a = all[index]![0]!, b = all[index]!.at(-1)!;
    for (const reading of b.readings.filter(r => r.kind === 'consumption' && r.coverage === 'complete')) {
      const base = a.readings.find(r => r.kind === reading.kind && r.name === reading.name && r.productKind === reading.productKind);
      const first = before.machines[index]!, last = after.machines[index]!;
      const input = (row: typeof first) => reading.productKind === 'fluid' ? row.fluids[reading.name] ?? 0 : row.inputs?.find(i => i.name === reading.name)?.count ?? 0;
      const expected = input(first) - input(last), observed = reading.total! - (base?.total ?? 0);
      // Endpoint in-flight crafts plus the latest sample's one-cadence skew.
      const tolerance = 2 * (reading.errorBound ?? 0) + 0.002;
      assert(Math.abs(expected - observed) <= tolerance, 'Uncalibrated input ' + reading.name);
      calibration.push({ scope: scopes[index]!.id, kind: 'consumption', product: reading.name, productKind: reading.productKind, expected, observed, tolerance, endpointBound: reading.errorBound ?? 0 });
    }
  }
  checks.push('Ordinary furnace, sulfur chemical and advanced refinery co-products agree with independent endpoint inventories/fluid contents within one-cadence craft skew and 0.001 fluid rounding per endpoint');
  const tank = all[3]!.at(-1)!;
  assert(!tank.readings.some(r => r.kind === 'production')); assert(Math.abs(tank.readings.find(r => r.kind === 'stock' && r.name === 'water')!.total! - 1234.567) < 0.001);
  checks.push('Preloaded stable tank exposes fluid stock without manufacturing gross production');
  assert.match(await port.command('/silent-command storage.af_calibration[2].set_recipe("plastic-bar");rcon.print("changed-recipe")'), /changed-recipe/);
  control = await life.reconcile(control); control = await life.arm(control); await delay(600); await life.heartbeat(control); control = await life.pause(await life.inspect()); barrier(control);
  const changed = await samples('chemical'); assert.notEqual(changed.at(-1)!.membershipHash, all[1]!.at(-1)!.membershipHash);
  assert.equal((await samples('refinery')).at(-1)!.membershipHash, all[2]!.at(-1)!.membershipHash);
  checks.push('Recipe replacement changes only affected scope membership');
  assert.match(await port.command('/silent-command local e=storage.af_calibration[3];e.get_module_inventory().insert{name="productivity-module",count=1};rcon.print("bonus-installed")'), /bonus-installed/);
  control = await life.reconcile(control); control = await life.arm(control); await delay(600); await life.heartbeat(control); control = await life.pause(await life.inspect()); barrier(control);
  assert((await samples('refinery')).at(-1)!.readings.some(r => r.coverage === 'unknown' && r.reason === 'unsupported_bonus_or_quality'));
  checks.push('Unsupported module/bonus invalidates affected gross flow rather than silently omitting its effect');
  // Exercise the public production status path in this same owned world. A mapped
  // character task grants observation area only here; no placement batch is sent.
  assert.match(await port.command('/silent-command local e=storage.af_calibration[2];e.set_recipe("sulfur");e.get_inventory(defines.inventory.assembling_machine_output).clear();for i=1,#e.fluidbox do local f=e.fluidbox.get_filter(i);if f then local p=e.fluidbox.get_prototype(i);if p.production_type=="input" then e.fluidbox[i]={name=f.name,amount=500,temperature=25} end end end;rcon.print("status-fixture-ready")'), /status-fixture-ready/);
  control = await life.reconcile(control);
  runtime = new DurableRuntime(path.join(evidence, 'runtime'), path.basename(evidence), control.epoch, game, life, [profile.password]);
  const c = new Coordinator(runtime, { ...PROBE_CAPS, tools: 100, turns: 10, turnMs: 300000, runMs: 300000 });
  team().forEach(a => c.register({ ...a, definition: { ...a.definition, limits: { ...a.definition.limits, tools: 80 } } }));
  const gateway = new CoordinationGateway(c), mcp = new CoordinationMcp(c, gateway);
  const turn = c.budget.admit('foreman'), binding = c.bind('foreman', 'status-probe', turn.id, async () => {}), token = mcp.issue('foreman'); mcp.bind(token, binding);
  const found = await mcp.call(token, 'production_search', { query: 'sulfur', recipe: 'recipe:sulfur' }) as ProductionSearchResult;
  const request: ProductionRequest = { schema: 1, target: { kind: 'item', name: 'sulfur', quality: 'normal', surface: 'nauvis' }, mode: 'rate', rate: { numerator: '1', denominator: '1', unit: 'items-per-game-second' }, profile: { id: 'calibration', revision: 1, fingerprint: 'installed-ordinary', recipes: ['sulfur'], equipment: ['chemical-plant'] }, facts: found.facts, externalInputs: ['water', 'petroleum-gas'].map(name => ({ product: { kind: 'fluid', name, quality: 'normal', surface: 'nauvis' }, capacity: { kind: 'unlimited' } })), initialStock: [], utilities: { electricityWatts: 10000000 }, constructionEquipment: { 'chemical-plant': 1 }, sinks: [], routes: {}, machines: {}, fuels: {} };
  const summary = await mcp.call(token, 'production_plan', { request }) as ProductionPlanSummary; assert.equal(summary.status, 'feasible');
  const detail = await mcp.call(token, 'production_inspect', { id: summary.id, revision: summary.revision }) as ProductionPlanPage;
  const stage = detail.stages[0]!;
  const reservations = diagnosticAssignment(1).resources.map(r => r.resource).map(r => r.kind === 'area' ? { ...r, bounds: scopes[1]!.area } : r);
  await mcp.call(token, 'production_commit', { requestId: 'status-calibration', id: summary.id, revision: summary.revision, assignments: [{ stage: stage.id, task: { id: 'status-stage', goal: 'observe chemical stage', parent: null, dependencies: [], scope: {}, resources: {}, successCriteria: ['construction complete'], deadline: null, committedPlan: summary.id + '.' + summary.revision + '/' + stage.id, actor: 'builder-1', reservations, criteria: [{ kind: 'message-delivered', id: 'unfulfilled-construction-claim' }] } }] });
  const first = await mcp.call(token, 'production_status', { id: summary.id, revision: summary.revision, stage: stage.id, windowTicks: 600 }) as ProductionStatusPage;
  assert.equal(first.stages[0]?.health, 'unknown'); assert.equal(first.scenarioVerdict, 'not-evaluated'); assert.equal(first.stages[0]?.task, 'status-stage');
  // The diagnostic controller advances this fixture, never the gameplay tool.
  control = await life.arm(control); const statusStart = (await life.inspect()).tick; const deadline = Date.now() + 30000;
  while ((await life.inspect()).tick - statusStart < 660) { assert(Date.now() < deadline, 'Status interval timeout'); await life.heartbeat(control); await delay(200); }
  control = await life.pause(await life.inspect()); barrier(control);
  const current = await mcp.call(token, 'production_status', { id: summary.id, revision: summary.revision, stage: stage.id, windowTicks: 600 }) as ProductionStatusPage;
  assert.equal(current.stages[0]?.task, 'status-stage'); assert.equal(current.scenarioVerdict, 'not-evaluated'); assert(current.stages[0]!.metrics.some(m => m.productKind === 'fluid' && m.unit === 'units-per-game-second'));
  assert(!JSON.stringify(current).includes('evaluator')); assert.equal(runtime.execution.pending().length, 0);
  await writeFile(path.join(evidence, 'status.json'), JSON.stringify({ first, current }, null, 2));
  checks.push('Actual production MCP search/plan/commit/status returns recipe-scoped fluid evidence and durable stage/task links without build effects or evaluator verdict');
  await writeFile(path.join(evidence, 'calibration.json'), JSON.stringify(calibration, null, 2));
} catch (error) { failure = String(error); await writeFile(path.join(evidence, 'failure.txt'), error instanceof Error ? error.stack ?? String(error) : String(error)); process.exitCode = 1; console.error(failure.slice(0, 1500)); }
finally {
  runtime?.close(); port?.close();
  try { await stopProfile(profile.config); cleanup = !(await listProjectProcesses()).some(p => p.config === profile.config); } catch (error) { failure ??= String(error); }
  if (!cleanup) { failure ??= 'Owned profile cleanup unresolved'; process.exitCode = 1; }
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed: failure === null, checks, failure, cleanup, modelInference: false, calibration }, null, 2));
  console.log(JSON.stringify({ evidence, checks: checks.length, failure, cleanup }));
}
