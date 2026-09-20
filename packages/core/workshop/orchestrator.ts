import { createHash } from 'node:crypto';
import type { Journal, EventContext } from '../execution/durable.js';
import type { ModelSelection, WorkshopAssignment, WorkshopCandidateRef, WorkshopEvaluationReport, WorkshopScore } from '@autofactorio/contracts';
import { resolveWorkshopModels } from '@autofactorio/contracts';
import { compareWorkshopScores } from './scoring.js';

export type WorkshopStage = 'configured'|'preflight'|'designing'|'building'|'frozen'|'measuring'|'scoring'|'checkpoint'|'finalizing'|'library'|'learning'|'reported'|'complete'|'held'|'stopped';
export type WorkshopCheckpointKind = 'brief'|'afterScore'|'libraryAdmission'|'learningActivation';
export interface WorkshopCheckpointState { kind:WorkshopCheckpointKind; key:string; resumeStage:WorkshopStage; deadline:string }
export interface WorkshopIterationState {
  id: string; sessionId: string; number: number; stage: WorkshopStage; artifact: WorkshopCandidateRef|null;
  evaluation: WorkshopEvaluationReport|null; score: WorkshopScore|null; feedback: string|null; operationIds: string[]; valid: boolean|null;
}
export interface WorkshopSessionState {
  id: string; assignment: WorkshopAssignment; stage: WorkshopStage; selections: Record<'designer'|'scorer'|'learnings', ModelSelection>;
  iterations: WorkshopIterationState[]; activeIteration: number|null; bestIteration: number|null; validIterations: number[];
  steeringRevision: number; stopReason: string|null; checkpointDeadline: string|null; pinnedBundleHash: string; operationResults: Record<string, unknown>;
  checkpoint:WorkshopCheckpointState|null; checkpointDecisions:Record<string,'continue'|'finish'>;
  operationIntents:Record<string,{stage:WorkshopStage;status:'dispatched'|'unknown'|'acknowledged'|'failed';at:string;failure?:string}>;
  assistance: { revision:number; text:string; at:string }[]; finalOutcome: 'best-valid'|'no-valid-result'|null;
}
const allowed: Record<WorkshopStage, WorkshopStage[]> = {
  configured:['preflight','stopped'], preflight:['designing','checkpoint','stopped'], designing:['building','stopped'], building:['frozen','stopped'],
  frozen:['measuring','stopped'], measuring:['scoring','stopped'], scoring:['checkpoint','designing','finalizing','stopped'],
  checkpoint:['designing','finalizing','stopped'], finalizing:['library','learning','reported','checkpoint','stopped'], library:['learning','reported','checkpoint','stopped'],
  learning:['checkpoint','reported','held','stopped'], reported:['complete','stopped'], complete:[], held:['stopped'], stopped:[],
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Durable workshop state machine. Side effects are named before dispatch and reconciled by operation id. */
export class WorkshopOrchestrator {
  constructor(private journal: Journal, private context: () => EventContext) {}
  get(id: string): WorkshopSessionState { const value = this.journal.get<WorkshopSessionState>(this.context().run, 'workshopSessions', id); if (!value) throw new Error('Unknown workshop session'); return {...value,checkpoint:value.checkpoint??null,checkpointDecisions:value.checkpointDecisions??{},operationIntents:value.operationIntents??{}}; }
  configure(id: string, assignment: WorkshopAssignment, bundleHash: string): WorkshopSessionState {
    const existing = this.journal.get<WorkshopSessionState>(this.context().run, 'workshopSessions', id);
    if (existing) {
      if (hash(existing.assignment) !== hash(assignment) || existing.pinnedBundleHash !== bundleHash) throw new Error('Workshop session identity collision');
      return existing;
    }
    const value: WorkshopSessionState = { id, assignment: structuredClone(assignment), stage:'configured', selections: resolveWorkshopModels(assignment.models), iterations:[], activeIteration:null, bestIteration:null, validIterations:[], steeringRevision:0, stopReason:null, checkpointDeadline:null, checkpoint:null, checkpointDecisions:{}, pinnedBundleHash:bundleHash, operationResults:{}, operationIntents:{}, assistance:[], finalOutcome:null };
    this.save(value, 'workshop/configured'); return value;
  }
  preflight(id: string, available: ModelSelection[]): WorkshopSessionState {
    const s = this.get(id); this.requireAvailable(s,available);
    return this.transition(s, 'preflight', 'workshop/preflight');
  }
  recheckAvailability(id:string,available:ModelSelection[]):WorkshopSessionState { const s=this.get(id);this.requireAvailable(s,available);this.save(s,'workshop/availability-rechecked');return s; }
  beginIteration(id: string): WorkshopIterationState {
    const s = this.get(id); if (!['preflight','scoring','checkpoint'].includes(s.stage)) throw new Error('Iteration cannot start from current stage');
    if (s.iterations.length >= s.assignment.iterations.attempts) throw new Error('Iteration cap reached');
    if (s.stage === 'checkpoint' && s.checkpointDeadline) throw new Error('Checkpoint unresolved');
    const number = s.iterations.length + 1; const iteration: WorkshopIterationState = { id:`${id}:${number}`, sessionId:id, number, stage:'designing', artifact:null, evaluation:null, score:null, feedback:null, operationIds:[], valid:null };
    s.iterations.push(iteration); s.activeIteration=number; s.stage='designing'; this.saveBoth(s, iteration, 'workshop/iteration-started'); return structuredClone(iteration);
  }
  advance(id: string, next: WorkshopStage): WorkshopSessionState { return this.transition(this.get(id), next, `workshop/${next}`); }
  artifact(id: string, candidate: WorkshopCandidateRef): void { const [s,i]=this.active(id,'building'); if (candidate.sessionId !== id || candidate.iteration !== i.number || candidate.assignmentRevision !== s.assignment.revision || candidate.bundleHash !== s.pinnedBundleHash) throw new Error('Candidate provenance mismatch'); i.artifact=structuredClone(candidate); this.saveBoth(s,i,'workshop/artifact'); }
  evaluation(id: string, report: WorkshopEvaluationReport): void { const [s,i]=this.active(id,'measuring'); if (report.attemptId !== i.id) throw new Error('Evaluation provenance mismatch'); i.evaluation=structuredClone(report); i.valid=report.valid; this.saveBoth(s,i,'workshop/evaluated'); }
  score(id: string, score: WorkshopScore, feedback: string): void {
    const [s,i]=this.active(id,'scoring'); if (score.candidate.sessionId !== id || score.candidate.iteration !== i.number || score.candidate.artifactHash !== i.artifact?.artifactHash) throw new Error('Score provenance mismatch');
    if(score.rubricVersion!==s.assignment.rubric.version)throw new Error('Score rubric version mismatch');
    i.score=structuredClone(score); i.feedback=feedback; i.valid=i.evaluation?.valid === true&&i.evaluation.passed===true&&score.eligible===true; if (i.valid&&!s.validIterations.includes(i.number)) s.validIterations.push(i.number);
    s.bestIteration=this.best(s); this.saveBoth(s,i,'workshop/scored');
  }
  next(id: string): 'iterate'|'checkpoint'|'finalize' {
    const s=this.get(id); if (s.stage !== 'scoring') throw new Error('Iteration is not scored');
    const complete=s.iterations.length >= s.assignment.iterations.attempts;
    let plateau=false; const n=s.assignment.iterations.plateauRounds;
    if (s.assignment.iterations.mode==='maximum' && s.assignment.iterations.earlyStop && s.validIterations.length >= n+1) {
      const recent=s.validIterations.slice(-(n+1)).map(v=>s.iterations[v-1]!.score); plateau=recent.slice(1).every((v,index)=>compareWorkshopScores(v,recent[index]!,s.assignment.rubric)<=0);
    }
    const key=`afterScore:${s.activeIteration}`;if(s.assignment.checkpoints.afterScore&&!Object.hasOwn(s.checkpointDecisions,key)){this.requestCheckpoint(id,'afterScore','scoring',key);return'checkpoint';}
    return complete||plateau?'finalize':'iterate';
  }
  requestCheckpoint(id:string,kind:WorkshopCheckpointKind,resumeStage:WorkshopStage,key:string=kind):boolean{const s=this.get(id);if(Object.hasOwn(s.checkpointDecisions,key))return false;if(s.stage==='checkpoint'||!allowed[s.stage].includes('checkpoint'))throw new Error(`Checkpoint cannot start from ${s.stage}`);const deadline=new Date(Date.parse(this.context().wallTime)+s.assignment.checkpoints.timeoutMs).toISOString();s.checkpoint={kind,key,resumeStage,deadline};s.checkpointDeadline=deadline;s.stage='checkpoint';this.save(s,`workshop/checkpoint-${kind}`);return true;}
  resolveCheckpoint(id:string,revision:number,action:'continue'|'finish',text=''):WorkshopSessionState{const s=this.get(id),checkpoint=s.checkpoint;if(s.stage!=='checkpoint'||!checkpoint||revision!==s.steeringRevision+1)throw new Error('Stale or invalid workshop checkpoint');if(text.trim())s.assistance.push({revision,text,at:this.context().wallTime});s.steeringRevision=revision;s.checkpointDecisions[checkpoint.key]=action;s.checkpoint=null;s.checkpointDeadline=null;if(action==='continue')s.stage=checkpoint.resumeStage;else{s.stage='reported';s.stopReason=`checkpoint_finish:${checkpoint.kind}`;s.finalOutcome??=s.bestIteration===null?'no-valid-result':'best-valid';}this.save(s,`workshop/checkpoint-${action}`);return structuredClone(s);}
  steer(id: string, revision: number, text: string): WorkshopSessionState { if(!text.trim())throw new Error('Stale or invalid workshop steering');return this.resolveCheckpoint(id,revision,'continue',text); }
  timeout(id: string, now: string): 'waiting'|'finish'|'continue' { const s=this.get(id); if (s.stage!=='checkpoint'||!s.checkpoint||Date.parse(now)<Date.parse(s.checkpoint.deadline)) return 'waiting';const action=s.assignment.checkpoints.timeoutAction;this.resolveCheckpoint(id,s.steeringRevision+1,action,'review-timeout');return action; }
  stop(id: string, reason: string): WorkshopSessionState { const s=this.get(id); if (!reason.trim()) throw new Error('Stop reason required'); s.stage='stopped'; s.stopReason=reason; this.save(s,'workshop/stopped'); return s; }
  fail(id:string,reason:string):WorkshopSessionState { const s=this.get(id);if(!reason.trim())throw new Error('Failure reason required');for(const [operationId,intent] of Object.entries(s.operationIntents))if(intent.status==='dispatched')s.operationIntents[operationId]={...intent,status:'failed',failure:reason};s.stage='stopped';s.stopReason=reason;this.save(s,'workshop/failed');return s; }
  hold(id:string,reason:string):WorkshopSessionState { const s=this.get(id);if(!reason.trim())throw new Error('Hold reason required');s.stage='held';s.stopReason=reason;this.save(s,'workshop/held');return s; }
  holdInFlight(id:string,reason:string):WorkshopSessionState { const s=this.get(id);if(!reason.trim())throw new Error('Hold reason required');for(const [operationId,intent] of Object.entries(s.operationIntents))if(intent.status==='dispatched')s.operationIntents[operationId]={...intent,status:'unknown'};s.stage='held';s.stopReason=reason;this.save(s,'workshop/cancellation-unconfirmed');return s; }
  finalize(id:string):WorkshopSessionState { const s=this.get(id);if(s.stage!=='scoring'&&s.stage!=='checkpoint')throw new Error('Workshop cannot finalize from current stage');if(s.stage==='checkpoint'&&s.checkpointDeadline)throw new Error('Checkpoint unresolved');s.stage='finalizing';s.finalOutcome=s.bestIteration===null?'no-valid-result':'best-valid';this.save(s,'workshop/finalized');return s; }
  async effect<T>(id: string, operationId: string, run: () => Promise<T>, reconcile?:()=>Promise<{resolved:true;value:T}|{resolved:false}>): Promise<T> {
    const s=this.get(id); if (!operationId) throw new Error('Operation identity required'); if (Object.hasOwn(s.operationResults,operationId)) return structuredClone(s.operationResults[operationId]) as T;
    const prior=s.operationIntents[operationId];
    if(prior){
      const reconciled=await reconcile?.();
      if(reconciled?.resolved){this.reconcileEffect(id,operationId,reconciled.value);return structuredClone(reconciled.value);}
      const current=this.get(id);current.operationIntents[operationId]={...prior,status:'unknown'};this.save(current,'workshop/effect-unknown');throw new Error(`Workshop effect outcome unknown: ${operationId}`);
    }
    const i=s.activeIteration===null?null:s.iterations[s.activeIteration-1]!; if (i&&!i.operationIds.includes(operationId)) i.operationIds.push(operationId);
    s.operationIntents[operationId]={stage:s.stage,status:'dispatched',at:this.context().wallTime};this.save(s,'workshop/effect-intent'); const result=await run(); const current=this.get(id);
    if (!Object.hasOwn(current.operationResults,operationId)) { current.operationResults[operationId]=structuredClone(result);current.operationIntents[operationId]={...current.operationIntents[operationId]!,status:'acknowledged'}; this.save(current,'workshop/effect-acknowledged'); }
    return structuredClone(result);
  }
  reconcileEffect(id:string,operationId:string,result:unknown):void { const s=this.get(id); if (Object.hasOwn(s.operationResults,operationId)&&JSON.stringify(s.operationResults[operationId])!==JSON.stringify(result)) throw new Error('Operation reconciliation conflict'); s.operationResults[operationId]=structuredClone(result);const prior=s.operationIntents[operationId];s.operationIntents[operationId]={stage:prior?.stage??s.stage,status:'acknowledged',at:prior?.at??this.context().wallTime}; this.save(s,'workshop/effect-reconciled'); }
  private active(id:string,stage:WorkshopStage):[WorkshopSessionState,WorkshopIterationState]{ const s=this.get(id); if(s.stage!==stage||s.activeIteration===null)throw new Error(`Workshop is not ${stage}`); return [s,s.iterations[s.activeIteration-1]!]; }
  private transition(s:WorkshopSessionState,next:WorkshopStage,type:string):WorkshopSessionState { if(!allowed[s.stage].includes(next))throw new Error(`Invalid workshop transition ${s.stage} -> ${next}`); s.stage=next; const i=s.activeIteration===null?null:s.iterations[s.activeIteration-1]; if(i&&['building','frozen','measuring','scoring'].includes(next))i.stage=next; this.save(s,type); if(i)this.saveIteration(i,type); return s; }
  private best(s:WorkshopSessionState):number|null { const valid=s.iterations.filter(v=>v.valid&&v.score); if(!valid.length)return null; return valid.sort((a,b)=>compareWorkshopScores(b.score,a.score,s.assignment.rubric)||a.number-b.number)[0]!.number; }
  private requireAvailable(s:WorkshopSessionState,available:ModelSelection[]):void { for (const [role, selection] of Object.entries(s.selections)) if (!available.some(v => JSON.stringify(v) === JSON.stringify(selection))) throw new Error(`${role} managed selection unavailable; no fallback`); }
  private save(s:WorkshopSessionState,type:string):void { this.journal.append(this.context(),type,[{entity:'workshopSessions',id:s.id,value:{...s}}]); }
  private saveIteration(i:WorkshopIterationState,type:string):void { this.journal.append(this.context(),type,[{entity:'workshopIterations',id:i.id,value:{...i}}]); }
  private saveBoth(s:WorkshopSessionState,i:WorkshopIterationState,type:string):void { this.journal.append(this.context(),type,[{entity:'workshopSessions',id:s.id,value:{...s}},{entity:'workshopIterations',id:i.id,value:{...i}}]); }
}
