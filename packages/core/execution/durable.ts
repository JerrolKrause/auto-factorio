import type { Batch, Receipt } from '@autofactorio/contracts';

export type Visibility = { kind: 'operator' } | { kind: 'shared' } | { kind: 'restricted'; agents: string[]; roles: string[]; tasks: string[] };
export type Entity = 'runs' | 'agents' | 'tasks' | 'messages' | 'observations' | 'commands' | 'measurements' | 'interventions' | 'checkpoints' | 'budgets' | 'artifacts';
export interface EventContext {
  run: string; epoch: string; wallTime: string; gameTick: number | null; actor: string | null; task: string | null;
  causation: string | null; correlation: string | null; visibility: Visibility;
}
export interface Change { entity: Entity; id: string; value: Record<string, unknown> }
export interface Event extends EventContext { version: 1; sequence: number; type: string; changes: Change[] }
export interface Journal {
  append(context: EventContext, type: string, changes: Change[]): Event;
  get<T>(run: string, entity: Entity, id: string): T | undefined;
  list<T>(run: string, entity: Entity): T[];
}
export interface Command {
  batch: Batch; state: 'pending' | 'sending' | 'unknown' | 'acknowledged' | 'rolled_back';
  receipt: Receipt | null; receiptEpoch: string | null; reason: string | null;
}
export interface WorldReceipts { epoch: string; session: string; ledger: Record<string, Receipt> }
export interface ExecutionPort { inspect(): Promise<WorldReceipts>; submit(batch: Batch): Promise<Receipt> }
/** One conservative execution lane now; ownership scheduling belongs to phase 06/07. */
export class DurableExecution {
  private reconciled = false;
  private busy = false;
  constructor(private journal: Journal, private context: () => EventContext, private game: ExecutionPort) {}
  intent(batch: Batch): void {
    const c = this.context();
    if (batch.epoch !== c.epoch) throw new Error('Intent epoch mismatch');
    if (this.journal.get(c.run, 'commands', batch.commandId)) throw new Error('Command identity already committed');
    if (this.pending().some(c => c.state === 'unknown' || c.state === 'sending' || c.receipt?.status === 'accepted' || c.receipt?.status === 'running')) throw new Error('Unresolved effects block conflicting work');
    this.save({ batch, state: 'pending', receipt: null, receiptEpoch: null, reason: null }, 'command/intent');
  }
  pending(): Command[] { return this.journal.list<Command>(this.context().run, 'commands'); }
  private save(command: Command, type: string): void {
    this.journal.append({ ...this.context(), actor: command.batch.actor, task: command.batch.task, correlation: command.batch.commandId, gameTick: command.receipt?.endedTick ?? command.receipt?.acceptedTick ?? null }, type, [{ entity: 'commands', id: command.batch.commandId, value: { ...command } }]);
  }
  async reconcile(): Promise<void> {
    if (this.busy) throw new Error('Execution operation in progress');
    this.busy = true; this.reconciled = false;
    try {
      const world = await this.game.inspect();
      for (const command of this.pending()) {
        if (command.state === 'rolled_back') continue;
        const same = (command.batch.epoch === world.epoch && command.batch.session === world.session) || (command.state === 'acknowledged' && command.receiptEpoch === world.epoch);
        const receipt = same ? world.ledger[command.batch.commandId] : undefined;
        if (receipt) this.save({ ...command, state: 'acknowledged', receipt, receiptEpoch: world.epoch, reason: null }, 'command/reconciled');
        else if (same && command.state === 'pending') { /* Never sent: still safe, after explicit admission. */ }
        else this.save({ ...command, state: 'unknown', receipt: null, receiptEpoch: null, reason: same ? 'receipt_unavailable' : 'epoch_requires_checkpoint_reconciliation' }, 'command/unknown');
      }
      this.reconciled = !this.pending().some(c => c.state === 'unknown' || c.state === 'sending');
    } finally { this.busy = false; }
  }
  /** Runtime supplies a verified held ledger: validated load or acknowledged lifecycle reconciliation. */
  checkpointLedger(world: WorldReceipts): void {
    if (this.busy) throw new Error('Execution operation in progress');
    this.reconciled = false;
    for (const command of this.pending()) {
      const receipt = world.ledger[command.batch.commandId];
      this.save({ ...command, state: receipt ? 'acknowledged' : 'rolled_back', receipt: receipt ?? null, receiptEpoch: world.epoch, reason: 'managed_checkpoint_requires_fresh_authorization' }, 'command/checkpoint');
    }
  }
  async dispatch(id: string): Promise<Receipt> {
    if (!this.reconciled || this.busy) throw new Error('Reconciliation required before dispatch');
    const command = this.journal.get<Command>(this.context().run, 'commands', id);
    if (!command || command.state !== 'pending') throw new Error('Only an unsent intent can dispatch');
    if (this.pending().some(c => c.state === 'unknown' || c.state === 'sending' || c.receipt?.status === 'accepted' || c.receipt?.status === 'running')) throw new Error('Unresolved effects block conflicting work');
    this.busy = true;
    try {
      const world = await this.game.inspect();
      if (command.batch.epoch !== world.epoch || command.batch.session !== world.session) throw new Error('Stale command requires reconciliation');
      // This transaction commits the outbox's send boundary BEFORE any transport effect.
      this.save({ ...command, state: 'sending' }, 'command/dispatching');
      const receipt = await this.game.submit(command.batch);
      if (receipt.commandId !== id) throw new Error('Receipt identity mismatch');
      this.save({ ...command, state: 'acknowledged', receipt, receiptEpoch: world.epoch }, 'command/acknowledged');
      return receipt;
    } catch (error) {
      this.reconciled = false;
      const current = this.journal.get<Command>(this.context().run, 'commands', id)!;
      if (current.state === 'sending') this.save({ ...current, state: 'unknown', reason: 'transport_or_acknowledgement_unconfirmed' }, 'command/unknown');
      throw error;
    } finally { this.busy = false; }
  }
}
