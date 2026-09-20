import { effectReceipt, validateWorkshopAssignment } from '@autofactorio/contracts';
import type { WorkshopAssignment, WorkshopEvaluationReport, WorkshopScore } from '@autofactorio/contracts';
import type { WorkshopRuntimeHost } from '../../packages/core/workshop/runtime.js';

const rational=(value:string)=>({numerator:value,denominator:'1'});
/** Deterministic test-only host. It proves runtime ownership without claiming provider or game evidence. */
export const workshopHostFixture:WorkshopRuntimeHost={
  async resolve(value){
    const draft=structuredClone(value) as Record<string,unknown>;if(Array.isArray(draft.ports))return validateWorkshopAssignment(draft);const windowTicks=Number(draft.windowTicks),windows=Number(draft.windows);delete draft.windowTicks;delete draft.windows;
    return validateWorkshopAssignment({...draft,profileRevision:1,gameFingerprint:'fixture-installed-data-v1',footprint:{width:32,height:16,clearance:2,maxTiles:262144},ports:[{id:'iron',direction:'input',product:{kind:'item',name:'iron-plate',quality:'normal',surface:'nauvis'},position:{x:0,y:0},facing:0,transport:'belt',lane:1,rate:rational('1'),unit:'units-per-game-second',required:true},{id:'circuits',direction:'output',product:{kind:'item',name:'electronic-circuit',quality:'normal',surface:'nauvis'},position:{x:10,y:0},facing:8,transport:'belt',lane:1,rate:rational('1'),unit:'units-per-game-second',required:true}],throughput:[{portId:'circuits',windowTicks,windows,quantum:rational('1'),productionError:rational('0'),deliveryError:rational('0'),maxStockDrawdown:rational('2'),maxResidual:rational('1'),interval:'(startTick,endTick]'}]});
  },
  async design(session,iteration){return{sessionId:session.id,iteration,artifactHash:`fixture-artifact-${iteration}`,assignmentRevision:session.assignment.revision,bundleHash:session.pinnedBundleHash,evidence:[`fixture-design-${iteration}`]};},
  async build(){},
  async measure(session,candidate):Promise<WorkshopEvaluationReport>{return{schema:1,attemptId:`${session.id}:${candidate.iteration}`,valid:true,passed:true,reasons:[],ports:[],evidence:[`fixture-measure-${candidate.iteration}`]};},
  async score(_session,candidate):Promise<{score:WorkshopScore;feedback:string}>{return{score:{schema:1,candidate,rubricVersion:'rubric-1',eligible:true,dimensions:{throughput:{value:candidate.iteration,unit:'fixture-score',evidence:[],judgment:'measured'}},feedback:'fixture score',interactionFeedback:'fixture',invalidReasons:[]},feedback:'fixture score'};},
  async finalization(){return{admission:null,learningRequired:true};},
  async prepareLearning(){return{activationRequired:true};},
  async activateLearning(){},
  cancel(sessionId){return effectReceipt(`workshop:${sessionId}`,'cancelled');},
};

export type ResolvedWorkshopFixture=WorkshopAssignment;
