import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProductionPlanPage, ProductionPlanSummary, ProductionSearchResult } from '@autofactorio/contracts';
import { LiveWorkshopGame, LiveWorkshopHost } from '../apps/runtime/workshop-live-host.js';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { Coordinator } from '../packages/core/orchestration/coordinator.js';
import { team } from '../packages/core/orchestration/roles.js';
import { CoordinationGateway } from '../packages/tools/src/coordination.js';
import { CoordinationMcp } from '../packages/tools/src/coordination-mcp.js';
import { PROBE_CAPS } from '../packages/codex/src/budget.js';
import type { WorkshopSessionState } from '../packages/core/workshop/orchestrator.js';
import { blueprintContentHash } from '../packages/core/workshop/blueprint.js';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import { WorkshopControl } from '../packages/factorio/src/workshop.js';
import { referenceBlueprint, referenceCase, referenceRequest } from './dev/production-chain-reference.js';
import { runOilControls } from './dev/production-chain-oil-controls.js';
import { createProfile, identifyObserver, listProjectProcesses, startObserver, startServer, stopProfile, waitFor, waitForServer } from './dev/game-processes.js';

const args = process.argv.slice(2), oilControls = args[1] === 'refining-controls';
const selected = referenceCase(oilControls ? [args[0]!, 'refining-cracking', ...args.slice(2)] : args);
const character = selected === 'sulfur-character';
// A direct headless reference does not need to touch an existing client. A
// character reference fails closed if Steam's one graphical instance is occupied.
if (character) {
  const graphical = spawnSync('powershell.exe', ['-NoProfile', '-Command', '@(Get-CimInstance Win32_Process -Filter "Name=\'factorio.exe\'" | Where-Object { $_.CommandLine -notmatch "--(start-server|create|benchmark|version)" }).Count'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (graphical.status !== 0 || graphical.stdout.trim() !== '0') throw new Error('Graphical Factorio is occupied or inventory unavailable; no client started');
}
await listProjectProcesses();
const profile = await createProfile(false, !character, { port: 27039, gamePort: 34219 });
const evidence = await mkdtemp(path.join(profile.dir, 'production-chain-'));
let port: Awaited<ReturnType<typeof waitForServer>> | undefined, runtime: DurableRuntime | undefined;
let observer = false, cleanup = false, failure: string | null = null;
const events: unknown[] = [], checks: string[] = [];
const save = async (name: string, value: unknown) => writeFile(path.join(evidence, name), JSON.stringify(value, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ selected, evidence, profile: profile.config }));
try {
  await startServer(profile); port = await waitForServer(profile);
  await port.command('/silent-command rcon.print("production-chain-ready")');
  assert.match(await port.command('/silent-command rcon.print("production-chain-ready")'), /production-chain-ready/);
  // Dedicated scenario setup only: research/power/equipment are the declared
  // supplied boundary. No production item/fluid is inserted into the candidate.
  assert.match(await port.command('/silent-command for _,t in pairs(game.forces.player.technologies) do t.researched=true end for _,r in pairs(game.forces.player.recipes) do r.productivity_bonus=0 end rcon.print("reference-research-ready")'), /reference-research-ready/);
  if (character) { await startObserver(profile); observer = true; await identifyObserver(profile); }
  const client = new GameClient(port, event => events.push(event)), lifecycle = new Lifecycle(port, client, event => events.push(event));
  if (character) await waitFor('reference builder', async () => {
    const world = await client.request({ op: 'observe', surface: 'nauvis', area: [{ x: -32, y: -32 }, { x: 32, y: 32 }], offset: 0, limit: 50 });
    return (world.actors as Record<string, { connected?: boolean }>)['builder-1']?.connected ? true : undefined;
  }, 120000, 200);
  const control = new WorkshopControl(port), context = await control.installedChainProfile('production-chain');
  const request = referenceRequest(context, selected);
  await port.command('/autofactorio {"op":"identity"}');
  await port.command('/autofactorio {"op":"authorize","epoch":"initial","session":"probe"}');
  runtime = new DurableRuntime(path.join(evidence, 'runtime'), path.basename(evidence), 'initial', client, lifecycle, [profile.password]);
  const coordinator = new Coordinator(runtime, { ...PROBE_CAPS, tools: 40, turns: 5, turnMs: 600000, runMs: 600000 });
  team().forEach(agent => coordinator.register(agent));
  const mcp = new CoordinationMcp(coordinator, new CoordinationGateway(coordinator));
  const turn = coordinator.budget.admit('foreman'), binding = coordinator.bind('foreman', 'physical-reference', turn.id, async () => {});
  const token = mcp.issue('foreman'); mcp.bind(token, binding);
  const discovery = await mcp.call(token, 'production_search', { query: request.target.name, product: `${request.target.kind}:${request.target.name}` }) as ProductionSearchResult;
  const deliveredRequest = { ...request, facts: discovery.facts };
  const summary = await mcp.call(token, 'production_plan', { request: deliveredRequest }) as ProductionPlanSummary;
  assert.equal(summary.status, 'feasible', JSON.stringify(summary.blockers)); assert(summary.executable);
  const plan = await mcp.call(token, 'production_inspect', { id: summary.id, revision: summary.revision }) as ProductionPlanPage;
  assert.equal(plan.stages.length, 2); assert.equal(plan.next, null);
  await save('tool-delivery.json', { discovery, request: deliveredRequest, summary, plan });
  coordinator.budget.finish(turn.id); mcp.revoke(token);
  checks.push('Installed-data production_search/plan/inspect delivered a feasible complete reference through authenticated MCP');
  const host = new LiveWorkshopHost(evidence, { async invoke() { throw new Error('Reference probe prohibits inference'); }, async close() {} },
    new LiveWorkshopGame(port, client, lifecycle, activity => events.push(activity)));
  const id = `physical-${selected}`, model = { provider: 'openai', modelId: 'gpt-6-astra', reasoningEffort: 'low' };
  const setup = { schema: 1, id, revision: 1, comparisonSeries: id, objective: `Physical ${selected} deterministic reference`,
    source: { kind: 'brief', id: null }, profileId: context.profile.id, productionMode: 'chain', chainRequest: request,
    construction: character ? 'character' : 'direct', libraryAccess: false, improveRevision: null,
    requestedSpeed: { numerator: '10', denominator: '1' }, settlingTicks: 18000, windowTicks: 3600, windows: 5,
    rubric: { version: 'rubric-1', weights: { throughput: { numerator: '1', denominator: '1' } }, materiality: { throughput: { numerator: '0', denominator: '1' } }, directions: { throughput: 'maximize' } },
    iterations: { attempts: 1, mode: 'exact', earlyStop: false, plateauRounds: 1 },
    checkpoints: { brief: false, afterScore: false, libraryAdmission: false, learningActivation: false, timeoutMs: 1000, timeoutAction: 'finish' },
    budgets: { wallMs: 600000, gameTicks: 100000, turns: 3, toolCalls: 8, reportedTokens: 1000, learningReservedTurns: 0, learningReservedTools: 0 },
    models: { sessionDefault: model, overrides: {} }, learning: { cadence: 'off', batchSessions: 2, candidateCap: 2, attemptsPerCandidate: 1, autoActivate: false } };
  const assignment = await host.resolve(setup);
  const connectors = JSON.parse(await port.command('/silent-command rcon.print(helpers.table_to_json(defines.wire_connector_id))')) as { pole_copper: number };
  assert(Number.isSafeInteger(connectors.pole_copper));
  const document = referenceBlueprint(assignment, selected, connectors.pole_copper), artifactHash = blueprintContentHash(document);
  const directory = path.join(evidence, 'workshop-live', id);
  await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, `${artifactHash}.json`), JSON.stringify(document), { flag: 'wx' });
  await save('reference.json', { assignment, document, artifactHash });
  const session = { id, assignment, activeIteration: 1, pinnedBundleHash: 'baseline' } as WorkshopSessionState;
  const candidate = { sessionId: id, iteration: 1, artifactHash, assignmentRevision: 1, bundleHash: 'baseline', evidence: ['deterministic-reference:no-inference'] };
  await host.build(session, candidate);
  const inspection = await control.inspect(`${id}-1`);
  assert.deepEqual(Object.values(inspection.fixtures as Record<string, { kind: string; product: { name: string } }>).filter(f => f.kind === 'source').map(f => f.product.name).sort(), ['crude-oil', 'water']);
  await save('built-inspection.json', inspection);
  // Give a fully connected candidate real construction-time ticks. The host's
  // declared supplies must remain empty until the preload check admits settling.
  const built = JSON.parse(await readFile(path.join(directory, `${artifactHash}.built.json`), 'utf8')) as { surface: string };
  const startTick = JSON.parse(await port.command('/silent-command game.speed=1;game.tick_paused=false;rcon.print(game.tick)')) as number;
  await waitFor('unfed reference build', async () => (await lifecycle.inspect()).tick >= startTick + 120 ? true : undefined, 10000, 100);
  const opening = JSON.parse(await port.command(`/silent-command game.tick_paused=true;local out={tick=game.tick,fluid=0,crafts=0,progress=0};for _,e in pairs(game.surfaces[${JSON.stringify(built.surface)}].find_entities()) do if e.type=='assembling-machine' then out.crafts=out.crafts+e.products_finished;out.progress=out.progress+e.crafting_progress end;if e.type=='pipe' or e.type=='pipe-to-ground' or e.type=='storage-tank' or e.type=='assembling-machine' then for i=1,#e.fluidbox do local f=e.fluidbox[i];out.fluid=out.fluid+(f and f.amount or 0) end end end;rcon.print(helpers.table_to_json(out))`)) as { tick: number; fluid: number; crafts: number; progress: number };
  await save('before-admission.json', opening);
  assert.equal(opening.fluid, 0); assert.equal(opening.crafts, 0); assert.equal(opening.progress, 0);
  checks.push('Connected build stays empty and unoperated during real ticks until measurement admits declared feeds');
  const evaluation = await host.measure(session, candidate);
  await save('evaluation.json', evaluation);
  const samples = (await readFile(path.join(directory, 'iteration-1.measurements.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { startTick: number; endTick: number });
  assert.equal(samples.length, 5);
  samples.forEach((sample, index) => { assert.equal(sample.endTick - sample.startTick, 3600); if (index) assert.equal(sample.startTick, samples[index - 1]!.endTick); });
  assert.equal(evaluation.valid, true, JSON.stringify(evaluation.reasons));
  assert.equal(evaluation.passed, true, JSON.stringify(evaluation.reasons));
  checks.push('Physical pipe/belt reference passes five consecutive 60-game-second fresh production/delivery and upstream stage windows');
  if (oilControls) checks.push(...await runOilControls({ host, control, port, evidence, setup, copperConnector: connectors.pole_copper }));
} catch (error) { failure = String(error); process.exitCode = 1; console.error(failure.slice(0, 1800)); }
finally {
  runtime?.close(); port?.close();
  try {
    if (observer) await stopProfile(profile.observerConfig);
    await stopProfile(profile.config);
    cleanup = !(await listProjectProcesses()).some(p => [profile.config, profile.observerConfig].includes(p.config));
  } catch (error) { failure ??= String(error); process.exitCode = 1; }
  if (!cleanup) { failure ??= 'Owned profile cleanup unresolved'; process.exitCode = 1; }
  await save('events.json', events);
  await save('result.json', { selected: oilControls ? 'refining-controls' : selected, passed: failure === null, checks, failure, cleanup, modelInference: false,
    acceptance: 'Deterministic reference only; full ordinary-gameplay/mode/negative/recovery S5 matrix remains separately required' });
  console.log(JSON.stringify({ selected, evidence, checks: checks.length, failure, cleanup }));
}
