export interface Caps { turns: number; concurrency: number; turnMs: number; runMs: number; tools: number; tokens: number | null }
export const PROBE_CAPS: Caps = { turns: 6, concurrency: 2, turnMs: 60_000, runMs: 300_000, tools: 12, tokens: 30_000 };
export interface TurnBudget {
  id: string; role: string; elapsedMs: number; attempts: number; closed: boolean; finished: boolean;
  reason: string | null; interrupt: 'none' | 'unconfirmed' | 'confirmed'; cancellation: 'none' | 'unconfirmed' | 'confirmed';
}
export interface BudgetState {
  elapsedMs: number; spentTurns: number; attempts: number; closed: boolean; reason: string | null;
  reportedTokens: number; usageBySession: Record<string, number>; turns: TurnBudget[];
}
export type StopCallback = (turn: TurnBudget) => void;
/** Clock-independent persisted counters; a fresh monotonic epoch never resets spent time. */
export class Budget {
  readonly state: BudgetState;
  private last: number;
  private readonly stopNotified = new Set<string>();
  constructor(readonly caps: Caps, private readonly now: () => number, private readonly stop: StopCallback, prior?: BudgetState, private readonly persist: (state: BudgetState) => void = () => {}) {
    for (const value of [caps.turns, caps.concurrency, caps.turnMs, caps.runMs, caps.tools, ...(caps.tokens === null ? [] : [caps.tokens])]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Budget caps must be positive safe integers');
    }
    this.state = prior ? structuredClone(prior) : { elapsedMs: 0, spentTurns: 0, attempts: 0, closed: false, reason: null, reportedTokens: 0, usageBySession: {}, turns: [] };
    this.last = now();
    // A replacement controller cannot assume old processes/orders stopped.
    if (prior) for (const turn of this.state.turns) if (!turn.finished) this.closeTurn(turn, 'controller_replaced');
    this.commit();
  }
  private notifyStop(turn: TurnBudget): void {
    if (this.stopNotified.has(turn.id)) return;
    this.stopNotified.add(turn.id); this.stop(turn);
  }
  private commit(): void {
    try { this.persist(structuredClone(this.state)); }
    catch (error) {
      // Storage failure must never prevent interruption of already active work.
      this.state.closed = true; this.state.reason = 'persistence_failed';
      for (const turn of this.state.turns) if (!turn.finished) {
        turn.closed = true; turn.reason = 'persistence_failed'; turn.interrupt = 'unconfirmed'; turn.cancellation = 'unconfirmed';
      }
      for (const turn of this.state.turns) if (!turn.finished) {
        try { this.notifyStop(turn); } catch { /* Attempt every stop; preserve the original persistence error. */ }
      }
      throw error;
    }
  }
  confirmCancellation(id: string): void { this.get(id).cancellation = 'confirmed'; this.commit(); }
  tick(): void {
    const current = this.now(); const delta = Math.max(0, current - this.last); this.last = current;
    this.state.elapsedMs += delta;
    for (const turn of this.state.turns) if (!turn.finished) turn.elapsedMs += delta;
    if (this.state.elapsedMs >= this.caps.runMs) this.closeRun('run_time');
    if (this.caps.tokens !== null && this.state.reportedTokens >= this.caps.tokens) this.closeRun('reported_tokens');
    for (const turn of this.state.turns) if (!turn.finished && turn.elapsedMs >= this.caps.turnMs) this.closeTurn(turn, 'turn_time');
    this.commit();
  }
  admit(role: string): TurnBudget {
    this.tick();
    if (this.state.closed) throw new Error(`Run closed: ${this.state.reason}`);
    if (this.state.spentTurns >= this.caps.turns) throw new Error('Provider turn admission exhausted');
    if (this.state.turns.filter(t => !t.finished).length >= this.caps.concurrency) throw new Error('Concurrency exhausted');
    if (this.state.turns.some(t => t.role === role && (!t.finished || (t.closed && t.cancellation !== 'confirmed')))) throw new Error('Role requires completion and reconciliation');
    const turn: TurnBudget = { id: `turn-${++this.state.spentTurns}`, role, elapsedMs: 0, attempts: 0, closed: false, finished: false, reason: null, interrupt: 'none', cancellation: 'none' };
    this.state.turns.push(turn); this.commit(); return turn;
  }
  attempt(id: string | null): boolean {
    this.tick(); this.state.attempts++;
    const turn = this.state.turns.find(t => t.id === id);
    if (!turn) { this.commit(); return false; }
    turn.attempts++; this.commit();
    if (turn.closed || turn.finished || this.state.closed) return false;
    if (turn.attempts > this.caps.tools) { this.closeTurn(turn, 'tool_attempts'); return false; }
    return true;
  }
  afterAttempt(id: string): void {
    const turn = this.get(id);
    if (turn.attempts >= this.caps.tools) this.closeTurn(turn, 'tool_attempts');
  }
  usage(session: string, cumulative: number): void {
    if (!Number.isSafeInteger(cumulative) || cumulative < 0) return;
    const previous = this.state.usageBySession[session] ?? 0;
    this.state.usageBySession[session] = Math.max(previous, cumulative);
    this.state.reportedTokens += Math.max(0, cumulative - previous); this.tick();
  }
  finish(id: string, interrupted = false): void {
    const turn = this.get(id); turn.finished = true;
    if (interrupted) turn.interrupt = 'confirmed';
    this.commit();
  }
  get(id: string): TurnBudget {
    const turn = this.state.turns.find(t => t.id === id); if (!turn) throw new Error('Unknown turn'); return turn;
  }
  closeTurn(turn: TurnBudget, reason: string): void {
    if (turn.closed || turn.finished) return;
    turn.closed = true; turn.reason = reason; turn.interrupt = 'unconfirmed'; turn.cancellation = 'unconfirmed'; this.commit(); this.notifyStop(turn);
  }
  closeRun(reason: string): void {
    if (this.state.closed) return;
    // Admission closure precedes every callback, including re-entrant late tools.
    this.state.closed = true; this.state.reason = reason; this.commit();
    for (const turn of this.state.turns) this.closeTurn(turn, reason);
  }
  snapshot(): BudgetState { this.tick(); return structuredClone(this.state); }
}
