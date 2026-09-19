import assert from 'node:assert/strict';
import { diagnosticAssignment } from '@autofactorio/contracts';
import { appendFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { GameClient } from '../packages/factorio/src/client.js';
import { barrier, captureCheckpoint, Lifecycle, prepareManagedLoad, validateCheckpoint, verifyLoaded } from '../packages/factorio/src/lifecycle.js';
import { executeReference } from './dev/first-shift-reference.js';
import { currentModHash, prepareFirstShift } from './dev/first-shift-session.js';
import { configureProfile, readProfile, startServer, stopProfile, waitFor, waitForServer } from './dev/game-processes.js';
import { calibrationRateTolerance } from './operational-calibration.js';

const value = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const selected = value('--scenario') ?? '01-first-shift';
if (selected !== '01-first-shift' && selected !== '02-some-assembly-required') throw new Error('Select --scenario 01-first-shift or 02-some-assembly-required');
const prepared = await prepareFirstShift('team', undefined, selected); const { run, profile, port, game, life } = prepared;
const gameArea = (run.manifest.area as unknown as ([number, number] | { x: number; y: number })[]).map(position => Array.isArray(position) ? { x: position[0], y: position[1] } : position) as [{ x: number; y: number }, { x: number; y: number }];
const evidence = await mkdtemp(path.join(run.directory, 'operational-probe-')); const checks: string[] = []; let failure: string | null = null; let held = false; let activeProfile = profile;
const sink = (event: unknown) => appendFileSync(path.join(evidence, 'events.jsonl'), JSON.stringify(event) + '\n');
const pass = (message: string) => { checks.push(message); console.log(message); };
type Reading = { kind: string; name: string; quality: string; total: number | null; coverage: string; reason?: string; method: string };
type Sample = { tick: number; epoch: string; membershipHash: string; readings: Reading[] };
type DirectCounters = { tick: number; recipes: Record<string, { finished: number; machines: number }>; injected: Record<string, number>; collected: number; rates: Record<string, number>; assemblerSpeed: number; stock: Record<string, number> };
type Calibration = { toleranceBasis: string; sampleIntervalTicks: number; engineIntervalTicks: number; comparisons: { metric: string; item: string; expectedQuantity: number; observedQuantity: number; quantityTolerance: number; expectedRate: number; observedRate: number; rateTolerance: number }[] };
const find = (sample: Sample, kind: string, name: string) => sample.readings.find(r => r.kind === kind && r.name === name);
const deltaOf = (a: Sample, b: Sample, kind: string, name: string) => (find(b, kind, name)?.total ?? 0) - (find(a, kind, name)?.total ?? 0);
let control = await life.inspect(); let lastTick = -1; let calibration: Calibration | null = null;
async function readSamples(client = game) {
  const response = await client.request({ op: 'operational-read', scopeId: 'scenario-main', scopeRevision: 1, afterTick: lastTick });
  const rawSamples = response.samples; const samples = (Array.isArray(rawSamples) ? rawSamples : rawSamples && Object.keys(rawSamples).length === 0 ? [] : null) as Sample[] | null;
  if (!samples) throw new Error('Invalid operational sample page');
  if (samples.length) lastTick = samples.at(-1)!.tick; return { tick: Number(response.tick), samples };
}
async function observeAll(client: GameClient) {
  const entities: Record<string, unknown>[] = []; let next = 0; let first: Record<string, unknown> | null = null;
  do {
    const response = await client.request({ op: 'observe', surface: 'nauvis', area: gameArea, offset: next, limit: 50 });
    first ??= response; entities.push(...(response.entities as Record<string, unknown>[])); next = response.nextOffset === undefined || response.nextOffset === null ? -1 : Number(response.nextOffset);
  } while (next >= 0);
  return { ...first!, entities, total: entities.length, nextOffset: null, truncated: false };
}
async function advance(ticks: number, currentLife = life) {
  const target = (await currentLife.inspect()).tick + ticks;
  await waitFor(`advance ${ticks} ticks`, async () => { control = await currentLife.heartbeat(control); return control.tick >= target ? true : undefined; }, 120_000, 100);
}
async function independentCounters(): Promise<DirectCounters> {
  const payload = JSON.stringify({ op: 'operational-raw-counters', area: gameArea }).replaceAll('\\', '\\\\').replaceAll("'", "\\'");
  const raw = await port.command(`/silent-command rcon.print(remote.call('autofactorio_operator_v1','rpc','${payload}'))`); const decoded = JSON.parse(raw) as DirectCounters & { ok?: boolean; error?: string };
  if (decoded.ok === false) throw new Error(`Independent counter query failed: ${decoded.error}`); return decoded;
}
function calibrateSampler(baseline: Sample, end: Sample, before: DirectCounters, after: DirectCounters): Calibration {
  const sampleSeconds = (end.tick - baseline.tick) / 60; const engineSeconds = (after.tick - before.tick) / 60; assert(sampleSeconds > 0 && engineSeconds > 0);
  const comparisons: Calibration['comparisons'] = [];
  const add = (metric: string, item: string, expectedQuantity: number, observedQuantity: number, capacityPerSecond: number) => {
    const quantityTolerance = Math.ceil(capacityPerSecond * 2 + 1); // Both endpoints may be one 60-tick cadence from a direct read.
    const expectedRate = expectedQuantity / engineSeconds; const observedRate = observedQuantity / sampleSeconds;
    const rateTolerance = calibrationRateTolerance(quantityTolerance, expectedQuantity, sampleSeconds, engineSeconds);
    assert(Math.abs(observedQuantity - expectedQuantity) <= quantityTolerance, `${metric}/${item} quantity outside calibration tolerance`);
    assert(Math.abs(observedRate - expectedRate) <= rateTolerance + Number.EPSILON, `${metric}/${item} rate outside calibration tolerance`);
    comparisons.push({ metric, item, expectedQuantity, observedQuantity, quantityTolerance, expectedRate, observedRate, rateTolerance });
  };
  const directDelta = (recipe: string) => (after.recipes[recipe]?.finished ?? 0) - (before.recipes[recipe]?.finished ?? 0);
  const manifest = run.manifest as unknown as { recipe: { energy: number }; gearRecipe?: { energy: number } };
  const capacity = (recipe: string) => Math.max(before.recipes[recipe]?.machines ?? 0, after.recipes[recipe]?.machines ?? 0) * Math.max(before.assemblerSpeed, after.assemblerSpeed) / (recipe === 'automation-science-pack' ? manifest.recipe.energy : manifest.gearRecipe?.energy ?? 1);
  const science = directDelta('automation-science-pack'); const scienceCapacity = capacity('automation-science-pack');
  add('production', 'automation-science-pack', science, deltaOf(baseline, end, 'production', 'automation-science-pack'), scienceCapacity);
  add('consumption', 'iron-gear-wheel', science, deltaOf(baseline, end, 'consumption', 'iron-gear-wheel'), scienceCapacity);
  add('consumption', 'copper-plate', science, deltaOf(baseline, end, 'consumption', 'copper-plate'), scienceCapacity);
  if (selected === '02-some-assembly-required') {
    const gear = directDelta('iron-gear-wheel'); add('consumption', 'iron-plate', gear * 2, deltaOf(baseline, end, 'consumption', 'iron-plate'), capacity('iron-gear-wheel') * 2);
  }
  for (const item of Object.keys(after.injected)) add('boundary-delivery', item, (after.injected[item] ?? 0) - (before.injected[item] ?? 0), deltaOf(baseline, end, 'boundary-delivery', item), (after.rates[item] ?? 0) / 60);
  add('boundary-delivery', 'automation-science-pack', after.collected - before.collected, deltaOf(baseline, end, 'boundary-delivery', 'automation-science-pack'), scienceCapacity);
  const stockCapacity = (item: string) => {
    if (item === 'automation-science-pack') return scienceCapacity * 2;
    if (item === 'iron-gear-wheel') return (after.rates[item] ?? 0) / 60 + capacity('iron-gear-wheel') + scienceCapacity;
    if (item === 'copper-plate') return (after.rates[item] ?? 0) / 60 + scienceCapacity;
    if (item === 'iron-plate') return (after.rates[item] ?? 0) / 60 + capacity('iron-gear-wheel') * 2;
    return 0;
  };
  const sampleStockKeys = [...baseline.readings, ...end.readings].filter(r => r.kind === 'stock').map(r => `${r.name}/${r.quality}`);
  const stockKeys = new Set([...Object.keys(before.stock), ...Object.keys(after.stock), ...sampleStockKeys]);
  for (const key of stockKeys) {
    const split = key.lastIndexOf('/'); assert(split > 0, `Invalid raw stock identity ${key}`); const item = key.slice(0, split); const quality = key.slice(split + 1);
    const first = baseline.readings.find(r => r.kind === 'stock' && r.name === item && r.quality === quality);
    const last = end.readings.find(r => r.kind === 'stock' && r.name === item && r.quality === quality);
    assert(first?.coverage === 'complete' && first.total !== null, `Missing complete baseline stock reading for ${key}`); assert(last?.coverage === 'complete' && last.total !== null, `Missing complete ending stock reading for ${key}`);
    add('stock', `${item}/${quality}`, (after.stock[key] ?? 0) - (before.stock[key] ?? 0), last.total - first.total, stockCapacity(item));
  }
  return { toleranceBasis: 'At most two 60-tick endpoint offsets; quantity tolerance is ceil(max direct capacity per second * 2 seconds + 1), with the corresponding interval-normalized rate tolerance.', sampleIntervalTicks: end.tick - baseline.tick, engineIntervalTicks: after.tick - before.tick, comparisons };
}
console.log(JSON.stringify({ evidence, scenario: selected }));
try {
  // Four-times speed stays below the heartbeat gap observed when full-scope samples run at 8x.
  control = await life.reconcile(control, [diagnosticAssignment(control.generation + 1, selected === '02-some-assembly-required' ? 40 : 32)]); control = await life.arm(control); await port.command('/silent-command game.speed=4;rcon.print("operational probe speed 4")'); control = await life.inspect();
  control = await executeReference({ game, life, control, manifest: run.manifest, progress: () => {} }); await advance(3_600); pass('Legal character reference built and warmed without model inference');
  await game.request({ op: 'operational-register', scope: { schema: 1, id: 'scenario-main', revision: 1, task: 'operational-probe', surface: 'nauvis', area: gameArea, entityLimit: 5_000 }, sampleTicks: 60, historySamples: 120 });
  const baseline = (await readSamples()).samples.at(-1)!; const directBaseline = await independentCounters(); await advance(1_200); const healthy = (await readSamples()).samples; const end = healthy.at(-1)!; const directEnd = await independentCounters();
  assert(end && baseline && end.epoch === baseline.epoch); assert(deltaOf(baseline, end, 'production', 'automation-science-pack') > 0); assert(deltaOf(baseline, end, 'boundary-delivery', 'automation-science-pack') > 0);
  for (const item of selected === '02-some-assembly-required' ? ['iron-plate', 'copper-plate'] : ['iron-gear-wheel', 'copper-plate']) assert(deltaOf(baseline, end, 'boundary-delivery', item) > 0);
  assert(end.readings.some(r => r.kind === 'consumption' && r.total !== null)); assert(end.readings.some(r => r.kind === 'stock' && r.total !== null));
  const stable = healthy.some((sample, index) => index > 0 && deltaOf(healthy[index - 1]!, sample, 'production', 'automation-science-pack') > 0 && deltaOf(healthy[index - 1]!, sample, 'stock', 'automation-science-pack') === 0);
  assert(stable, 'Expected at least one stable-stock interval with nonzero production'); pass('Healthy scope established terminal intake, assembler production/recipe consumption, collector delivery and stable-stock flow');
  calibration = calibrateSampler(baseline, end, directBaseline, directEnd); pass('Independent engine counters calibrate supported quantities and rates within the declared two-cadence tolerance');

  const recipeCleared = await port.command('/silent-command for _,e in pairs(game.surfaces.nauvis.find_entities_filtered{type="assembling-machine"}) do local r=e.get_recipe();if r and r.name=="automation-science-pack" then e.set_recipe(nil);rcon.print("recipe cleared "..e.unit_number);break end end'); assert.match(recipeCleared, /recipe cleared/); await advance(120);
  const changedRecipe = (await readSamples()).samples.at(-1)!; assert.notEqual(changedRecipe.membershipHash, end.membershipHash);
  const recipeRestored = await port.command('/silent-command for _,e in pairs(game.surfaces.nauvis.find_entities_filtered{type="assembling-machine"}) do if not e.get_recipe() then e.set_recipe("automation-science-pack");break end end;rcon.print("recipe restored")'); assert.match(recipeRestored, /recipe restored/); await advance(120);
  const restoredRecipe = (await readSamples()).samples.at(-1)!; assert.notEqual(restoredRecipe.membershipHash, changedRecipe.membershipHash); pass('Recipe identity changes invalidate only the affected scope baseline');

  // Stop all installed inserters and clear machine inputs without changing scope membership.
  const starvationSetup = await port.command('/silent-command for _,e in pairs(game.surfaces.nauvis.find_entities_filtered{type="inserter"}) do e.active=false end;for _,e in pairs(game.surfaces.nauvis.find_entities_filtered{type="assembling-machine"}) do e.get_inventory(defines.inventory.assembling_machine_input).clear() end;rcon.print("machines starved")'); assert.match(starvationSetup, /machines starved/);
  await advance(1_200); const starved = (await readSamples()).samples; const starvationEnd = starved.at(-1)!; const starvationStart = starved[0]!;
  const primary = selected === '02-some-assembly-required' ? 'iron-plate' : 'iron-gear-wheel'; const configuredDuringStarvation = deltaOf(starvationStart, starvationEnd, 'configured-supply', primary); const producedDuringStarvation = deltaOf(starvationStart, starvationEnd, 'production', 'automation-science-pack'); assert(configuredDuringStarvation > 0); assert(configuredDuringStarvation > producedDuringStarvation); pass('Starvation separates configured supply from measured production and consumption');

  await port.command('/silent-command for _,e in pairs(game.surfaces.nauvis.find_entities_filtered{type="assembling-machine"}) do local inv=e.get_inventory(defines.inventory.assembling_machine_output);if inv and e.get_recipe() and e.get_recipe().name=="automation-science-pack" then inv.insert{name="automation-science-pack",count=100,quality="normal"} end end;rcon.print("outputs blocked")'); await advance(120);
  const blocked = await game.request({ op: 'observe', surface: 'nauvis', area: gameArea, offset: 0, limit: 50 }); const machines = (blocked.entities as Record<string, unknown>[]).filter(e => e.type === 'assembling-machine'); assert(machines.some(e => String(e.status) !== '1' && e.recipe === 'automation-science-pack')); pass('Machine inspection exposes output blockage symptoms without assigning a root cause');

  await port.command('/silent-command for _,e in pairs(game.surfaces.nauvis.find_entities_filtered{name="electric-energy-interface"}) do e.power_production=0;e.electric_buffer_size=1;e.energy=0 end;rcon.print("power removed")'); await advance(120);
  const powerless = await game.request({ op: 'observe', surface: 'nauvis', area: gameArea, offset: 0, limit: 50 }); assert((powerless.entities as Record<string, unknown>[]).filter(e => e.type === 'assembling-machine').some(e => Number(e.power ?? 0) === 0)); pass('Machine inspection exposes lost-power symptoms');

  control = await life.pause(await life.inspect()); barrier(control); const paused = await readSamples(); await delay(300); const pausedAgain = await readSamples(); assert.equal(pausedAgain.tick, paused.tick); assert.equal(pausedAgain.samples.length, 0); pass('Pause produces no elapsed-game-time operational samples');
  const modHash = await currentModHash(); const checkpointPath = await captureCheckpoint({ lifecycle: life, paused: control, saveDirectory: path.join(profile.dir, 'data/saves'), outputDirectory: path.join(evidence, 'checkpoint'), logFile: profile.log, eventCursor: () => 0, world: () => observeAll(game), modHash }); const checkpoint = await validateCheckpoint(checkpointPath, modHash);
  port.close(); await stopProfile(profile.observerConfig); await stopProfile(profile.config);
  const load = path.join(evidence, 'load'); await prepareManagedLoad(checkpointPath, modHash, load); const restoredDir = path.join(evidence, 'restored-game'); await mkdir(restoredDir); activeProfile = await configureProfile(restoredDir, path.join(load, checkpoint.save), { port: profile.port, gamePort: profile.gamePort, source: profile });
  await startServer(activeProfile); const restoredPort = await waitForServer(activeProfile); const restoredGame = new GameClient(restoredPort, sink); const restoredLife = new Lifecycle(restoredPort, restoredGame, sink); const loaded = await restoredLife.inspect(); verifyLoaded(checkpoint, loaded, await observeAll(restoredGame), true);
  control = await restoredLife.reconcile(loaded); const restored = await restoredGame.request({ op: 'operational-read', scopeId: 'scenario-main', scopeRevision: 1, afterTick: -1 }); const restoredSamples = restored.samples as Sample[]; assert(restoredSamples.length > 0); assert(restoredSamples.every(s => s.epoch !== control.epoch));
  control = await restoredLife.arm(control); await advance(120, restoredLife); const afterRestore = await restoredGame.request({ op: 'operational-read', scopeId: 'scenario-main', scopeRevision: 1, afterTick: restoredSamples.at(-1)!.tick }); assert((afterRestore.samples as Sample[]).some(s => s.epoch === control.epoch));
  control = await restoredLife.pause(control); barrier(control); restoredGame.close(); pass('Managed save/load retains bounded history and starts a new epoch baseline before reconstruction');
  await writeFile(path.join(evidence, 'samples.json'), JSON.stringify({ baseline, healthy, directBaseline, directEnd, calibration, starved, restoredSamples, afterRestore }, null, 2));
} catch (error) { failure = String(error); process.exitCode = 1; await writeFile(path.join(evidence, 'failure.txt'), failure); console.error(failure.slice(0, 1200)); }
finally {
  try { const p = await readProfile(activeProfile.dir); const probePort = await waitForServer(p); const probeGame = new GameClient(probePort, sink); const probeLife = new Lifecycle(probePort, probeGame, sink); let state = await probeLife.inspect(); if (state.armed || !state.paused) state = await probeLife.pause(state); barrier(state); held = true; probeGame.close(); } catch { failure ??= 'cleanup hold unconfirmed'; process.exitCode = 1; }
  await stopProfile(activeProfile.observerConfig); await stopProfile(activeProfile.config); await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ schema: 1, scenario: selected, passed: failure === null, checks, failure, modelInference: false, calibration, cleanup: { held } }, null, 2)); console.log(JSON.stringify({ evidence, passed: failure === null, checks: checks.length }));
}
