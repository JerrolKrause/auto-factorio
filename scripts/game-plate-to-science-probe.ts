import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { diagnosticAssignment, diagnosticGrants, record } from '@autofactorio/contracts';
import { GameClient, observeRequest } from '../packages/factorio/src/client.js';
import { barrier, Lifecycle, sha256 } from '../packages/factorio/src/lifecycle.js';
import type { ControlState } from '../packages/factorio/src/lifecycle.js';
import { FirstShiftAttempt, FirstShiftControl, evaluatorManifest, fingerprint } from '../packages/factorio/src/first-shift.js';
import { VerificationControl } from '../packages/factorio/src/verification.js';
import { executeReference } from './dev/first-shift-reference.js';
import { currentModHash } from './dev/first-shift-session.js';
import type { ScenarioRun } from './dev/first-shift-session.js';
import { readProfile, waitFor, waitForServer } from './dev/game-processes.js';

const flag = process.argv.indexOf('--run-file');
if (flag < 0) throw new Error('Explicit dedicated S2 --run-file required');
const prepared = JSON.parse(await readFile(process.argv[flag + 1]!, 'utf8')) as ScenarioRun;
assert.equal(prepared.manifest.id, '02-some-assembly-required');
const profile = await readProfile(prepared.profile);
const evidence = await mkdtemp(path.join(profile.dir, 'plate-to-science-probe-'));
const sink = (event: unknown) => appendFileSync(path.join(evidence, 'events.jsonl'), JSON.stringify({ visibility: { kind: 'evaluator' }, event }) + '\n');
const sourceFiles = ['scripts/game-plate-to-science-probe.ts', 'scripts/dev/first-shift-reference.ts', 'packages/contracts/src/game.ts', 'packages/contracts/src/ownership.ts', 'packages/factorio/src/first-shift.ts', 'packages/core/evaluation/engine.ts', ...((await readdir('mods/autofactorio')).map(f => 'mods/autofactorio/' + f))];
const sources = Object.fromEntries(await Promise.all(sourceFiles.map(async f => [f, sha256(await readFile(f))])));
for (const f of sourceFiles.filter(f => f.startsWith('mods/'))) assert.equal(sha256(await readFile(path.join(profile.mods, 'autofactorio_0.1.0', path.basename(f)))), sources[f], 'Live mod source mismatch');
await writeFile(path.join(evidence, 'sources.json'), JSON.stringify(sources, null, 2));

