import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dashboard } from '../apps/runtime/http.js';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { Operator } from '../apps/runtime/operator.js';
import { prepareLiveWorkshopHost } from '../apps/runtime/workshop-live-host.js';
import { reconcileWorkspaceStartup } from '../apps/runtime/workspace-startup.js';
import { Coordinator } from '../packages/core/orchestration/coordinator.js';
import { PROBE_CAPS } from '../packages/codex/src/budget.js';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import { SerialPort } from '../packages/factorio/src/serial-port.js';
import { SqliteJournal } from '../packages/storage/src/journal.js';
import { WorkspaceCatalog } from '../packages/storage/src/workspace-catalog.js';
import { createProfile, listProjectProcesses, startServer, stopProfile, waitFor, waitForServer } from './dev/game-processes.js';
import type { GameProfile } from './dev/game-processes.js';
import { readFreshGame, recordFreshGame } from './dev/fresh-game.js';
import { cleanupAll } from './dev/cleanup.js';

const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const codex = argument('--codex');
if (!process.argv.includes('--live') || !codex || !path.isAbsolute(codex)) throw new Error('Requires --live --codex <absolute managed executable>; this command spends included usage');
if ((await listProjectProcesses()).some(item => item.kind === 'server')) throw new Error('Existing project server must be preserved; run the trial only after its supported shutdown');
await mkdir('.runtime/default-workshop-trial', { recursive: true });
const evidence = await mkdtemp(path.resolve('.runtime/default-workshop-trial/run-'));
process.env.AF_GAME_PROFILE_ROOT = path.join(evidence, 'profiles');
const id = 'default-brief-trial';
// Preserve the user-facing default brief/profile/measurement. Narrow iteration and
// inference budgets explicitly; learning and library mutation are outside this trial.
const input = { schema: 1, id, revision: 1, comparisonSeries: id, objective: 'create 15 green circuits per second',
  source: { kind: 'brief', id: null }, profileId: 'starter-assembly', construction: 'direct', libraryAccess: false, improveRevision: null,
  requestedSpeed: { numerator: '10', denominator: '1' }, settlingTicks: 600, windowTicks: 3600, windows: 5,
  rubric: { version: 'rubric-1', weights: { throughput: { numerator: '1', denominator: '1' } }, materiality: { throughput: { numerator: '1', denominator: '100' } }, directions: { throughput: 'maximize' } },
  iterations: { attempts: 1, mode: 'exact', earlyStop: false, plateauRounds: 2 },
  checkpoints: { brief: false, afterScore: false, libraryAdmission: false, learningActivation: false, timeoutMs: 60000, timeoutAction: 'finish' },
  budgets: { wallMs: 480000, gameTicks: 18600, turns: 6, toolCalls: 24, reportedTokens: 60000, learningReservedTurns: 0, learningReservedTools: 0 },
  models: { sessionDefault: { provider: 'openai', modelId: 'gpt-6-astra', reasoningEffort: 'low' }, overrides: {} },
  learning: { cadence: 'off', batchSessions: 1, candidateCap: 1, attemptsPerCandidate: 1, autoActivate: false } };
