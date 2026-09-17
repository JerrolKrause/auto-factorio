import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { record, diagnosticGrants } from '@autofactorio/contracts';
import { GameClient, observeRequest } from '../packages/factorio/src/client.js';
import { Lifecycle, sha256, captureCheckpoint, barrier } from '../packages/factorio/src/lifecycle.js';
import type { ControlState } from '../packages/factorio/src/lifecycle.js';
import { VerificationControl } from '../packages/factorio/src/verification.js';
import { FirstShiftControl, FirstShiftAttempt, evaluatorManifest, fingerprint, briefing, commonKit } from '../packages/factorio/src/first-shift.js';
import { readProfile, waitForServer, waitFor } from './dev/game-processes.js';
import { executeReference } from './dev/first-shift-reference.js';
import type { ScenarioRun } from './dev/first-shift-session.js';
import { currentModHash } from './dev/first-shift-session.js';

const flag = process.argv.indexOf('--profile-file');
const runFlag = process.argv.indexOf('--run-file');
const prepared: ScenarioRun | undefined = runFlag >= 0 ? JSON.parse(await readFile(process.argv[runFlag + 1]!, 'utf8')) : undefined;
if (flag < 0 && !prepared) throw new Error('Explicit dedicated --profile-file or --run-file required');
const profile = await readProfile(prepared?.profile ?? JSON.parse(await readFile(process.argv[flag + 1]!, 'utf8')).dir);
const evidence = await mkdtemp(path.join(profile.dir, 'first-shift-probe-'));
const sink = (e: unknown) => appendFileSync(path.join(evidence, 'events.jsonl'), JSON.stringify({ visibility: { kind: 'evaluator' }, event: e }) + '\n');
const sourceFiles = ['scripts/game-first-shift-probe.ts', 'scripts/dev/first-shift-reference.ts', 'packages/factorio/src/first-shift.ts', 'packages/core/evaluation/engine.ts', ...((await readdir('mods/autofactorio')).map(f => 'mods/autofactorio/' + f))];
const sources = Object.fromEntries(await Promise.all(sourceFiles.map(async f => [f, sha256(await readFile(f))])));
for (const f of sourceFiles.filter(f => f.startsWith('mods/'))) assert.equal(sha256(await readFile(path.join(profile.mods, 'autofactorio_0.1.0', path.basename(f)))), sources[f], 'Live mod source mismatch');
await writeFile(path.join(evidence, 'sources.json'), JSON.stringify(sources, null, 2));
const port = await waitForServer(profile); const game = new GameClient(port, sink); const life = new Lifecycle(port, game, sink); const scenario = new FirstShiftControl(port); const guard = new VerificationControl(port, sink);
let control!: ControlState; let failure: string | null = null; const checks: string[] = [];
const pass = (s: string) => { checks.push(s); console.log(s); };
console.log(JSON.stringify({ evidence }));
try {
  await port.command('/silent-command rcon.print("phase11")'); await port.command('/silent-command rcon.print("phase11")');
  await waitFor('Visible S1 builder', async () => { const w = await game.request(observeRequest); return record(w.actors)['builder-1'] && record(record(w.actors)['builder-1']).connected === true ? true : undefined; });
  control = await life.pause(await life.inspect()); assert.equal(Object.keys(control.ledger).length, 0);
  const manifest = prepared ? await scenario.inspect() : await scenario.setup(); const modHash = await currentModHash();
  const initial = await game.request(observeRequest);
  const builder = record(record(initial.actors)['builder-1']);
  const inventory = builder.inventory as { name: string; quality: string; count: number }[];
  assert.deepEqual(Object.fromEntries(inventory.map(i => [i.name, i.count])), commonKit); assert(inventory.every(i => i.quality === 'normal'));
  assert.equal(builder.miningSpeed, 0); assert.equal(builder.craftingSpeed, 0);
  await writeFile(path.join(evidence, 'initial-world.json'), JSON.stringify(initial, null, 2));
  if (prepared) assert.equal(prepared.modHash, modHash);
  const fixtureHash = fingerprint({ manifest, modHash });
  if (!prepared) await guard.configure(control, fixtureHash, manifest.evaluator, manifest.settlingTicks);
  await writeFile(path.join(evidence, 'manifest.json'), JSON.stringify({ manifest, modHash, fixtureHash }, null, 2));
  await writeFile(path.join(evidence, 'briefing.json'), JSON.stringify(briefing(manifest, 'team'), null, 2));
  const cache = path.resolve('.runtime/scenarios/cache', fixtureHash); await mkdir(cache, { recursive: true });
  const checkpoint = prepared?.checkpoint ?? await captureCheckpoint({ lifecycle: life, paused: control, saveDirectory: path.join(profile.dir, 'data/saves'), outputDirectory: cache, logFile: profile.log, eventCursor: () => 0, world: () => game.request(observeRequest), modHash });
  await writeFile(path.join(evidence, 'checkpoint.json'), JSON.stringify({ checkpoint, fixtureHash, modHash }));
  pass('Finite S1 fixture inspected and fingerprinted disarmed initial checkpoint captured');
  control = await life.reconcile(await life.inspect());
  const origin = { run: randomUUID(), epoch: control.epoch, session: control.session, originTick: control.tick, originWallMs: Date.now(), fixtureHash, roster: 'team', diagnostic: true, simulationSpeed: 4 };
  await writeFile(path.join(evidence, 'run.json'), JSON.stringify(origin, null, 2));
  // Diagnostic acceleration changes wall duration, never character speed, recipes or tick windows.
  await port.command('/silent-command game.speed=4;rcon.print("diagnostic simulation speed 4")');
  control = await life.arm(control);
  const armTick = control.tick;
  await waitFor('Repeated-pause re-arm advances', async () => { control = await life.heartbeat(control); assert.equal(control.paused, false); return control.tick > armTick ? true : undefined; }, 5000, 100);
  pass('Re-arm after repeated paused requests advances normal game ticks');
  control = await executeReference({ game, life, control, manifest, progress: console.log });
  pass('Hidden reference built only through legal character batches with finite-kit receipts');
  // Let the fully connected factory fill ordinary transport buffers before admission.
  const readyTick = control.tick + 3600;
  await waitFor('Reference warm-up', async () => { control = await life.heartbeat(control); return control.tick >= readyTick ? true : undefined; }, 90000, 100);
  const attempt = new FirstShiftAttempt(randomUUID(), evaluatorManifest(manifest, fixtureHash, origin.originTick, origin.originWallMs), scenario, guard, sink);
  await attempt.admit(control);
  // A real ordinary pause must preserve the admitted baseline across continued polling.
  control = await life.pause(await life.inspect()); const pausedTick = control.tick;
  await attempt.poll(); await delay(250); await attempt.poll();
  assert.equal((await life.inspect()).tick, pausedTick);
  const priorEpoch = control.epoch;
  control = await life.rpc({ op: 'resume-verification', epoch: control.epoch, session: control.session, revision: control.revision });
  assert.equal(control.epoch, priorEpoch); assert.equal(control.armed, true);
  // This operator-only probe must reach Lua for later negative admission checks.
  // The application runtime deliberately keeps its character client closed here.
  game.admission = true;
  for (;;) {
    control = await life.heartbeat(control); await attempt.poll();
    const report = attempt.engine.report();
    if (!['admitting', 'settling', 'scoring'].includes(report.state)) {
      await writeFile(path.join(evidence, 'positive.json'), JSON.stringify(report, null, 2));
      assert.equal(report.state, 'passed', JSON.stringify({ reasons: report.reasons, windows: report.windows, stages: report.stages })); break;
    }
    await delay(100);
  }
  pass('Live S1 positive reference passes five exact windows and fresh connected-flow balances');
  const frozen = evaluatorManifest(manifest, fixtureHash, origin.originTick, origin.originWallMs);
  async function diagnostic(lua: string) {
    sink({ kind: 'diagnostic/setup-injection', lua, duringVerification: false });
    const result = await port.command('/silent-command ' + lua + ';rcon.print("diagnostic setup complete")');
    assert.match(result, /diagnostic setup complete/);
  }
  async function controlAttempt(name: string, beforePoll?: (a: FirstShiftAttempt) => Promise<void>) {
    control = await life.heartbeat(control);
    const a = new FirstShiftAttempt(randomUUID(), frozen, scenario, guard, sink); await a.admit(control);
    if (beforePoll) await beforePoll(a);
    for (;;) {
      control = await life.heartbeat(control); await a.poll();
      const r = a.engine.report();
      if (!['admitting', 'settling', 'scoring'].includes(r.state)) { await writeFile(path.join(evidence, name + '.json'), JSON.stringify(r, null, 2)); return { attempt: a, report: r }; }
      await delay(100);
    }
  }
  await attempt.repair(control);
  const removeInputs = `for _,e in pairs(game.surfaces.nauvis.find_entities_filtered{name='transport-belt'}) do if (e.position.y==-2.5 or e.position.y==3.5) and e.position.x>-21 then e.destroy() end end`;
  const machines = `game.surfaces.nauvis.find_entities_filtered{type='assembling-machine'}`;
  await diagnostic(removeInputs + `;for _,e in pairs(${machines}) do local inv=e.get_inventory(defines.inventory.assembling_machine_input);inv.clear();inv.insert{name='iron-gear-wheel',count=50};inv.insert{name='copper-plate',count=50};e.get_inventory(defines.inventory.assembling_machine_output).clear() end`);
  const preload = await controlAttempt('preloaded-input', async () => {
    const world = await game.request({ op: 'observe', surface: 'nauvis', area: [{ x: -17, y: -1 }, { x: -14, y: 2 }], offset: 0, limit: 50 });
    const e = (world.entities as { name: string; quality: string; position: { x: number; y: number }; unit: number }[]).find(v => v.name === 'assembling-machine-1')!;
    await assert.rejects(() => game.request({ op: 'submit', batch: { commandId: randomUUID(), epoch: control.epoch, session: control.session, task: 'phase03-actions', revision: 1, actor: 'builder-1', surface: 'nauvis', grants: diagnosticGrants(control.generation), deadline: control.tick + 36000, steps: [{ kind: 'transfer', target: { name: e.name, quality: e.quality, position: e.position, unit: e.unit }, inventory: 'input', flow: 'put', item: { name: 'iron-gear-wheel', quality: 'normal', count: 1 } }] } }), /verification_observation_only/);
    pass('Character-supply bypass is rejected at admission during the preloaded-input control');
  });
  assert.equal(preload.report.state, 'failed'); assert(preload.report.windows.every(w => w.passed), 'Preload must sustain output so this challenges upstream scoring'); assert(preload.report.stages.filter(s => s.id !== 'automation-science-pack').every(s => s.produced < 150 && s.delivered < 150));
  pass('Old ingredient stock sustains all output windows but fails fresh terminal intake');
  await preload.attempt.repair(control);
  await diagnostic(`for _,e in pairs(${machines}) do e.get_inventory(defines.inventory.assembling_machine_input).clear();e.get_inventory(defines.inventory.assembling_machine_output).insert{name='automation-science-pack',count=100} end`);
  const oldOutput = await controlAttempt('preloaded-output');
  assert.equal(oldOutput.report.state, 'failed'); assert(oldOutput.report.windows.every(w => w.delivered >= 30), 'Old output must challenge new-production scoring'); assert(oldOutput.report.windows.some(w => w.produced < 30));
  pass('Automatically delivered old science stock fails the fresh machine-production requirement');
  await oldOutput.attempt.repair(control);
  await diagnostic(`for _,e in pairs(${machines}) do local inv=e.get_inventory(defines.inventory.assembling_machine_input);inv.clear();inv.insert{name='iron-gear-wheel',count=50};inv.insert{name='copper-plate',count=50};e.get_inventory(defines.inventory.assembling_machine_output).clear() end;for _,y in ipairs({-2.5,3.5}) do game.surfaces.nauvis.create_entity{name='transport-belt',position={-20.5,y},direction=4,force='player'};game.surfaces.nauvis.create_entity{name='inserter',position={-19.5,y},direction=12,force='player'};game.surfaces.nauvis.create_entity{name='wooden-chest',position={-18.5,y},force='player'} end`);
  const unrelated = await controlAttempt('unrelated-upstream');
  assert.equal(unrelated.report.state, 'failed'); assert(unrelated.report.windows.every(w => w.passed)); assert(unrelated.report.stages.filter(s => s.id !== 'automation-science-pack').every(s => s.produced === 0));
  const unused = JSON.parse(await port.command(`/silent-command local out={};for _,y in ipairs({-2.5,3.5}) do out[#out+1]=game.surfaces.nauvis.find_entity('wooden-chest',{-18.5,y}).get_inventory(defines.inventory.chest).get_item_count() end;rcon.print(helpers.table_to_json(out))`)) as number[];
  await writeFile(path.join(evidence, 'unused-upstream-inventories.json'), JSON.stringify(unused)); assert(unused.every(n => n >= 150));
  pass('Unrelated upstream delivery exceeds 150 per ingredient but cannot substitute for science-chain intake');
  await unrelated.attempt.repair(control);
  const native = await controlAttempt('native-character-supply', async () => {
    sink({ kind: 'diagnostic/native-inventory-edit', duringVerification: true });
    await port.command('/silent-command game.players[1].insert{name="iron-gear-wheel",count=1};rcon.print("diagnostic native inventory edit")');
  });
  assert.equal(native.report.state, 'invalid');
  pass('Native character inventory edit invalidates verification instead of silently preserving coverage');
  // A realistic accumulated construction ledger must survive ordinary recovery,
  // not only the short observation-only verification pause exercised above.
  await port.command('/silent-command game.speed=1;rcon.print("control recovery at normal speed")');
  control = await life.pause(await life.inspect());
  const ledgerBytes = Buffer.byteLength(JSON.stringify(control.ledger));
  assert(ledgerBytes > 65536, 'Recovery regression must exceed the old RPC limit');
  control = await life.reconcile(control); control = await life.arm(control);
  const resumedAt = control.tick;
  for (let i = 0; i < 20; i++) { control = await life.heartbeat(control); assert(control.armed && !control.paused); await delay(100); }
  assert(control.tick > resumedAt); control = await life.pause(control); barrier(control);
  await writeFile(path.join(evidence, 'large-ledger-recovery.json'), JSON.stringify({ passed: true, ledgerBytes, resumedAt, heldAt: control.tick }));
} catch (error) { failure = String(error); process.exitCode = 1; await writeFile(path.join(evidence, 'failure.txt'), failure); console.error(failure.slice(0, 1200)); }
finally {
  let held = false;
  try { control = await life.inspect(); if (control.armed || !control.paused) control = await life.pause(control); barrier(control); held = true; } catch { failure ??= 'Cleanup hold unconfirmed'; process.exitCode = 1; }
  port.close(); await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed: failure === null, checks, failure, modelInference: false, cleanup: { held, tick: control?.tick ?? null } }, null, 2));
  console.log(JSON.stringify({ evidence, checks: checks.length, failure: failure?.slice(0, 300) }));
}
