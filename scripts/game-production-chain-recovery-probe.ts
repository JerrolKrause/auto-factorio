import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Assignment, Batch, Receipt } from '@autofactorio/contracts';
import { prepareChainConstruction } from '../apps/runtime/workshop-chain-construction.js';
import { bindChainStages, chainMeasurementRequirements } from '../apps/runtime/workshop-chain-measurement.js';
import { resolveInstalledWorkshopChain } from '../apps/runtime/workshop-chain-resolution.js';
import { DurableExecution, type EventContext } from '../packages/core/execution/durable.js';
import { billOfMaterials } from '../packages/core/workshop/blueprint.js';
import { constructionBatches } from '../packages/core/workshop/construction.js';
import { evaluateWorkshop } from '../packages/core/workshop/evaluation.js';
import { SqliteJournal } from '../packages/storage/src/journal.js';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle, barrier, captureCheckpoint, prepareManagedLoad, sha256, validateCheckpoint, verifyLoaded, type ControlState } from '../packages/factorio/src/lifecycle.js';
import { wrapper } from '../packages/factorio/src/rcon.js';
import { WorkshopControl } from '../packages/factorio/src/workshop.js';
import { referenceBlueprint, referenceRequest } from './dev/production-chain-reference.js';
import { placementAcknowledgementLoss, recoveryCheckpointWorld, requirePrefixInventory } from './dev/production-chain-recovery.js';
import { configureProfile, createProfile, identifyObserver, listProjectProcesses, startObserver, startServer, stopProfile, waitFor, waitForServer, type GameProfile } from './dev/game-processes.js';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--case' || args[1] !== 'sulfur-recovery') throw new Error('Expected --case sulfur-recovery; dedicated new game only');
const graphical = spawnSync('powershell.exe', ['-NoProfile', '-Command', '@(Get-CimInstance Win32_Process -Filter "Name=\'factorio.exe\'" | Where-Object { $_.CommandLine -notmatch "--(start-server|create|benchmark|version)" }).Count'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
if (graphical.status !== 0 || graphical.stdout.trim() !== '0') throw new Error('Graphical Factorio is occupied or inventory unavailable');
await listProjectProcesses();
const initial = await createProfile(false, false, { port: 27039, gamePort: 34219 });
const evidence = await mkdtemp(path.join(initial.dir, 'production-chain-recovery-'));
const save = (name: string, value: unknown) => writeFile(path.join(evidence, name), JSON.stringify(value, null, 2), { flag: 'wx' });
const sink = (event: unknown) => appendFileSync(path.join(evidence, 'events.jsonl'), JSON.stringify(event) + '\n');
let profile = initial, restored: GameProfile | undefined;
let port: Awaited<ReturnType<typeof waitForServer>> | undefined, journal: SqliteJournal | undefined;
let failure: string | null = null, cleanup = false;
const checks: string[] = [];
console.log(JSON.stringify({ selected: 'sulfur-recovery', evidence, profile: initial.config }));
try {
  await startServer(profile); port = await waitForServer(profile);
  await port.command('/silent-command rcon.print("chain-recovery-ready")');
  assert.match(await port.command('/silent-command rcon.print("chain-recovery-ready")'), /chain-recovery-ready/);
  await startObserver(profile); await identifyObserver(profile);
  let game = new GameClient(port, sink), life = new Lifecycle(port, game, sink), control: ControlState;
  const builder = async () => {
    const world = await game.request({ op: 'observe', surface: 'nauvis', area: [{ x: -48, y: -32 }, { x: 48, y: 32 }], offset: 0, limit: 50 });
    return (world.actors as Record<string, { connected?: boolean }>)['builder-1']?.connected ? true : undefined;
  };
  await waitFor('recovery initial builder', builder, 120000, 200);
  let workshop = new WorkshopControl(port);
  const context = await workshop.installedChainProfile('production-chain');
  const request = referenceRequest(context, 'sulfur-character');
  const id = 'chain-recovery', model = { provider: 'openai', modelId: 'gpt-6-astra', reasoningEffort: 'low' };
  const resolved = resolveInstalledWorkshopChain({ schema: 1, id, revision: 1, comparisonSeries: id, objective: 'Legal sulfur chain acknowledgement loss and managed restore',
    source: { kind: 'brief', id: null }, profileId: context.profile.id, productionMode: 'chain', chainRequest: request,
    construction: 'character', libraryAccess: false, improveRevision: null, requestedSpeed: { numerator: '10', denominator: '1' },
    settlingTicks: 18000, windowTicks: 3600, windows: 5,
    rubric: { version: 'rubric-1', weights: { throughput: { numerator: '1', denominator: '1' } }, materiality: { throughput: { numerator: '0', denominator: '1' } }, directions: { throughput: 'maximize' } },
    iterations: { attempts: 1, mode: 'exact', earlyStop: false, plateauRounds: 1 },
    checkpoints: { brief: false, afterScore: false, libraryAdmission: false, learningActivation: false, timeoutMs: 1000, timeoutAction: 'finish' },
    budgets: { wallMs: 600000, gameTicks: 100000, turns: 3, toolCalls: 8, reportedTokens: 1000, learningReservedTurns: 0, learningReservedTools: 0 },
    models: { sessionDefault: model, overrides: {} }, learning: { cadence: 'off', batchSessions: 2, candidateCap: 2, attemptsPerCandidate: 1, autoActivate: false } }, context);
  const connector = Number(await port.command('/silent-command rcon.print(defines.wire_connector_id.pole_copper)'));
  assert(Number.isSafeInteger(connector));
  const document = referenceBlueprint(resolved.assignment, 'sulfur-character', connector);
  const prepared = prepareChainConstruction(resolved.assignment, document, context.profile, context);
  assert(prepared.character);
  const surface = 'af-chain-recovery', worldId = 'chain-recovery-1';
  const setup = await workshop.setup({ id: worldId, surface, force: surface, profile: context.profile,
    area: [{ x: -256, y: -256 }, { x: 256, y: 256 }], maxTiles: 512 * 512,
    fixtures: prepared.fixtures, boundaryFingerprint: prepared.boundaryFingerprint });
  await workshop.enter(worldId, 'builder-1');
  assert.match(await port.command(`/silent-command local p=game.get_player(1);assert(p.surface.name==${JSON.stringify(surface)});p.get_main_inventory().clear();rcon.print('recovery-empty-kit-boundary')`), /recovery-empty-kit-boundary/);
  const kit = billOfMaterials(document);
  const provision = await workshop.provision(worldId, 'builder-1', 'recovery-one-finite-kit', Object.entries(kit).map(([name, count]) => ({ name, count, quality: 'normal' as const })));
  const actorInventory = async () => {
    const actor = await workshop.actor(worldId, 'builder-1');
    // The engine serializes an empty Lua sequence as {}, never a populated map.
    if (!Array.isArray(actor.inventory)) { assert.deepEqual(actor.inventory, {}); return {}; }
    return Object.fromEntries((actor.inventory as { name: string; count: number }[]).map(value => [value.name, value.count]));
  };
  assert.deepEqual(await actorInventory(), kit);
  control = await life.pause(await life.inspect());
  const grant = (generation: number): Assignment => ({ id: 'chain-recovery-build', owner: 'workshop-runtime', task: 'workshop-build', revision: 1, actor: 'builder-1',
    resources: [{ grant: { id: 'recovery-area', generation }, resource: { kind: 'area', surface, bounds: [{ x: -256, y: -256 }, { x: 256, y: 256 }] } },
      { grant: { id: 'recovery-items', generation }, resource: { kind: 'items', actor: 'builder-1' } },
      { grant: { id: 'recovery-actor', generation }, resource: { kind: 'actor', actor: 'builder-1' } }] });
  let assignment = grant(control.generation + 1);
  control = await life.reconcile(control, [assignment]); control = await life.arm(control);
  const batches = constructionBatches(prepared.character, { commandPrefix: 'lost-placement', epoch: control.epoch, session: control.session,
    task: assignment.task, revision: 1, actor: 'builder-1', surface, grants: assignment.resources.map(value => value.grant), deadline: control.tick + 30000 });
  const original = batches[0]!;
  // The raw client continues real simulation/heartbeats while the caller's
  // placement acknowledgement is withheld. No receipt or world state is forged.
  const rawGame = game, rawLife = life;
  const fault = placementAcknowledgementLoss(port, async batch => {
    await waitFor('native placement prefix', async () => {
      control = await rawLife.heartbeat(control);
      const receipt = await rawGame.receipt(batch.commandId);
      return receipt && batch.steps.slice(0, receipt.completed).some(step => step.kind === 'place') ? receipt : undefined;
    }, 60000, 25);
    control = await rawLife.pause(await rawLife.inspect()); barrier(control);
    const receipt = await rawGame.receipt(batch.commandId); assert(receipt); return receipt;
  });
  const uncertainGame = new GameClient(fault.port, sink);
  const journalFile = path.join(evidence, 'construction.sqlite');
  journal = new SqliteJournal(journalFile);
  let epoch = control.epoch;
  const eventContext = (): EventContext => ({ run: id, epoch, wallTime: new Date().toISOString(), gameTick: null, actor: null, task: null, causation: null, correlation: null, visibility: { kind: 'operator' } });
  const executionPort = () => ({ inspect: () => life.inspect(), submit: async (batch: Batch) => {
    const response = await game.request({ op: 'submit', batch }); return response.receipt as Receipt;
  } });
  game = uncertainGame;
  let execution = new DurableExecution(journal, eventContext, executionPort());
  await execution.reconcile(); execution.intent(original);
  await assert.rejects(execution.dispatch(original.commandId), /placement acknowledgement lost after native effects/);
  assert.equal(fault.state.forwards, 1); assert.equal(fault.state.losses, 1);
  assert.equal(execution.pending()[0]!.state, 'unknown'); assert(game.unresolved.has(original.commandId));
  assert.throws(() => execution.intent({ ...original, commandId: 'forbidden-conflict' }), /Unresolved effects/);
  await assert.rejects(game.request({ op: 'submit', batch: { ...original, commandId: 'forbidden-conflict' } }), /Unknown outcome/);
  await assert.rejects(new Lifecycle(fault.port, game, sink).arm(control), /Unknown game outcomes/);
  await execution.reconcile();
  const heldReceipt = await game.receipt(original.commandId); assert(heldReceipt);
  assert.equal(heldReceipt.status, 'suspended');
  requirePrefixInventory(original, heldReceipt, kit, await actorInventory());
  const cancelled = (await game.request({ op: 'cancel', commandId: original.commandId, epoch: control.epoch, session: control.session })).receipt as Receipt;
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.completed, heldReceipt.completed);
  requirePrefixInventory(original, cancelled, kit, await actorInventory());
  await execution.reconcile();
  const prefixInspection = await workshop.inspect(worldId);
  assert(Array.isArray(prefixInspection.entities) && prefixInspection.entities.length > 0);
  await save('lost-placement.json', { original, fault: fault.state, heldReceipt, cancelled, provision, prefixInspection, inventory: await actorInventory(), commands: execution.pending() });
  checks.push('Genuine legal placement effects survive lost acknowledgement; durable/client/arm fences deny conflicts; receipt-backed cancel preserves exact completed-prefix debit');
  const observe = async (allowDisconnected = false) => {
    // Public observe is Nauvis-only but reports the actual actors on every
    // surface. Read candidate entities through their existing workshop owner;
    // neither route grants gameplay observation authority over new surfaces.
    const world = await game.request({ op: 'observe', surface: 'nauvis', area: [{ x: -48, y: -32 }, { x: 48, y: 32 }], offset: 0, limit: 50 });
    const candidate = await workshop.inspect(worldId);
    return recoveryCheckpointWorld(world, candidate.entities, surface, allowDisconnected);
  };
  const modFiles = (await readdir('mods/autofactorio')).filter(name => name.endsWith('.lua') || name === 'info.json').sort();
  const modHashes = Object.fromEntries(await Promise.all(modFiles.map(async name => [name, sha256(await readFile(path.join(initial.mods, 'autofactorio_0.1.0', name)))])));
  const modHash = sha256(Buffer.from(JSON.stringify(modHashes)));
  control = await life.inspect(); barrier(control);
  const manifestPath = await captureCheckpoint({ lifecycle: life, paused: control, saveDirectory: path.join(initial.dir, 'data/saves'), outputDirectory: path.join(evidence, 'checkpoint'), logFile: initial.log, eventCursor: () => journal!.cursor(), world: observe, modHash });
  const manifest = await validateCheckpoint(manifestPath, modHash);
  await save('checkpoint-proof.json', { manifestPath, modHash, modHashes, manifest });
  journal.close(); journal = undefined; port.close();
  await stopProfile(initial.observerConfig); await stopProfile(initial.config);
  const loadedDirectory = path.join(evidence, 'managed-load');
  await prepareManagedLoad(manifestPath, modHash, loadedDirectory);
  restored = await configureProfile(loadedDirectory, path.join(loadedDirectory, manifest.save), { source: initial, port: 27039, gamePort: 34219 });
  profile = restored;
  await startServer(profile); port = await waitForServer(profile);
  game = new GameClient(port, sink); game.admission = false; life = new Lifecycle(port, game, sink); workshop = new WorkshopControl(port);
  control = await life.inspect(); verifyLoaded(manifest, control, await observe(true), true);
  await startObserver(profile); await identifyObserver(profile);
  await waitFor('restored legal builder', async () => {
    const world = await observe(true); return (world.actors as Record<string, { connected?: boolean }>)['builder-1']?.connected ? true : undefined;
  }, 120000, 200);
  verifyLoaded(manifest, await life.inspect(), await observe());
  requirePrefixInventory(original, cancelled, kit, await actorInventory());
  journal = new SqliteJournal(journalFile); epoch = control.epoch;
  execution = new DurableExecution(journal, eventContext, executionPort());
  execution.checkpointLedger(control);
  assert.equal(execution.pending()[0]!.receipt?.completed, cancelled.completed);
  assignment = grant(control.generation + 1);
  const previousEpoch = control.epoch;
  control = await life.reconcile(control, [assignment]); epoch = control.epoch;
  assert.notEqual(epoch, previousEpoch); execution.checkpointLedger(control);
  const stale = JSON.parse(await port.command(wrapper({ op: 'submit', batch: original })));
  assert.equal(stale.error, 'stale_epoch_or_session');
  control = await life.arm(control); await execution.reconcile();
  const restoredTick = control.tick;
  checks.push('Managed checksum checkpoint loads held with identical prefix/world/inventory; fresh epoch and grants reject saved placement traffic');
  const remaining = { ...prepared.character, steps: [...original.steps.slice(cancelled.completed), ...batches.slice(1).flatMap(batch => batch.steps)] };
  const resumed = constructionBatches(remaining, { commandPrefix: 'restored-suffix', epoch: control.epoch, session: control.session, task: assignment.task, revision: 1,
    actor: 'builder-1', surface, grants: assignment.resources.map(value => value.grant), deadline: control.tick + 30000 });
  const receipts: Receipt[] = [];
  for (const batch of resumed) {
    execution.intent(batch); await execution.dispatch(batch.commandId);
    const receipt = await waitFor('restored suffix receipt', async () => {
      control = await life.heartbeat(control);
      const receipt = await game.receipt(batch.commandId);
      return receipt && !['accepted', 'running'].includes(receipt.status) ? receipt : undefined;
    }, 180000, 25);
    assert.equal(receipt.status, 'completed', JSON.stringify(receipt)); assert.equal(receipt.unexecuted, 0); assert.equal(receipt.completed, batch.steps.length);
    receipts.push(receipt); await execution.reconcile();
    await save(`${batch.commandId}.json`, { batch, receipt });
  }
  control = await life.pause(await life.inspect()); barrier(control);
  assert.deepEqual(await actorInventory(), {});
  const inspection = await workshop.inspect(worldId);
  const entities = inspection.entities as Parameters<typeof bindChainStages>[2];
  assert.equal(entities.length, document.entities.length);
  for (const prefix of prefixInspection.entities as typeof entities) assert(entities.some(entity => entity.unit === prefix.unit && entity.name === prefix.name && entity.position.x === prefix.position.x && entity.position.y === prefix.position.y), 'Restored completed placement must retain its original native unit');
  for (const entity of document.entities) assert.equal(entities.filter(value => value.name === entity.name && value.position.x === entity.position.x && value.position.y === entity.position.y).length, 1);
  await save('restored-construction.json', { document, kit, receipts, cancelled, resumedSteps: remaining.steps.length, inspection, restoredTick, epoch });
  checks.push('Only unexecuted suffix resumed; one native entity per planned position, finite kit fully consumed once, durable prefix unchanged');
  const requirements = chainMeasurementRequirements(resolved.assignment, prepared.resolved.chain);
  const bindings = bindChainStages(prepared.resolved.chain.stages, document, entities), attemptId = 'post-restore-sulfur';
  // Ordinary observations currently select the player force. Use the actual
  // workshop candidate bindings, not an empty ordinary scope, for coverage.
  const measurementControl = await life.inspect(); barrier(measurementControl); assert.equal(measurementControl.epoch, epoch);
  assert.equal((await workshop.measureStatus(worldId, attemptId)).present, false);
  const admission = await workshop.measureConfigure({ id: worldId, generation: Number(setup.generation), attemptId, settlingTicks: 18000, windowTicks: 3600, windows: 5, requestedSpeed: 10,
    ports: resolved.assignment.ports.filter(value => value.direction === 'output' || value.direction === 'byproduct').map(value => ({ id: value.id, fixtureId: value.id, product: { kind: value.product.kind, name: value.product.name, quality: 'normal' as const } })),
    chain: { boundaryFingerprint: prepared.boundaryFingerprint, candidateFingerprint: String(inspection.candidateFingerprint), stages: bindings } });
  assert.equal(admission.attemptId, attemptId); assert(Number.isSafeInteger(admission.admittedTick)); assert(Number(admission.admittedTick) >= restoredTick);
  await save('measurement-admission.json', { restoredTick, epoch, heldTick: measurementControl.tick, bindings, admission });
  const measured = await waitFor('five fresh post-restore windows', async () => {
    const page = await workshop.measureRead(worldId, attemptId, -1); return page.finished ? page : undefined;
  }, 600000, 100);
  assert.equal(measured.state, 'finished'); assert.equal(measured.samples.length, 5);
  assert(measured.samples[0]!.startTick > restoredTick);
  measured.samples.forEach((sample, index) => {
    assert.equal(sample.attemptId, attemptId);
    assert.equal(sample.startTick, Number(admission.admittedTick) + 18000 + index * 3600);
    assert.equal(sample.endTick - sample.startTick, 3600);
    for (const stage of requirements.stages) {
      const actual = sample.stages?.find(value => value.id === stage.id);
      assert(actual && actual.recipe === stage.recipe && actual.machine === stage.machine && actual.coverage === 'complete' && actual.evidence.length > 0);
    }
  });
  const evaluation = evaluateWorkshop(resolved.assignment, measured.samples, requirements.stages, requirements.coProducts);
  await save('post-restore-measurement.json', { restoredTick, epoch, admission, attemptId, requirements, bindings, measured, evaluation });
  assert.equal(evaluation.valid, true, JSON.stringify(evaluation.reasons)); assert.equal(evaluation.passed, true, JSON.stringify(evaluation.reasons));
  checks.push('New post-restore workshop attempt admitted under reconciled epoch passes five contiguous fresh sulfur/upstream windows with complete candidate-stage coverage');
} catch (error) { failure = String(error); process.exitCode = 1; await save('failure.json', { failure, stack: error instanceof Error ? error.stack : null }); console.error(failure.slice(0, 1800)); }
finally {
  journal?.close(); port?.close();
  try {
    for (const owned of [restored, initial]) if (owned) { await stopProfile(owned.observerConfig); await stopProfile(owned.config); }
    cleanup = !(await listProjectProcesses()).some(value => [initial.config, initial.observerConfig, restored?.config, restored?.observerConfig].includes(value.config));
  } catch (error) { failure ??= String(error); process.exitCode = 1; }
  if (!cleanup) { failure ??= 'Owned recovery cleanup unresolved'; process.exitCode = 1; }
  await save('result.json', { selected: 'sulfur-recovery', passed: failure === null, checks, failure, cleanup, modelInference: false, acceptance: 'Deterministic legal-chain recovery only; no autonomous model success' });
  console.log(JSON.stringify({ evidence, checks: checks.length, failure, cleanup }));
}