const port = await waitForServer(profile); const game = new GameClient(port, sink); const life = new Lifecycle(port, game, sink);
const scenario = new FirstShiftControl(port); const guard = new VerificationControl(port, sink);
let control!: ControlState; let failure: string | null = null; const checks: string[] = [];
const pass = (message: string) => { checks.push(message); console.log(message); };
console.log(JSON.stringify({ evidence }));
try {
  await waitFor('Visible S2 builder', async () => { const world = await game.request(observeRequest); return record(world.actors)['builder-1'] ? true : undefined; });
  control = await life.pause(await life.inspect()); barrier(control);
  const manifest = await scenario.inspect(); assert.equal(manifest.id, '02-some-assembly-required');
  const modHash = await currentModHash(); assert.equal(prepared.modHash, modHash);
  const fixtureHash = fingerprint({ manifest, modHash }); assert.equal(prepared.fixtureHash, fixtureHash);
  await writeFile(path.join(evidence, 'fixture.json'), JSON.stringify({ manifest, fixtureHash, roster: prepared.roster, checkpoint: prepared.checkpoint }, null, 2));
  pass('S2 fixture, installed recipes, finite kit and disarmed checkpoint match the selected run');
  control = await life.reconcile(control, [diagnosticAssignment(control.generation + 1, 40)]); await port.command('/silent-command game.speed=4;rcon.print("S2 diagnostic speed 4")'); control = await life.arm(control);
  control = await executeReference({ game, life, control, manifest, progress: console.log });
  pass('Hidden S2 reference used only ordinary character-gateway construction and recipe actions');
  const ready = control.tick + 3600;
  await waitFor('S2 reference warm-up', async () => { control = await life.heartbeat(control); return control.tick >= ready ? true : undefined; }, 90000, 100);
  const frozen = evaluatorManifest(manifest, fixtureHash, prepared.originTick, prepared.originWallMs);
  async function finish(name: string, attempt: FirstShiftAttempt) {
    for (;;) {
      control = await life.heartbeat(control); await attempt.poll(); const report = attempt.engine.report();
      if (!['admitting', 'settling', 'scoring'].includes(report.state)) { await writeFile(path.join(evidence, name + '.json'), JSON.stringify(report, null, 2)); return report; }
      await delay(100);
    }
  }
  const positiveAttempt = new FirstShiftAttempt(randomUUID(), frozen, scenario, guard, sink); await positiveAttempt.admit(control);
  const positive = await finish('positive', positiveAttempt); assert.equal(positive.state, 'passed', JSON.stringify({ reasons: positive.reasons, stages: positive.stages }));
  assert.deepEqual(positive.stages.map(s => [s.id, s.passed]), [['iron-plate', true], ['iron-gear-wheel', true], ['copper-plate', true], ['automation-science-pack', true]]);
  pass('Legal S2 reference passed five science windows plus 300 iron, 150 copper and 150 connected gears');

  async function diagnostic(lua: string) {
    sink({ kind: 'diagnostic/setup-injection', lua, duringVerification: false });
    assert.match(await port.command('/silent-command ' + lua + ';rcon.print("S2 diagnostic complete")'), /S2 diagnostic complete/);
    control = await life.heartbeat(control); await delay(100); control = await life.heartbeat(control);
  }
  async function begin() { control = await life.heartbeat(control); const attempt = new FirstShiftAttempt(randomUUID(), frozen, scenario, guard, sink); await attempt.admit(control); return attempt; }
  await positiveAttempt.repair(control);
  await diagnostic(`game.speed=1;local chest=game.surfaces.nauvis.create_entity{name='wooden-chest',position={-33.5,-2.5},force='player'};chest.insert{name='iron-gear-wheel',count=100};local link=game.surfaces.nauvis.create_entity{name='inserter',position={-32.5,-2.5},direction=12,force='player'};link.active=false`);
  await diagnostic(`game.speed=4`);
  const bufferedAttempt = await begin(); const buffered = await finish('unchanged-side-buffer', bufferedAttempt); assert.equal(buffered.state, 'passed');
  const bufferedCount = Number(await port.command(`/silent-command local chest=game.surfaces.nauvis.find_entity('wooden-chest',{-33.5,-2.5});rcon.print(chest and chest.get_inventory(defines.inventory.chest).get_item_count{name='iron-gear-wheel',quality='normal'} or -1)`));
  assert.equal(bufferedCount, 100); await writeFile(path.join(evidence, 'unchanged-side-buffer-stock.json'), JSON.stringify({ gears: bufferedCount }));
  pass('Unchanged topology-connected side stock does not create segmented drawdown');
  await bufferedAttempt.repair(control);
  await diagnostic(`game.speed=1`);
  const machines = `game.surfaces.nauvis.find_entities_filtered{type='assembling-machine'}`;
  for (const [x, y] of [[-36.5, -8.5], [-22.5, -2.5], [-36.5, 3.5]]) await diagnostic(`local e=game.surfaces.nauvis.find_entity('transport-belt',{${x},${y}});if e then e.destroy() end`);
  await diagnostic(`for _,e in pairs(${machines}) do if e.get_recipe() and e.get_recipe().name=='automation-science-pack' then local inv=e.get_inventory(defines.inventory.assembling_machine_input);inv.clear();inv.insert{name='iron-gear-wheel',count=100};inv.insert{name='copper-plate',count=100};e.get_inventory(defines.inventory.assembling_machine_output).clear() end end`);
  await diagnostic(`game.speed=4`);
  const preloadAttempt = await begin();
  const observed = await game.request({ op: 'observe', surface: 'nauvis', area: [{ x: -20, y: -1 }, { x: -17, y: 2 }], offset: 0, limit: 50 });
  const entity = (observed.entities as { name: string; quality: string; position: { x: number; y: number }; unit: number }[]).find(e => e.name === 'assembling-machine-1')!;
  const target = { name: entity.name, quality: entity.quality, position: entity.position, unit: entity.unit };
  await assert.rejects(() => game.request({ op: 'submit', batch: { commandId: randomUUID(), epoch: control.epoch, session: control.session, task: 'phase03-actions', revision: 1, actor: 'builder-1', surface: 'nauvis', grants: diagnosticGrants(control.generation, 40), deadline: control.tick + 36000, steps: [{ kind: 'transfer', target, inventory: 'input', flow: 'put', item: { name: 'iron-gear-wheel', quality: 'normal', count: 1 } }] } }), /verification_observation_only/);
  const preload = await finish('preloaded-gears', preloadAttempt); assert.equal(preload.state, 'failed'); assert(preload.windows.every(w => w.passed));
  assert(preload.stages.find(s => s.id === 'iron-gear-wheel')!.produced < 150);
  pass('Preloaded/hand-supplied gears sustain final output but fail fresh connected gear-chain proof');

  await preloadAttempt.repair(control);
  await diagnostic(`game.speed=1`);
  await diagnostic(`game.surfaces.nauvis.create_entity{name='transport-belt',position={-22.5,-2.5},direction=4,force='player'};for _,x in ipairs({-31.5,-25.5}) do for _,y in ipairs({-8.5,-2.5}) do local belt=game.surfaces.nauvis.find_entity('transport-belt',{x,y});if belt then belt.destroy() end end end;for _,e in pairs(${machines}) do local r=e.get_recipe();if r and r.name=='iron-gear-wheel' then local inv=e.get_inventory(defines.inventory.assembling_machine_input);inv.clear();e.get_inventory(defines.inventory.assembling_machine_output).clear();local input=game.surfaces.nauvis.create_entity{name='wooden-chest',position={e.position.x,e.position.y-3},force='player'};input.insert{name='iron-plate',count=600};local feeder=game.surfaces.nauvis.find_entity('inserter',{e.position.x,e.position.y-2});if feeder then feeder.destroy() end;game.surfaces.nauvis.create_entity{name='fast-inserter',position={e.position.x,e.position.y-2},direction=0,force='player'};game.surfaces.nauvis.create_entity{name='wooden-chest',position={e.position.x,e.position.y+3},force='player'};local link=game.surfaces.nauvis.create_entity{name='inserter',position={e.position.x+1,e.position.y+3},direction=12,force='player'};link.active=e.position.x < -30 elseif r and r.name=='automation-science-pack' then e.get_inventory(defines.inventory.assembling_machine_input).remove{name='iron-gear-wheel',quality='normal',count=10000} end end`);
  await diagnostic(`local chest=game.surfaces.nauvis.create_entity{name='wooden-chest',position={-19.5,-4.5},force='player'};chest.insert{name='iron-gear-wheel',count=240};game.surfaces.nauvis.create_entity{name='inserter',position={-19.5,-3.5},direction=0,force='player'}`);
  await diagnostic(`game.speed=4`);
  const sharedAttempt = await begin(); const shared = await finish('unused-upstream-shared-buffer', sharedAttempt);
  const unused = JSON.parse(await port.command(`/silent-command local out={};for _,x in ipairs({-31.5,-25.5}) do local chest=game.surfaces.nauvis.find_entity('wooden-chest',{x,-2.5});out[#out+1]=chest and chest.get_inventory(defines.inventory.chest).get_item_count{name='iron-gear-wheel',quality='normal'} or 0 end;rcon.print(helpers.table_to_json(out))`)) as number[];
  const unusedProduced = unused.reduce((sum, count) => sum + count, 0); assert(unusedProduced >= 150); assert.equal(shared.state, 'failed'); assert(shared.windows.every(w => w.passed));
  const sharedGear = shared.stages.find(s => s.id === 'iron-gear-wheel')!; assert(sharedGear.produced >= sharedGear.delivered); assert(sharedGear.delivered >= 150); assert(sharedGear.consumed >= 150); assert(sharedGear.drawdown > 16);
  await writeFile(path.join(evidence, 'unused-gear-production.json'), JSON.stringify({ chests: unused, produced: unusedProduced }));
  pass('Aggregate-cancelling fresh accumulation could not hide depletion of the separate preloaded branch under component reconciliation');

  await sharedAttempt.repair(control); const nativeAttempt = await begin();
  await port.command('/silent-command game.players[1].insert{name="iron-gear-wheel",count=1};rcon.print("native character supply")');
  const native = await finish('native-character-supply', nativeAttempt); assert.equal(native.state, 'invalid');
  pass('Native character-supply mutation invalidated S2 verification');
} catch (error) {
  failure = String(error); process.exitCode = 1; await writeFile(path.join(evidence, 'failure.txt'), failure); console.error(failure.slice(0, 1500));
} finally {
  let held = false;
  try { control = await life.inspect(); if (control.armed || !control.paused) control = await life.pause(control); barrier(control); held = true; } catch { failure ??= 'Cleanup hold unconfirmed'; process.exitCode = 1; }
  port.close(); await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed: failure === null, checks, failure, modelInference: false, cleanup: { held, tick: control?.tick ?? null } }, null, 2));
  console.log(JSON.stringify({ evidence, checks: checks.length, failure: failure?.slice(0, 300) }));
}
