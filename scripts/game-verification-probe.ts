import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { diagnosticGrants, record } from '@autofactorio/contracts';
import type { Batch, Step, Target } from '@autofactorio/contracts';
import { GameClient, observeRequest } from '../packages/factorio/src/client.js';
import { Lifecycle, sha256 } from '../packages/factorio/src/lifecycle.js';
import type { ControlState } from '../packages/factorio/src/lifecycle.js';
import { VerificationControl } from '../packages/factorio/src/verification.js';
import { readProfile, waitForServer, waitFor } from './dev/game-processes.js';

const flag = process.argv.indexOf('--profile-file');
if (flag < 0) throw new Error('Explicit dedicated --profile-file required');
const profile = await readProfile((JSON.parse(await readFile(process.argv[flag + 1]!, 'utf8')) as { dir: string }).dir);
const evidence = await mkdtemp(path.join(profile.dir, 'verification-probe-'));
const sources = ['scripts/game-verification-probe.ts', 'packages/factorio/src/verification.ts', 'packages/factorio/src/client.ts', 'packages/factorio/src/lifecycle.ts', 'mods/autofactorio/control.lua', 'mods/autofactorio/actions.lua', 'mods/autofactorio/common.lua', 'mods/autofactorio/lifecycle.lua', 'mods/autofactorio/ownership.lua', 'mods/autofactorio/edits.lua', 'mods/autofactorio/verification.lua', 'mods/autofactorio/info.json'];
const hashes = Object.fromEntries(await Promise.all(sources.map(async f => [f, sha256(await readFile(f))])));
for (const f of sources.filter(f => f.startsWith('mods/'))) assert.equal(sha256(await readFile(path.join(profile.mods, 'autofactorio_0.1.0', path.basename(f)))), hashes[f], 'Live mod source mismatch');
await writeFile(path.join(evidence, 'source-manifest.json'), JSON.stringify(hashes, null, 2));
const sink = (e: unknown) => appendFileSync(path.join(evidence, 'events.jsonl'), JSON.stringify(e) + '\n');
const checks: string[] = []; const pass = (s: string) => { checks.push(s); console.log(s); };
const port = await waitForServer(profile); const game = new GameClient(port, sink); const life = new Lifecycle(port, game, sink); const verification = new VerificationControl(port, sink);
let control!: ControlState; let serial = 0; let failure: string | null = null;
const actor = (w: Record<string, unknown>) => record(record(w.actors)['builder-1']);
async function observe() { control = await life.heartbeat(control); return game.request(observeRequest); }
function batch(steps: Step[]): Batch { return { commandId: 'verification-' + ++serial, epoch: control.epoch, session: control.session, task: 'phase03-actions', revision: 1, actor: 'builder-1', surface: 'nauvis', grants: diagnosticGrants(control.generation), deadline: control.tick + 36000, steps }; }
async function submit(steps: Step[]) { const b = batch(steps); await game.request({ op: 'submit', batch: b }); return b; }
async function finish(id: string) { return waitFor('Final receipt', async () => { await observe(); const r = await game.receipt(id); return r && !['accepted', 'running'].includes(r.status) ? r : undefined; }, 15000, 40); }
const chest: Step = { kind: 'place', item: 'wooden-chest', quality: 'normal', direction: 0, position: { x: 2.5, y: 2.5 } };
try {
  await port.command('/silent-command rcon.print("AutoFactorio phase10")'); await port.command('/silent-command rcon.print("AutoFactorio phase10")');
  control = await life.inspect();
  await waitFor('Visible player', async () => { const w = await game.request(observeRequest); return record(w.actors)['builder-1'] && actor(w).connected === true ? w : undefined; });
  assert.equal(Object.keys(control.ledger).length, 0, 'Fresh dedicated world required');
  control = await life.pause(control); control = await life.reconcile(control);
  await verification.configure(control, 'guard-sandbox', 'phase10-v1'); control = await life.arm(control);
  const initial = await observe(); await writeFile(path.join(evidence, 'versions.json'), JSON.stringify(initial.mods));
  const fixture = (initial.entities as Record<string, unknown>[]).find(e => e.name === 'steel-chest')!;
  const target: Target = { name: String(fixture.name), quality: String(fixture.quality), position: fixture.position as Target['position'], unit: Number(fixture.unit) };
  await assert.rejects(() => submit([{ kind: 'craft', recipe: 'automation-science-pack', count: 1 }]), /manual_science_prohibited/);
  const protectedOrder = await submit([{ kind: 'mine', target }]); assert.match(JSON.stringify(await finish(protectedOrder.commandId)), /protected_fixture/);
  pass('Benchmark building denies manual science crafting and protected fixture tampering');
  const queued = await submit([{ kind: 'craft', recipe: 'iron-gear-wheel', count: 40 }, chest]);
  await waitFor('Native crafting active', async () => { const w = await observe(); return Object.keys(actor(w).crafting as object).length ? true : undefined; }, 10000, 30);
  const admission = await verification.admit(control, 'attempt-1');
  const receipt = await game.receipt(queued.commandId); assert.equal(receipt?.status, 'cancelled'); assert(Number(receipt?.endedTick) <= admission.tick);
  const frozen = actor(await observe()).inventory;
  for (let i = 0; i < 12; i++) { await delay(40); const w = await observe(); assert.deepEqual(actor(w).inventory, frozen); assert.equal((w.entities as Record<string, unknown>[]).some(e => e.name === 'wooden-chest'), false); assert.equal(Object.keys(actor(w).crafting as object).length, 0); }
  assert.deepEqual(await verification.admit(control, 'attempt-1'), admission);
  pass('Admission cancels active native craft and queued placement before an immutable inventory baseline; no later effects');
  const mutations: Step[] = [chest, { kind: 'craft', recipe: 'iron-gear-wheel', count: 1 }, { kind: 'mine', target }, { kind: 'rotate', target }, { kind: 'recipe', target, recipe: 'automation-science-pack' }, { kind: 'transfer', target, inventory: 'chest', flow: 'put', item: { name: 'iron-plate', quality: 'normal', count: 1 } }];
  for (const mutation of mutations) await assert.rejects(() => submit([mutation]), /verification_observation_only/);
  const walking = await submit([{ kind: 'walk', position: { x: 1, y: 0 } }]); assert.equal((await finish(walking.commandId)).status, 'completed'); assert.deepEqual(actor(await observe()).inventory, frozen);
  pass('All six production mutation kinds reject during verification while non-interacting walking completes');
  // A delayed/retried command must read back its cancellation, never resume its queued placement.
  const replay = await game.request({ op: 'submit', batch: queued });
  assert.deepEqual(replay.receipt, receipt);
  assert.equal(((await observe()).entities as Record<string, unknown>[]).some(e => e.name === 'wooden-chest'), false);
  pass('Delayed replay of cancelled queued work returns its original receipt without any world effect');
  await assert.rejects(() => verification.repair(control, 'wrong-attempt'), /attempt_mismatch/);
  assert.equal((await verification.inspect(control)).state, 'admitted');
  assert.equal((await verification.repair(control, 'attempt-1')).state, 'aborted');
  const built = await submit([chest]); assert.equal((await finish(built.commandId)).status, 'completed');
  await assert.rejects(() => submit([{ kind: 'craft', recipe: 'automation-science-pack', count: 1 }]), /manual_science_prohibited/);
  pass('Matching repair abort is acknowledged before legal placement reopens; benchmark science policy persists');
  const next = await verification.admit(control, 'attempt-2'); assert(next.tick > admission.tick);
  // Explicit player-API diagnostic raises the same engine edit event as a manual build.
  await port.command('/silent-command local p=game.players[1];p.cursor_stack.set_stack{name="wooden-chest",count=1};p.build_from_cursor{position={4.5,1.5}};rcon.print("diagnostic human build invoked")');
  const invalid = await verification.inspect(control); assert.equal(invalid.state, 'invalid');
  assert((await life.edits(0)).events.some(e => e.causality === 'human'));
  await assert.rejects(() => verification.admit(control, 'attempt-2'), /not acknowledged/);
  await assert.rejects(() => submit([chest]), /verification_observation_only/);
  pass('Human edit records assistance evidence and invalidates the attempt without reopening mutation admission');
  await verification.repair(control, 'attempt-2'); await verification.admit(control, 'attempt-3');
  control = await life.pause(control); const tick = control.tick;
  for (let i = 0; i < 5; i++) { await delay(40); control = await life.inspect(); assert.equal(control.tick, tick); assert.equal((await verification.inspect(control)).state, 'admitted'); }
  control = await life.reconcile(control); assert.equal((await verification.inspect(control)).state, 'invalid');
  pass('Paused polling freezes game ticks; authority replacement invalidates the old verification baseline');
  await writeFile(path.join(evidence, 'final-guard.json'), JSON.stringify(await verification.inspect(control), null, 2));
} catch (error) { failure = String(error); process.exitCode = 1; console.error(failure); }
finally {
  try { control = await life.inspect(); if (control.armed || !control.paused) await life.pause(control); } catch { failure ??= 'Cleanup hold unconfirmed'; process.exitCode = 1; }
  port.close(); await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed: failure === null, checks, failure, modelInference: false, calibration: 'guard only; no scenario measurement claim' }, null, 2));
  console.log(JSON.stringify({ evidence, checks: checks.length, failure }));
}
