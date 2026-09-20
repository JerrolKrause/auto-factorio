import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dashboardFixture } from '../scripts/dev/dashboard-fixture.js';
import { dashboard } from '../apps/runtime/http.js';
import { applyEvent } from '../apps/dashboard/src/state.js';
import type { DashboardSnapshot } from '../apps/runtime/dashboard-types.js';
import { AgentContext } from '../packages/core/context/service.js';
import { CoordinationGateway } from '../packages/tools/src/coordination.js';
import { Operator } from '../apps/runtime/operator.js';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { Coordinator } from '../packages/core/orchestration/coordinator.js';
import { diagnosticAssignment } from '@autofactorio/contracts';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture(seed = true) {
  const f = await dashboardFixture(mkdtempSync(path.join(os.tmpdir(), 'af-dashboard-')), seed); cleanup.push(() => f.close()); return f;
}
async function http() {
  const f = await fixture(); const server = dashboard(f.operator); const origin = await server.listen(); cleanup.push(() => server.close());
  const headers = { host: new URL(origin).host, authorization: 'Bearer ' + server.capability, origin };
  return { ...f, server, origin, headers };
}
describe('operator boundary and durable replay', () => {
  it('creates a bookmark-safe same-origin session cookie on the health/page boundary', async () => {
    const f = await http();
    expect(f.origin).toMatch(/^http:\/\/localhost:\d+$/);
    const health = await f.server.app.inject({ url: '/health', headers: { host: new URL(f.origin).host } });
    expect(health.statusCode).toBe(200);
    expect(health.headers['x-autofactorio-service']).toBe('dashboard');
    const cookie = String(health.headers['set-cookie'] ?? '').split(';', 1)[0];
    expect(cookie).toMatch(/^af_session=[a-f0-9]{64}$/);
    const response = await f.server.app.inject({ url: '/api/snapshot', headers: { host: new URL(f.origin).host, origin: f.origin, cookie } });
    expect(response.statusCode).toBe(200);
  });

  it('requires exact local host, capability and command origin without CORS', async () => {
    const f = await http();
    for (const headers of [{ ...f.headers, host: 'attacker.test' }, { ...f.headers, origin: 'https://attacker.test' }, { ...f.headers, authorization: 'Bearer wrong' }, { ...f.headers, 'sec-fetch-site': 'cross-site' }]) {
      const response = await f.server.app.inject({ method: 'POST', url: '/api/control', headers, payload: { action: 'resume' } }); expect([401, 403]).toContain(response.statusCode);
    }
    const { origin: _, ...noOrigin } = f.headers; void _;
    expect((await f.server.app.inject({ method: 'POST', url: '/api/advice', headers: noOrigin, payload: {} })).statusCode).toBe(403);
    expect(f.c.tasks()).toHaveLength(2);
  });
  it('reconstructs projections at one cursor and deduplicates resumed event delivery', async () => {
    const f = await http();
    const snapshot = (await f.server.app.inject({ url: '/api/snapshot', headers: f.headers })).json<DashboardSnapshot>();
    f.c.activity('engineer', 'explanation', { text: 'new observation' });
    const page = f.runtime.journal.page(f.runtime.run, snapshot.cursor);
    let next = snapshot; for (const event of [...page, ...page]) next = applyEvent(next, event);
    expect(next.events.filter(e => e.sequence === page[0]!.sequence)).toHaveLength(1);
    expect(next.cursor).toBe(f.runtime.journal.cursor());
    expect(() => f.runtime.journal.page(f.runtime.run, -1)).toThrow();
    expect((await f.server.app.inject({ url: '/api/history?after=999999999', headers: f.headers })).statusCode).toBe(400);
  });
  it('streams events from a durable cursor, including changes while the browser was absent', async () => {
    const f = await http(); const cursor = f.runtime.journal.cursor();
    f.c.activity('foreman', 'explanation', { text: 'while absent' });
    const abort = new AbortController();
    const response = await fetch(f.origin + '/api/events?after=' + cursor, { headers: { authorization: f.headers.authorization }, signal: abort.signal });
    expect(response.status).toBe(200); const reader = response.body!.getReader();
    let text = ''; while (!text.includes('while absent')) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain('id: ' + f.runtime.journal.cursor()); abort.abort();
  });
  it('persists exact advice before delivery; duplicate retries never create work or cancel batches', async () => {
    const f = await http(); const before = f.c.tasks();
    f.runtime.record('run/fixture', [{ entity: 'runs', id: f.runtime.run, value: { objective: 'fixture', assisted: false } }]);
    const input = { id: 'advice-1', recipient: 'engineer', text: '  Check copper first.\nKeep the batch running.  ' };
    for (let n = 0; n < 2; n++) expect((await f.server.app.inject({ method: 'POST', url: '/api/advice', headers: f.headers, payload: input })).statusCode).toBe(200);
    const stored = f.runtime.journal.get<{ text: string; delivery: string; gameTick: number }>(f.runtime.run, 'interventions', input.id)!;
    expect(stored.text).toBe(input.text); expect(stored.delivery).toBe('received'); expect(stored.gameTick).toBeGreaterThan(0);
    expect(f.c.tasks()).toEqual(before);
    expect(f.runtime.journal.get<{ assisted: boolean }>(f.runtime.run, 'runs', f.runtime.run)?.assisted).toBe(true);
    const events = f.runtime.journal.events().filter(e => e.type.startsWith('steering/'));
    expect(events.map(e => e.type)).toEqual(['steering/persisted', 'steering/received']);
    expect(() => f.operator.interventions.advice(input.id, 'engineer', 'changed', 0)).toThrow('conflict');
  });
  it('delivers scoped advice through bounded briefing and records authenticated interpretation separately', async () => {
    const f = await fixture();
    f.operator.interventions.advice('advice', 'engineer', 'Use the supplied materials', 101); f.operator.interventions.deliver();
    const turn = f.c.budget.admit('engineer'); const binding = f.c.bind('engineer', 'engineer-session', turn.id, async () => f.c.finish(turn.id, true));
    const briefing = new AgentContext(f.c, binding).briefing(); expect(JSON.stringify(briefing)).toContain('Use the supplied materials');
    const gateway = new CoordinationGateway(f.c); const token = gateway.issue(binding);
    gateway.call(token, 'interpret', { id: 'advice', interpretation: 'I will inspect the kit first.', resultingTasks: ['survey'], supersededTasks: [] });
    const record = f.runtime.journal.get<{ delivery: string; interpretation: string }>(f.runtime.run, 'interventions', 'advice')!;
    expect(record.delivery).toBe('interpreted'); expect(record.interpretation).toContain('kit');
    expect(() => f.operator.interventions.interpret('foreman', 'advice', 'stolen', [], [])).toThrow();
  });
  it('recovers advice committed before routing using a replacement controller', async () => {
    const f = await fixture(); f.operator.interventions.advice('pending', 'foreman', 'Inspect this', 100);
    const replacement = new Operator(f.c); replacement.interventions.deliver(); replacement.interventions.deliver();
    expect(f.runtime.journal.list(f.runtime.run, 'interventions')).toHaveLength(1);
    expect(f.runtime.journal.events().filter(e => e.type === 'steering/received')).toHaveLength(1);
  });
});
describe('operator controls and integrity', () => {
  it('closes admission synchronously, interrupts both roles, and resumes with fresh game identity', async () => {
    const f = await fixture(); const epoch = f.runtime.context().epoch;
    const turns = ['foreman', 'engineer'].map(role => { const t = f.c.budget.admit(role); return { t, b: f.c.bind(role, role + '-session', t.id, async () => f.c.finish(t.id, true)) }; });
    const pause = f.operator.control('pause'); expect(f.c.held()).toBe(true);
    expect(() => f.c.authenticate(turns[0]!.b, 'observe')).toThrow('closed');
    const paused = await pause; expect(paused.status).toBe('paused'); expect(f.state.paused).toBe(true);
    expect(turns.every(({ t }) => t.finished)).toBe(true);
    const resumed = await f.operator.control('resume'); expect(resumed.status).toBe('running'); expect(f.runtime.context().epoch).not.toBe(epoch);
    expect(f.c.budget.state.spentTurns).toBe(2);
  });
  it('never declares pause confirmed while inference completion is unknown', async () => {
    const f = await fixture(); const t = f.c.budget.admit('engineer'); f.c.bind('engineer', 'session', t.id, async () => {});
    const result = await f.operator.control('pause'); expect(result.status).toBe('unconfirmed'); expect(result.cancellation).toBe('confirmed'); expect(result.inference).toBe('unconfirmed');
    expect((await f.operator.control('resume')).admission).toBe(false);
  });
  it('settles a delayed interruption through monitoring without another user action', async () => {
    const f = await fixture(); const t = f.c.budget.admit('engineer'); f.c.bind('engineer', 'session', t.id, async () => {});
    expect((await f.operator.control('pause')).status).toBe('unconfirmed');
    f.c.finish(t.id, true); await f.operator.poll(); expect(f.operator.state().status).toBe('paused');
  });
  it('serializes a control request behind an in-flight poll with admission already closed', async () => {
    const f = await fixture(); const inspect = f.life.inspect.bind(f.life);
    let interrupted = false; const turn = f.c.budget.admit('engineer');
    f.c.bind('engineer', 'poll-overlap', turn.id, async () => { interrupted = true; f.c.finish(turn.id, true); });
    let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; }); let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    let first = true; f.life.inspect = async () => { if (first) { first = false; entered(); await blocked; } return inspect(); };
    const poll = f.operator.poll(); await started;
    const pause = f.operator.control('pause'); expect(f.c.held()).toBe(true); await Promise.resolve(); expect(interrupted).toBe(true); release(); await poll;
    expect((await pause).status).toBe('paused'); expect(f.state.armed).toBe(false);
  });
  it('suspends routine polling while a trusted workshop operation owns game control', async () => {
    const f = await fixture(); const release = await f.operator.reserveGameControl();
    const tick = f.operator.state().gameTick; f.state.tick += 50;
    await f.operator.poll(); expect(f.operator.state().gameTick).toBe(tick);
    await expect(f.operator.control('pause')).rejects.toThrow('reserved by workshop');
    release(); await expect.poll(() => f.operator.state().gameTick).toBeGreaterThan(tick ?? 0);
  });
  it('waits for an already-started operator control before granting workshop game control', async () => {
    const f = await fixture(); const inspect = f.life.inspect.bind(f.life);
    let unblock!: () => void; const blocked = new Promise<void>(resolve => { unblock = resolve; });
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    let first = true; f.life.inspect = async () => { if (first) { first = false; entered(); await blocked; } return inspect(); };
    const pause = f.operator.control('pause'); await started; let granted = false;
    const reservation = f.operator.reserveGameControl().then(release => { granted = true; return release; });
    await Promise.resolve(); expect(granted).toBe(false); unblock(); await pause;
    const release = await reservation; expect(granted).toBe(true); release(); await f.operator.poll();
  });
  it.each(['deferred', 'rejected'])('interrupts inference before %s game recovery settles', async mode => {
    const f = await fixture(); let interrupted = 0;
    const turn = f.c.budget.admit('engineer'); f.c.bind('engineer', 'session', turn.id, async () => { interrupted++; f.c.finish(turn.id, true); });
    const original = f.life.inspect.bind(f.life); let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; }); let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    f.life.inspect = async () => { entered(); if (mode === 'rejected') throw new Error('Disconnected'); await blocked; return original(); };
    const pause = f.operator.control('pause'); await started;
    expect(interrupted).toBe(1); release(); await pause; expect(interrupted).toBe(1);
  });
  it('retains advice, assistance and spent budget after closing and replacing the runtime', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'af-operator-restart-'));
    const first = await dashboardFixture(directory); first.operator.interventions.advice('saved-advice', 'engineer', 'Durable instruction', 100);
    const turn = first.c.budget.admit('engineer'); first.c.finish(turn.id); first.close();
    const second = await dashboardFixture(directory); cleanup.push(() => second.close());
    expect(second.c.budget.state.spentTurns).toBe(1);
    expect(second.runtime.journal.get<{ assisted: boolean }>(second.runtime.run, 'runs', 'assistance')?.assisted).toBe(true);
    expect(second.runtime.journal.get<{ text: string; delivery: string }>(second.runtime.run, 'interventions', 'saved-advice')).toMatchObject({ text: 'Durable instruction', delivery: 'received' });
  });
  it.each(['control', 'poll'])('recovers identity before revoking a restored active reservation through %s', async route => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'af-operator-reservation-'));
    const f = await dashboardFixture(directory, true);
    const task = f.c.task('survey'); const input = { ...task, actor: 'builder-1', reservations: diagnosticAssignment(1).resources.map(r => r.resource) };
    f.c.revise('foreman', task.id, 1, input);
    f.c.send('foreman', { id: 'replacement-assignment', recipient: 'engineer', task: task.id, revision: 2, intent: 'handoff', content: 'Build', evidence: [] }); await f.c.pump();
    expect(f.runtime.ownership.list().some(r => r.state === 'active')).toBe(true);
    f.close();
    const runtime = new DurableRuntime(directory, 'dashboard-fixture', f.state.epoch, f.game, f.life); cleanup.push(() => runtime.close());
    const c = new Coordinator(runtime, f.c.budget.caps); const operator = new Operator(c);
    if (route === 'control') await operator.control('pause'); else await operator.poll();
    expect(operator.state().status).toBe('paused'); expect(runtime.ownership.list().every(r => r.state === 'released')).toBe(true);
    expect((await operator.control('resume')).status).toBe('running');
  });
  it('keeps disconnected stop and checkpoint unconfirmed, preserves world, then reconciles on resume', async () => {
    const f = await fixture(); f.disconnect(); const result = await f.operator.control('stop');
    expect(result.status).toBe('unconfirmed'); expect(result.checkpoint).toBe('unconfirmed'); expect(result.cancellation).toBe('unconfirmed'); expect(f.c.tasks()).toHaveLength(2);
    f.disconnect(false); expect((await f.operator.control('resume')).status).toBe('running');
  });
  it('budget exhaustion permanently closes scoring and refuses a resume/reset', async () => {
    const f = await fixture(); f.advance(3600001); await f.operator.poll();
    expect(f.operator.state().scoringClosed).toBe(true); expect(f.state.paused).toBe(true);
    expect((await f.operator.control('resume')).admission).toBe(false);
    expect(f.runtime.journal.get<{ valid: boolean }>(f.runtime.run, 'runs', 'verification')?.valid).toBe(false);
  });
  it('closes admission when the game watchdog disarms execution on a healthy connection', async () => {
    const f = await fixture(); f.state.armed = false;
    await f.operator.poll(); expect(f.operator.state().admission).toBe(false);
    expect(f.state.paused).toBe(true); expect(f.operator.state().status).toBe('paused');
  });
  it('invalidates verification for detected edits, keeps uncertain causality and deduplicates polling', async () => {
    const f = await fixture(); const input = { id: 'edit-1', gameTick: 102, detail: { kind: 'rotate' }, causality: 'unknown' as const, verification: true };
    f.operator.humanEdit(input); f.operator.humanEdit(input);
    expect(f.runtime.journal.list(f.runtime.run, 'interventions')).toHaveLength(1);
    expect(f.runtime.journal.get<{ valid: boolean }>(f.runtime.run, 'runs', 'verification')?.valid).toBe(false);
    expect(f.runtime.journal.get<{ assisted: boolean }>(f.runtime.run, 'runs', 'assistance')?.assisted).toBe(true);
    expect(JSON.stringify(f.runtime.journal.list(f.runtime.run, 'interventions'))).toContain('unknown');
  });
  it('explicit reprioritization closes the old revision and refuses a duplicate stale change', async () => {
    const f = await fixture(); const t = f.c.task('survey');
    await f.operator.reprioritize(t.id, t.revision, { ...t, goal: 'Reinspect copper' });
    expect(f.c.task(t.id).revision).toBe(2); expect(f.c.task(t.id).owner).toBeNull();
    expect(f.runtime.journal.get<{ assisted: boolean }>(f.runtime.run, 'runs', 'assistance')?.assisted).toBe(true);
    const intervention = f.runtime.journal.list<{ kind: string; text: string; previousRevision: number; requestedRevision: number }>(f.runtime.run, 'interventions').find(i => i.kind === 'reprioritization')!;
    expect(intervention.text).toContain('Reinspect copper'); expect(intervention.previousRevision).toBe(1); expect(intervention.requestedRevision).toBe(2);
    await expect(f.operator.reprioritize(t.id, t.revision, t)).rejects.toThrow('Stale');
    expect(f.runtime.journal.list(f.runtime.run, 'interventions')).toHaveLength(1);
  });
  it('labels ordinary-world missing production telemetry as unavailable', async () => {
    const f = await fixture(); f.state.production = {}; await f.operator.poll();
    expect(f.runtime.journal.get(f.runtime.run, 'measurements', 'production')).toMatchObject({ complete: false, value: null, coverage: 'Production telemetry unavailable for this world' });
  });
});
