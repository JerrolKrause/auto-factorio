import type { Journal, EventContext } from '../execution/durable.js';

export interface WorkshopUsageEvent {
  id: string; sessionId: string; invocationId: string; role: string; iteration: number | null; batchId: string | null;
  cumulativeTokens: number | null; monetaryAmount: number | null; allowanceRemaining: number | null; owner: 'workshop' | 'learning'; at: string;
}
export interface WorkshopUsageState {
  sessionId: string; totalTokens: number; unknownTokenInvocations: string[]; monetaryAmount: number | null; allowanceRemaining: number | null;
  byRole: Record<string, number>; byIteration: Record<string, number>; byBatch: Record<string, number>; byOwner: Record<'workshop'|'learning',number>; events: Record<string, WorkshopUsageEvent>;
}

/** Cumulative provider counters are charged once to their invocation owner. Unknown values stay unknown. */
export class WorkshopUsageLedger {
  constructor(private journal: Journal, private context: () => EventContext) {}
  state(sessionId: string): WorkshopUsageState {
    return this.journal.get<WorkshopUsageState>(this.context().run, 'usage', sessionId) ?? {
      sessionId, totalTokens: 0, unknownTokenInvocations: [], monetaryAmount: null, allowanceRemaining: null,
      byRole: {}, byIteration: {}, byBatch: {}, byOwner:{workshop:0,learning:0},events: {},
    };
  }
  record(event: WorkshopUsageEvent): WorkshopUsageState {
    if (!event.id || !event.sessionId || !event.invocationId || !event.role || !['workshop','learning'].includes(event.owner)) throw new Error('Invalid usage event');
    if (event.cumulativeTokens !== null && (!Number.isSafeInteger(event.cumulativeTokens) || event.cumulativeTokens < 0)) throw new Error('Invalid cumulative usage');
    const state = this.state(event.sessionId);state.byOwner??={workshop:0,learning:0};const previousEvent = state.events[event.id];
    if (previousEvent) {
      if (JSON.stringify(previousEvent) !== JSON.stringify(event)) throw new Error('Usage event identity collision');
      return state;
    }
    const invocationEvents=Object.values(state.events).filter(v=>v.invocationId===event.invocationId);if(invocationEvents.some(v=>v.owner!==event.owner||v.role!==event.role||v.sessionId!==event.sessionId||v.iteration!==event.iteration||v.batchId!==event.batchId))throw new Error('Usage invocation ownership collision');
    const prior = invocationEvents.filter(v => v.cumulativeTokens !== null)
      .reduce((n, v) => Math.max(n, v.cumulativeTokens!), 0);
    const delta = event.cumulativeTokens === null ? 0 : Math.max(0, event.cumulativeTokens - prior);
    state.events[event.id] = structuredClone(event); state.totalTokens += delta;
    state.byOwner[event.owner]=(state.byOwner[event.owner]??0)+delta;
    state.byRole[event.role] = (state.byRole[event.role] ?? 0) + delta;
    if (event.iteration !== null) state.byIteration[String(event.iteration)] = (state.byIteration[String(event.iteration)] ?? 0) + delta;
    if (event.batchId !== null) state.byBatch[event.batchId] = (state.byBatch[event.batchId] ?? 0) + delta;
    if (event.cumulativeTokens === null && !state.unknownTokenInvocations.includes(event.invocationId)) state.unknownTokenInvocations.push(event.invocationId);
    state.monetaryAmount = event.monetaryAmount; state.allowanceRemaining = event.allowanceRemaining;
    this.journal.append(this.context(), 'workshop/usage', [{ entity: 'usage', id: event.sessionId, value: { ...state } }]);
    return structuredClone(state);
  }
  admit(owner: 'workshop'|'learning', usedTurns: number, usedTools: number, caps: { turns: number; tools: number; learningReservedTurns: number; learningReservedTools: number }): void {
    const turnLimit = owner === 'learning' ? caps.turns : caps.turns - caps.learningReservedTurns;
    const toolLimit = owner === 'learning' ? caps.tools : caps.tools - caps.learningReservedTools;
    if (usedTurns >= turnLimit || usedTools >= toolLimit) throw new Error(`${owner} budget admission exhausted`);
  }
}
