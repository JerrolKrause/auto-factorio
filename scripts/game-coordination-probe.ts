import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { diagnosticAssignment, record } from '@autofactorio/contracts';
import type { Batch, Step } from '@autofactorio/contracts';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { Coordinator } from '../packages/core/orchestration/coordinator.js';
import type { TaskInput } from '../packages/core/orchestration/coordinator.js';
import { team, engineer } from '../packages/core/orchestration/roles.js';
import { CoordinationGateway } from '../packages/tools/src/coordination.js';
import { PROBE_CAPS } from '../packages/codex/src/budget.js';
import { GameClient, observeRequest } from '../packages/factorio/src/client.js';
import { Lifecycle, barrier, sha256 } from '../packages/factorio/src/lifecycle.js';
import type { ControlState } from '../packages/factorio/src/lifecycle.js';
import { readProfile, waitForServer, waitFor, identifyObserver } from './dev/game-processes.js';

const flag = process.argv.indexOf('--profile-file');
if (flag < 0) throw new Error('Explicit fresh --profile-file required');
const profile = await readProfile((JSON.parse(await readFile(process.argv[flag + 1]!, 'utf8')) as { dir: string }).dir);
const evidence = await mkdtemp(path.join(profile.dir, 'coordination-probe-'));
const checks: string[] = []; const sink = (e: unknown) => appendFileSync(path.join(evidence, 'events.jsonl'), JSON.stringify(e) + '\n');
const pass = (s: string) => { checks.push(s); sink({ kind: 'probe/pass', detail: s }); console.log(s); };
const sources = ['scripts/game-coordination-probe.ts', 'packages/core/orchestration/coordinator.ts', 'packages/core/orchestration/roles.ts', 'packages/tools/src/coordination.ts', 'packages/contracts/src/coordination.ts', 'apps/runtime/durable-runtime.ts', 'packages/core/execution/durable.ts', 'packages/core/execution/ownership.ts', 'packages/storage/src/journal.ts', 'packages/codex/src/budget.ts', 'mods/autofactorio/control.lua', 'mods/autofactorio/actions.lua', 'mods/autofactorio/ownership.lua', 'mods/autofactorio/lifecycle.lua', 'mods/autofactorio/common.lua', 'mods/autofactorio/info.json'];
const hashes = Object.fromEntries(await Promise.all(sources.map(async file => [file, sha256(await readFile(file))])));
for (const file of sources.filter(f => f.startsWith('mods/'))) assert.equal(sha256(await readFile(path.join(profile.mods, 'autofactorio_0.1.0', path.basename(file)))), hashes[file], 'Live mod differs');
await writeFile(path.join(evidence, 'source-manifest.json'), JSON.stringify(hashes, null, 2));
const port = await waitForServer(profile); const game = new GameClient(port, sink); const life = new Lifecycle(port, game, sink);
let runtime!: DurableRuntime; let c: Coordinator; let gateway: CoordinationGateway; let control: ControlState; let failure: string | null = null;
const caps = { ...PROBE_CAPS, runMs: 300000, turnMs: 240000, tools: 40 };
const connect = () => { runtime = new DurableRuntime(path.join(evidence, 'runtime'), path.basename(evidence), 'initial', game, life, [profile.password]); c = new Coordinator(runtime, caps); gateway = new CoordinationGateway(c); };
const observe = () => game.request(observeRequest);
const actor = (w: Record<string, unknown>) => record(record(w.actors)['builder-1']);
const input = (id: string): TaskInput => ({ id, goal: 'coordination ' + id, parent: null, dependencies: [], scope: {}, resources: {}, successCriteria: ['completed legal command'], deadline: null, committedPlan: 'deterministic diagnostic', actor: 'builder-1', reservations: diagnosticAssignment(1).resources.map(g => g.resource), criteria: [{ kind: 'command-completed', id: id + '-command' }] });
const makeBatch = (task: string, steps: Step[]): Batch => {
  const r = runtime.ownership.list().find(r => r.task === task && r.state === 'active')!;
  return { commandId: task + '-command', epoch: control.epoch, session: control.session, task, revision: c.task(task).revision, actor: r.actor, surface: 'nauvis', grants: r.resources.map(g => g.grant), deadline: control.tick + 36000, steps };
};
try {
  await port.command('/silent-command rcon.print("AutoFactorio phase07")'); await port.command('/silent-command rcon.print("AutoFactorio phase07")');
  console.log('Waiting for visible phase 07 player');
  await waitFor('Visible player', async () => { const w = await observe(); return record(w.actors)['builder-1'] && actor(w).connected === true ? w : undefined; }); await identifyObserver(profile);
  control = await life.inspect(); assert.equal(Object.keys(control.ledger).length, 0, 'Fresh world required'); connect();
  control = await runtime!.recover(); control = await runtime!.resume(control);
  team().forEach(a => c!.register(a)); c!.register({ id: 'inspector', definition: { ...engineer, id: 'inspector' }, actors: [] });
  const interrupted = new Set<string>();
  const bind = (agent: string) => {
    const turn = c!.budget.admit(agent);
    return { turn, token: gateway!.issue(c!.bind(agent, 'synthetic-' + agent, turn.id, async () => { interrupted.add(agent); c!.finish(turn.id, true); })) };
  };
  const foreman = bind('foreman'); const builder = bind('engineer');
  gateway!.call(foreman.token, 'propose', { task: input('chest') });
  const handoff = { id: 'chest-handoff', recipient: 'engineer', task: 'chest', revision: 1, intent: 'handoff', content: 'Place one chest', evidence: [] };
  gateway!.call(foreman.token, 'message', { message: handoff }); gateway!.call(foreman.token, 'message', { message: handoff }); await c!.pump();
  assert.equal(c!.messages().filter(m => m.id === handoff.id).length, 1); assert.equal(c!.agent('foreman').actors.length, 0);
  pass('Separate synthetic sessions share one budget; durable duplicate handoff assigns one builder to a bodyless foreman task');
  gateway!.call(foreman.token, 'propose', { task: { ...input('craft'), dependencies: ['chest'] } });
  gateway!.call(foreman.token, 'message', { message: { ...handoff, id: 'craft-handoff', task: 'craft', content: 'Craft after chest' } }); await c!.pump(); assert.equal(c!.task('craft').wait, 'dependency');
  const chest = makeBatch('chest', [{ kind: 'place', item: 'wooden-chest', quality: 'normal', position: { x: 2.5, y: 2.5 }, direction: 0 }]);
  gateway!.call(builder.token, 'submit', { batch: chest });
  await waitFor('Completed chest', async () => { control = await life.heartbeat(control); await c!.pump(); const r = await game.receipt(chest.commandId); return r?.status === 'completed' ? r : undefined; }, 10000, 40);
  await c!.pump(); // The final direct receipt read may be newer than the preceding durable reconciliation.
  gateway!.call(builder.token, 'report', { task: 'chest', revision: 1, evidence: [chest.commandId] }); await c!.pump(); await c!.pump();
  assert.equal(c!.task('chest').status, 'succeeded'); assert.equal(c!.task('craft').status, 'assigned');
  assert.equal(((await observe()).entities as Record<string, unknown>[]).filter(e => e.name === 'wooden-chest').length, 1);
  pass('Receipt evidence completes a legal placement and wakes its dependent task without extra provider turns');
  c!.propose('foreman', { ...input('inspection'), actor: null, reservations: [], criteria: [{ kind: 'message-delivered', id: 'inspection-report' }] });
  c!.send('foreman', { ...handoff, id: 'inspection-handoff', task: 'inspection', recipient: 'inspector', intent: 'handoff' }); await c!.pump();
  c!.send('inspector', { ...handoff, id: 'inspection-report', task: 'inspection', recipient: 'foreman', intent: 'report' }); await c!.pump();
  c!.report('inspector', 'inspection', 1, ['inspection-report']); await c!.pump();
  assert.equal(c!.task('inspection').status, 'succeeded'); assert(c!.view('inspector').history.every(h => h.agent === 'inspector'));
  pass('Third bodyless specialist uses the same assignment, history, message and evidence contracts');
  const crafting = makeBatch('craft', [{ kind: 'craft', recipe: 'iron-gear-wheel', count: 40 }]); gateway!.call(builder.token, 'submit', { batch: crafting });
  await waitFor('Active crafting', async () => { control = await life.heartbeat(control); await c!.pump(); const a = actor(await observe()); return Object.keys(a.crafting as object).length ? a : undefined; }, 10000, 25);
  assert.equal(c!.budget.state.turns.filter(t => !t.finished).length, 2); c!.budget.usage('synthetic-ceiling', caps.tokens!);
  assert.throws(() => gateway!.call(builder.token, 'submit', { batch: { ...crafting, commandId: 'late' } }), /closed/);
  assert.throws(() => gateway!.call(foreman.token, 'message', { message: handoff }), /closed/);
  await c!.pump(); assert.deepEqual([...interrupted].sort(), ['engineer', 'foreman']);
  assert(c!.budget.state.turns.every(t => t.cancellation === 'confirmed' && t.interrupt === 'confirmed'));
  assert.equal((await game.receipt(crafting.commandId))?.status, 'cancelled'); assert(runtime!.ownership.list().every(r => r.state === 'released'));
  const held = actor(await observe());
  for (let i = 0; i < 10; i++) { await delay(60); control = await life.heartbeat(control); const next = actor(await observe()); assert.deepEqual(next.inventory, held.inventory); assert.deepEqual(next.position, held.position); assert.equal(Object.keys(next.crafting as object).length, 0); }
  pass('Reported-token exhaustion closes both synthetic sessions and acknowledges live crafting cancellation with stable subsequent inventory');
  control = await runtime!.recover(); barrier(control); const before = c!.budget.snapshot(); runtime!.close(); connect(); await runtime!.recover(); await c!.pump();
  assert.equal(c!.budget.state.spentTurns, before.spentTurns); assert.equal(c!.budget.state.reportedTokens, caps.tokens); assert.throws(() => c!.budget.admit('engineer'), /closed/);
  assert.equal(c!.task('chest').status, 'succeeded'); assert.equal(c!.messages().filter(m => m.id === 'chest-handoff').length, 1);
  pass('Replacement reconstructs task/messages and spent roster budget; final visible world remains paused, neutral and disarmed');
  await writeFile(path.join(evidence, 'recovered-state.json'), JSON.stringify({ recovery: runtime!.recovery(), agents: c!.agents(), tasks: c!.tasks(), messages: c!.messages(), budget: c!.budget.snapshot(), control }, null, 2));
} catch (error) { failure = String(error); process.exitCode = 1; sink({ kind: 'probe/failed', failure }); console.error(failure); }
finally {
  try { const s = await life.inspect(); if (s.armed) await life.pause(s); } catch { sink({ kind: 'probe/cleanup-unconfirmed' }); }
  runtime?.close(); port.close(); await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ passed: failure === null, failure, checks, inference: false }, null, 2)); console.log(JSON.stringify({ evidence, failure, checks: checks.length }));
}
