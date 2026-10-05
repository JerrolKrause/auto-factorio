import { normalizeEffectReceipt, resolveWorkshopModels, validateWorkshopAssignment } from '@autofactorio/contracts';
import type { EffectReceipt, ModelSelection, WorkshopAssignment, WorkshopCandidateRef, WorkshopEvaluationReport, WorkshopScore, WorkshopCritique } from '@autofactorio/contracts';
import type { LibraryAdmission, LibraryEntry } from './library.js';
import { BlueprintLibrary } from './library.js';
import type { LearningService } from './learning.js';
import type { WorkshopSessionState } from './orchestrator.js';
import type { WorkshopSnapshot } from './orchestrator.js';
import { WorkshopOrchestrator } from './orchestrator.js';
import type { WorkshopUsageLedger } from './usage.js';
import type { WorkspaceGroupIdentity, WorkspaceRunIdentity } from '@autofactorio/contracts';
import type { WorkspaceRequest } from '../../storage/src/workspace-catalog.js';

export interface WorkshopRuntimeServices { library:BlueprintLibrary; learning:LearningService; usage:WorkshopUsageLedger; sessions:()=>WorkshopSessionState[] }
export type WorkshopCancellation = EffectReceipt;

export class WorkshopEffectOutcomeError extends Error {
  constructor(readonly outcome:'failed'|'unknown',cause:unknown){super(String(cause),cause instanceof Error?{cause}:undefined);this.name='WorkshopEffectOutcomeError';}
}
class WorkshopStopRequested extends Error { constructor(){super('Workshop stop intent closed admission');} }

export interface WorkshopRuntimeHost {
  bindServices?(services:WorkshopRuntimeServices):void;
  resolve(input:unknown):Promise<WorkshopAssignment>;
  preflight?(assignment:WorkshopAssignment):Promise<void>;
  design(session:WorkshopSessionState,iteration:number):Promise<WorkshopCandidateRef>;
  build(session:WorkshopSessionState,candidate:WorkshopCandidateRef):Promise<void>;
  measure(session:WorkshopSessionState,candidate:WorkshopCandidateRef):Promise<WorkshopEvaluationReport>;
  snapshot?(session:WorkshopSessionState,candidate:WorkshopCandidateRef):Promise<WorkshopSnapshot>;
  observe?(session:WorkshopSessionState):Promise<boolean>;
  score(session:WorkshopSessionState,candidate:WorkshopCandidateRef,evaluation:WorkshopEvaluationReport):Promise<{score:WorkshopScore;feedback:string;critique?:WorkshopCritique}>;
  finalization(session:WorkshopSessionState):Promise<{admission:LibraryAdmission|null;learningRequired:boolean}>;
  prepareLearning(session:WorkshopSessionState):Promise<{activationRequired:boolean}>;
  activateLearning(session:WorkshopSessionState):Promise<void>;
  reconcile?<T>(session:WorkshopSessionState,operationId:string):Promise<{resolved:true;value:T}|{resolved:false}>;
  reconcileCancellation?(session:WorkshopSessionState,operationId:string):Promise<EffectReceipt>;
  cancel(sessionId:string):WorkshopCancellation|Promise<WorkshopCancellation>;
  close?():void|Promise<void>;
}

