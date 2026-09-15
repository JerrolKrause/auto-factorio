import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { record } from '@autofactorio/contracts';
import type { Batch, Step } from '@autofactorio/contracts';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { GameClient, observeRequest } from '../packages/factorio/src/client.js';
import { Lifecycle, barrier, validateCheckpoint, prepareManagedLoad, verifyLoaded, sha256 } from '../packages/factorio/src/lifecycle.js';
import { PROBE_CAPS } from '../packages/codex/src/budget.js';
import { readProfile, waitForServer, waitFor, configureProfile, startServer, startObserver, identifyObserver } from './dev/game-processes.js';
import type { GameProfile } from './dev/game-processes.js';
import type { ControlState } from '../packages/factorio/src/lifecycle.js';
import type { Command } from '../packages/core/execution/durable.js';
const argument = (key: string, fallback: string) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1]! : fallback;
const worker = process.argv.includes('--crash-worker');
const profileFile = argument('--profile-file', '.runtime/phase04/current.json');
const profile = await readProfile((JSON.parse(await readFile(profileFile, 'utf8')) as { dir: string }).dir);
const evidence = worker ? argument('--evidence', '') : await mkdtemp(path.join(profile.dir, 'durable-probe-'));
const data = path.join(evidence, 'runtime'); const run = path.basename(evidence); const checks: string[] = [];
const sink = (event: unknown) => appendFileSync(path.join(evidence, worker ? 'worker-events.jsonl' : 'events.jsonl'), JSON.stringify(event) + '\n');
const pass = (label: string) => { checks.push(label); sink({ kind: 'probe/pass', label }); console.log(label); };
const mods = ['control.lua', 'lifecycle.lua', 'actions.lua', 'common.lua', 'info.json'];
const hashes = Object.fromEntries(await Promise.all(mods.map(async name => [name, sha256(await readFile('mods/autofactorio/' + name))])));
for (const name of mods) assert.equal(sha256(await readFile(path.join(profile.mods, 'autofactorio_0.1.0', name))), hashes[name], 'Live mod source mismatch');
const modHash = sha256(Buffer.from(JSON.stringify(hashes)));
let activeProfile: GameProfile = profile; let port = await waitForServer(profile); let control: ControlState;
let game!: GameClient; let life!: Lifecycle; let runtime: DurableRuntime | undefined;
const actor = (w: Record<string, unknown>) => record(record(w.actors)['builder-1']);
const batch = (id: string, steps: Step[]): Batch => ({ commandId: id, epoch: control.epoch, session: control.session, task: 'phase03-actions', revision: 1, actor: 'builder-1', surface: 'nauvis', grant: { id: 'test-area', generation: control.generation }, deadline: control.tick + 36000, steps });
const place: Step[] = [{ kind: 'place', item: 'wooden-chest', quality: 'normal', direction: 0, position: { x: 2.5, y: 2.5 } }];
const observe = () => game.request(observeRequest);
async function finish(id: string) {
  for (let i = 0; i < 200; i++) { control = await life.heartbeat(control); const r = await game.receipt(id); if (r && !['accepted', 'running'].includes(r.status)) return r; await delay(50); }
  throw new Error('Placement completion unconfirmed');
}
class CrashAfterEffectClient extends GameClient {
  override async request(input: unknown): Promise<Record<string, unknown>> {
    const response = await super.request(input);
    if (record(input).op === 'submit') {
      const id = (record(input).batch as Batch).commandId; const receipt = await finish(id); assert.equal(receipt.status, 'completed');
      const world = await observe(); writeFileSync(path.join(evidence, 'effect-before-crash.json'), JSON.stringify({ receipt, world }, null, 2));
      // No return to DurableExecution: the database outbox is still 'sending'. No finally/close runs.
      process.exit(73);
    }
    return response;
  }
}
function connect(crash = false) {
  game = crash ? new CrashAfterEffectClient(port, sink) : new GameClient(port, sink); life = new Lifecycle(port, game, sink);
  runtime = new DurableRuntime(data, run, 'initial', game, life, [activeProfile.password]);
}
let failure: string | null = null; let manifestPath: string | undefined; let restoredDirectory: string | undefined;
try {
  await port.command('/silent-command rcon.print("AutoFactorio phase05")'); await port.command('/silent-command rcon.print("AutoFactorio phase05")');
  connect(worker);
  if (worker) {
    runtime!.createBudget(PROBE_CAPS, () => performance.now(), () => {});
    control = await runtime!.recover(); control = await runtime!.resume(control);
    const b = batch('effect-before-ack', place); runtime!.intent(b); await runtime!.dispatch(b.commandId); throw new Error('Crash point did not exit');
  }
  await writeFile(path.join(evidence, 'source-manifest.json'), JSON.stringify({ mods: hashes, sources: Object.fromEntries(await Promise.all(['scripts/game-durable-probe.ts', 'apps/runtime/durable-runtime.ts', 'packages/storage/src/journal.ts', 'packages/storage/src/artifacts.ts', 'packages/core/execution/durable.ts', 'packages/codex/src/budget.ts'].map(async file => [file, sha256(await readFile(file))]))) }, null, 2));
  console.log('Waiting for visible phase 05 player');
  await waitFor('Visible player', async () => { const w = await observe(); return record(w.actors)['builder-1'] && actor(w).connected === true ? w : undefined; });
  await identifyObserver(profile); control = await life.inspect(); assert.equal(Object.keys(control.ledger).length, 0, 'Fresh diagnostic world required');
  runtime!.initialize({ objective: 'Retain one legal placement across runtime death and controlled rollback', scenario: 'phase05-diagnostic', scenarioVersion: '1', seed: 42, codeCommit: 'see source-manifest.json', gameVersion: '2.0.77', mods: control.mods, roster: ['foreman', 'engineer'], model: 'none-deterministic', effort: 'none', instructionHashes: {}, assisted: false, status: 'diagnostic' });
  runtime!.task({ id: 'phase03-actions', goal: 'place one chest', parent: null, owner: 'engineer', dependencies: [], scope: { surface: 'nauvis' }, resources: { 'wooden-chest': 1 }, successCriteria: ['one entity and one consumed item'], deadline: null, revision: 1, committedPlan: 'Place at 2.5,2.5 after reconciliation', status: 'pending', evidence: [] });
  runtime!.record('coordination/recorded', [{ entity: 'agents', id: 'engineer', value: { id: 'engineer', role: 'engineer', assignment: 'phase03-actions', session: null, status: 'waiting' } }, { entity: 'messages', id: 'assignment', value: { sender: 'foreman', recipient: 'engineer', task: 'phase03-actions', intent: 'assignment', content: 'place one chest', evidence: [] } }]);
  const budget = runtime!.createBudget(PROBE_CAPS, () => performance.now(), () => {}); const turn = budget.admit('synthetic-accounting'); budget.attempt(turn.id); budget.usage('synthetic-session', 42); budget.finish(turn.id); // Fake usage only, no inference.
  control = await runtime!.recover(); control = await runtime!.resume(control);
  const before = await observe(); const inventoryBefore = actor(before).inventory;
  runtime!.observation({ tick: before.tick, actors: before.actors, truncated: false }, before, { kind: 'restricted', agents: ['engineer'], roles: [], tasks: [] });
  runtime!.intent(batch('unsent-at-checkpoint', place));
  manifestPath = await runtime!.capture({ saveDirectory: path.join(profile.dir, 'data/saves'), outputDirectory: path.join(evidence, 'checkpoints'), logFile: profile.log, world: observe, modHash });
  const manifest = await validateCheckpoint(manifestPath, modHash);
  assert(manifest.eventCursor > 0); assert.equal(runtime!.recovery().complete, true); pass('Durable checkpoint links verified held save, exact observations, pending task/intent and budget');
  runtime!.close(); runtime = undefined; port.close();
  const child = spawn(process.execPath, [path.resolve('dist/scripts/game-durable-probe.js'), '--crash-worker', '--profile-file', path.resolve(profileFile), '--evidence', evidence], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', bytes => appendFileSync(path.join(evidence, 'worker.log'), bytes)); child.stderr.on('data', bytes => appendFileSync(path.join(evidence, 'worker.log'), bytes));
  const childExit = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); assert.equal(childExit, 73);
  port = await waitForServer(profile); connect();
  assert.equal(runtime!.journal.get<Command>(run, 'commands', 'effect-before-ack')?.state, 'sending'); pass('Separate runtime process exits 73 after real placement and before database acknowledgement');
  control = await runtime!.recover(); barrier(control);
  const outcome = runtime!.journal.get<Command>(run, 'commands', 'effect-before-ack'); assert.equal(outcome?.receipt?.status, 'completed');
  const after = await observe(); assert.equal((after.entities as Record<string, unknown>[]).filter(e => e.name === 'wooden-chest').length, 1);
  const itemCount = (items: unknown) => (items as { name: string; count: number }[]).find(i => i.name === 'wooden-chest')?.count ?? 0;
  assert.equal(itemCount(inventoryBefore) - itemCount(actor(after).inventory), 1);
  await assert.rejects(() => runtime!.execution.dispatch('effect-before-ack'), /unsent/); pass('Replacement reconciles game receipt, one chest and one inventory debit without replay');
  const recoveredBudget = runtime!.createBudget(PROBE_CAPS, () => performance.now(), () => {}); assert.equal(recoveredBudget.state.spentTurns, 1); assert.equal(recoveredBudget.state.reportedTokens, 42); assert.equal(runtime!.recovery().tasks[0]?.owner, 'engineer');
  assert.equal(runtime!.recovery().commands.some(c => c.batch.commandId === 'unsent-at-checkpoint'), true); pass('Replacement reconstructs task ownership, committed plan, old intent and expenditure without a transcript');
  const backupPath = path.join(evidence, 'backup'); const backup = runtime!.backup(backupPath);
  for (let i = 0; i < 12; i++) runtime!.evidence('public-transcript', { syntheticActivity: i }, { kind: 'operator' });
  assert.equal((await backup).complete, true); const snapshotBefore = runtime!.journal.snapshot(); runtime!.journal.rebuild(); assert.deepEqual(runtime!.journal.snapshot(), snapshotBefore); pass('Live runtime backup includes a consistent artifact manifest during event production; rebuild matches');
  runtime!.close(); runtime = undefined; port.close();
  restoredDirectory = path.join(evidence, 'managed-load'); await prepareManagedLoad(manifestPath, modHash, restoredDirectory);
  activeProfile = await configureProfile(restoredDirectory, path.join(restoredDirectory, manifest.save), { source: profile, port: 27026, gamePort: 34206 });
  await startServer(activeProfile); port = await waitForServer(activeProfile); connect();
  control = await life.inspect(); verifyLoaded(manifest, control, await observe(), true); barrier(control);
  await startObserver(activeProfile, profile.observerConfig); console.log('Waiting for visible held checkpoint rejoin');
  await waitFor('Restored visible player', async () => { const w = await observe(); return record(w.actors)['builder-1'] && actor(w).connected === true ? w : undefined; }); await identifyObserver(activeProfile);
  control = await life.inspect(); await runtime!.restoreHeld(manifest.name, modHash, control, await observe());
  assert.equal(runtime!.journal.get<Command>(run, 'commands', 'effect-before-ack')?.state, 'rolled_back');
  assert.equal((await observe()).entities instanceof Array, true); assert.equal(((await observe()).entities as Record<string, unknown>[]).filter(e => e.name === 'wooden-chest').length, 0); pass('Verified managed load retires post-checkpoint receipts; no saved intent replays behind the barrier');
  runtime!.createBudget(PROBE_CAPS, () => performance.now(), () => {});
  control = await runtime!.resume(control); const fresh = batch('fresh-after-restore', place); runtime!.intent(fresh); await runtime!.dispatch(fresh.commandId); assert.equal((await finish(fresh.commandId)).status, 'completed');
  control = await runtime!.recover(); barrier(control); assert.equal(((await observe()).entities as Record<string, unknown>[]).filter(e => e.name === 'wooden-chest').length, 1); pass('Explicit re-arm plus fresh intent creates exactly one chest in the restored world; final world held');
  const finalRecovery = runtime!.recovery(); assert.equal(finalRecovery.complete, true); writeFileSync(path.join(evidence, 'recovered-state.json'), JSON.stringify(finalRecovery, null, 2));
  // Check the self-contained backup after its source runtime has accumulated later history.
  const backupRuntime = new DurableRuntime(backupPath, run, 'backup', game, life, [activeProfile.password]); assert.equal(backupRuntime.recovery().complete, true); const snap = backupRuntime.journal.snapshot(); backupRuntime.journal.rebuild(); assert.deepEqual(backupRuntime.journal.snapshot(), snap); backupRuntime.close(); pass('Independent backup reopen verifies checksums and projection equality');
} catch (error) { failure = String(error); process.exitCode = 1; sink({ kind: 'probe/failed', failure }); console.error(failure); }
finally {
  try { if (life!) { control = await life.inspect(); if (control.armed) await life.pause(control); } } catch { sink({ kind: 'probe/cleanup-unconfirmed' }); }
  runtime?.close(); port.close();
  if (!worker) { await mkdir(evidence, { recursive: true }); await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed: failure === null, failure, checks, manifestPath, restoredDirectory }, null, 2)); console.log(JSON.stringify({ evidence, failure, checks: checks.length })); }
}
