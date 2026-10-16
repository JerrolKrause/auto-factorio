import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { diagnosticAssignment } from '@autofactorio/contracts';
import type { ProductionSearchResult, ProductionPlanSummary, ProductionPlanPage, ProductionStatusPage, Receipt } from '@autofactorio/contracts';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { Coordinator } from '../packages/core/orchestration/coordinator.js';
import { team } from '../packages/core/orchestration/roles.js';
import { constructionBatches } from '../packages/core/workshop/construction.js';
import { CoordinationGateway } from '../packages/tools/src/coordination.js';
import { CoordinationMcp } from '../packages/tools/src/coordination-mcp.js';
import { PROBE_CAPS } from '../packages/codex/src/budget.js';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle, barrier, type ControlState } from '../packages/factorio/src/lifecycle.js';
import { WorkshopControl } from '../packages/factorio/src/workshop.js';
import { referenceRequest } from './dev/production-chain-reference.js';
import { gameplayCase, gameplayConstruction, gameplayHeartbeatPort, gameplayWindow, requireSulfurWindow, type GameplayEndpoint } from './dev/production-chain-gameplay.js';
import { createProfile, identifyObserver, listProjectProcesses, startObserver, startServer, stopProfile, waitFor, waitForServer } from './dev/game-processes.js';

