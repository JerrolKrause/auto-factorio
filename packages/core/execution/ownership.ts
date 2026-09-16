import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { conflicts, resourceKey, validateAssignment, validateReceipt } from '@autofactorio/contracts';
import type { Assignment, Batch, OwnershipAck, OwnershipControl, Resource } from '@autofactorio/contracts';
import type { EventContext, Journal, Command, Change } from './durable.js';

export interface Reservation extends Assignment {
  state: 'granting' | 'active' | 'revoking' | 'released'; request: OwnershipControl; ack?: OwnershipAck;
}
export interface OwnershipPort { control(request: OwnershipControl): Promise<OwnershipAck> }
/** Single writer: every whole-set transition is one journal transaction, before transport. */
export class Ownership {
  private busy = false;
  constructor(private journal: Journal, private context: () => EventContext, private port: OwnershipPort, private session: () => string) {}
  list(): Reservation[] { return this.journal.list(this.context().run, 'reservations'); }
  private save(r: Reservation): void {
    this.journal.append({ ...this.context(), task: r.task, actor: r.actor, correlation: r.request.id, gameTick: r.ack?.tick ?? null }, 'ownership/' + r.state, [{ entity: 'reservations', id: r.id, value: { ...r } }]);
  }
  acquire(input: Omit<Assignment, 'resources'> & { resources: Resource[] }): Reservation {
    if (this.busy) throw new Error('Ownership control in progress');
    const prior = this.list();
    if (prior.some(r => r.id === input.id)) throw new Error('Assignment ID already used');
    if (prior.some(r => r.task === input.task && (r.state !== 'released' || r.revision >= input.revision))) throw new Error('Task revision requires acknowledged replacement');
    const sorted = structuredClone(input.resources).sort((a, b) => resourceKey(a) < resourceKey(b) ? -1 : resourceKey(a) > resourceKey(b) ? 1 : 0);
    if (new Set(sorted.map(resourceKey)).size !== sorted.length) throw new Error('Duplicate resource');
    if (prior.some(r => r.state !== 'released' && r.resources.some(a => sorted.some(b => conflicts(a.resource, b))))) throw new Error('Reservation conflict');
    const assignment: Assignment = { ...input, resources: sorted.map(resource => ({ resource, grant: { id: resourceKey(resource), generation: 1 + Math.max(0, ...prior.flatMap(r => r.resources.filter(g => conflicts(g.resource, resource)).map(g => g.grant.generation))) } })) };
    validateAssignment(assignment);
    const request: OwnershipControl = { id: randomUUID(), epoch: this.context().epoch, session: this.session(), operation: 'grant', assignment };
    const r: Reservation = { ...assignment, state: 'granting', request }; this.save(r); return r;
  }
  revoke(id: string): Reservation {
    if (this.busy) throw new Error('Ownership control in progress');
    const r = this.list().find(r => r.id === id); if (!r) throw new Error('Unknown assignment');
    if (r.state === 'released' || r.state === 'revoking') return r;
    const assignment: Assignment = { id: r.id, owner: r.owner, task: r.task, revision: r.revision, actor: r.actor, resources: r.resources.map(g => ({ ...g, grant: { ...g.grant, generation: g.grant.generation + 1 } })) };
    const next: Reservation = { ...assignment, state: 'revoking', request: { id: randomUUID(), epoch: this.context().epoch, session: this.session(), operation: 'revoke', assignment } };
    this.save(next); return next;
  }
  async flush(id: string): Promise<Reservation> {
    if (this.busy) throw new Error('Ownership control in progress');
    const r = this.list().find(r => r.id === id); if (!r) throw new Error('Unknown assignment');
    if (r.state === 'active' || r.state === 'released') return r;
    this.busy = true;
    try {
      const ack = await this.port.control(r.request);
      if (!isDeepStrictEqual(ack.request, r.request) || !Number.isSafeInteger(ack.tick) || ack.tick < 0 || !Array.isArray(ack.receipts) || ack.receipts.some(x => !['completed', 'partial', 'failed', 'cancelled'].includes(x.status))) throw new Error('Ownership acknowledgement mismatch');
      ack.receipts.forEach(validateReceipt);
      const changes: Change[] = [];
      if (r.state === 'revoking') {
        for (const command of this.journal.list<Command>(this.context().run, 'commands').filter(c => c.batch.task === r.task && c.batch.revision === r.revision && c.batch.epoch === r.request.epoch && c.batch.session === r.request.session && c.state !== 'rolled_back')) {
          const receipt = ack.receipts.find(x => x.commandId === command.batch.commandId);
          if (!receipt && command.state !== 'pending') throw new Error('Final command receipt missing');
          changes.push({ entity: 'commands', id: command.batch.commandId, value: { ...command, receipt: receipt ?? null, state: receipt ? 'acknowledged' : 'rolled_back', receiptEpoch: r.request.epoch, reason: 'ownership_revoked' } });
        }
      }
      const next: Reservation = { ...r, state: r.state === 'granting' ? 'active' : 'released', ack };
      changes.push({ entity: 'reservations', id: r.id, value: { ...next } });
      this.journal.append({ ...this.context(), task: r.task, actor: r.actor, correlation: r.request.id, gameTick: ack.tick }, 'ownership/' + next.state, changes); return next;
    } finally { this.busy = false; }
  }
  authorize(batch: Batch, owner: string): void {
    const r = this.list().find(r => r.state === 'active' && r.task === batch.task && r.revision === batch.revision && r.actor === batch.actor && r.owner === owner);
    if (!r || r.request.epoch !== batch.epoch || r.request.session !== batch.session || !isDeepStrictEqual(r.resources.map(g => g.grant), batch.grants)) throw new Error('Stale or unauthorized assignment');
  }
  /** Called behind the verified held restore barrier. No saved grant remains dispatchable. */
  restoreHeld(): void {
    if (this.busy) throw new Error('Ownership control in progress');
    const changes = this.list().filter(r => r.state !== 'released').map(r => ({ entity: 'reservations' as const, id: r.id, value: { ...r, state: 'released', ack: undefined, reason: 'held_restore_requires_new_assignment' } }));
    if (changes.length) this.journal.append(this.context(), 'ownership/restored-held', changes);
  }
}
