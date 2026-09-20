import { normalizeEffectReceipt, resolveWorkshopModels, validateWorkshopAssignment } from '@autofactorio/contracts';
import type { EffectReceipt, ModelSelection, WorkshopAssignment, WorkshopCandidateRef, WorkshopEvaluationReport, WorkshopScore } from '@autofactorio/contracts';
import type { LibraryAdmission, LibraryEntry } from './library.js';
import { BlueprintLibrary } from './library.js';
import type { LearningService } from './learning.js';
import type { WorkshopSessionState } from './orchestrator.js';
import { WorkshopOrchestrator } from './orchestrator.js';
import type { WorkshopUsageLedger } from './usage.js';

export interface WorkshopRuntimeServices { library:BlueprintLibrary; learning:LearningService; usage:WorkshopUsageLedger; sessions:()=>WorkshopSessionState[] }
export type WorkshopCancellation = EffectReceipt;

export class WorkshopEffectOutcomeError extends Error {
  constructor(readonly outcome:'failed'|'unknown',cause:unknown){super(String(cause),cause instanceof Error?{cause}:undefined);this.name='WorkshopEffectOutcomeError';}
}

export interface WorkshopRuntimeHost {
  bindServices?(services:WorkshopRuntimeServices):void;
  resolve(input:unknown):Promise<WorkshopAssignment>;
  preflight?(assignment:WorkshopAssignment):Promise<void>;
  design(session:WorkshopSessionState,iteration:number):Promise<WorkshopCandidateRef>;
  build(session:WorkshopSessionState,candidate:WorkshopCandidateRef):Promise<void>;
  measure(session:WorkshopSessionState,candidate:WorkshopCandidateRef):Promise<WorkshopEvaluationReport>;
  score(session:WorkshopSessionState,candidate:WorkshopCandidateRef,evaluation:WorkshopEvaluationReport):Promise<{score:WorkshopScore;feedback:string}>;
  finalization(session:WorkshopSessionState):Promise<{admission:LibraryAdmission|null;learningRequired:boolean}>;
  prepareLearning(session:WorkshopSessionState):Promise<{activationRequired:boolean}>;
  activateLearning(session:WorkshopSessionState):Promise<void>;
  reconcile?<T>(session:WorkshopSessionState,operationId:string):Promise<{resolved:true;value:T}|{resolved:false}>;
  cancel(sessionId:string):WorkshopCancellation|Promise<WorkshopCancellation>;
  close?():void|Promise<void>;
}

