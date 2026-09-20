import type { Coordinator, TaskInput } from '../../packages/core/orchestration/coordinator.js';
import { Interventions, assistanceChanges } from '../../packages/core/orchestration/interventions.js';
import { barrier } from '../../packages/factorio/src/lifecycle.js';
import type { ControlState } from '../../packages/factorio/src/lifecycle.js';
import { randomUUID } from 'node:crypto';
import { runDeadline } from '../../packages/core/evaluation/run-clock.js';
import type { RunClock } from '../../packages/core/evaluation/run-clock.js';

export interface OperatorState {
  admission: boolean; requested: 'pause' | 'stop' | 'resume' | null;
  status: 'running' | 'paused' | 'stopped' | 'unconfirmed' | 'disconnected';
  gameTick: number | null; connected: boolean; cancellation: 'confirmed' | 'unconfirmed';
  checkpoint: 'not-requested' | 'unconfirmed'; inference: 'confirmed' | 'unconfirmed';
  scoringClosed: boolean; error: string | null;
}
export class Operator {
  readonly interventions: Interventions;
  private busy = false;
  private polling = false;
  private pollWork: Promise<void> = Promise.resolve();
  private lastControl: ControlState | null = null;
  private gameReservations = 0;
  private gameReservationTail: Promise<void> = Promise.resolve();
  private controlSettled: Promise<void> = Promise.resolve();
  constructor(readonly coordinator: Coordinator) {
    this.interventions = new Interventions(coordinator);
    if (!coordinator.runtime.hasControlSession()) this.save({ ...this.state(), admission: false, requested: 'pause', status: 'unconfirmed', cancellation: 'unconfirmed', inference: 'unconfirmed', connected: false, error: 'Controller replacement requires reconciliation' });
  }
  state(): OperatorState {
    return this.coordinator.runtime.journal.get<OperatorState>(this.coordinator.runtime.run, 'runs', 'operator-control') ?? {
      admission: false, requested: null, status: 'unconfirmed', gameTick: null, connected: false,
      cancellation: 'unconfirmed', checkpoint: 'not-requested', inference: 'unconfirmed', scoringClosed: false, error: null,
    };
  }
  private save(state: OperatorState): void {
    this.coordinator.runtime.record('operator/control', [{ entity: 'runs', id: 'operator-control', value: { ...state } }], { kind: 'operator' }, state.gameTick);
  }
  private inferenceConfirmed(): boolean {
    return this.coordinator.budget.state.turns.every(t => t.finished);
  }
  private observed(s: ControlState): void {
    this.lastControl = s;
    const prior = this.state();
    this.save({ ...prior, connected: true, gameTick: s.tick, error: null });
    const available = Object.keys(s.production).length > 0;
    this.coordinator.runtime.record('game/measurement', [{ entity: 'measurements', id: 'production', value: { id: 'production', name: 'Engine production counters', gameTick: s.tick, value: available ? s.production : null, complete: available, coverage: available ? 'Diagnostic furnace production' : 'Production telemetry unavailable for this world', scoring: 'unscored telemetry' } }], { kind: 'operator' }, s.tick);
  }
  /** Synchronous durable admission closure precedes every await and late provider/game callback. */
  async control(action: 'pause' | 'stop' | 'resume'): Promise<OperatorState> {
    if (this.gameReservations) throw new Error('Game control reserved by workshop operation');
    if (this.busy) throw new Error('Control operation in progress');
    this.busy = true;
    let settleControl!: () => void;
    this.controlSettled = new Promise<void>(resolve => { settleControl = resolve; });
    this.save({ ...this.state(), admission: false, requested: action, status: 'unconfirmed', cancellation: 'unconfirmed', inference: this.inferenceConfirmed() ? 'confirmed' : 'unconfirmed', error: null });
    const c = this.coordinator;
    try {
      c.interruptForControl();
      // Let an earlier poll finish under the already-closed admission gate before changing epochs.
      await this.pollWork;
      if (c.runtime.hasControlSession()) await c.pump();
      // Recovery establishes the current session before ownership creates durable revoke requests.
      // Pump can change the held receipt ledger, so refresh that barrier again before resume.
      await c.runtime.recover();
      await c.pump();
      const held = await c.runtime.recover(); barrier(held);
      const inference = this.inferenceConfirmed() ? 'confirmed' : 'unconfirmed';
      if (action === 'resume') {
        if (inference !== 'confirmed') throw new Error('Inference interruption unconfirmed');
        if (c.budget.snapshot().closed || this.state().scoringClosed) throw new Error('Original run budget closed; continuation cannot score');
        const verification = c.runtime.journal.get<{ active?: boolean }>(c.runtime.run, 'runs', 'verification')?.active === true;
        const armed = await c.runtime.resume(held, verification);
        this.lastControl = armed;
        this.save({ ...this.state(), admission: true, status: 'running', connected: true, gameTick: armed.tick, cancellation: 'confirmed', inference, error: null });
      } else {
        this.save({ ...this.state(), status: inference === 'confirmed' ? (action === 'pause' ? 'paused' : 'stopped') : 'unconfirmed', connected: true, gameTick: held.tick, cancellation: 'confirmed', inference, error: inference === 'confirmed' ? null : 'Inference interruption unconfirmed' });
      }
    } catch (error) {
      this.save({ ...this.state(), admission: false, status: 'unconfirmed', error: String(error), checkpoint: 'unconfirmed' });
    } finally { this.busy = false; settleControl(); }
    return this.state();
  }
  async reprioritize(task: string, revision: number, input: TaskInput): Promise<void> {
    if (this.busy) throw new Error('Control operation in progress');
    const c = this.coordinator; const prior = c.task(task);
    if (prior.revision !== revision || input.id !== task) throw new Error('Stale task revision');
    const id = randomUUID();
    const intervention = { id, kind: 'reprioritization', recipient: prior.manager, text: JSON.stringify(input), wallTime: new Date().toISOString(), gameTick: this.state().connected ? this.state().gameTick : null, delivery: 'pending', interpretation: null, resultingTasks: [task], supersededTasks: [task], previousRevision: revision, requestedRevision: revision + 1 };
    c.runtime.journal.append({ ...c.runtime.context(), actor: 'operator', task, causation: id, correlation: task, gameTick: intervention.gameTick }, 'operator/reprioritization', [{ entity: 'interventions', id, value: intervention }, ...assistanceChanges(c)]);
    c.revise(prior.manager, task, revision, input);
    c.runtime.record('operator/reprioritized', [{ entity: 'interventions', id, value: { ...intervention, delivery: 'applied', interpretation: 'Direct operator revision applied; old ownership must be released before reassignment.' } }]);
    // A revision closes the old admission immediately; acknowledged fences precede reassignment.
    await c.pump();
  }
  humanEdit(input: { id: string; gameTick: number; detail: unknown; causality: 'human' | 'unknown'; verification: boolean }): void {
    const r = this.coordinator.runtime;
    if (r.journal.get(r.run, 'interventions', input.id)) return;
    r.record('world/human-edit', [
      { entity: 'interventions', id: input.id, value: { ...input, kind: 'world-edit', wallTime: new Date().toISOString(), delivery: 'recorded' } },
      ...assistanceChanges(this.coordinator),
      ...(input.verification ? [{ entity: 'runs' as const, id: 'verification', value: { valid: false, reason: 'human edit or unknown causality', intervention: input.id } }] : []),
    ], { kind: 'operator' }, input.gameTick);
  }
  poll(): Promise<void> {
    if (this.gameReservations) return this.pollWork;
    if (this.polling || this.busy) return this.pollWork;
    this.pollWork = this.performPoll();
    return this.pollWork;
  }
  /** Serializes trusted game-side operations and keeps routine recovery from changing their pause state. */
  async reserveGameControl(): Promise<() => void> {
    let unlock!: () => void;
    const gate = new Promise<void>(resolve => { unlock = resolve; });
    const prior = this.gameReservationTail;
    this.gameReservationTail = prior.then(() => gate);
    this.gameReservations++;
    await prior;
    // The reservation counter rejects later controls; this await closes the
    // opposite ordering where a control passed its gate first.
    await this.controlSettled;
    await this.pollWork;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.gameReservations--;
      unlock();
      if (!this.gameReservations) void this.poll().catch(error => console.error('Operator monitoring failed:', String(error)));
    };
  }
  private async performPoll(): Promise<void> {
    this.polling = true;
    try {
      const c = this.coordinator;
      c.budget.tick(); this.interventions.deliver();
      // Refresh the acknowledged fence before potentially expensive ledger work.
      // A stale fence still fails closed; this never revives lost authority.
      if (this.state().admission && this.lastControl) await c.runtime.heartbeat(this.lastControl);
      if (!c.runtime.hasControlSession()) await c.runtime.recover();
      if (c.budget.state.closed && !this.state().scoringClosed) {
        this.save({ ...this.state(), admission: false, scoringClosed: true, requested: 'stop', status: 'unconfirmed' });
        c.runtime.record('verification/budget-closed', [{ entity: 'runs', id: 'verification', value: { valid: false, reason: 'budget closed' } }]);
      }
      if (!this.state().admission) c.interruptForControl();
      await c.pump();
      let control = await c.runtime.inspectControl();
      const clock = c.runtime.journal.get<RunClock>(c.runtime.run, 'runs', 'scenario-clock');
      const deadline = clock && runDeadline(clock, control.tick, Date.now());
      if (deadline && !this.state().scoringClosed) {
        c.stop(deadline);
        this.save({ ...this.state(), admission: false, scoringClosed: true, requested: 'stop', status: 'unconfirmed' });
        c.runtime.record('verification/deadline-closed', [{ entity: 'runs', id: 'verification', value: { valid: false, reason: deadline } }]);
      }
      if (this.state().admission && (!control.armed || control.paused)) {
        // A watchdog or external hold can revoke execution while the transport remains healthy.
        this.save({ ...this.state(), admission: false, requested: 'pause', status: 'unconfirmed', cancellation: 'unconfirmed', error: 'Game execution authority lost' });
        c.interruptForControl();
        await c.pump();
      }
      if (!this.state().admission && !this.busy) {
        if (control.armed || !control.paused || !control.neutral || control.ticksToRun !== 0) control = await c.runtime.recover();
        barrier(control);
        const requested = this.state().requested;
        const inference = this.inferenceConfirmed() ? 'confirmed' : 'unconfirmed';
        const status = inference === 'confirmed' && requested !== 'resume' ? (requested === 'stop' ? 'stopped' : 'paused') : 'unconfirmed';
        this.save({ ...this.state(), cancellation: 'confirmed', inference, status });
      }
      if (this.state().admission) await c.runtime.heartbeat(control);
      this.observed(control);
      const cursor = c.runtime.journal.get<{ sequence: number; session: string }>(c.runtime.run, 'runs', 'human-edit-cursor');
      const edits = await c.runtime.humanEdits(cursor?.session === control.session ? cursor.sequence : 0);
      const verification = c.runtime.journal.get<{ active?: boolean }>(c.runtime.run, 'runs', 'verification')?.active === true;
      for (const edit of edits.events) this.humanEdit({ ...edit, verification });
      c.runtime.record('world/edit-coverage', [{ entity: 'runs', id: 'human-edit-cursor', value: { session: control.session, sequence: edits.events.at(-1)?.sequence ?? cursor?.sequence ?? 0, coverage: edits.coverage, complete: !edits.overflow } },
        ...(edits.overflow ? [{ entity: 'runs' as const, id: 'verification', value: { valid: false, reason: 'human edit evidence overflow' } }] : []),
      ]);
    } catch (error) {
      this.save({ ...this.state(), admission: false, status: 'disconnected', connected: false, cancellation: 'unconfirmed', checkpoint: 'unconfirmed', error: String(error) });
      this.coordinator.interruptForControl();
    } finally { this.polling = false; }
  }
  start(intervalMs = 500): () => Promise<void> {
    const timer = setInterval(() => { void this.poll().catch(error => console.error('Operator monitoring failed:', String(error))); }, intervalMs);
    return async () => { clearInterval(timer); await this.pollWork; };
  }
}
