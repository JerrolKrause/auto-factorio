import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diagnosticAssignment } from '@autofactorio/contracts';
import type { Batch, OwnershipAck, OwnershipControl, Resource } from '@autofactorio/contracts';
import { SqliteJournal } from '../packages/storage/src/journal.js';
import { Ownership } from '../packages/core/execution/ownership.js';
import { DurableExecution } from '../packages/core/execution/durable.js';
import type { EventContext, Command } from '../packages/core/execution/durable.js';

const context: EventContext = { run: 'run', epoch: 'epoch', wallTime: '2026-09-15T18:00:00Z', gameTick: null, actor: null, task: null, causation: null, correlation: null, visibility: { kind: 'operator' } };
const resources = diagnosticAssignment(1).resources.map(r => r.resource);
const input = (id = 'first', revision = 1) => ({ id, owner: 'engineer', task: 'task', revision, actor: 'builder-1', resources });
function fixture() {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'af-ownership-')), 'runtime.sqlite');
  const journal = new SqliteJournal(file); const calls: OwnershipControl[] = [];
  const port = { control: async (r: OwnershipControl): Promise<OwnershipAck> => { calls.push(structuredClone(r)); return { request: r, tick: 42, receipts: [] }; } };
  const owner = new Ownership(journal, () => context, port, () => 'session');
  return { file, journal, port, owner, calls };
}
function batch(r: ReturnType<Ownership['acquire']>): Batch { return { commandId: 'command', epoch: 'epoch', session: 'session', task: r.task, revision: r.revision, actor: r.actor, surface: 'nauvis', grants: r.resources.map(g => g.grant), deadline: 1000, steps: [{ kind: 'walk', position: { x: 1, y: 1 } }] }; }
describe('phase 06 acknowledged reservations', () => {
  it('atomically orders opposite inputs and rejects overlapping geometry with different IDs without partial grants', () => {
    const { owner, journal } = fixture(); const r = owner.acquire({ ...input(), resources: [...resources].reverse() });
    expect(r.resources.map(g => g.resource.kind)).toEqual(['actor', 'area', 'items']);
    expect(() => owner.acquire({ ...input('conflict'), task: 'other', resources: [...resources].reverse() })).toThrow('conflict');
    const other: Resource[] = [{ kind: 'actor', actor: 'builder-2' }, { kind: 'items', actor: 'builder-2' }, { kind: 'area', surface: 'nauvis', bounds: [{ x: 10, y: 10 }, { x: 20, y: 20 }] }];
    expect(() => owner.acquire({ ...input('overlap'), task: 'other', actor: 'builder-2', resources: other })).toThrow('conflict');
    expect(owner.list()).toHaveLength(1); expect(journal.cursor()).toBe(1); journal.close();
  });
  it('supports independent agents and actors for disjoint sets', async () => {
    const { owner, journal } = fixture();
    for (let i = 1; i <= 2; i++) {
      const actor = 'builder-' + i; const r = owner.acquire({ id: 'a' + i, owner: 'engineer', task: 't' + i, revision: 1, actor, resources: [{ kind: 'actor', actor }, { kind: 'items', actor }, { kind: 'area', surface: 'nauvis', bounds: [{ x: i * 4, y: 0 }, { x: i * 4 + 2, y: 2 }] }] });
      await owner.flush(r.id); owner.authorize(batch(r), 'engineer'); expect(() => owner.authorize(batch(r), 'foreman')).toThrow('unauthorized');
    }
    expect(owner.list().filter(r => r.state === 'active')).toHaveLength(2); journal.close();
  });
  it('blocks replacement while revoke is delayed, persists admission closure and retries the same ID after process replacement', async () => {
    const { owner, journal, port, file } = fixture(); const r = owner.acquire(input()); await owner.flush(r.id);
    let release!: (a: OwnershipAck) => void; let sent!: OwnershipControl;
    port.control = request => { sent = request; return new Promise(resolve => { release = resolve; }); };
    const revoke = owner.revoke(r.id); const pending = owner.flush(r.id);
    expect(journal.get('run', 'reservations', r.id)).toMatchObject({ state: 'revoking' });
    expect(() => owner.authorize(batch(r), 'engineer')).toThrow(); expect(() => owner.acquire(input('new', 2))).toThrow();
    release({ request: sent, tick: 51, receipts: [] }); await pending; journal.close();
    const reopened = new SqliteJournal(file); const replacement = new Ownership(reopened, () => context, port, () => 'session');
    expect(replacement.revoke(r.id).request.id).toBe(revoke.request.id); const next = replacement.acquire(input('new', 2));
    expect(next.resources.every(g => g.grant.generation === 3)).toBe(true); reopened.close();
  });
  it('keeps a disconnected revoke unavailable across restart and retransmits its exact request', async () => {
    const { owner, journal, port, file } = fixture(); const r = owner.acquire(input()); await owner.flush(r.id);
    const revoking = owner.revoke(r.id); port.control = async () => { throw new Error('disconnected'); }; await expect(owner.flush(r.id)).rejects.toThrow('disconnected'); journal.close();
    const reopened = new SqliteJournal(file); let seen: unknown;
    const retry = new Ownership(reopened, () => context, { control: async request => { seen = request; return { request, tick: 50, receipts: [] }; } }, () => 'session');
    expect(() => retry.acquire(input('new', 2))).toThrow(); await retry.flush(r.id); expect(seen).toEqual(revoking.request); reopened.close();
  });
  it.each(['area', 'actor', 'items', 'task', 'epoch', 'session', 'omission'])('rejects stale %s despite other current fences', async kind => {
    const { owner, journal } = fixture(); const r = owner.acquire(input()); await owner.flush(r.id); const b = batch(r);
    if (kind === 'task') b.revision++;
    else if (kind === 'epoch' || kind === 'session') b[kind] = 'old';
    else if (kind === 'omission') b.grants.pop();
    else b.grants[r.resources.findIndex(g => g.resource.kind === kind)]!.generation++;
    expect(() => owner.authorize(b, 'engineer')).toThrow(); journal.close();
  });
  it('requires all sent final receipts and commits receipt reconciliation atomically with release', async () => {
    const { owner, journal, port } = fixture(); const r = owner.acquire(input()); await owner.flush(r.id);
    const command: Command = { batch: batch(r), state: 'unknown', receipt: null, receiptEpoch: null, reason: 'timeout' };
    journal.append(context, 'command/unknown', [{ entity: 'commands', id: 'command', value: { ...command } }]); owner.revoke(r.id);
    await expect(owner.flush(r.id)).rejects.toThrow('Final command receipt missing'); expect(owner.list()[0]?.state).toBe('revoking');
    port.control = async request => ({ request, tick: 42, receipts: [{ commandId: 'command', status: 'cancelled', acceptedTick: 10, endedTick: 42, completed: 0, unexecuted: 1, steps: [] }] });
    await owner.flush(r.id); expect(journal.get('run', 'commands', 'command')).toMatchObject({ state: 'acknowledged', receipt: { status: 'cancelled' } }); expect(journal.events().at(-1)?.changes).toHaveLength(2); journal.close();
  });
  it('does not send a control or partially acquire when persistence fails', async () => {
    const { owner, journal, calls } = fixture(); journal.append = () => { throw new Error('disk full'); };
    expect(() => owner.acquire(input())).toThrow('disk full'); expect(calls).toHaveLength(0); expect(owner.list()).toHaveLength(0); journal.close();
  });
  it('does not reactivate grants after a bad acknowledgement or released task revision', async () => {
    const { owner, journal, port } = fixture(); const r = owner.acquire(input());
    port.control = async request => ({ request: { ...request, id: 'other' }, tick: 42, receipts: [] });
    await expect(owner.flush(r.id)).rejects.toThrow('mismatch'); expect(() => owner.authorize(batch(r), 'engineer')).toThrow();
    owner.restoreHeld(); expect(() => owner.acquire(input('new', 1))).toThrow('revision'); expect(() => owner.authorize(batch(r), 'engineer')).toThrow(); journal.close();
  });
  it.each([false, true])('rechecks the unsent boundary after deferred inspection, revoke acknowledged=%s', async acknowledged => {
    const { owner, journal } = fixture(); const r = owner.acquire(input()); await owner.flush(r.id);
    let release!: () => void; let deferred = false; let sends = 0;
    const execution = new DurableExecution(journal, () => context, {
      inspect: async () => { if (deferred) await new Promise<void>(resolve => { release = resolve; }); return { epoch: 'epoch', session: 'session', ledger: {} }; },
      authorize: b => owner.authorize(b, 'engineer'), submit: async () => { sends++; throw new Error('Must not send'); },
    });
    execution.intent(batch(r)); await execution.reconcile(); deferred = true; const pending = execution.dispatch('command');
    owner.revoke(r.id); if (acknowledged) await owner.flush(r.id); release(); await expect(pending).rejects.toThrow();
    expect(journal.get<Command>('run', 'commands', 'command')?.state).toBe(acknowledged ? 'rolled_back' : 'pending');
    await owner.flush(r.id); expect(owner.list()[0]?.state).toBe('released'); expect(sends).toBe(0); journal.close();
  });
});