/** Runtime-owned loop. Browser requests only resolve and enqueue durable work. */
export class WorkshopRuntime {
  private active=new Map<string,Promise<void>>();
  private timers=new Map<string,ReturnType<typeof setTimeout>>();
  private closing=false;
  constructor(private orchestrator:WorkshopOrchestrator,private host:WorkshopRuntimeHost,private library:BlueprintLibrary,private available:()=>ModelSelection[],private bundleHash:(sessionId:string)=>string,private listSessions:()=>WorkshopSessionState[],private publish:(entry:LibraryEntry)=>void){}
  async launch(input:unknown):Promise<WorkshopSessionState>{
    const assignment=validateWorkshopAssignment(await this.host.resolve(input)),available=this.available();
    await this.host.preflight?.(assignment);
    if(!available.length)throw new Error('Managed model catalog unavailable; workshop inference withheld');
    for(const[role,selection]of Object.entries(resolveWorkshopModels(assignment.models)))if(!available.some(value=>JSON.stringify(value)===JSON.stringify(selection)))throw new Error(`${role} managed selection unavailable; no fallback`);
    const session=this.orchestrator.configure(assignment.id,assignment,this.bundleHash(assignment.id));this.orchestrator.preflight(session.id,available);if(assignment.checkpoints.brief)this.orchestrator.requestCheckpoint(session.id,'brief','preflight');else this.orchestrator.beginIteration(session.id);this.track(session.id);return this.orchestrator.get(session.id);
  }
  resume(id:string):WorkshopSessionState{const session=this.orchestrator.get(id);if(['complete','stopped'].includes(session.stage))return session;if(session.stage==='checkpoint')throw new Error('Checkpoint unresolved');this.track(id);return session;}
  recover():void{for(const session of this.sessions())if(!['complete','held','stopped'].includes(session.stage))this.track(session.id);}
  pending(id:string):Promise<void>|undefined{return this.active.get(id);}
  async stop(id:string,reason:string):Promise<WorkshopSessionState>{let cancellation:WorkshopCancellation;try{cancellation=this.cancellation(await this.host.cancel(id),id);}catch(error){cancellation={schema:1,effectId:`workshop:${id}`,outcome:'unknown',failures:[String(error)]};}if(cancellation.outcome==='unknown')return this.orchestrator.holdInFlight(id,`stop_cancellation_unconfirmed:${cancellation.failures.join('|')}`);return this.orchestrator.stop(id,reason);}
  async close():Promise<void>{this.closing=true;for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();const active=[...this.active.keys()],cancellations=active.map(async id=>{try{return{id,result:this.cancellation(await this.host.cancel(id),id)};}catch(error){return{id,result:{schema:1 as const,effectId:`workshop:${id}`,outcome:'unknown' as const,failures:[String(error)]}};}});const results=await Promise.all(cancellations);for(const {id,result}of results){const session=this.orchestrator.get(id);if(!['complete','held','stopped'].includes(session.stage))this.orchestrator.holdInFlight(id,result.outcome!=='unknown'?'runtime_closed_with_inflight_effect':`close_cancellation_unconfirmed:${result.failures.join('|')}`);}await Promise.allSettled(this.active.values());await this.host.close?.();}
  private sessions():WorkshopSessionState[]{return this.listSessions();}
  private track(id:string):void{if(this.closing)return;const session=this.orchestrator.get(id);const prior=this.timers.get(id);if(prior){clearTimeout(prior);this.timers.delete(id);}if(session.stage==='checkpoint'&&session.checkpoint){const delay=Math.max(0,Date.parse(session.checkpoint.deadline)-Date.now());const timer=setTimeout(()=>{this.timers.delete(id);if(this.orchestrator.timeout(id,new Date().toISOString())!=='waiting')this.enqueue(id);},Math.min(delay,2_147_483_647));timer.unref?.();this.timers.set(id,timer);return;}this.enqueue(id);}
  private enqueue(id:string):void{if(this.closing||this.active.has(id))return;const task=Promise.resolve().then(()=>this.run(id)).catch(error=>{const current=this.orchestrator.get(id);if(!['complete','held','stopped'].includes(current.stage)){const reason=String(error),unknown=error instanceof WorkshopEffectOutcomeError&&error.outcome==='unknown'||reason.includes('Workshop effect outcome unknown');if(unknown)this.orchestrator.holdInFlight(id,`workshop_runtime_held:${reason}`);else this.orchestrator.fail(id,`workshop_runtime_failed:${reason}`);}}).finally(()=>this.active.delete(id));this.active.set(id,task);}
  private async run(id:string):Promise<void>{
    for(;;){
      let session=this.orchestrator.get(id);if(['complete','held','stopped'].includes(session.stage))return;if(session.stage==='checkpoint'){this.track(id);return;}
      if(session.stage==='configured'){this.orchestrator.preflight(id,this.available());continue;}
      if(session.stage==='preflight'){this.orchestrator.beginIteration(id);continue;}
      const iteration=session.activeIteration;if(iteration===null)throw new Error('Workshop iteration identity missing');
      const op=(name:string)=>`${id}:${iteration}:${name}`;
      if(session.stage==='designing'){
        this.orchestrator.recheckAvailability(id,this.available());
        const candidate=await this.orchestrator.effect(id,op('design'),()=>this.host.design(session,iteration),()=>this.reconcile(session,op('design')));
        this.orchestrator.advance(id,'building');this.orchestrator.artifact(id,candidate);continue;
      }
      const state=session.iterations[iteration-1]!;if(!state.artifact)throw new Error('Workshop artifact missing');
      if(session.stage==='building'){await this.orchestrator.effect(id,op('build'),async()=>{await this.host.build(session,state.artifact!);return{completed:true};},()=>this.reconcile(session,op('build')));this.orchestrator.advance(id,'frozen');continue;}
      if(session.stage==='frozen'){this.orchestrator.advance(id,'measuring');continue;}
      if(session.stage==='measuring'){const evaluation=await this.orchestrator.effect(id,op('measure'),()=>this.host.measure(session,state.artifact!),()=>this.reconcile(session,op('measure')));this.orchestrator.evaluation(id,evaluation);this.orchestrator.advance(id,'scoring');continue;}
      if(session.stage==='scoring'&&!state.score){this.orchestrator.recheckAvailability(id,this.available());const evaluation=state.evaluation;if(!evaluation)throw new Error('Workshop evaluation missing');const result=await this.orchestrator.effect(id,op('score'),()=>this.host.score(session,state.artifact!,evaluation),()=>this.reconcile(session,op('score')));this.orchestrator.score(id,result.score,result.feedback);session=this.orchestrator.get(id);const next=this.orchestrator.next(id);if(next==='iterate'){this.orchestrator.beginIteration(id);continue;}if(next==='checkpoint'){this.track(id);return;}this.orchestrator.finalize(id);continue;}
      if(session.stage==='scoring'){const next=this.orchestrator.next(id);if(next==='iterate'){this.orchestrator.beginIteration(id);continue;}if(next==='checkpoint'){this.track(id);return;}this.orchestrator.finalize(id);continue;}
      if(session.stage==='finalizing'){
        const finalization=await this.orchestrator.effect(id,`${id}:finalization`,()=>this.host.finalization(session),()=>this.reconcile(session,`${id}:finalization`));
        if(finalization.admission&&session.assignment.checkpoints.libraryAdmission&&this.orchestrator.requestCheckpoint(id,'libraryAdmission','finalizing')){this.track(id);return;}
        if(finalization.admission){const entry=this.library.admit(finalization.admission);this.publish(entry);}this.orchestrator.advance(id,'library');continue;
      }
      if(session.stage==='library'){const finalization=await this.orchestrator.effect(id,`${id}:finalization`,()=>this.host.finalization(session),()=>this.reconcile(session,`${id}:finalization`));if(finalization.learningRequired)this.orchestrator.advance(id,'learning');else this.orchestrator.advance(id,'reported');continue;}
      if(session.stage==='learning'){this.orchestrator.recheckAvailability(id,this.available());const preparation=await this.orchestrator.effect(id,`${id}:learning-prepare`,()=>this.host.prepareLearning(session),()=>this.reconcile(session,`${id}:learning-prepare`));if(preparation.activationRequired&&session.assignment.checkpoints.learningActivation&&this.orchestrator.requestCheckpoint(id,'learningActivation','learning')){this.track(id);return;}if(preparation.activationRequired)await this.orchestrator.effect(id,`${id}:learning-activate`,async()=>{await this.host.activateLearning(session);return{completed:true};},()=>this.reconcile(session,`${id}:learning-activate`));this.orchestrator.advance(id,'reported');continue;}
      if(session.stage==='reported'){this.orchestrator.advance(id,'complete');continue;}
      throw new Error(`Unsupported workshop recovery stage: ${session.stage}`);
    }
  }
  private reconcile<T>(session:WorkshopSessionState,operationId:string):Promise<{resolved:true;value:T}|{resolved:false}>{return this.host.reconcile?.<T>(session,operationId)??Promise.resolve({resolved:false});}
  private cancellation(value:unknown,id:string):WorkshopCancellation{return normalizeEffectReceipt(value,`workshop:${id}`,'workshop_cancellation');}
}
