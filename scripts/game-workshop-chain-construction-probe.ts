import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BlueprintDocument, ProductionRequest, WorkshopAssignment } from '@autofactorio/contracts';
import { LiveWorkshopGame, LiveWorkshopHost } from '../apps/runtime/workshop-live-host.js';
import type { WorkshopSessionState } from '../packages/core/workshop/orchestrator.js';
import { blueprintContentHash } from '../packages/core/workshop/blueprint.js';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import { WorkshopControl } from '../packages/factorio/src/workshop.js';
import { createProfile, identifyObserver, listProjectProcesses, startObserver, startServer, stopProfile, waitFor, waitForServer } from './dev/game-processes.js';

// A diagnostic reconstruction/fixture check, not a production or scoring trial.
// No caller-selected save, ports, profile, runtime host or provider invocation.
if (process.argv.length > 2) throw new Error('Chain construction probe accepts no arguments');
const graphical = spawnSync('powershell.exe', ['-NoProfile', '-Command', '@(Get-CimInstance Win32_Process -Filter "Name=\'factorio.exe\'" | Where-Object { $_.CommandLine -notmatch "--(start-server|create|benchmark|version)" }).Count'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
if (graphical.status !== 0 || graphical.stdout.trim() !== '0') throw new Error('Graphical Factorio is occupied or its inventory is unavailable; no project client started');
await listProjectProcesses();
const profile = await createProfile(false, false, { port: 27029, gamePort: 34209 });
const evidence = await mkdtemp(path.join(profile.dir, 'chain-construction-'));
let port: Awaited<ReturnType<typeof waitForServer>> | undefined;
let observer = false, cleanup = false, failure: string | null = null;
const checks: string[] = [], events: unknown[] = [];
console.log(JSON.stringify({ evidence, profile: profile.config }));
try {
  await startServer(profile); port = await waitForServer(profile);
  await port.command('/silent-command rcon.print("chain-construction-ready")');
  await port.command('/silent-command rcon.print("chain-construction-ready")');
  await startObserver(profile); observer = true; await identifyObserver(profile);
  const client = new GameClient(port, event => events.push(event));
  const life = new Lifecycle(port, client, event => events.push(event));
  await waitFor('chain construction builder', async () => {
    const world = await client.request({ op: 'observe', surface: 'nauvis', area: [{ x: -32, y: -32 }, { x: 32, y: 32 }], offset: 0, limit: 50 });
    return (world.actors as Record<string, { connected?: boolean }>)['builder-1']?.connected ? true : undefined;
  }, 120000, 200);
  const control = new WorkshopControl(port), context = await control.installedChainProfile('production-chain');
  const product = (kind: 'item' | 'fluid', name: string) => ({ kind, name, quality: 'normal' as const, surface: 'nauvis' });
  const request: ProductionRequest = { schema: 1, target: product('item', 'sulfur'), mode: 'rate', rate: { numerator: '1', denominator: '1', unit: 'items-per-game-second' },
    profile: { id: context.profile.id, revision: context.profile.revision, fingerprint: context.profile.fingerprint, recipes: context.profile.recipes, equipment: context.profile.allowedEquipment },
    facts: { schema: 1, id: `production.${context.snapshot.catalog.fingerprint}`, fingerprint: context.snapshot.catalog.fingerprint, availabilityRevision: context.snapshot.availabilityRevision },
    externalInputs: ['crude-oil', 'water'].map(name => ({ product: product('fluid', name), capacity: { kind: 'rate' as const, numerator: '100', denominator: '1' } })),
    initialStock: [], utilities: { electricityWatts: 2_000_000 }, constructionEquipment: { 'oil-refinery': 2, 'chemical-plant': 1, pipe: 2 },
    sinks: ['heavy-oil', 'light-oil'].map(name => ({ product: product('fluid', name), capacity: { kind: 'rate' as const, numerator: '20', denominator: '1' } })),
    routes: { 'fluid:petroleum-gas': 'recipe:advanced-oil-processing' }, machines: {}, fuels: {} };
  const game = new LiveWorkshopGame(port, client, life, activity => events.push(activity));
  const host = new LiveWorkshopHost(evidence, { async invoke() { throw new Error('No inference permitted'); }, async close() {} }, game);
  const component = await control.installedChainProfile('starter-assembly');
  const componentSetup = await control.setup({ id: 'legacy-component', surface: 'af-legacy-component', force: 'af-legacy-component', profile: component.profile,
    area: [{ x: -256, y: -256 }, { x: 256, y: 256 }], maxTiles: 512 * 512,
    fixtures: [{ id: 'power', kind: 'power', position: { x: 0, y: 14 }, product: { kind: 'item', name: 'electricity', quality: 'normal' }, rate: 0 }] });
  assert.equal(componentSetup.ok, true);
  checks.push('Legacy component setup accepts fixtures without the optional chain identity or bounded-rate fields');
  await writeFile(path.join(evidence, 'component.json'), JSON.stringify(componentSetup, null, 2));
  let directSurface = '', heavySink: { entity: string; position: { x: number; y: number }; rate: number } | undefined;
  let priorAssignment: WorkshopAssignment | undefined;
  for (const construction of ['direct', 'character'] as const) {
    const id = `chain-${construction}`, selected = { provider: 'openai', modelId: 'gpt-6-astra', reasoningEffort: 'low' };
    const assignment = await host.resolve({ schema: 1, id, revision: 1, comparisonSeries: id, objective: 'Reconstruct installed sulfur chain', source: { kind: 'brief', id: null },
      profileId: 'production-chain', productionMode: 'chain', chainRequest: request, construction, libraryAccess: false, improveRevision: null,
      requestedSpeed: { numerator: '1', denominator: '1' }, settlingTicks: 0, windowTicks: 60, windows: 1,
      rubric: { version: 'rubric-1', weights: { throughput: { numerator: '1', denominator: '1' } }, materiality: { throughput: { numerator: '0', denominator: '1' } }, directions: { throughput: 'maximize' } },
      iterations: { attempts: 1, mode: 'exact', earlyStop: false, plateauRounds: 1 }, checkpoints: { brief: false, afterScore: false, libraryAdmission: false, learningActivation: false, timeoutMs: 1000, timeoutAction: 'finish' },
      budgets: { wallMs: 120000, gameTicks: 30000, turns: 3, toolCalls: 8, reportedTokens: 1000, learningReservedTurns: 0, learningReservedTools: 0 },
      models: { sessionDefault: selected, overrides: {} }, learning: { cadence: 'off', batchSessions: 2, candidateCap: 2, attemptsPerCandidate: 1, autoActivate: false } });
    priorAssignment = assignment;
    const document: BlueprintDocument = { schema: 1, label: 'Installed chain configuration', description: 'Disconnected construction diagnostic',
      entities: [{ id: 'refinery', entityNumber: 1, name: 'oil-refinery', position: { x: -8.5, y: 0.5 }, direction: 4, quality: 'normal', recipe: 'advanced-oil-processing' },
        { id: 'refinery-b', entityNumber: 5, name: 'oil-refinery', position: { x: -8.5, y: 9.5 }, direction: 4, quality: 'normal', recipe: 'advanced-oil-processing' },
        { id: 'chemical', entityNumber: 2, name: 'chemical-plant', position: { x: 4.5, y: 0.5 }, direction: 8, quality: 'normal', recipe: 'sulfur' },
        { id: 'pipe-a', entityNumber: 3, name: 'pipe', position: { x: -8.5, y: 4.5 }, direction: 0, quality: 'normal' },
        { id: 'pipe-b', entityNumber: 4, name: 'pipe', position: { x: 4.5, y: 3.5 }, direction: 0, quality: 'normal' }],
      ports: assignment.ports, wires: [], icons: [{ index: 1, name: 'sulfur' }], tiles: [] };
    const artifactHash = blueprintContentHash(document), directory = path.join(evidence, 'workshop-live', id);
    await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, `${artifactHash}.json`), JSON.stringify(document));
    const session = { id, assignment, activeIteration: 1 , pinnedBundleHash: 'baseline' } as WorkshopSessionState;
    const candidate = { sessionId: id, iteration: 1, artifactHash, assignmentRevision: 1, bundleHash: 'baseline', evidence: [] };
    await host.build(session, candidate);
    const inspection = await control.inspect(`${id}-1`), entities = inspection.entities as { name: string; recipe?: string; direction: number }[];
    assert(entities.some(entity => entity.name === 'oil-refinery' && entity.recipe === 'advanced-oil-processing' && entity.direction === 4));
    assert(entities.some(entity => entity.name === 'chemical-plant' && entity.recipe === 'sulfur' && entity.direction === 8));
    const fixtures = inspection.fixtures as Record<string, { kind: string; product: { name: string }; rate: number; bounded: boolean }>;
    if (construction === 'direct') {
      directSurface = (JSON.parse(await readFile(path.join(directory, `${artifactHash}.built.json`), 'utf8')) as { surface: string }).surface;
      heavySink = (inspection.fixtures as Record<string, NonNullable<typeof heavySink>>)['byproduct-fluid-heavy-oil'];
    }
    assert.deepEqual(Object.values(fixtures).filter(fixture => fixture.kind === 'source').map(fixture => fixture.product.name).sort(), ['crude-oil', 'water']);
    assert(Object.values(fixtures).every(fixture => fixture.bounded && Number.isFinite(fixture.rate)));
    if (construction === 'character') {
      const actor = await control.actor(`${id}-1`, 'builder-1');
      assert(!(actor.inventory as { name: string; count: number }[]).some(item => ['oil-refinery', 'chemical-plant', 'pipe'].includes(item.name) && item.count));
      checks.push('Legal character host build preserves both recipes/directions and consumes the exact finite provision');
    } else checks.push('Direct host build preserves both recipes/directions with only declared external fixtures');
    await writeFile(path.join(evidence, `${construction}.json`), JSON.stringify({ assignment, document, inspection }, null, 2));
  }
  const furnaceRequest: ProductionRequest = { ...request, target: product('item', 'iron-plate'),
    externalInputs: [{ product: product('item', 'iron-ore'), capacity: { kind: 'unlimited' } }],
    constructionEquipment: { 'electric-furnace': 2 }, sinks: [], routes: { 'item:iron-plate': 'recipe:iron-plate' } };
  const raw: Record<string, unknown> = { ...priorAssignment, id: 'chain-furnace', comparisonSeries: 'chain-furnace', objective: 'Reconstruct installed iron plate furnace', chainRequest: furnaceRequest, construction: 'character', windowTicks: 60, windows: 1 };
  for (const field of ['ports', 'throughput', 'footprint', 'gameFingerprint', 'profileRevision']) delete raw[field];
  const furnaceAssignment = await host.resolve(raw);
  const furnaceDocument: BlueprintDocument = { schema: 1, label: 'Furnace recipe hint', description: 'Disconnected legal-character furnace regression',
    entities: [{ id: 'furnace', entityNumber: 1, name: 'electric-furnace', position: { x: 0.5, y: 3.5 }, direction: 0, quality: 'normal', recipe: 'iron-plate' },
      { id: 'furnace-b', entityNumber: 2, name: 'electric-furnace', position: { x: 6.5, y: 3.5 }, direction: 0, quality: 'normal', recipe: 'iron-plate' }],
    ports: furnaceAssignment.ports, wires: [], icons: [{ index: 1, name: 'iron-plate' }], tiles: [] };
  const furnaceHash = blueprintContentHash(furnaceDocument), furnaceDirectory = path.join(evidence, 'workshop-live', furnaceAssignment.id);
  await mkdir(furnaceDirectory, { recursive: true }); await writeFile(path.join(furnaceDirectory, `${furnaceHash}.json`), JSON.stringify(furnaceDocument));
  await host.build({ id: furnaceAssignment.id, assignment: furnaceAssignment, activeIteration: 1 , pinnedBundleHash: 'baseline' } as WorkshopSessionState,
    { sessionId: furnaceAssignment.id, iteration: 1, artifactHash: furnaceHash, assignmentRevision: 1, bundleHash: 'baseline', evidence: [] });
  const furnaceInspection = await control.inspect('chain-furnace-1'), furnaceActor = await control.actor('chain-furnace-1', 'builder-1');
  assert.equal((furnaceInspection.entities as { name: string }[]).filter(entity => entity.name === 'electric-furnace').length, 2);
  assert(!(furnaceActor.inventory as { name: string; count: number }[]).some(item => item.name === 'electric-furnace' && item.count));
  checks.push('Legal character furnace recipe hints validate without assembler setter, with exact finite furnace inventory consumed');
  await writeFile(path.join(evidence, 'furnace.json'), JSON.stringify({ assignment: furnaceAssignment, document: furnaceDocument, inspection: furnaceInspection, actor: furnaceActor }, null, 2));
  // Explicit fixture injection is a diagnostic negative control only. It must
  // never be confused with fresh candidate manufacture or evaluator evidence.
  assert(heavySink && directSurface);
  // Console storage is scenario-local, not mod storage. Locate physical fixtures
  // using public inspection and the durable host build receipt instead.
  const fixtureLookup = `local s=game.surfaces[${JSON.stringify(directSurface)}];local e=s.find_entity(${JSON.stringify(heavySink.entity)},{${heavySink.position.x},${heavySink.position.y}});`;
  const rawInjection = await port.command(`/silent-command ${fixtureLookup}e.fluidbox[1]={name="heavy-oil",amount=1000};local power=s.find_entity("electric-energy-interface",{0,14});game.speed=1;game.tick_paused=false;rcon.print(helpers.table_to_json({tick=game.tick,powerPerTick=power.power_production,buffer=power.electric_buffer_size}))`);
  await writeFile(path.join(evidence, 'fixture-injection-response.txt'), rawInjection);
  const injected = JSON.parse(rawInjection) as { tick: number; powerPerTick: number; buffer: number };
  assert(Math.abs(injected.powerPerTick * 60 - request.utilities.electricityWatts!) < 0.001);
  assert(injected.buffer <= request.utilities.electricityWatts! / 60 + 1);
  await waitFor('finite fixture ticks', async () => (await life.inspect()).tick >= injected.tick + 120 ? true : undefined, 30000, 100);
  const sampled = JSON.parse(await port.command(`/silent-command game.tick_paused=true;${fixtureLookup}rcon.print(helpers.table_to_json({tick=game.tick,stock=e.fluidbox[1] and e.fluidbox[1].amount or 0}))`)) as { tick: number; stock: number };
  const elapsedTicks = sampled.tick - injected.tick, removed = 1000 - sampled.stock;
  assert(elapsedTicks >= 120 && elapsedTicks < 1800);
  assert(Math.abs(removed - heavySink.rate * elapsedTicks / 60) < 0.05);
  assert(sampled.stock > 0);
  checks.push('Installed power honors declared watts converted per tick; finite co-product sink matches its declared rate over the observed game-tick interval');
  await writeFile(path.join(evidence, 'fixture-limits.json'), JSON.stringify({ injected, sampled, elapsedTicks, removed, expectedRemoval: heavySink.rate * elapsedTicks / 60 }, null, 2));
  await writeFile(path.join(evidence, 'events.json'), JSON.stringify(events, null, 2));
} catch (error) { failure = String(error); process.exitCode = 1; console.error(failure.slice(0, 1500)); }
finally {
  port?.close();
  try { if (observer) await stopProfile(profile.observerConfig); await stopProfile(profile.config); cleanup = !(await listProjectProcesses()).some(process => [profile.config, profile.observerConfig].includes(process.config)); }
  catch (error) { failure ??= String(error); process.exitCode = 1; }
  if (!cleanup) { failure ??= 'Owned profile cleanup unresolved'; process.exitCode = 1; }
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed: failure === null, checks, failure, cleanup, modelInference: false, productionAcceptance: false }, null, 2));
  console.log(JSON.stringify({ evidence, checks: checks.length, failure, cleanup }));
}
