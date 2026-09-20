import type { Journal, EventContext } from '../execution/durable.js';

export interface WorkshopUsageEvent {
  id: string; sessionId: string; invocationId: string; role: string; iteration: number | null; batchId: string | null;
  cumulativeTokens: number | null; monetaryAmount: number | null; allowanceRemaining: number | null; owner: 'workshop' | 'learning'; at: string;
}
export interface WorkshopUsageState {
  sessionId: string; totalTokens: number; unknownTokenInvocations: string[]; monetaryAmount: number | null; allowanceRemaining: number | null;
  byRole: Record<string, number>; byIteration: Record<string, number>; byBatch: Record<string, number>; byOwner: Record<'workshop'|'learning',number>; events: Record<string, WorkshopUsageEvent>;
}

export type WorkshopInferenceOwner='workshop'|'learning';
export interface WorkshopInferenceUsage { turns:number;tools:number;elapsedMs:number;tokens:number|null }
export interface WorkshopInferenceAdmission {
  schema:1;sessionId:string;invocationId:string;owner:WorkshopInferenceOwner;role:string;
  limits:{turns:number;tools:number;wallMs:number;tokens:number|null};
}
export interface DurableOwnerUsage { turns:number;tools:number;elapsedMs:number;tokens:number;unknownTokens:boolean }
export interface DurableUsageInvocation { owner:WorkshopInferenceOwner;role:string;status:'started'|'complete'|'unknown';turns:number;tools:number;elapsedMs:number;tokens:number|null;text?:string }
export interface DurableInferenceUsage { workshop:DurableOwnerUsage;learning:DurableOwnerUsage;elapsedMs:number;tokens:number;unknownTokens:boolean;invocations:Record<string,DurableUsageInvocation> }

export const emptyInferenceUsage=():DurableInferenceUsage=>{const owner=():DurableOwnerUsage=>({turns:0,tools:0,elapsedMs:0,tokens:0,unknownTokens:false});return{workshop:owner(),learning:owner(),elapsedMs:0,tokens:0,unknownTokens:false,invocations:{}};};

/** Sole aggregate admission owner for workshop inference. Provider adapters receive only its finite token. */
export class WorkshopInferenceAdmissions {
  constructor(readonly sessionId:string,private budgets:{wallMs:number;turns:number;toolCalls:number;reportedTokens:number|null;learningReservedTurns:number;learningReservedTools:number},readonly state:DurableInferenceUsage){}
  completed(invocationId:string):string|null{const prior=this.state.invocations[invocationId];if(!prior)return null;if(prior.status==='complete'&&prior.text!==undefined)return prior.text;throw new Error(`Managed invocation outcome unknown: ${invocationId}`);}
  admit(owner:WorkshopInferenceOwner,role:string,invocationId:string):WorkshopInferenceAdmission{
    if(this.state.invocations[invocationId])throw new Error(`Managed invocation identity already admitted: ${invocationId}`);
    const reserveShare=Math.max(this.budgets.turns===0?0:this.budgets.learningReservedTurns/this.budgets.turns,this.budgets.toolCalls===0?0:this.budgets.learningReservedTools/this.budgets.toolCalls),reservedWall=Math.floor(this.budgets.wallMs*reserveShare),reservedTokens=this.budgets.reportedTokens===null?null:Math.floor(this.budgets.reportedTokens*reserveShare),caps=owner==='workshop'?{turns:this.budgets.turns-this.budgets.learningReservedTurns,tools:this.budgets.toolCalls-this.budgets.learningReservedTools,wallMs:this.budgets.wallMs-reservedWall,tokens:this.budgets.reportedTokens===null?null:this.budgets.reportedTokens-reservedTokens!}:{turns:this.budgets.learningReservedTurns,tools:this.budgets.learningReservedTools,wallMs:reservedWall,tokens:reservedTokens},used=this.state[owner];
    if(caps.tokens!==null&&used.unknownTokens)throw new Error(`${owner} aggregate reported-token usage unknown; further inference deferred`);
    const limits={turns:caps.turns-used.turns,tools:caps.tools-used.tools,wallMs:caps.wallMs-used.elapsedMs,tokens:caps.tokens===null?null:caps.tokens-used.tokens};
    if(limits.turns<=0||limits.tools<=0||limits.wallMs<=0||limits.tokens!==null&&limits.tokens<=0)throw new Error(`${owner} aggregate provider budget exhausted`);
    used.turns++;this.state.invocations[invocationId]={owner,role,status:'started',turns:1,tools:0,elapsedMs:0,tokens:null};
    return{schema:1,sessionId:this.sessionId,invocationId,owner,role,limits:{...limits,turns:1}};
  }
  complete(admission:WorkshopInferenceAdmission,usage:WorkshopInferenceUsage,text:string):void{const record=this.record(admission);record.status='complete';record.text=text;record.tools=Math.max(0,usage.tools);record.elapsedMs=Math.max(0,usage.elapsedMs);record.tokens=usage.tokens;const owner=this.state[admission.owner];owner.tools+=record.tools;owner.elapsedMs+=record.elapsedMs;this.state.elapsedMs+=record.elapsedMs;if(record.tokens===null){owner.unknownTokens=true;this.state.unknownTokens=true;}else{owner.tokens+=record.tokens;this.state.tokens+=record.tokens;}}
  unknown(admission:WorkshopInferenceAdmission,elapsedMs:number):void{const record=this.record(admission),owner=this.state[admission.owner];record.status='unknown';record.tools=admission.limits.tools;record.elapsedMs=Math.max(0,elapsedMs);owner.tools+=record.tools;owner.elapsedMs+=record.elapsedMs;owner.unknownTokens=true;this.state.elapsedMs+=record.elapsedMs;this.state.unknownTokens=true;}
  private record(admission:WorkshopInferenceAdmission):DurableUsageInvocation{if(admission.schema!==1||admission.sessionId!==this.sessionId||admission.invocationId===''||admission.owner!=='workshop'&&admission.owner!=='learning')throw new Error('Invalid workshop inference admission');const record=this.state.invocations[admission.invocationId];if(!record||record.owner!==admission.owner||record.role!==admission.role||record.status!=='started')throw new Error('Workshop inference admission identity mismatch');return record;}
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
}
