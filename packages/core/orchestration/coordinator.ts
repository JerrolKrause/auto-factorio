import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { DEFAULT_OPERATIONAL_LIMITS, resourceKey, validateAssignment, validateProductionTarget } from '@autofactorio/contracts';
import type { AgentDefinition, AgentHistory, AgentInstance, Batch, CoordinatedTask, ScopedMessage, ToolGroup } from '@autofactorio/contracts';
import type { DurableRuntime } from '../../../apps/runtime/durable-runtime.js';
import type { Budget, Caps, TurnBudget } from '../../codex/src/budget.js';
import type { Change, Command } from '../execution/durable.js';
import { ASTRA } from '../../codex/src/protocol.js';
import { privateTo, taskVisibility } from '../context/authorization.js';
import { ContextArchive } from '../context/archive.js';
import { OperationalStore, OperationalWatches } from '../context/operational.js';

export interface SessionBinding { agent: string; session: string; generation: number; epoch: string; turn: string }
export type TaskInput = Pick<CoordinatedTask, 'id' | 'goal' | 'parent' | 'dependencies' | 'scope' | 'resources' | 'successCriteria' | 'deadline' | 'committedPlan' | 'actor' | 'reservations' | 'criteria' | 'productionTarget'>;
export type MessageInput = Pick<ScopedMessage, 'id' | 'recipient' | 'task' | 'revision' | 'intent' | 'content' | 'evidence'>;
const terminal = (t: CoordinatedTask) => ['succeeded', 'failed', 'cancelled', 'superseded'].includes(t.status);
const id = (s: string) => { if (typeof s !== 'string' || !/^[\w.-]{1,100}$/.test(s)) throw new Error('Invalid coordination identity'); };

