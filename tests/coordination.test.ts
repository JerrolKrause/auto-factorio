import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diagnosticAssignment } from '@autofactorio/contracts';
import type { Batch, OwnershipControl, Receipt } from '@autofactorio/contracts';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import type { ControlState } from '../packages/factorio/src/lifecycle.js';
import { PROBE_CAPS } from '../packages/codex/src/budget.js';
import { Coordinator } from '../packages/core/orchestration/coordinator.js';
import type { TaskInput } from '../packages/core/orchestration/coordinator.js';
import { team, soloTeam, engineer } from '../packages/core/orchestration/roles.js';
import { CoordinationGateway } from '../packages/tools/src/coordination.js';

const caps = { ...PROBE_CAPS, turns: 20, tools: 100, runMs: 10000, turnMs: 9000 };
const resources = diagnosticAssignment(1).resources.map(r => r.resource);
function task(id = 'task', actor: string | null = 'builder-1'): TaskInput {
  return { id, goal: 'perform ' + id, parent: null, dependencies: [], scope: {}, resources: {}, successCriteria: ['completed receipt'], deadline: null, committedPlan: 'place chest', actor, reservations: actor ? resources : [], criteria: [{ kind: 'command-completed', id: id + '-command' }] };
}
async function fixture(directory = mkdtempSync(path.join(os.tmpdir(), 'af-coordination-')), prior?: ControlState) {
  const control: ControlState = prior ?? { ok: true, epoch: 'epoch', session: 'session', revision: 1, generation: 1, armed: false, ready: false, paused: true, neutral: true, ticksToRun: 0, tick: 100, ticksPlayed: 100, experimentTick: 100, scenarioElapsed: 100, injections: 1, checkpoint: false, ledger: {}, intents: {}, production: {}, mods: {} };
  const port = { command: async () => JSON.stringify(control), close: () => {} };
  const game = new GameClient(port, () => {}); const life = new Lifecycle(port, game, () => {});
  life.inspect = async () => structuredClone(control);
  life.pause = async () => { control.armed = false; control.paused = true; return structuredClone(control); };
  life.reconcile = async () => structuredClone(control);
  life.arm = async () => { control.armed = true; control.paused = false; return structuredClone(control); };
  const controls: OwnershipControl[] = []; let lost = false;
  life.ownership = async request => {
    controls.push(structuredClone(request));
    if (lost) throw new Error('disconnected');
    const receipts: Receipt[] = [];
    if (request.operation === 'revoke') for (const r of Object.values(control.ledger)) {
      if (['accepted', 'running'].includes(r.status)) { r.status = 'cancelled'; r.endedTick = 101; }
      receipts.push(r);
    }
    return { request, tick: 101, receipts };
  };
  let sends = 0;
  game.request = async input => {
    const b = (input as { batch: Batch }).batch; sends++;
    const receipt: Receipt = { commandId: b.commandId, status: 'running', acceptedTick: 100, endedTick: 100, completed: 0, unexecuted: b.steps.length, steps: [] };
    control.ledger[b.commandId] = receipt; return { ok: true, receipt };
  };
  let runtime = new DurableRuntime(directory, 'run', 'epoch', game, life); let now = 0;
  let c = new Coordinator(runtime, caps, () => now); let gateway = new CoordinationGateway(c);
  await runtime.recover(); await runtime.resume(control);
  return {
    get runtime() { return runtime; }, get c() { return c; }, get gateway() { return gateway; }, control, life, controls,
    now: (n: number) => { now = n; }, lost: (v: boolean) => { lost = v; }, sends: () => sends,
    bind(who: string, interrupt = async () => {}) { const turn = c.budget.admit(who); return { turn, token: gateway.issue(c.bind(who, who + '-session-' + turn.id, turn.id, interrupt)) }; },
    async restart() { runtime.close(); runtime = new DurableRuntime(directory, 'run', 'epoch', game, life); c = new Coordinator(runtime, caps, () => now); gateway = new CoordinationGateway(c); await runtime.execution.reconcile(); },
    close() { runtime.close(); },
  };
}
function batch(f: Awaited<ReturnType<typeof fixture>>, key = 'task'): Batch {
  const r = f.runtime.ownership.list().find(r => r.task === key && r.state === 'active')!;
  return { commandId: key + '-command', epoch: 'epoch', session: 'session', task: key, revision: f.c.task(key).revision, actor: r.actor, surface: 'nauvis', grants: r.resources.map(r => r.grant), deadline: 1000, steps: [{ kind: 'place', item: 'wooden-chest', quality: 'normal', direction: 0, position: { x: 2.5, y: 2.5 } }] };
}
async function assigned(f: Awaited<ReturnType<typeof fixture>>, key = 'task', who = 'engineer', manager = 'foreman', body: string | null = 'builder-1') {
  f.c.propose(manager, task(key, body)); f.c.send(manager, { id: key + '-assign', recipient: who, task: key, revision: 1, intent: 'handoff', content: 'Build', evidence: [] }); await f.c.pump();
}
describe('phase 07 durable coordination', () => {
  it('registers independent histories, a bodyless foreman and an ordinary third specialist', async () => {
    const f = await fixture(); team().forEach(a => f.c.register(a));
    f.c.register({ id: 'inspector', definition: { ...engineer, id: 'inspector' }, actors: [] });
    await assigned(f, 'inspect', 'inspector', 'foreman', null);
    expect(f.c.agent('foreman').actors).toEqual([]); expect(f.c.task('inspect').owner).toBe('inspector');
    expect(f.c.view('engineer').tasks).toEqual([]); expect(f.c.view('inspector').history.every(h => h.agent === 'inspector')).toBe(true);
    expect(f.c.view('foreman').history).not.toEqual(f.c.view('inspector').history); f.close();
  });
  it('rejects provider-session sharing, forged identities, forbidden tools and stale tokens', async () => {
    const f = await fixture(); team().forEach(a => f.c.register(a)); const fore = f.bind('foreman'); const eng = f.bind('engineer');
    expect(() => f.c.bind('engineer', 'foreman-session-' + fore.turn.id, eng.turn.id, async () => {})).toThrow('another agent');
    expect(() => f.gateway.call(fore.token, 'observe', { agent: 'engineer' })).toThrow('spoofing');
    expect(() => f.gateway.call(fore.token, 'submit', { batch: {} })).toThrow('admission');
    expect(() => f.gateway.call(eng.token, 'propose', { task: task() })).toThrow('admission');
    f.c.finish(fore.turn.id); expect(() => f.gateway.call(fore.token, 'observe', {})).toThrow('closed');
    expect(f.c.budget.state.attempts).toBe(4); f.close();
  });
  it('enforces registered observation scope independently of tool and task scope', async () => {
    const f = await fixture(); team().forEach(a => f.c.register(a));
    f.c.register({ id: 'limited', definition: { ...engineer, id: 'limited', observations: ['messages'] }, actors: [] });
    await assigned(f, 'limited-task', 'limited', 'foreman', null);
    const view = f.c.view('limited'); expect(view.tasks).toEqual([]); expect(view.history).toEqual([]); expect(view.messages).toHaveLength(1); f.close();
  });
  it('rejects dependency cycles, unsupported criteria and stale revisions before mutating the graph', async () => {
    const f = await fixture(); team().forEach(a => f.c.register(a)); f.c.propose('foreman', task('a')); f.c.propose('foreman', { ...task('b'), dependencies: ['a'] });
    expect(() => f.c.revise('foreman', 'a', 1, { ...task('a'), dependencies: ['b'] })).toThrow('cycle');
    expect(() => f.c.propose('foreman', { ...task('bad'), criteria: [] })).toThrow('criteria');
    f.c.revise('foreman', 'a', 1, task('a')); expect(() => f.c.revise('foreman', 'a', 1, task('a'))).toThrow('Stale');
    expect(f.c.view('foreman').history.some(h => h.kind === 'superseded')).toBe(true); f.close();
  });
  it.each([false, true])('deduplicates a durable handoff on either side of delivery across restart: delivered=%s', async delivered => {
    const f = await fixture(); team().forEach(a => f.c.register(a)); f.c.propose('foreman', task('task', null));
    const input = { id: 'assign', recipient: 'engineer', task: 'task', revision: 1, intent: 'handoff' as const, content: 'Build', evidence: [] };
    f.c.send('foreman', input); if (delivered) await f.c.pump(); await f.restart(); f.c.send('foreman', input); await f.c.pump();
    expect(f.c.messages()).toHaveLength(1); expect(f.c.task('task').owner).toBe('engineer');
    expect(f.c.view('engineer').history.filter(h => h.kind === 'received')).toHaveLength(1);
    expect(() => f.c.send('foreman', { ...input, content: 'Different' })).toThrow('collision'); f.close();
  });
  it('rejects stale pending handoffs, outside recipients and actor escalation', async () => {
    const f = await fixture(); team().forEach(a => f.c.register(a)); f.c.propose('foreman', task());
    expect(() => f.c.send('foreman', { id: 'bad', recipient: 'foreman', task: 'task', revision: 1, intent: 'handoff', content: '', evidence: [] })).toThrow('actor');
    f.c.send('foreman', { id: 'old', recipient: 'engineer', task: 'task', revision: 1, intent: 'handoff', content: '', evidence: [] });
    f.c.revise('foreman', 'task', 1, task()); await f.c.pump(); expect(f.c.messages()[0]?.delivery).toBe('rejected'); expect(f.c.task('task').owner).toBeNull(); f.close();
  });
  it('progresses queued actions and dependencies without model polling, verifies receipts and releases ownership', async () => {
    const f = await fixture(); team().forEach(a => f.c.register(a)); await assigned(f);
    f.c.propose('foreman', { ...task('dependent', null), dependencies: ['task'] }); f.c.send('foreman', { id: 'next', recipient: 'engineer', task: 'dependent', revision: 1, intent: 'handoff', content: '', evidence: [] });
    expect(() => f.c.report('engineer', 'task', 1, ['task-command'])).toThrow('evidence');
    f.c.submit('engineer', batch(f)); await f.c.pump(); expect(f.sends()).toBe(1); expect(f.c.task('dependent').wait).toBe('dependency');
    Object.assign(f.control.ledger['task-command']!, { status: 'completed', completed: 1, unexecuted: 0, endedTick: 101, steps: [{ index: 1, status: 'completed', startedTick: 100, endedTick: 101, before: [], after: [], delta: [] }] }); await f.c.pump();
    f.c.report('engineer', 'task', 1, ['task-command']); await f.c.pump(); await f.c.pump();
    expect(f.c.task('task').status).toBe('succeeded'); expect(f.c.task('dependent').status).toBe('assigned'); expect(f.c.budget.state.spentTurns).toBe(0); expect(f.sends()).toBe(1); f.close();
  });
  it.each(['team', 'solo'])('supports %s message evidence, assistance and restart using the same contracts', async mode => {
    const f = await fixture(); const roster = mode === 'team' ? team() : soloTeam(); roster.forEach(a => f.c.register(a));
    const manager = roster[0]!.id, owner = roster.at(-1)!.id;
    f.c.propose(manager, { ...task('plan', null), criteria: [{ kind: 'message-delivered', id: 'plan-report' }] });
    f.c.send(manager, { id: 'assign', recipient: owner, task: 'plan', revision: 1, intent: 'handoff', content: '', evidence: [] }); await f.c.pump();
    f.c.send(owner, { id: 'help', recipient: manager, task: 'plan', revision: 1, intent: 'assistance', content: 'Need layout decision', evidence: [] }); await f.c.pump();
    const report = { id: 'plan-report', recipient: manager, task: 'plan', revision: 1, intent: 'report' as const, content: 'Plan attached', evidence: [] };
    f.c.send(owner, report); await f.c.pump(); await f.restart(); f.c.send(owner, report); f.c.report(owner, 'plan', 1, ['plan-report']); await f.c.pump();
    expect(f.c.task('plan').status).toBe('succeeded'); expect(f.c.messages()).toHaveLength(3); f.close();
  });
  it('closes both active sessions, rejects late work, retains uncertain cancellation and never resets spent budgets', async () => {
    const f = await fixture(); team().forEach(a => f.c.register(a)); await assigned(f);
    let interrupted = 0; const fore = f.bind('foreman', async () => { interrupted++; }); const eng = f.bind('engineer', async () => { interrupted++; });
    f.gateway.call(eng.token, 'submit', { batch: batch(f) }); await f.c.pump(); f.lost(true); f.now(10001);
    await expect(f.c.pump()).rejects.toThrow('unconfirmed'); expect(interrupted).toBe(2);
    expect(f.c.budget.get(eng.turn.id).cancellation).toBe('unconfirmed');
    expect(() => f.gateway.call(fore.token, 'message', { message: {} })).toThrow('closed');
    expect(() => f.gateway.call(eng.token, 'submit', { batch: batch(f) })).toThrow();
    const request = f.runtime.ownership.list()[0]!.request.id;
    await f.restart(); expect(f.c.budget.state.spentTurns).toBe(2); expect(() => f.c.budget.admit('foreman')).toThrow('closed');
    f.lost(false); await f.c.pump(); expect(f.runtime.ownership.list()[0]!.request.id).toBe(request);
    expect(f.c.budget.get(eng.turn.id).cancellation).toBe('confirmed'); expect(f.control.ledger['task-command']!.status).toBe('cancelled'); f.close();
  });
  it('does not wait for an unresponsive provider interrupt before cancelling game work', async () => {
    const f = await fixture(); team().forEach(a => f.c.register(a)); await assigned(f); f.bind('engineer', () => new Promise(() => {}));
    f.c.submit('engineer', batch(f)); await f.c.pump(); f.c.stop('allowance'); await f.c.pump();
    expect(f.runtime.ownership.list()[0]?.state).toBe('released'); expect(f.c.pendingStops()[0]?.interrupt).toBe('unconfirmed'); f.close();
  });
  it('rejects old-session tokens after replacement and requires task revision after held ownership release', async () => {
    const f = await fixture(); team().forEach(a => f.c.register(a)); await assigned(f); const eng = f.bind('engineer');
    await f.restart(); expect(() => f.gateway.call(eng.token, 'observe', {})).toThrow('Unauthenticated'); await f.c.pump(); expect(f.c.task('task').status).toBe('blocked'); f.close();
  });
  it('rechecks scheduler closure after deferred dispatch inspection', async () => {
    const f = await fixture(); team().forEach(a => f.c.register(a)); await assigned(f); f.c.submit('engineer', batch(f));
    let release!: () => void; f.life.inspect = async () => { await new Promise<void>(r => { release = r; }); return structuredClone(f.control); };
    const dispatch = f.runtime.dispatch('task-command'); f.c.stop('allowance'); release(); await expect(dispatch).rejects.toThrow('closed'); expect(f.sends()).toBe(0); f.close();
  });
  it('bounds derived reservation IDs and rejects incomplete reservations before persisting', async () => {
    const f = await fixture(); team().forEach(a => f.c.register(a));
    expect(() => f.c.propose('foreman', { ...task('invalid'), reservations: [] })).toThrow('Incomplete'); expect(f.c.tasks()).toEqual([]);
    expect(() => f.c.propose('foreman', { ...task('duplicate'), reservations: [...resources, resources[0]!] })).toThrow('Duplicate');
    expect(() => f.c.propose('foreman', { ...task('long-surface'), reservations: resources.map(r => r.kind === 'area' ? { ...r, surface: 's'.repeat(100) } : r) })).toThrow('identity');
    const key = 't'.repeat(100); f.c.propose('foreman', task(key));
    f.c.send('foreman', { id: 'long-task-assignment', task: key, revision: 1, recipient: 'engineer', intent: 'handoff', content: '', evidence: [] });
    await f.c.pump(); expect(f.runtime.ownership.list()[0]!.id.length).toBeLessThanOrEqual(100); f.close();
  });
  it('does not recursively inject recorded observation responses into history', async () => {
    const f = await fixture(); team().forEach(a => f.c.register(a)); const fore = f.bind('foreman');
    for (let i = 0; i < 8; i++) f.gateway.call(fore.token, 'observe', {});
    const view = f.c.view('foreman'); expect(view.history.some(h => h.kind === 'tool-result')).toBe(false);
    expect(JSON.stringify(view).length).toBeLessThan(10000);
    expect(f.runtime.journal.events().filter(e => e.type === 'agent/tool-result')).toHaveLength(8); f.close();
  });
  it('keeps a single execution lane and cancels queued remainder when reconciliation first discovers failure', async () => {
    const f = await fixture(); team().forEach(a => f.c.register(a)); await assigned(f); const first = batch(f);
    f.c.submit('engineer', first); f.c.submit('engineer', { ...first, commandId: 'second' });
    await f.c.pump(); expect(f.sends()).toBe(1); await f.c.pump(); expect(f.sends()).toBe(1);
    Object.assign(f.control.ledger[first.commandId]!, { status: 'failed', endedTick: 101 });
    await f.c.pump(); expect(f.sends()).toBe(1); expect(f.c.task('task').status).toBe('failed');
    expect(f.runtime.execution.pending().find(c => c.batch.commandId === 'second')?.state).toBe('rolled_back'); f.close();
  });
});