await writeFile(path.join(evidence, 'input.json'), JSON.stringify(input, null, 2));
console.log(JSON.stringify({ evidence, objective: input.objective, budgets: input.budgets, model: input.models.sessionDefault }));
const profiles: GameProfile[] = [];
let port: SerialPort | undefined, runtime: DurableRuntime | undefined, server: ReturnType<typeof dashboard> | undefined;
let catalog: WorkspaceCatalog | undefined, stopPolling: (() => Promise<void>) | undefined;
let failure: string | null = null, cleanup = false, recovery: unknown = null, final: unknown = null;
try {
  const profile = await createProfile(false, true); profiles.push(profile); await startServer(profile);
  port = new SerialPort(await waitForServer(profile));
  const game = new GameClient(port, () => {}), life = new Lifecycle(port, game, () => {});
  const control = await waitFor('live operator RPC', async () => { try { return await life.inspect(); } catch { return undefined; } });
  const directory = path.join(evidence, 'startup/dashboard-trial'); await mkdir(directory, { recursive: true });
  runtime = new DurableRuntime(directory, 'default-trial-runtime', control.epoch, game, life, [profile.password]);
  const operator = new Operator(new Coordinator(runtime, { ...PROBE_CAPS, runMs: 600000 })); await operator.control('pause');
  const activeRuntime = runtime;
  const prepared = await prepareLiveWorkshopHost({ directory, fenceDirectory: profile.dir, codexExecutable: codex, port, game, lifecycle: life,
    reserveGameControl: () => operator.reserveGameControl(),
    activity: activity => {
      activeRuntime.record(`workshop/${activity.category}-${activity.status}`, [{ entity: 'workshopOperations', id: activity.id, value: { ...activity } }]);
      console.log(JSON.stringify({ activity: activity.category, status: activity.status, id: activity.id }));
    }, events: event => { void appendFile(path.join(evidence, 'provider-activity.jsonl'), JSON.stringify(event) + '\n'); } });
  assert(prepared.catalog.models.some(model => model.id === 'gpt-6-astra' && model.efforts.includes('low')), 'Required Astra/low unavailable; no fallback');
  catalog = new WorkspaceCatalog(evidence); reconcileWorkspaceStartup(catalog, runtime);
  server = dashboard(operator, undefined, { workspaceCatalog: catalog, workshopHost: prepared.host, managedModels: prepared.catalog.models });
  const origin = await server.listen(); stopPolling = operator.start(); console.log(JSON.stringify({ liveDashboard: `${origin}/workshop` }));
  const headers = { origin, authorization: `Bearer ${server.capability}`, 'content-type': 'application/json' };
  const launch = await fetch(`${origin}/api/workshop/launch`, { method: 'POST', headers, body: JSON.stringify({ assignment: input }) });
  assert.equal(launch.status, 202, await launch.text());
  const deadline = Date.now() + 510000; let stage: unknown;
  for (;;) {
    const session = runtime.journal.get<Record<string, unknown>>(runtime.run, 'workshopSessions', id);
    if (session?.stage !== stage) { stage = session?.stage; console.log(JSON.stringify({ stage: stage ?? 'preparing' })); }
    if (session && ['complete', 'stopped', 'held'].includes(String(stage))) { final = session; break; }
    if (catalog.request(id)?.state === 'failed') { final = { request: catalog.request(id), session }; break; }
    if (Date.now() >= deadline) {
      const stop = await fetch(`${origin}/api/workshop/stop`, { method: 'POST', headers, body: JSON.stringify({ sessionId: id, reason: 'bounded default trial deadline' }) });
      final = { deadline: true, stopStatus: stop.status, session: runtime.journal.get(runtime.run, 'workshopSessions', id) }; break;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  await writeFile(path.join(evidence, 'outcome.json'), JSON.stringify(final, null, 2));
  await stopPolling(); stopPolling = undefined; await server.close(); server = undefined;
  // Save only this trial's world before its exact process is stopped.
  await port.command('/silent-command game.server_save("default-trial-final")');
  const save = path.join(profile.dir, 'data/saves/default-trial-final.zip');
  await waitFor('trial final save', async () => { try { const bytes = await readFile(save); return bytes.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])) ? true : undefined; } catch { return undefined; } }, 30000, 250);
  runtime.close(); runtime = undefined; port.close(); port = undefined; await stopProfile(profile.config);
  const protectedFiles = [path.join(directory, 'runtime.sqlite'), path.join(directory, 'workshop-live', id, 'provider-budget.json'), save];
  const hashes: Record<string, string> = {};
  for (const file of protectedFiles) { try { hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
  const priorOwner = catalog.owner();
  const successorDirectory = path.join(evidence, 'startup/dashboard-successor'); await mkdir(successorDirectory, { recursive: true });
  const successorJournal = new SqliteJournal(path.join(successorDirectory, 'runtime.sqlite'));
  try {
    if (priorOwner) {
      const replacement = await createProfile(false, true); profiles.push(replacement); await startServer(replacement);
      const boundary = await recordFreshGame(replacement); port = new SerialPort(await waitForServer(replacement));
      const client = new GameClient(port, () => {}), lifecycle = new Lifecycle(port, client, () => {});
      const nextControl = await waitFor('successor operator RPC', async () => { try { return await lifecycle.inspect(); } catch { return undefined; } });
      const receipt = await readFreshGame(replacement, boundary, nextControl);
      reconcileWorkspaceStartup(catalog, { directory: successorDirectory, run: 'successor-runtime', journal: successorJournal }, receipt);
    } else reconcileWorkspaceStartup(catalog, { directory: successorDirectory, run: 'successor-runtime', journal: successorJournal });
    assert.equal(catalog.owner(), null);
    assert.equal(catalog.admit('next-run-admission', 'workshop', { objective: input.objective }).newlyAdmitted, true);
    catalog.transitionRequest('next-run-admission', 'cancelled', 'no-inference successor admission check');
    for (const [file, expected] of Object.entries(hashes)) assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), expected);
    recovery = { passed: true, priorOwner, successorAdmitted: true, successorInference: false, preserved: hashes };
  } finally { successorJournal.close(); }
} catch (error) { failure = String(error); process.exitCode = 1; }
finally {
  const cleanupReceipts = await cleanupAll([
    { id: 'polling', run: () => stopPolling?.() }, { id: 'dashboard', run: () => server?.close() },
    { id: 'runtime', run: () => runtime?.close() }, { id: 'catalog', run: () => catalog?.close() },
    { id: 'port', run: () => port?.close() },
    ...profiles.map((profile, index) => ({ id: `game-${index}`, run: () => stopProfile(profile.config) })),
  ]);
  cleanup = cleanupReceipts.every(receipt => receipt.completed);
  failure ??= cleanup ? null : 'Owned cleanup incomplete; inspect cleanupReceipts';
  const result = { passed: !failure && cleanup && recovery !== null, failure, cleanup, cleanupReceipts, final, recovery,
    limitations: ['One bounded default-brief attempt; library and learning disabled', 'A completed trial is not necessarily target-passing', 'Direct construction only; no universal entity support'], budgets: input.budgets };
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ evidence, passed: result.passed, cleanup, failure })); if (!result.passed) process.exitCode = 1;
}