/** Runtime-owned loop. Browser requests only resolve and enqueue durable work. */
export class WorkshopRuntime {
  private active=new Map<string,Promise<void>>();
  private timers=new Map<string,ReturnType<typeof setTimeout>>();
  private launches=new Map<string,Promise<void>>();
  private stops=new Map<string,Promise<WorkshopSessionState|WorkspaceRequest>>();
  private liveEffects=new Set<string>();
  private closing=false;
  constructor(private orchestrator:WorkshopOrchestrator,private host:WorkshopRuntimeHost,private library:BlueprintLibrary,private available:()=>ModelSelection[],private bundleHash:(sessionId:string)=>string,private listSessions:()=>WorkshopSessionState[],private publish:(entry:LibraryEntry)=>void,private history?:{admit:(id:string,input:unknown)=>{request:WorkspaceRequest;newlyAdmitted:boolean};owns:(id:string)=>boolean;stopIntent:(id:string,reason:string)=>WorkspaceRequest|null;stopRequested:(id:string)=>boolean;stopRetired?:(id:string,reason:string)=>WorkspaceRequest|null;transition:(id:string,state:WorkspaceRequest['state'],reason?:string|null)=>WorkspaceRequest;begin:(assignment:WorkshopAssignment,selectedGroupId:string|null)=>{group:WorkspaceGroupIdentity;run:WorkspaceRunIdentity};journaled:(runId:string)=>void}){}
  /** Fast durable admission for HTTP. Preparation continues without browser ownership. */
  accept(input:unknown,selectedGroupId:string|null=null):WorkspaceRequest {
    if(!this.history)throw new Error('Workspace coordinator unavailable');
    const id=this.inputId(input),admitted=this.history.admit(id,{assignment:input,selectedGroupId});
    if(admitted.newlyAdmitted){
      const work=Promise.resolve().then(()=>this.launchAdmitted(input,selectedGroupId)).then(()=>{},error=>{
        if(!(error instanceof WorkshopStopRequested)&&!this.history?.stopRequested(id))this.history?.transition(id,error instanceof WorkshopEffectOutcomeError&&error.outcome==='unknown'?'held':'failed',String(error));
      }).finally(()=>this.launches.delete(id));
      this.launches.set(id,work);
    }
    return admitted.request;
  }
  async launch(input:unknown,selectedGroupId:string|null=null):Promise<WorkshopSessionState>{
    if(this.history){
      const id=this.inputId(input),admitted=this.history.admit(id,{assignment:input,selectedGroupId});
      if(!admitted.newlyAdmitted){
        try{return this.orchestrator.get(id);}catch{throw new Error('Workspace preparation pending; inspect the admitted request before retry');}
      }
    }
    try{return await this.launchAdmitted(input,selectedGroupId);}catch(error){if(!(error instanceof WorkshopStopRequested)&&!this.history?.stopRequested(this.inputId(input)))this.history?.transition(this.inputId(input),error instanceof WorkshopEffectOutcomeError&&error.outcome==='unknown'?'held':'failed',String(error));throw error;}
  }
  private inputId(input:unknown):string {if(!input||typeof input!=='object'||Array.isArray(input)||typeof (input as Record<string,unknown>).id!=='string')throw new Error('Workshop request ID required');return (input as {id:string}).id;}
  private guard(id:string):void {if(this.history?.stopRequested(id))throw new WorkshopStopRequested();try{if(this.orchestrator.get(id).stopRequested)throw new WorkshopStopRequested();}catch(error){if(error instanceof WorkshopStopRequested)throw error;}}
  private async launchAdmitted(input:unknown,selectedGroupId:string|null):Promise<WorkshopSessionState>{
    const id=this.inputId(input);this.guard(id);
    const resolved=await this.host.resolve(input);this.guard(id);
    const assignment=validateWorkshopAssignment(resolved),available=this.available();
    await this.host.preflight?.(assignment);
    this.guard(id);
    if(!available.length)throw new Error('Managed model catalog unavailable; workshop inference withheld');
    for(const[role,selection]of Object.entries(resolveWorkshopModels(assignment.models)))if(!available.some(value=>JSON.stringify(value)===JSON.stringify(selection)))throw new Error(`${role} managed selection unavailable; no fallback`);
    this.guard(id);const history=this.history?.begin(assignment,selectedGroupId);
    const session=this.orchestrator.configure(assignment.id,assignment,this.bundleHash(assignment.id),history);if(history)this.history!.journaled(session.id);this.orchestrator.preflight(session.id,available);if(assignment.checkpoints.brief)this.orchestrator.requestCheckpoint(session.id,'brief','preflight');else this.orchestrator.beginIteration(session.id);this.history?.transition(session.id,'active');this.track(session.id);return this.orchestrator.get(session.id);
  }
  resume(id:string):WorkshopSessionState{const session=this.orchestrator.get(id);if(['complete','stopped'].includes(session.stage))return session;this.guard(id);if(session.stage==='checkpoint')throw new Error('Checkpoint unresolved');this.track(id);return session;}
  recover():void{for(const session of this.sessions())if(!['complete','held','stopped'].includes(session.stage)&&!session.stopRequested&&!this.history?.stopRequested(session.id)&&(!this.history||this.history.owns(session.id)))this.track(session.id);}
  pending(id:string):Promise<void>|undefined{return this.active.get(id);}
  async stop(id:string,reason:string):Promise<WorkshopSessionState|WorkspaceRequest>{
    const retired=this.history?.stopRetired?.(id,reason);if(retired)return retired;
    const request=this.history?.stopIntent(id,reason);
    let session:WorkshopSessionState|undefined;try{session=this.orchestrator.get(id);}catch{session=undefined;}
    if(session&&['complete','stopped'].includes(session.stage))return session;
    if(request&&['completed','cancelled','failed'].includes(request.state))return request;
    if(session)this.orchestrator.requestStop(id,reason);
    const prior=this.stops.get(id);if(prior)return prior;
    if(!session&&!request)return{id,kind:'workshop',requestHash:'',state:'cancelled',reason,createdAt:new Date().toISOString()};
    const pending=this.finishStop(id,reason,Boolean(session)).finally(()=>this.stops.delete(id));this.stops.set(id,pending);return pending;
  }
  private async finishStop(id:string,reason:string,hasSession:boolean):Promise<WorkshopSessionState|WorkspaceRequest>{
    if(hasSession){const current=this.orchestrator.get(id);
      const uncertain=Object.entries(current.operationIntents).filter(([operationId,intent])=>intent.status==='unknown'||intent.status==='dispatched'&&!this.liveEffects.has(operationId));
      if(uncertain.length){
        // A replacement's empty cancellation aggregate cannot prove an older
        // dispatched effect settled. Require a receipt for each durable identity.
        for(const [operationId] of uncertain){
          let receipt:EffectReceipt;
          try{receipt=normalizeEffectReceipt(await this.host.reconcileCancellation?.(current,operationId),operationId,'held_effect_reconciliation');}
          catch(error){receipt={schema:1,effectId:operationId,outcome:'unknown',failures:[String(error)]};}
          if(receipt.outcome==='unknown'){
            this.history?.transition(id,'held','held_effect_requires_exact_receipt');
            return this.orchestrator.holdInFlight(id,'held_effect_requires_exact_receipt');
          }
          this.orchestrator.settleCancelledEffects(id,[operationId],receipt);
        }
      }
    }
    let cancellation:WorkshopCancellation;try{cancellation=this.cancellation(await this.host.cancel(id),id);}catch(error){cancellation={schema:1,effectId:`workshop:${id}`,outcome:'unknown',failures:[String(error)]};}
    if(cancellation.outcome==='unknown'){
      const detail=`stop_cancellation_unconfirmed:${cancellation.failures.join('|')}`;
      const session=hasSession?this.orchestrator.holdInFlight(id,detail):null;
      const state=this.history?.transition(id,'held',detail);
      return session??state!;
    }
    const active=this.active.get(id);
    if(active){let timeout:ReturnType<typeof setTimeout>|undefined;
      try{const settled=await Promise.race([active.then(()=>true),new Promise<boolean>(resolve=>{timeout=setTimeout(()=>resolve(false),10_000);})]);
        if(!settled){const detail='stop_active_effect_not_settled';const session=hasSession?this.orchestrator.holdInFlight(id,detail):null;const state=this.history?.transition(id,'held',detail);return session??state!;}}
      finally{if(timeout)clearTimeout(timeout);}}
    if(hasSession){const intents=Object.entries(this.orchestrator.get(id).operationIntents).filter(([,intent])=>intent.status==='dispatched'||intent.status==='unknown').map(([operationId])=>operationId);
      if(intents.some(operationId=>!/:\d+:(design|score|build|measure)$/.test(operationId))){const detail='stop_effect_requires_exact_receipt';const session=this.orchestrator.holdInFlight(id,detail),state=this.history?.transition(id,'held',detail);return session??state!;}
      this.orchestrator.settleCancelledEffects(id,intents);
    }
    // A lost start acknowledgment still follows a fully reported run. An exact
    // observation Stop closes that phase successfully without cancelling its score.
    const stoppedSession=hasSession?this.orchestrator.get(id):null;
    const observing=Boolean(stoppedSession?.operationIntents[`${id}:observe`]&&stoppedSession.finalOutcome&&stoppedSession.iterations.at(-1)?.evaluation);
    const session=hasSession?(observing?this.orchestrator.finishObservation(id,reason):this.orchestrator.stop(id,reason)):null;
    const state=this.history?.transition(id,observing?'completed':'cancelled',reason);
    return session??state!;
  }
  async close():Promise<void>{this.closing=true;for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();await Promise.allSettled(this.launches.values());const active=[...this.active.keys()],cancellations=active.map(async id=>{try{return{id,result:this.cancellation(await this.host.cancel(id),id)};}catch(error){return{id,result:{schema:1 as const,effectId:`workshop:${id}`,outcome:'unknown' as const,failures:[String(error)]}};}});const results=await Promise.all(cancellations);for(const {id,result}of results){const session=this.orchestrator.get(id);if(!['complete','held','stopped'].includes(session.stage))this.orchestrator.holdInFlight(id,result.outcome!=='unknown'?'runtime_closed_with_inflight_effect':`close_cancellation_unconfirmed:${result.failures.join('|')}`);}await Promise.allSettled(this.active.values());await this.host.close?.();}
  private sessions():WorkshopSessionState[]{return this.listSessions();}
  private effect<T>(id:string,operationId:string,run:()=>Promise<T>,reconcile?:()=>Promise<{resolved:true;value:T}|{resolved:false}>):Promise<T>{
    return this.orchestrator.effect(id,operationId,async()=>{
      // Queue membership after replacement does not mean this controller
      // dispatched the durable intent. Only the actual host call owns it.
      this.liveEffects.add(operationId);
      try{return await run();}finally{this.liveEffects.delete(operationId);}
    },reconcile);
  }
  private track(id:string):void{if(this.closing)return;const session=this.orchestrator.get(id);const prior=this.timers.get(id);if(prior){clearTimeout(prior);this.timers.delete(id);}if(session.stage==='checkpoint'&&session.checkpoint){const delay=Math.max(0,Date.parse(session.checkpoint.deadline)-Date.now());const timer=setTimeout(()=>{this.timers.delete(id);if(this.history?.stopRequested(id)||this.orchestrator.get(id).stopRequested)return;if(this.orchestrator.timeout(id,new Date().toISOString())!=='waiting')this.enqueue(id);},Math.min(delay,2_147_483_647));timer.unref?.();this.timers.set(id,timer);return;}this.enqueue(id);}
  private enqueue(id:string):void{if(this.closing||this.active.has(id))return;const task=Promise.resolve().then(()=>this.run(id)).catch(error=>{const current=this.orchestrator.get(id);if(error instanceof WorkshopStopRequested||current.stopRequested)return;if(!['complete','held','stopped'].includes(current.stage)){const reason=String(error),unknown=error instanceof WorkshopEffectOutcomeError&&error.outcome==='unknown'||reason.includes('Workshop effect outcome unknown');if(unknown)this.orchestrator.holdInFlight(id,`workshop_runtime_held:${reason}`);else this.orchestrator.fail(id,`workshop_runtime_failed:${reason}`);}}).finally(()=>{this.active.delete(id);const session=this.orchestrator.get(id);if(session.stage==='complete')this.history?.transition(id,'completed');else if(session.stage==='held')this.history?.transition(id,'held',session.stopReason);else if(session.stage==='stopped')this.history?.transition(id,session.stopReason?.includes('failed')?'failed':'cancelled',session.stopReason);});this.active.set(id,task);}
  private async run(id:string):Promise<void>{
    for(;;){
      let session=this.orchestrator.get(id);if(['complete','held','stopped'].includes(session.stage))return;this.guard(id);if(session.stage==='checkpoint'){this.track(id);return;}
      if(session.stage==='configured'){this.orchestrator.preflight(id,this.available());continue;}
      if(session.stage==='preflight'){this.orchestrator.beginIteration(id);continue;}
      const iteration=session.activeIteration;if(iteration===null)throw new Error('Workshop iteration identity missing');
      const op=(name:string)=>`${id}:${iteration}:${name}`;
      if(session.stage==='designing'){
        this.orchestrator.recheckAvailability(id,this.available());
        let candidate:WorkshopCandidateRef;
        try{candidate=await this.effect(id,op('design'),()=>this.host.design(session,iteration),()=>this.reconcile(session,op('design')));}catch(error){if(!(error instanceof WorkshopEffectOutcomeError)||error.outcome!=='failed')throw error;this.orchestrator.rejectIteration(id,op('design'),String(error));continue;}
        this.guard(id);
        this.orchestrator.advance(id,'building');this.orchestrator.artifact(id,candidate);continue;
      }
      const state=session.iterations[iteration-1]!;
      if(session.stage==='scoring'&&state.evaluation&&!state.snapshot&&this.host.snapshot){const snapshot=await this.host.snapshot(session,state.artifact!);this.guard(id);this.orchestrator.snapshot(id,snapshot);continue;}
      if(session.stage==='scoring'&&state.valid===false&&!state.evaluation){const next=this.orchestrator.next(id);if(next==='iterate'){this.orchestrator.beginIteration(id);continue;}if(next==='checkpoint'){this.track(id);return;}this.orchestrator.finalize(id);continue;}
      if(!state.artifact&&['building','frozen','measuring','scoring'].includes(session.stage))throw new Error('Workshop artifact missing');
      if(session.stage==='building'){try{await this.effect(id,op('build'),async()=>{await this.host.build(session,state.artifact!);return{completed:true};},()=>this.reconcile(session,op('build')));}catch(error){if(!(error instanceof WorkshopEffectOutcomeError)||error.outcome!=='failed')throw error;this.orchestrator.rejectIteration(id,op('build'),String(error));continue;}this.guard(id);this.orchestrator.advance(id,'frozen');continue;}
      if(session.stage==='frozen'){this.orchestrator.advance(id,'measuring');continue;}
      if(session.stage==='measuring'){const evaluation=await this.effect(id,op('measure'),()=>this.host.measure(session,state.artifact!),()=>this.reconcile(session,op('measure')));this.guard(id);this.orchestrator.evaluation(id,evaluation);this.orchestrator.advance(id,'scoring');continue;}
      if(session.stage==='scoring'&&!state.score){this.orchestrator.recheckAvailability(id,this.available());const evaluation=state.evaluation;if(!evaluation)throw new Error('Workshop evaluation missing');const result=await this.effect(id,op('score'),()=>this.host.score(session,state.artifact!,evaluation),()=>this.reconcile(session,op('score')));this.guard(id);this.orchestrator.score(id,result.score,result.feedback,result.critique??null);session=this.orchestrator.get(id);const next=this.orchestrator.next(id);if(next==='iterate'){this.orchestrator.beginIteration(id);continue;}if(next==='checkpoint'){this.track(id);return;}this.orchestrator.finalize(id);continue;}
      if(session.stage==='scoring'){const next=this.orchestrator.next(id);if(next==='iterate'){this.orchestrator.beginIteration(id);continue;}if(next==='checkpoint'){this.track(id);return;}this.orchestrator.finalize(id);continue;}
      if(session.stage==='finalizing'){
        const finalization=await this.effect(id,`${id}:finalization`,()=>this.host.finalization(session),()=>this.reconcile(session,`${id}:finalization`));this.guard(id);
        if(finalization.admission&&session.assignment.checkpoints.libraryAdmission&&this.orchestrator.requestCheckpoint(id,'libraryAdmission','finalizing')){this.track(id);return;}
        if(finalization.admission){
          const admission=finalization.admission;
          const entry=await this.effect(id,`${id}:library-admit`,
            async()=>this.library.admit(admission),
            async()=>{const receipt=this.library.admissionReceipt(admission.operationId);return receipt?{resolved:true as const,value:receipt}:{resolved:false as const};});
          this.guard(id);
          this.publish(entry);
        }
        this.orchestrator.advance(id,'library');continue;
      }
      if(session.stage==='library'){const finalization=await this.effect(id,`${id}:finalization`,()=>this.host.finalization(session),()=>this.reconcile(session,`${id}:finalization`));this.guard(id);if(finalization.learningRequired)this.orchestrator.advance(id,'learning');else this.orchestrator.advance(id,'reported');continue;}
      if(session.stage==='learning'){this.orchestrator.recheckAvailability(id,this.available());const preparation=await this.effect(id,`${id}:learning-prepare`,()=>this.host.prepareLearning(session),()=>this.reconcile(session,`${id}:learning-prepare`));this.guard(id);if(preparation.activationRequired&&session.assignment.checkpoints.learningActivation&&this.orchestrator.requestCheckpoint(id,'learningActivation','learning')){this.track(id);return;}if(preparation.activationRequired){await this.effect(id,`${id}:learning-activate`,async()=>{await this.host.activateLearning(session);return{completed:true};},()=>this.reconcile(session,`${id}:learning-activate`));this.guard(id);}this.orchestrator.advance(id,'reported');continue;}
      if(session.stage==='reported'){const observing=this.host.observe?await this.effect(id,`${id}:observe`,()=>this.host.observe!(session),()=>this.reconcile(session,`${id}:observe`)):false;this.guard(id);this.orchestrator.advance(id,observing?'observing':'complete');if(observing)return;continue;}
      if(session.stage==='observing'){const running=await this.host.observe?.(session);this.guard(id);if(running===false)this.orchestrator.finishObservation(id,'evaluation_stopped');return;}
      throw new Error(`Unsupported workshop recovery stage: ${session.stage}`);
    }
  }
  private reconcile<T>(session:WorkshopSessionState,operationId:string):Promise<{resolved:true;value:T}|{resolved:false}>{return this.host.reconcile?.<T>(session,operationId)??Promise.resolve({resolved:false});}
  private cancellation(value:unknown,id:string):WorkshopCancellation{return normalizeEffectReceipt(value,`workshop:${id}`,'workshop_cancellation');}
}