gameplayCase(process.argv.slice(2));
const graphical = spawnSync('powershell.exe', ['-NoProfile', '-Command', '@(Get-CimInstance Win32_Process -Filter "Name=\'factorio.exe\'" | Where-Object { $_.CommandLine -notmatch "--(start-server|create|benchmark|version)" }).Count'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
if (graphical.status !== 0 || graphical.stdout.trim() !== '0') throw new Error('Graphical Factorio is occupied or inventory unavailable');
await listProjectProcesses();
const profile = await createProfile(false, false, { port: 27039, gamePort: 34219 });
const evidence = await mkdtemp(path.join(profile.dir, 'production-chain-gameplay-'));
const save = (name: string, value: unknown) => writeFile(path.join(evidence, name), JSON.stringify(value, null, 2), { flag: 'wx' });
const sink = (event: unknown) => appendFileSync(path.join(evidence, 'events.jsonl'), JSON.stringify(event) + '\n');
let port: Awaited<ReturnType<typeof waitForServer>> | undefined, runtime: DurableRuntime | undefined;
let observer = false, cleanup = false, failure: string | null = null;
const checks: string[] = [];
console.log(JSON.stringify({ selected: 'sulfur-gameplay', evidence, profile: profile.config }));
try {
  await startServer(profile); port = await waitForServer(profile);
  await port.command('/silent-command rcon.print("ordinary-reference-ready")');
  assert.match(await port.command('/silent-command rcon.print("ordinary-reference-ready")'), /ordinary-reference-ready/);
  await startObserver(profile); observer = true; await identifyObserver(profile);
  let heartbeatControl: ControlState | null = null;
  const serialized = gameplayHeartbeatPort(port, async () => {
    assert(heartbeatControl); heartbeatControl = await heartbeatLife.heartbeat(heartbeatControl);
  }, () => heartbeatControl !== null);
  const game = new GameClient(serialized, sink), life = new Lifecycle(serialized, game, sink);
  const heartbeatLife = new Lifecycle(port, game, sink);
  await waitFor('ordinary builder', async () => {
    const world = await game.request({ op: 'observe', surface: 'nauvis', area: [{ x: -48, y: -32 }, { x: 48, y: 32 }], offset: 0, limit: 50 });
    return (world.actors as Record<string, { connected?: boolean }>)['builder-1']?.connected ? true : undefined;
  }, 120000, 200);
  let control = await life.pause(await life.inspect()); barrier(control);
  // Scenario setup clears terrain, supplies research and the declared external
  // fixtures only. There is no workshop surface, force, materializer or grant.
  const setup = `local s=game.surfaces.nauvis;s.request_to_generate_chunks({0,0},3);s.force_generate_chunk_requests();for _,e in pairs(s.find_entities_filtered{area={{-64,-48},{64,48}}}) do if e.type~='character' then e.destroy() end end;local tiles={};for x=-64,64 do for y=-48,48 do tiles[#tiles+1]={name='grass-1',position={x,y}} end end;s.set_tiles(tiles);s.always_day=true;for _,t in pairs(game.forces.player.technologies) do t.researched=true end;for _,r in pairs(game.forces.player.recipes) do r.productivity_bonus=0 end;local function fixture(name,x,y) local e=s.create_entity{name=name,position={x,y},direction=4,force='player'};assert(e,name);e.minable=false;e.destructible=false;return e end;storage.af_chain_reference={sources={['crude-oil']=fixture('storage-tank',-32.5,-12.5),water=fixture('storage-tank',-32.5,-6.5)},sink=fixture('express-transport-belt',32.5,-12.5),supplied={['crude-oil']=0,water=0},delivered=0};local p=fixture('electric-energy-interface',0,14);p.power_production=2000000/60;p.electric_buffer_size=2000000/60;p.energy=0;local player=game.get_player(1);assert(player.teleport({-40,-28},s));player.get_main_inventory().clear();rcon.print('ordinary-scenario-ready')`;
  assert.match(await port.command(`/silent-command ${setup}`), /ordinary-scenario-ready/);
  // Installed profile retrieval is read-only. It supplies facts, never setup.
  const context = await new WorkshopControl(port).installedChainProfile('production-chain');
  const connector = JSON.parse(await port.command('/silent-command rcon.print(defines.wire_connector_id.pole_copper)')) as number;
  assert(Number.isSafeInteger(connector));
  const construction = gameplayConstruction(context, connector), request = referenceRequest(context, 'sulfur-character');
  request.constructionEquipment['oil-refinery'] = 3;
  for (const [name, count] of Object.entries(construction.inventory)) assert(count <= (request.constructionEquipment[name] ?? 0));
  // One finite kit, debited by native placements; no replenishment after this.
  const kit = Object.entries(construction.inventory).map(([name, count]) => `assert(p.insert{name=${JSON.stringify(name)},count=${count},quality='normal'}==${count})`).join(';');
  assert.match(await port.command(`/silent-command local p=game.get_player(1);${kit};rcon.print('finite-kit-ready')`), /finite-kit-ready/);
  runtime = new DurableRuntime(path.join(evidence, 'runtime'), path.basename(evidence), control.epoch, game, life, [profile.password]);
  control = await runtime.recover(); control = await runtime.resume(control);
  heartbeatControl = control;
  const c = new Coordinator(runtime, { ...PROBE_CAPS, tools: 80, turns: 4, turnMs: 840000, runMs: 840000 });
  team().forEach(agent => c.register({ ...agent, definition: { ...agent.definition, limits: { tools: 60 } } }));
  const mcp = new CoordinationMcp(c, new CoordinationGateway(c));
  const bind = (agent: string) => {
    const turn = c.budget.admit(agent), token = mcp.issue(agent);
    mcp.bind(token, c.bind(agent, `scripted-${agent}`, turn.id, async () => {})); return { turn, token };
  };
  const foreman = bind('foreman'), engineer = bind('engineer');
  const discovery = await mcp.call(foreman.token, 'production_search', { query: 'sulfur', product: 'item:sulfur' }) as ProductionSearchResult;
  const deliveredRequest = { ...request, facts: discovery.facts };
  const summary = await mcp.call(foreman.token, 'production_plan', { request: deliveredRequest }) as ProductionPlanSummary;
  assert.equal(summary.status, 'feasible'); assert(summary.executable);
  const plan = await mcp.call(foreman.token, 'production_inspect', { id: summary.id, revision: summary.revision }) as ProductionPlanPage;
  assert.equal(plan.stages.length, 2); assert.equal(plan.next, null);
  const ordered = ['recipe:basic-oil-processing', 'recipe:sulfur'].map(recipe => { const stage = plan.stages.find(value => value.recipe === recipe); assert(stage, recipe); return stage; });
  const tasks = ordered.map((stage, index) => ({ stage: stage.id, task: {
    id: `ordinary-stage-${index}`, goal: `Build ${stage.recipe}`, parent: null, dependencies: [], scope: {}, resources: {},
    successCriteria: ['All declared construction batches completed'], deadline: null,
    committedPlan: `${summary.id}.${summary.revision}/${stage.id}`, actor: 'builder-1',
    reservations: diagnosticAssignment(1, 64).resources.map(value => value.resource),
    criteria: Array.from({ length: Math.ceil(construction.plans[index]!.steps.length / 100) }, (_, batch) => ({ kind: 'command-completed' as const, id: `ordinary-stage-${index}-${batch + 1}` })),
  } }));
  const commitment = await mcp.call(foreman.token, 'production_commit', { requestId: 'ordinary-sulfur', id: summary.id, revision: summary.revision, assignments: tasks });
  await save('tool-delivery.json', { discovery, request: deliveredRequest, summary, plan, commitment, tasks });
  const receipts: Receipt[] = [];
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index]!.task;
    await mcp.call(foreman.token, 'message', { message: { id: `${task.id}-handoff`, recipient: 'engineer', task: task.id, revision: 1, intent: 'handoff', content: task.goal, evidence: [] } });
    await c.pump(); assert.equal(c.task(task.id).status, 'assigned');
    const reservation = runtime.ownership.list().find(value => value.task === task.id && value.state === 'active'); assert(reservation);
    const batches = constructionBatches(construction.plans[index]!, { commandPrefix: task.id, epoch: control.epoch, session: control.session,
      task: task.id, revision: 1, actor: reservation.actor, surface: 'nauvis', grants: reservation.resources.map(value => value.grant), deadline: control.tick + 30000 });
    for (const batch of batches) {
      await mcp.call(engineer.token, 'submit', { batch });
      const receipt = await waitFor('ordinary batch receipt', async () => {
        control = await life.heartbeat(control); await c.pump();
        const receipt = await game.receipt(batch.commandId);
        return receipt && !['accepted', 'running'].includes(receipt.status) ? receipt : undefined;
      }, 180000, 40);
      receipts.push(receipt); await save(`${batch.commandId}.json`, { batch, receipt });
      assert.equal(receipt.status, 'completed', JSON.stringify(receipt)); assert.equal(receipt.unexecuted, 0);
      assert.equal(receipt.completed, batch.steps.length);
      // The direct receipt can be newer than the preceding durable poll. Join
      // reconciliation before the next intent crosses the unresolved-effects fence.
      await c.pump();
    }
    await c.pump();
    await mcp.call(engineer.token, 'report', { task: task.id, revision: 1, evidence: batches.map(value => value.commandId) });
    await c.pump(); await c.pump(); assert.equal(c.task(task.id).status, 'succeeded');
  }
  checks.push('Authenticated production_commit, separate team handoff, ordinary ownership and receipt-backed engineer construction');
  heartbeatControl = null;
  control = await life.pause(await life.inspect()); barrier(control);
  // Read native world endpoints independently of ordinary telemetry. This code
  // neither sets recipe counters nor inserts intermediate/target products.
  const endpoint = async (): Promise<GameplayEndpoint> => JSON.parse(await port!.command(`/silent-command local s=game.surfaces.nauvis;local f=storage.af_chain_reference;local out={tick=game.tick,delivered=f.delivered,supplied=f.supplied,crafts={},stock=0,fluid=0,progress=0,inventory={}};local function add(inv) if inv then out.stock=out.stock+inv.get_item_count('sulfur') end end;for _,e in pairs(s.find_entities_filtered{area={{-64,-48},{64,48}},force='player'}) do if e.type=='assembling-machine' then local r=e.get_recipe();if r then out.crafts[r.name]=(out.crafts[r.name] or 0)+e.products_finished;out.progress=out.progress+e.crafting_progress end;add(e.get_inventory(defines.inventory.assembling_machine_output)) elseif e.type=='transport-belt' then for i=1,e.get_max_transport_line_index() do out.stock=out.stock+e.get_transport_line(i).get_item_count('sulfur') end elseif e.type=='inserter' and e.held_stack.valid_for_read and e.held_stack.name=='sulfur' then out.stock=out.stock+e.held_stack.count end;if e.type=='pipe' or e.type=='pipe-to-ground' or e.type=='storage-tank' or e.type=='assembling-machine' then for i=1,#e.fluidbox do local value=e.fluidbox[i];out.fluid=out.fluid+(value and value.amount or 0) end end end;for _,v in pairs(game.get_player(1).get_main_inventory().get_contents()) do out.inventory[v.name]=(out.inventory[v.name] or 0)+v.count end;rcon.print(helpers.table_to_json(out))`)) as GameplayEndpoint;
  const opening = await endpoint(); await save('before-admission.json', opening);
  assert.equal(opening.fluid, 0); assert.equal(opening.stock, 0); assert.equal(opening.progress, 0);
  assert(Object.values(opening.crafts).every(value => value === 0)); assert.equal(Object.keys(opening.inventory).length, 0);
  await save('construction.json', { document: construction.document, kit: construction.inventory, receipts, tasks: c.tasks(), ownership: runtime.ownership.list(), opening });
  checks.push('Zero process preload; finite exact construction bill fully consumed with no refill');
  const status = () => mcp.call(foreman.token, 'production_status', { id: summary.id, revision: summary.revision, windowTicks: 3600 }) as Promise<ProductionStatusPage>;
  await status();
  // One fixed game-second at a time gives exact contiguous endpoints. The held,
  // disarmed executor cannot mutate construction during settling/scoring. Each
  // pulse supplies <=100 units of the two declared external fluids only; the
  // output pulse removes <=2 sulfur (one chemical plant's full-duty output)
  // actually present on the boundary belt; required delivery remains >=1/s.
  const deadline = Date.now() + 600000;
  const second = async () => {
    assert(Date.now() < deadline, 'Ordinary measurement wall budget exhausted');
    assert.match(await port!.command(`/silent-command assert(game.tick_paused and game.ticks_to_run==0);local f=storage.af_chain_reference;for name,e in pairs(f.sources) do local n=e.insert_fluid{name=name,amount=100};assert(n>=0 and n<=100);f.supplied[name]=f.supplied[name]+n end;game.speed=10;game.ticks_to_run=60;rcon.print('external-pulse')`), /external-pulse/);
    await waitFor('one measured game second', async () => Number(await port!.command('/silent-command rcon.print(game.ticks_to_run)')) === 0 ? true : undefined, 15000, 50);
    assert.match(await port!.command(`/silent-command local f=storage.af_chain_reference;local left=2;for i=1,f.sink.get_max_transport_line_index() do local n=f.sink.get_transport_line(i).remove_item{name='sulfur',count=left};f.delivered=f.delivered+n;left=left-n end;rcon.print('boundary-drained')`), /boundary-drained/);
  };
  for (let i = 0; i < 300; i++) await second();
  let before = await endpoint(); await save('settled.json', before);
  await second(); // Publication lookahead only; baseline remains at exactly 300s.
  for (let window = 0; window < 5; window++) {
    const { after, status: observed } = await gameplayWindow(second, endpoint, status);
    await save(`window-${window + 1}.json`, { before, after, status: observed });
    requireSulfurWindow(before, after, observed);
    console.log(JSON.stringify({ window: window + 1, tick: after.tick, produced: ((after.crafts.sulfur ?? 0) - (before.crafts.sulfur ?? 0)) * 2, delivered: after.delivered - before.delivered, passed: true }));
    before = after;
  }
  c.finish(engineer.turn.id); c.finish(foreman.turn.id); mcp.revoke(engineer.token); mcp.revoke(foreman.token);
  checks.push('Five exact consecutive 3600-tick windows pass independent fresh sulfur conservation/delivery and ordinary production_status upstream lower bounds');
  const held = await life.inspect(); barrier(held);
  await save('measurement-barrier.json', { epoch: held.epoch, session: held.session, tick: held.tick, paused: held.paused, armed: held.armed, neutral: held.neutral, ticksToRun: held.ticksToRun, surface: 'nauvis' });
  checks.push('No workshop world, setup, build, fixture feed or execution privilege used');
} catch (error) { failure = String(error); process.exitCode = 1; await save('failure.json', { failure, stack: error instanceof Error ? error.stack : null }); console.error(failure.slice(0, 1800)); }
finally {
  runtime?.close(); port?.close();
  try { if (observer) await stopProfile(profile.observerConfig); await stopProfile(profile.config); cleanup = !(await listProjectProcesses()).some(value => [profile.config, profile.observerConfig].includes(value.config)); }
  catch (error) { failure ??= String(error); process.exitCode = 1; }
  if (!cleanup) { failure ??= 'Owned cleanup unresolved'; process.exitCode = 1; }
  await save('result.json', { selected: 'sulfur-gameplay', passed: failure === null, checks, failure, cleanup, modelInference: false,
    acceptance: 'Deterministic ordinary gameplay sulfur reference; no autonomous model or negative/recovery claim' });
  console.log(JSON.stringify({ evidence, checks: checks.length, failure, cleanup }));
}
