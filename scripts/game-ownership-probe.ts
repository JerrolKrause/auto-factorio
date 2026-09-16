import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { record, diagnosticAssignment } from '@autofactorio/contracts';
import type { Batch, Step, TaskRecord, Assignment, OwnershipControl } from '@autofactorio/contracts';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { GameClient, observeRequest } from '../packages/factorio/src/client.js';
import { Lifecycle, barrier, fence, validateCheckpoint, prepareManagedLoad, verifyLoaded, sha256 } from '../packages/factorio/src/lifecycle.js';
import type { ControlState } from '../packages/factorio/src/lifecycle.js';
import { readProfile, waitForServer, waitFor, configureProfile, startServer, startObserver, identifyObserver, stopProfile } from './dev/game-processes.js';

const flag = process.argv.indexOf('--profile-file');
const profile = await readProfile((JSON.parse(await readFile(flag < 0 ? '.runtime/phase04/current.json' : process.argv[flag + 1]!, 'utf8')) as { dir: string }).dir);
const evidence = await mkdtemp(path.join(profile.dir, 'ownership-probe-')); const checks: string[] = [];
const sink = (event: unknown) => appendFileSync(path.join(evidence, 'events.jsonl'), JSON.stringify(event) + '\n');
const pass = (label: string) => { checks.push(label); sink({ kind: 'probe/pass', label }); console.log(label); };
const sourceFiles = ['mods/autofactorio/control.lua', 'mods/autofactorio/lifecycle.lua', 'mods/autofactorio/ownership.lua', 'mods/autofactorio/actions.lua', 'mods/autofactorio/common.lua', 'mods/autofactorio/info.json', 'scripts/game-ownership-probe.ts', 'apps/runtime/durable-runtime.ts', 'packages/core/execution/ownership.ts', 'packages/core/execution/durable.ts', 'packages/contracts/src/ownership.ts', 'packages/factorio/src/lifecycle.ts'];
const hashes = Object.fromEntries(await Promise.all(sourceFiles.map(async f => [f, sha256(await readFile(f))])));
for (const f of sourceFiles.filter(f => f.startsWith('mods/'))) assert.equal(sha256(await readFile(path.join(profile.mods, 'autofactorio_0.1.0', path.basename(f)))), hashes[f], 'Live mod differs');
const modHash = sha256(Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(hashes).filter(([f]) => f.startsWith('mods/'))))));
await writeFile(path.join(evidence, 'source-manifest.json'), JSON.stringify(hashes, null, 2));
let activeProfile = profile; let port = await waitForServer(profile); let game!: GameClient; let life!: Lifecycle; let runtime!: DurableRuntime; let control!: ControlState;
let assignment!: Assignment; let serial = 0; let revision = 0; let failure: string | null = null; let restoredDirectory: string | undefined;
function connect() { game = new GameClient(port, sink); life = new Lifecycle(port, game, sink); runtime = new DurableRuntime(path.join(evidence, 'runtime'), path.basename(evidence), 'initial', game, life, [activeProfile.password]); }
const observe = () => game.request(observeRequest);
const actor = (w: Record<string, unknown>) => record(record(w.actors)['builder-1']);
const task = (status = 'running'): TaskRecord => ({ id: 'fenced-task', goal: 'prove ownership fencing', parent: null, owner: 'engineer', dependencies: [], scope: {}, resources: {}, successCriteria: ['no effects after revoke acknowledgement'], deadline: null, revision, committedPlan: 'diagnostic actions', status, evidence: [] });
async function acquire() {
  revision++; runtime.task(task());
  const r = runtime.ownership.acquire({ id: 'assignment-' + revision, owner: 'engineer', task: 'fenced-task', revision, actor: 'builder-1', resources: diagnosticAssignment(1).resources.map(r => r.resource) });
  assignment = await runtime.ownership.flush(r.id); return r;
}
const batch = (steps: Step[]): Batch => ({ commandId: 'fence-' + ++serial, epoch: control.epoch, session: control.session, task: assignment.task, revision: assignment.revision, actor: assignment.actor, surface: 'nauvis', grants: assignment.resources.map(r => r.grant), deadline: control.tick + 36000, steps });
const chest: Step = { kind: 'place', item: 'wooden-chest', quality: 'normal', direction: 0, position: { x: 2.5, y: 2.5 } };
async function submit(steps: Step[]) { const b = batch(steps); runtime.intent(b); await runtime.dispatch(b.commandId); return b; }
async function poll() { control = await life.heartbeat(control); return observe(); }
async function heldEffects(label: string) {
  const first = actor(await poll());
  for (let i = 0; i < 12; i++) { await delay(60); const next = actor(await poll()); assert.deepEqual(next.position, first.position); assert.deepEqual(next.inventory, first.inventory); assert.equal(record(next.walking).walking, false); assert.equal(record(next.mining).mining, false); assert.equal(Object.keys(next.crafting as object).length, 0); }
  pass(label);
}
async function revoke() { const r = runtime.ownership.revoke(assignment.id); const final = await runtime.ownership.flush(r.id); await runtime.execution.reconcile(); return final; }
try {
  await port.command('/silent-command rcon.print("AutoFactorio phase06")'); await port.command('/silent-command rcon.print("AutoFactorio phase06")'); connect();
  console.log('Waiting for visible phase 06 player');
  await waitFor('Visible player', async () => { const w = await observe(); return record(w.actors)['builder-1'] && actor(w).connected === true ? w : undefined; }); await identifyObserver(profile);
  control = await life.inspect(); assert.equal(Object.keys(control.ledger).length, 0, 'Fresh world required');
  control = await runtime.recover(); control = await runtime.resume(control); const first = await acquire();
  assert.throws(() => runtime.ownership.acquire({ ...first, id: 'conflict', task: 'other', resources: [...first.resources.map(r => r.resource)].reverse() }), /conflict/);
  const conflicting: OwnershipControl = { ...first.request, id: randomUUID(), assignment: { ...first.request.assignment, id: 'conflicting-live', task: 'other' } };
  await assert.rejects(() => life.ownership(conflicting), /generation|conflict/); pass('Opposite-order Node conflict and conflicting live grant reject atomically');
  const staleArea = batch([chest]); staleArea.grants = structuredClone(staleArea.grants); staleArea.grants.find(g => g.id.startsWith('area.'))!.generation++;
  await assert.rejects(() => game.request({ op: 'submit', batch: staleArea }), /generation/);
  const staleTask = { ...batch([chest]), revision: revision + 1 }; await assert.rejects(() => game.request({ op: 'submit', batch: staleTask }), /task_revision/); pass('Lua rejects stale area generation with current actor grant and wrong task revision');
  const walking = await submit([{ kind: 'walk', position: { x: 6, y: 0 } }, chest]);
  await waitFor('Active movement', async () => { const a = actor(await poll()); return record(a.walking).walking === true && Number(record(a.position).x) > 0.2 ? a : undefined; }, 10000, 30);
  const originalOwnership = life.ownership.bind(life); let lost = true;
  life.ownership = async request => { const ack = await originalOwnership(request); if (lost) { lost = false; throw new Error('Simulated lost revoke acknowledgement'); } return ack; };
  const revoking = runtime.ownership.revoke(assignment.id); await assert.rejects(() => runtime.ownership.flush(assignment.id), /lost revoke/);
  assert.throws(() => runtime.ownership.acquire({ ...first, id: 'premature', revision: 2, resources: first.resources.map(r => r.resource) }));
  assert.throws(() => runtime.intent(batch([chest])), /unauthorized/);
  const revoked = await runtime.ownership.flush(assignment.id); assert.equal(revoked.request.id, revoking.request.id);
  const duplicate = await life.ownership(revoking.request); assert.deepEqual(duplicate, revoked.ack);
  await runtime.execution.reconcile(); assert.equal((await game.receipt(walking.commandId))?.status, 'cancelled');
  await heldEffects('Lost revoke acknowledgement holds reservations; duplicate retry has identical final receipts and no later movement or queued placement');
  await acquire();
  await assert.rejects(() => life.ownership({ ...first.request, id: randomUUID() }), /assignment_id|task_revision|generation/);
  await assert.rejects(() => life.rpc({ op: 'arm', ...fence({ ...control, revision: control.revision - 1 }) }), /stale_control_revision/);
  game.admission = true; // Rejected operator diagnostic closes the client, while the world remains armed.
  await assert.rejects(() => game.request({ op: 'submit', batch: { ...walking, commandId: 'late-old-task' } }), /task_revision/);
  pass('Reordered old grant, stale arm and late same-agent task output cannot revive revoked work');
  const crafting = await submit([{ kind: 'craft', recipe: 'iron-gear-wheel', count: 40 }, chest]);
  await waitFor('Native crafting', async () => { const a = actor(await poll()); return Object.keys(a.crafting as object).length ? a : undefined; }, 10000, 30);
  await revoke(); assert.equal((await game.receipt(crafting.commandId))?.status, 'cancelled'); await heldEffects('Native crafting revoke cancels queue with final refund accounting and no future items');
  await acquire(); const world = await observe(); const ore = (world.entities as Record<string, unknown>[]).find(e => e.name === 'iron-ore')!;
  const target = { name: String(ore.name), quality: String(ore.quality), position: ore.position as { x: number; y: number }, unit: (ore.unit as number | undefined) ?? null };
  const mining = await submit([{ kind: 'walk', position: { x: -2, y: 2 } }, { kind: 'mine', target }, chest]);
  await waitFor('Native mining', async () => { const a = actor(await poll()); return record(a.mining).mining === true ? a : undefined; }, 10000, 20);
  await revoke(); assert.equal((await game.receipt(mining.commandId))?.status, 'cancelled'); await heldEffects('Native mining revoke neutralizes ongoing mining and prevents queued effects');
  // Two individually legal endpoints do not authorize the gap between their reservations.
  revision++; runtime.task(task());
  const position = record(actor(await observe()).position); const x = Number(position.x); const y = Number(position.y);
  const bounded = runtime.ownership.acquire({ id: 'bounded-' + revision, owner: 'engineer', task: 'fenced-task', revision, actor: 'builder-1', resources: [
    { kind: 'actor', actor: 'builder-1' }, { kind: 'items', actor: 'builder-1' },
    { kind: 'area', surface: 'nauvis', bounds: [{ x: x - 1, y: y - 1 }, { x: x + 1, y: y + 1 }] },
    { kind: 'area', surface: 'nauvis', bounds: [{ x: 3, y: 1 }, { x: 5, y: 3 }] },
  ] });
  assignment = await runtime.ownership.flush(bounded.id); const boundedWalk = await submit([{ kind: 'walk', position: { x: 4, y: 2 } }]);
  await waitFor('Rejected unreserved path', async () => { const a = actor(await poll()); const p = record(a.position); assert(Number(p.x) >= x - 1 && Number(p.x) <= x + 1 && Number(p.y) >= y - 1 && Number(p.y) <= y + 1); const r = await game.receipt(boundedWalk.commandId); if (r && !['accepted', 'running'].includes(r.status)) { assert.equal(r.status, 'failed'); return r; } return undefined; }, 10000, 30);
  await runtime.execution.reconcile(); await revoke(); pass('Path between disjoint reserved endpoints fails before entering the unreserved gap');
  await acquire(); const savedOrder = await submit([{ kind: 'craft', recipe: 'iron-gear-wheel', count: 20 }, chest]);
  const manifestPath = await runtime.capture({ saveDirectory: path.join(profile.dir, 'data/saves'), outputDirectory: path.join(evidence, 'checkpoints'), logFile: profile.log, world: observe, modHash });
  const manifest = await validateCheckpoint(manifestPath, modHash); assert.equal(manifest.captured.ledger[savedOrder.commandId]?.status, 'suspended');
  revision++; runtime.task(task('cancelled')); await runtime.ownership.flush(assignment.id); assert.equal((await game.receipt(savedOrder.commandId))?.status, 'cancelled');
  pass('Checkpoint contains pending work whose task is durably cancelled and acknowledged afterward');
  runtime.close(); port.close(); await stopProfile(profile.observerConfig); await stopProfile(profile.config);
  restoredDirectory = path.join(evidence, 'managed-load'); await prepareManagedLoad(manifestPath, modHash, restoredDirectory);
  activeProfile = await configureProfile(restoredDirectory, path.join(restoredDirectory, manifest.save), { source: profile, port: 27027, gamePort: 34207 });
  await startServer(activeProfile); port = await waitForServer(activeProfile); connect(); control = await life.inspect(); barrier(control); verifyLoaded(manifest, control, await observe(), true);
  await startObserver(activeProfile); console.log('Waiting for visible held restore');
  await waitFor('Restored visible player', async () => { const w = await observe(); return record(w.actors)['builder-1'] && actor(w).connected === true ? w : undefined; }); await identifyObserver(activeProfile);
  control = await life.inspect(); await runtime.restoreHeld(manifest.name, modHash, control, await observe());
  assert.equal(runtime.recovery().tasks.find(t => t.id === 'fenced-task')?.status, 'cancelled');
  control = await runtime.resume(control);
  assert.throws(() => runtime.intent({ ...savedOrder, epoch: control.epoch, session: control.session, commandId: 'late-after-restore' }), /Task admission closed/);
  await assert.rejects(() => game.request({ op: 'submit', batch: { ...savedOrder, epoch: control.epoch, session: control.session, commandId: 'old-current-epoch' } }), /task_revision/);
  await heldEffects('Managed restore preserves latest cancelled task; fresh epoch alone cannot authorize saved or late obsolete work');
  await acquire(); const fresh = await submit([chest]);
  await waitFor('Replacement placement', async () => { await poll(); const r = await game.receipt(fresh.commandId); if (r && !['accepted', 'running'].includes(r.status)) { assert.equal(r.status, 'completed'); return r; } return undefined; }, 10000, 40);
  assert.equal(((await observe()).entities as Record<string, unknown>[]).filter(e => e.name === 'wooden-chest').length, 1);
  control = await runtime.recover(); barrier(control); pass('Fresh authorized replacement creates exactly one chest; final restored world is paused and disarmed');
  await writeFile(path.join(evidence, 'recovered-state.json'), JSON.stringify({ recovery: runtime.recovery(), ownership: runtime.ownership.list(), control }, null, 2));
} catch (error) { failure = String(error); process.exitCode = 1; sink({ kind: 'probe/failed', failure }); console.error(failure); }
finally {
  try { if (life) { control = await life.inspect(); if (control.armed) await life.pause(control); } } catch { sink({ kind: 'probe/cleanup-unconfirmed' }); }
  runtime?.close(); port.close(); await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed: failure === null, failure, checks, restoredDirectory }, null, 2)); console.log(JSON.stringify({ evidence, failure, checks: checks.length }));
}