/** Single deterministic controller. Methods are operator-internal; gameplay enters through its authenticated gateway. */
export class Coordinator {
  readonly budget: Budget;
  private readonly interrupts = new Map<string, () => Promise<void>>();
  private readonly stopped = new Set<string>();
  private readonly interruptRequested = new Set<string>();
  private busy = false;
  private pumpWork: Promise<void> | null = null;
  private readonly operational: OperationalStore;
  private readonly watches: OperationalWatches;
  constructor(readonly runtime: DurableRuntime, caps: Caps, now = () => performance.now(), private readonly dispatchAllowed = () => true) {
    this.budget = runtime.createBudget(caps, now, t => { this.stopped.add(t.id); });
    runtime.admissionGuard = batch => {
      this.budget.tick(); const t = this.task(batch.task);
      if (this.held() || this.budget.state.closed || t.revision !== batch.revision || !['assigned', 'running'].includes(t.status) || !this.dependenciesReady(t) || this.budget.state.turns.some(b => b.role === t.owner && b.closed && b.cancellation !== 'confirmed')) throw new Error('Scheduler admission closed');
    };
    const manifest = runtime.journal.get<{ operationalLimits?: typeof DEFAULT_OPERATIONAL_LIMITS }>(runtime.run, 'runs', runtime.run);
    this.operational = new OperationalStore(runtime, manifest?.operationalLimits ?? DEFAULT_OPERATIONAL_LIMITS);
    this.watches = new OperationalWatches(runtime, this.operational.limits);
  }
  agents(): AgentInstance[] { return this.runtime.journal.list(this.runtime.run, 'agents'); }
  /** Durable operator admission also protects late tools and a pump already awaiting the game. */
  held(): boolean { return this.runtime.journal.get<{ admission: boolean }>(this.runtime.run, 'runs', 'operator-control')?.admission === false; }
  interruptForControl(): void {
    for (const turn of this.budget.state.turns) this.budget.closeTurn(turn, 'operator_control');
    this.requestInterrupts();
  }
  /** Provider interruption must not wait behind a disconnected game or ownership reconciliation. */
  private requestInterrupts(): void {
    for (const turn of this.budget.state.turns.filter(t => t.closed && (t.cancellation !== 'confirmed' || !t.finished))) this.stopped.add(turn.id);
    for (const turn of this.stopped) {
      const interrupt = this.interrupts.get(turn);
      if (interrupt && !this.interruptRequested.has(turn)) {
        this.interruptRequested.add(turn);
        void Promise.resolve().then(interrupt).catch(() => { this.interruptRequested.delete(turn); });
      }
    }
  }
  tasks(): CoordinatedTask[] { return this.runtime.journal.list(this.runtime.run, 'tasks'); }
  messages(): ScopedMessage[] { return this.runtime.journal.list(this.runtime.run, 'messages'); }
  agent(who: string): AgentInstance { const a = this.agents().find(a => a.id === who); if (!a) throw new Error('Unknown agent'); return a; }
  task(key: string): CoordinatedTask { const t = this.tasks().find(t => t.id === key); if (!t) throw new Error('Unknown task'); return t; }
  private history(agent: string, kind: string, detail: unknown, task: CoordinatedTask | null = null): Change {
    const h: AgentHistory = { id: randomUUID(), agent, kind, detail, task: task?.id ?? null, revision: task?.revision ?? null, wallTime: new Date().toISOString(), epoch: this.runtime.context().epoch };
    return { entity: 'agentHistory', id: h.id, value: { ...h }, visibility: kind === 'tool-result' ? { kind: 'operator' } : privateTo(agent), sources: task ? [{ entity: 'tasks', id: task.id }] : [] };
  }
  private saveTask(t: CoordinatedTask, kind: string, extra: Change[] = []): void {
    this.runtime.record(kind, [{ entity: 'tasks', id: t.id, value: { ...t }, visibility: taskVisibility(t.id) }, ...extra]);
  }
  register(input: { id: string; definition: AgentDefinition; actors: string[] }): void {
    id(input.id); id(input.definition.id); input.actors.forEach(id);
    if (this.agents().some(a => a.id === input.id)) throw new Error('Agent already registered');
    const d = input.definition;
    if (d.model !== ASTRA || d.effort !== 'low' || !d.instructions || !d.output || !d.tools.length || d.tools.some(t => !['plan', 'message', 'execute', 'observe'].includes(t)) || !Array.isArray(d.observations) || d.observations.some(s => !['assigned-tasks', 'messages', 'history'].includes(s)) || !Number.isSafeInteger(d.limits.tools) || d.limits.tools < 1) throw new Error('Unsupported agent definition');
    const a: AgentInstance = { ...structuredClone(input), assignment: null, lineage: [], status: 'idle' };
    this.runtime.record('agent/registered', [{ entity: 'agents', id: a.id, value: { ...a }, visibility: privateTo(a.id) }, this.history(a.id, 'registered', { definition: d.id })]);
  }
  /** Provider admission uses the same budget. Bind only after its verified session and turn are known. */
  bind(agent: string, session: string, turn: string, interrupt: () => Promise<void>): SessionBinding {
    id(session); const a = this.agent(agent); const b = this.budget.get(turn);
    if (this.held() || b.role !== agent || b.closed || b.finished || this.budget.snapshot().closed) throw new Error('Session admission closed');
    if (this.agents().some(other => other.id !== agent && other.lineage.some(s => s.session === session))) throw new Error('Provider history belongs to another agent');
    if (this.interrupts.has(turn)) throw new Error('Turn already bound');
    const generation = (a.lineage.at(-1)?.generation ?? 0) + 1; const epoch = this.runtime.context().epoch;
    a.lineage.push({ session, generation, epoch }); a.status = 'reasoning';
    this.runtime.record('agent/session', [{ entity: 'agents', id: a.id, value: { ...a }, visibility: privateTo(a.id) }, this.history(a.id, 'session', { session, generation, turn })]);
    this.interrupts.set(turn, interrupt); return { agent, session, generation, epoch, turn };
  }
  authenticate(binding: SessionBinding, group: ToolGroup): AgentInstance {
    this.budget.tick(); const a = this.agent(binding.agent); const s = a.lineage.at(-1); const b = this.budget.get(binding.turn);
    if (this.held() || this.budget.state.closed || b.closed || b.finished || b.role !== a.id || !this.interrupts.has(binding.turn) || !s || s.session !== binding.session || s.generation !== binding.generation || binding.epoch !== this.runtime.context().epoch || !a.definition.tools.includes(group)) throw new Error('Stale identity or tool admission closed');
    return a;
  }
  private scoped(who: string, t: CoordinatedTask): void { if (t.manager !== who && t.owner !== who) throw new Error('Task scope forbidden'); }
  private dependenciesReady(t: CoordinatedTask): boolean {
    return t.dependencies.every(key => { const d = this.task(key); return d.status === 'succeeded' && d.epoch === this.runtime.context().epoch && this.dependenciesReady(d); });
  }
  view(who: string) {
    const agent = this.agent(who); const archive = new ContextArchive(this.runtime, () => this.principal(who));
    // Exact responses remain durable evidence, but never recursively inject earlier observation responses.
    return { agent, tasks: archive.entries('tasks').map(e => e.value as CoordinatedTask), messages: archive.entries('messages').map(e => e.value as ScopedMessage), history: archive.entries('agentHistory').map(e => e.value as AgentHistory).filter(h => h.kind !== 'tool-result') };
  }
  principal(who: string) {
    const a = this.agent(who);
    return { run: this.runtime.run, agent: who, role: a.definition.id, observations: a.definition.observations, tasks: this.tasks().filter(t => t.manager === who || t.owner === who).map(t => t.id) };
  }
  activity(who: string, kind: string, detail: unknown): void {
    this.runtime.record('agent/' + kind, [this.history(who, kind, detail)], { kind: 'restricted', agents: [who], roles: [], tasks: [] });
  }
  /** Host timer reports failures visibly and retries reconciliation without a reasoning turn. */
  start(onError: (error: unknown) => void, intervalMs = 100): () => Promise<void> {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 20) throw new Error('Invalid scheduler interval');
    let closed = false; let running: Promise<void> = Promise.resolve();
    const timer = setInterval(() => { if (!closed && !this.busy) running = this.pump().catch(onError); }, intervalMs);
    return async () => { closed = true; clearInterval(timer); await running; };
  }
  propose(who: string, input: TaskInput): CoordinatedTask {
    if (!this.agent(who).definition.tools.includes('plan')) throw new Error('Planning forbidden');
    id(input.id); if (this.tasks().some(t => t.id === input.id)) throw new Error('Task already exists');
    this.validate(input, who);
    const t: CoordinatedTask = { ...structuredClone(input), manager: who, owner: null, revision: 1, status: 'proposed', evidence: [], wait: null, epoch: this.runtime.context().epoch };
    this.checkGraph(t); this.saveTask(t, 'task/proposed', [this.history(who, 'proposed', input, t)]); return t;
  }
  private validate(input: TaskInput, who: string): void {
    if (!input.goal || !Array.isArray(input.dependencies) || !Array.isArray(input.criteria) || !input.criteria.length || input.criteria.some(c => !['command-completed', 'message-delivered'].includes(c.kind) || typeof c.id !== 'string' || !c.id)) throw new Error('Task requires supported deterministic criteria');
    if (new Set(input.dependencies).size !== input.dependencies.length) throw new Error('Duplicate dependency');
    for (const dep of [...input.dependencies, ...(input.parent ? [input.parent] : [])]) { this.scoped(who, this.task(dep)); }
    if (input.actor === null && input.reservations.length) throw new Error('Bodyless task cannot reserve game resources');
    if (input.productionTarget !== undefined) validateProductionTarget(input.productionTarget);
    if (input.actor) validateAssignment({ id: input.id, owner: who, task: input.id, revision: 1, actor: input.actor, resources: input.reservations.map(resource => ({ resource, grant: { id: resourceKey(resource), generation: 1 } })) });
  }
  private checkGraph(candidate: CoordinatedTask): void {
    const all = new Map(this.tasks().map(t => [t.id, t])); all.set(candidate.id, candidate);
    const visiting = new Set<string>(); const done = new Set<string>();
    const visit = (key: string) => {
      if (visiting.has(key)) throw new Error('Dependency or parent cycle'); if (done.has(key)) return;
      const t = all.get(key); if (!t) throw new Error('Unknown dependency'); visiting.add(key);
      for (const next of [...t.dependencies, ...(t.parent ? [t.parent] : [])]) visit(next);
      visiting.delete(key); done.add(key);
    }; for (const key of all.keys()) visit(key);
  }
  revise(who: string, key: string, revision: number, input: TaskInput): void {
    const t = this.task(key); if (t.manager !== who || t.revision !== revision || input.id !== key) throw new Error('Stale task revision or manager');
    this.validate(input, who); const next: CoordinatedTask = { ...t, ...structuredClone(input), owner: null, revision: revision + 1, status: 'proposed', evidence: [], wait: null, epoch: this.runtime.context().epoch };
    this.checkGraph(next);
    // Closing the task first prevents late work even if control is currently awaiting an acknowledgement.
    this.saveTask(next, 'task/revised', [this.history(who, 'superseded', { ...t, status: 'superseded' }, t)]);
  }
  cancel(who: string, key: string, revision: number): void {
    const t = this.task(key); if (t.manager !== who || t.revision !== revision || terminal(t)) throw new Error('Stale or terminal task');
    this.saveTask({ ...t, status: 'cancelled', wait: 'awaiting acknowledged release' }, 'task/cancelled');
  }
  send(who: string, input: MessageInput): ScopedMessage {
    id(input.id); const t = this.task(input.task); this.scoped(who, t); this.agent(input.recipient);
    if (typeof input.content !== 'string' || input.content.length > 2000 || !Array.isArray(input.evidence) || input.evidence.some(e => typeof e !== 'string') || !['handoff', 'assistance', 'report'].includes(input.intent)) throw new Error('Invalid message');
    const m: ScopedMessage = { ...structuredClone(input), sender: who, epoch: this.runtime.context().epoch, delivery: 'pending', reason: null };
    const prior = this.messages().find(m => m.id === input.id);
    if (prior) { if (!isDeepStrictEqual({ ...prior, delivery: 'pending', reason: null }, m)) throw new Error('Message identity collision'); return prior; }
    if (t.revision !== input.revision || t.epoch !== m.epoch || terminal(t)) throw new Error('Stale task message');
    if (input.intent === 'handoff') {
      if (who !== t.manager || t.owner !== null) throw new Error('Assignment requires current manager and unassigned task');
      if (t.actor && (!this.agent(input.recipient).actors.includes(t.actor) || !this.agent(input.recipient).definition.tools.includes('execute'))) throw new Error('Recipient lacks actor authorization');
    } else if (input.recipient !== t.manager && input.recipient !== t.owner) throw new Error('Recipient outside task scope');
    this.runtime.record('message/queued', [{ entity: 'messages', id: m.id, value: { ...m }, visibility: { kind: 'restricted', agents: [who, m.recipient], roles: [], tasks: [] } }, this.history(who, 'sent', m, t)]); return m;
  }
  private deliver(m: ScopedMessage): void {
    const t = this.task(m.task); let reason: string | null = null; const changes: Change[] = [];
    if (t.revision !== m.revision || t.epoch !== m.epoch || m.epoch !== this.runtime.context().epoch || terminal(t)) reason = 'stale_task';
    else if (m.intent === 'handoff') {
      if (t.owner !== null || t.manager !== m.sender) reason = 'assignment_changed';
      else changes.push({ entity: 'tasks', id: t.id, value: { ...t, owner: m.recipient }, visibility: taskVisibility(t.id) });
    }
    const delivered = { ...m, delivery: reason ? 'rejected' : 'delivered', reason };
    changes.push({ entity: 'messages', id: m.id, value: delivered, visibility: { kind: 'restricted', agents: [m.sender, m.recipient], roles: [], tasks: [] } }, this.history(m.recipient, 'received', delivered, t));
    this.runtime.record('message/' + delivered.delivery, changes); // Delivery and assignment are one transaction.
  }
  report(who: string, key: string, revision: number, evidence: string[]): void {
    const t = this.task(key); if (t.owner !== who || t.revision !== revision || !['assigned', 'running'].includes(t.status)) throw new Error('Stale task report');
    if (!this.qualifies(t, evidence)) throw new Error('Completion claim lacks qualifying evidence');
    this.saveTask({ ...t, status: 'verifying', evidence }, 'task/verifying', [this.history(who, 'reported', evidence, t)]);
  }
  private qualifies(t: CoordinatedTask, evidence: string[]): boolean {
    if (!Array.isArray(evidence) || t.epoch !== this.runtime.context().epoch) return false;
    return t.criteria.every(c => {
      if (!evidence.includes(c.id)) return false;
      if (c.kind === 'message-delivered') return this.messages().some(m => m.id === c.id && m.sender === t.owner && m.task === t.id && m.revision === t.revision && m.epoch === t.epoch && m.delivery === 'delivered');
      const command = this.runtime.journal.get<Command>(this.runtime.run, 'commands', c.id);
      return command?.batch.task === t.id && command.batch.revision === t.revision && command.receiptEpoch === t.epoch && command.state === 'acknowledged' && command.receipt?.status === 'completed';
    });
  }
  submit(who: string, batch: Batch): void {
    const t = this.task(batch.task);
    if (t.owner !== who || t.revision !== batch.revision || !['assigned', 'running'].includes(t.status) || this.budget.state.closed) throw new Error('Task execution admission closed');
    this.runtime.intent(batch, taskVisibility(t.id)); this.saveTask({ ...t, status: 'running', wait: null }, 'task/running');
  }
  /** Call on a bounded host timer; never starts an inference or polls through a model. */
  pump(): Promise<void> {
    // Control and provider cancellation must join an in-flight reconciliation,
    // not mistake a skipped concurrent call for its completion.
    if (!this.pumpWork) this.pumpWork = this.performPump().finally(() => { this.pumpWork = null; });
    return this.pumpWork;
  }
  private async performPump(): Promise<void> {
    this.busy = true;
    try {
      this.budget.tick();
      this.requestInterrupts();
      for (const m of this.messages().filter(m => m.delivery === 'pending')) this.deliver(m);
      for (const t of this.tasks()) {
        const stopped = this.held() || this.budget.state.closed || this.budget.state.turns.some(b => b.role === t.owner && b.closed && b.cancellation !== 'confirmed');
        const stale = t.epoch !== this.runtime.context().epoch;
        const invalidDependency = ['assigned', 'running', 'verifying', 'succeeded'].includes(t.status) && !this.dependenciesReady(t);
        if ((!terminal(t) && stopped) || (stale && (!terminal(t) || t.status === 'succeeded')) || invalidDependency) this.saveTask({ ...t, status: 'blocked', wait: stale ? 'epoch requires revision' : invalidDependency ? 'dependency requires revision' : 'budget cancellation' }, 'task/blocked');
      }
      const controlErrors: unknown[] = [];
      for (const r of this.runtime.ownership.list().filter(r => r.state !== 'released')) {
        const t = this.tasks().find(t => t.id === r.task);
        if (!t || t.revision !== r.revision || terminal(t) || ['blocked', 'verifying'].includes(t.status)) {
          try { this.runtime.ownership.revoke(r.id); await this.runtime.ownership.flush(r.id); } catch (error) { controlErrors.push(error); }
        }
      }
      for (const turn of this.stopped) {
        const b = this.budget.get(turn);
        if (!this.runtime.ownership.list().some(r => r.owner === b.role && r.state !== 'released')) { this.budget.confirmCancellation(turn); this.stopped.delete(turn); }
      }
      if (controlErrors.length) throw new AggregateError(controlErrors, 'Ownership cancellation unconfirmed');
      await this.runtime.execution.reconcile();
      for (const scope of this.operational.scopes()) {
        const afterTick = this.operational.samples(scope.id, scope.revision).at(-1)?.tick ?? -1;
        const response = await this.runtime.query({ op: 'operational-read', scopeId: scope.id, scopeRevision: scope.revision, afterTick });
        for (const sample of Array.isArray(response.samples) ? response.samples : []) this.operational.ingest(sample as never, { kind: 'restricted', agents: [], roles: [], tasks: [scope.task] });
      }
      for (const watch of this.watches.list()) {
        const scope = this.operational.scope(watch.scopeId);
        if (!scope || scope.revision !== watch.scopeRevision) continue;
        const metrics = this.operational.metrics(scope.id, Math.max(600, this.operational.limits.sampleTicks), undefined, [watch.metric.kind], [watch.metric.name]);
        const metric = metrics.find(m => m.quality === watch.metric.quality && m.surface === watch.metric.surface);
        if (metric?.coverage === 'complete' && metric.rate !== null) this.watches.evaluate(watch.id, metric.endTick, metric.rate, { kind: 'restricted', agents: [], roles: [], tasks: [watch.task] });
      }
      if (this.held()) return;
      // Reconciliation can discover a failure for the first time. Stop its queued remainder before dispatch.
      for (const t of this.tasks().filter(t => t.status === 'running')) {
        if (!this.runtime.execution.pending().some(c => c.batch.task === t.id && c.batch.revision === t.revision && c.state === 'acknowledged' && c.receipt && ['failed', 'partial', 'cancelled'].includes(c.receipt.status))) continue;
        this.saveTask({ ...t, status: 'failed', wait: 'command failed; manager diagnosis required' }, 'task/failed', [this.history(t.owner!, 'failure', { reason: 'command receipt' }, t)]);
        for (const r of this.runtime.ownership.list().filter(r => r.task === t.id && r.state !== 'released')) { this.runtime.ownership.revoke(r.id); await this.runtime.ownership.flush(r.id); }
      }
      for (const initial of this.tasks()) {
        let t = this.task(initial.id);
        if (t.status === 'verifying') {
          const passed = this.qualifies(t, t.evidence); this.saveTask({ ...t, status: passed ? 'succeeded' : 'failed', wait: passed ? null : 'evidence invalidated' }, 'task/verified'); continue;
        }
        if (!['proposed', 'ready', 'assigned', 'running'].includes(t.status) || this.budget.state.closed) continue;
        if (!this.dependenciesReady(t)) {
          if (t.wait !== 'dependency') this.saveTask({ ...t, wait: 'dependency' }, 'task/waiting'); continue;
        }
        if (t.status === 'proposed') { t = { ...t, status: 'ready', wait: null }; this.saveTask(t, 'task/ready'); }
        if (!t.owner) continue;
        if (this.tasks().some(other => other.id !== t.id && other.owner === t.owner && ['assigned', 'running', 'verifying'].includes(other.status))) continue;
        if (t.actor) {
          let r = this.runtime.ownership.list().find(r => r.task === t.id && r.revision === t.revision);
          if (r?.state === 'released') { this.saveTask({ ...t, status: 'blocked', wait: 'released ownership requires revision' }, 'task/blocked'); continue; }
          if (!r) {
            try { r = this.runtime.ownership.acquire({ id: createHash('sha256').update(JSON.stringify([t.id, t.revision])).digest('hex'), owner: t.owner, task: t.id, revision: t.revision, actor: t.actor, resources: t.reservations }); }
            catch (error) { if (!String(error).includes('Reservation conflict')) throw error; if (t.wait !== 'reservation') this.saveTask({ ...t, wait: 'reservation' }, 'task/waiting'); continue; }
          }
          if (r.state !== 'active') await this.runtime.ownership.flush(r.id);
          // The await may overlap a cancellation, revision or budget notification.
          this.budget.tick(); const current = this.task(t.id);
          if (this.held() || this.budget.state.closed || current.revision !== t.revision || terminal(current) || current.status === 'blocked') continue;
        }
        if (t.status === 'ready') this.saveTask({ ...t, status: 'assigned', wait: null }, 'task/assigned', [this.history(t.owner, 'assignment', { id: t.id }, t)]);
      }
      const order = new Map(this.runtime.journal.events().filter(e => e.type === 'command/intent').map(e => [e.correlation, e.sequence]));
      for (const c of this.runtime.execution.pending().filter(c => c.state === 'pending').sort((a, b) => order.get(a.batch.commandId)! - order.get(b.batch.commandId)!)) {
        if (!this.dispatchAllowed()) break;
        if (this.runtime.execution.pending().some(c => c.state === 'unknown' || c.state === 'sending' || c.receipt?.status === 'accepted' || c.receipt?.status === 'running')) break;
        const t = this.task(c.batch.task);
        if (!this.budget.state.closed && t.revision === c.batch.revision && ['assigned', 'running'].includes(t.status)) await this.runtime.dispatch(c.batch.commandId);
      }
      for (const a of this.agents()) {
        const t = this.tasks().find(t => t.owner === a.id && !terminal(t));
        const status: AgentInstance['status'] = this.budget.state.closed ? 'blocked' : t?.wait === 'dependency' ? 'waiting-dependency' : t?.wait === 'reservation' ? 'waiting-game' : t?.status === 'running' ? 'executing' : t?.status === 'blocked' ? 'blocked' : this.budget.state.turns.some(b => b.role === a.id && !b.finished && !b.closed) ? 'reasoning' : t ? 'idle' : 'completed';
        if (a.assignment !== (t?.id ?? null) || a.status !== status) this.runtime.record('agent/status', [{ entity: 'agents', id: a.id, value: { ...a, assignment: t?.id ?? null, status } }]);
      }
    } finally { this.busy = false; }
  }
  finish(turn: string, interrupted = false): void { this.budget.finish(turn, interrupted); }
  stop(reason: string): void { this.budget.closeRun(reason); }
  pendingStops(): TurnBudget[] { return this.budget.state.turns.filter(t => t.closed && (!t.finished || t.cancellation !== 'confirmed')); }
}
