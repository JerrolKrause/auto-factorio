import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { effectReceipt } from '@autofactorio/contracts';
import type { WorkshopEvaluationReport } from '@autofactorio/contracts';
import { LiveWorkshopGame, LiveWorkshopHost } from '../apps/runtime/workshop-live-host.js';
import type { WorkshopActivity, WorkshopGame, WorkshopInference } from '../apps/runtime/workshop-live-host.js';
import { composeWorkshop } from '../apps/runtime/workshop-composition.js';
import { WorkshopEffectOutcomeError } from '../packages/core/workshop/runtime.js';
import type { EventContext } from '../packages/core/execution/durable.js';
import { SqliteJournal } from '../packages/storage/src/journal.js';
import { WorkspaceCatalog } from '../packages/storage/src/workspace-catalog.js';

const selected={provider:'openai' as const,modelId:'gpt-6-astra',reasoningEffort:'low'};
const request=(id:string,overrides:Record<string,unknown>={})=>({schema:1,id,revision:1,comparisonSeries:`series-${id}`,objective:'Produce 60 electronic circuits per minute',source:{kind:'brief',id:null},profileId:'starter-assembly',construction:'direct',libraryAccess:false,improveRevision:null,requestedSpeed:{numerator:'10',denominator:'1'},settlingTicks:0,windowTicks:60,windows:1,rubric:{version:'rubric-1',weights:{throughput:{numerator:'1',denominator:'1'}},materiality:{throughput:{numerator:'0',denominator:'1'}},directions:{throughput:'maximize'}},iterations:{attempts:1,mode:'exact',earlyStop:false,plateauRounds:1},checkpoints:{brief:false,afterScore:false,libraryAdmission:false,learningActivation:false,timeoutMs:1000,timeoutAction:'finish'},budgets:{wallMs:60000,gameTicks:600,turns:3,toolCalls:8,reportedTokens:1000,learningReservedTurns:1,learningReservedTools:2},models:{sessionDefault:selected,overrides:{}},learning:{cadence:'off',batchSessions:2,candidateCap:2,attemptsPerCandidate:1,autoActivate:false},...overrides});
const installed={gameVersion:'2.0.77',mods:{base:'2.0.77'},profileId:'starter-assembly',profileRevision:1,surface:'nauvis',technologies:['automation'],allowedEquipment:['assembling-machine-1'],modules:[],beacons:[],recipe:{id:'electronic-circuit',category:'crafting',energy:0.5,ingredients:[{type:'item' as const,name:'iron-plate',amount:1}],products:[{type:'item' as const,name:'electronic-circuit',amount:1}]},machine:'assembling-machine-1'};
function harness(root:string,inference:WorkshopInference,gameOverrides:Partial<WorkshopGame>={}){
  const runtimeRoot=path.join(root,'runtime');mkdirSync(runtimeRoot,{recursive:true});const journal=new SqliteJournal(path.join(runtimeRoot,'run.sqlite')),catalog=new WorkspaceCatalog(root),activities:WorkshopActivity[]=[];let clock=0;
  const context=():EventContext=>({run:'run',epoch:'epoch',wallTime:new Date(1_800_000_000_000+clock++).toISOString(),gameTick:null,actor:'operator',task:null,causation:null,correlation:null,visibility:{kind:'operator'}});
  const game:WorkshopGame={async resolveProfile(){return structuredClone(installed);},async build(session){return{id:`${session.id}-${session.activeIteration}`,generation:1,surface:'af-test',characterEvidence:null};},async measure(session):Promise<WorkshopEvaluationReport>{return{schema:1,attemptId:`${session.id}:${session.activeIteration}`,valid:true,passed:true,reasons:[],ports:[],evidence:['fixture']};},cancel(sessionId){return effectReceipt(`game:${sessionId}`,'cancelled');},...gameOverrides};
  const host=new LiveWorkshopHost(runtimeRoot,inference,game,value=>activities.push(value)),store={directory:runtimeRoot,run:'run',journal,context,record(type:string,changes:Parameters<SqliteJournal['append']>[2]){journal.append(context(),type,changes);}},composition=composeWorkshop(store as never,{workshopHost:host,managedModels:[{id:selected.modelId,displayName:'Astra',efforts:[selected.reasoningEffort]}],workspaceCatalog:catalog});
  return{root,journal,catalog,host,activities,...composition,close:async()=>{await composition.controller?.close();composition.library.close();catalog.close();journal.close();}};
}
describe('held workshop cancellation recovery',()=>{
  it.each([
    ['missing',()=>undefined],['malformed',(id:string)=>({schema:1,effectId:id,outcome:'cancelled'})],['mismatched',(id:string)=>effectReceipt(`${id}-other`,'cancelled')],['unknown',(id:string)=>({schema:1,effectId:id,outcome:'unknown',failures:['still-unknown']})],
  ])('keeps an unknown held operation for a %s reconciliation receipt',async(_name,receipt)=>{
    const root=mkdtempSync(path.join(os.tmpdir(),'af-recovery-catalog-'));let reject!:(error:Error)=>void,started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
    const inference:WorkshopInference={async invoke(){return new Promise((_resolve,fail)=>{reject=fail;started();});},async cancel(){reject(new Error('provider call ended without outcome'));return effectReceipt('inference:held','cancelled');},async close(){}};
    const f=harness(root,inference);let originalClosed=false;try{
      await f.controller!.launch(request('held'));await ready;
      f.orchestrator.holdInFlight('held','simulated-restart-with-dispatched-design');reject(new Error('provider call outcome is unknown'));
      await f.controller!.pending('held');
      await f.close();originalClosed=true;
      const replacement=harness(root,{invoke:async()=>{throw new Error('recovery must not infer');},cancel:id=>effectReceipt(`inference:${id}`,'cancelled'),async close(){}},{reconcileCancellation:async(_session,_built,operationId)=>receipt(operationId) as never});
      replacement.host.reconcileCancellation=async(_session,operationId)=>receipt(operationId) as never;
      try{const held=await replacement.controller!.stop('held','retry-stop');expect(held).toMatchObject({stage:'held'});expect(replacement.orchestrator.get('held').operationIntents['held:1:design']).toMatchObject({status:'unknown'});expect(replacement.catalog.owner()).toMatchObject({id:'held',state:'held'});
        expect(await replacement.controller!.stop('held','retry-again')).toMatchObject({stage:'held'});
      }finally{await replacement.close();}
    }finally{if(!originalClosed)await f.close().catch(()=>{});rmSync(root,{recursive:true,force:true});}
  });

  it('does not reconcile unknown design/build operations without an exact supported receipt',async()=>{
    const root=mkdtempSync(path.join(os.tmpdir(),'af-recovery-unsupported-'));let gameReconciliations=0;const inference:WorkshopInference={invoke:async()=>{throw new WorkshopEffectOutcomeError('unknown','fixture unknown effect');},cancel:id=>effectReceipt(`inference:${id}`,'cancelled'),async close(){}};const f=harness(root,inference,{reconcileCancellation:async(_session,_built,operationId)=>{gameReconciliations++;return effectReceipt(operationId,'cancelled');}});
    try{await f.controller!.launch(request('unsupported'));await f.controller!.pending('unsupported');const session=f.orchestrator.get('unsupported');
      // A durable unknown design identity is retained across the runtime replacement.
      expect(session.operationIntents['unsupported:1:design']).toMatchObject({status:'unknown'});
      expect(await f.host.reconcileCancellation({...session,iterations:[{artifact:{sessionId:'unsupported',iteration:1,artifactHash:'fixture',assignmentRevision:1,bundleHash:'baseline',evidence:[]}}]} as never,'unsupported:1:build')).toMatchObject({outcome:'unknown'});expect(gameReconciliations).toBe(0);
      const held=await f.controller!.stop('unsupported','retry');expect(held).toMatchObject({stage:'held'});
    }finally{await f.close();rmSync(root,{recursive:true,force:true});}
  });

  it.each([
    ['missing',undefined],['mismatched',effectReceipt('held-measure:1:measure-other','cancelled')],['exact',effectReceipt('held-measure:1:measure','cancelled')],
  ])('stops a replacement before recovery replay when the dispatched measurement receipt is %s',async(_label,receipt)=>{
    const root=mkdtempSync(path.join(os.tmpdir(),'af-pre-recovery-stop-')),inference:WorkshopInference={invoke:async()=>{throw new Error('recovery must not infer');},cancel:id=>effectReceipt(`inference:${id}`,'cancelled'),async close(){}};
    const original=harness(root,inference);
    try{
      const input=request('held-measure'),assignment=input as never;original.catalog.admit('held-measure','workshop',input,path.join(root,'runtime'));const history=original.catalog.beginWorkshop(path.join(root,'runtime'),'run',assignment,null);
      original.catalog.journaled('held-measure');original.catalog.transitionRequest('held-measure','active');original.orchestrator.configure('held-measure',assignment,'baseline',history);original.orchestrator.preflight('held-measure',[selected]);original.orchestrator.beginIteration('held-measure');original.orchestrator.advance('held-measure','building');
      const candidate={sessionId:'held-measure',iteration:1,artifactHash:'measurement-artifact',assignmentRevision:1,bundleHash:'baseline',evidence:['fixture']};original.orchestrator.artifact('held-measure',candidate);original.orchestrator.advance('held-measure','frozen');original.orchestrator.advance('held-measure','measuring');
      const usageBefore=original.usage.record({id:'usage-before-stop',sessionId:'held-measure',invocationId:'held-measure:1:designer',role:'workshop-designer',iteration:1,batchId:null,cumulativeTokens:23,monetaryAmount:null,allowanceRemaining:null,owner:'workshop',at:'2026-10-01T00:00:00.000Z'});
      const effect=original.orchestrator.effect('held-measure','held-measure:1:measure',()=>new Promise<void>(()=>{}));void effect;
      const artifactDirectory=path.join(root,'runtime','workshop-live','held-measure');mkdirSync(artifactDirectory,{recursive:true});writeFileSync(path.join(artifactDirectory,'measurement-artifact.built.json'),JSON.stringify({id:'held-measure-1',generation:1,surface:'af-test',characterEvidence:null}));
      expect(original.orchestrator.get('held-measure').operationIntents['held-measure:1:measure']).toMatchObject({status:'dispatched',stage:'measuring'});
      await original.close();
      let reconciliationCalls=0;const replacement=harness(root,inference,{reconcileCancellation:async(_session,_built,operationId)=>{reconciliationCalls++;return receipt??{schema:1,effectId:operationId,outcome:'unknown',failures:['missing_exact_receipt']};}});
      try{
        // composeWorkshop queued recovery, but Stop closes admission synchronously before that task runs.
        const stopped=await replacement.controller!.stop('held-measure','operator-stop');
        if(receipt?.effectId==='held-measure:1:measure'&&receipt.outcome==='cancelled'){
          expect(stopped).toMatchObject({stage:'stopped'});expect(replacement.orchestrator.get('held-measure').operationIntents['held-measure:1:measure']).toMatchObject({status:'failed',cancellationReceipt:receipt});expect(replacement.catalog.request('held-measure')).toMatchObject({id:'held-measure',state:'cancelled'});expect(replacement.catalog.owner()).toBeNull();
          expect(replacement.orchestrator.get('held-measure').iterations).toMatchObject([{artifact:candidate}]);expect(replacement.usage.state('held-measure')).toEqual(usageBefore);expect(await replacement.controller!.stop('held-measure','repeat-stop')).toMatchObject({stage:'stopped'});expect(reconciliationCalls).toBe(1);
        }else{
          expect(stopped).toMatchObject({stage:'held'});expect(replacement.orchestrator.get('held-measure').operationIntents['held-measure:1:measure']).toMatchObject({status:'unknown'});expect(replacement.catalog.owner()).toMatchObject({id:'held-measure',state:'held'});
        }
        expect(replacement.activities.filter(value=>value.category==='provider')).toHaveLength(0);
      }finally{await replacement.close();}
    }finally{await original.close().catch(()=>{});rmSync(root,{recursive:true,force:true});}
  });
});

const attempt=(id:string,iteration=1)=>`attempt-${createHash('sha256').update(JSON.stringify(`${id}:${iteration}`)).digest('hex').slice(0,20)}`;
function directGame(control:Record<string,unknown>,root:string|null=null,reserve?:()=>Promise<()=>void>){
  const game=new LiveWorkshopGame({command:async()=>{throw new Error('unexpected command');},close(){}},{request:async()=>({})} as never,{} as never,()=>{},reserve,root);
  Object.assign(game,{control});return game;
}
const heldSession=(id:string,iteration=1)=>({id,activeIteration:iteration,iterations:[]} as never);
const built=(id:string,iteration=1)=>({id:`${id}-${iteration}`,generation:7,surface:'af-test',characterEvidence:null});
const finalStatus=(id:string,iteration=1,state='aborted')=>({attemptId:attempt(id,iteration),present:true,state,finished:true});

describe('exact game measurement cancellation receipt',()=>{
  it.each([
    ['wrong attempt',{attemptId:'other',present:true,state:'aborted',finished:true}],
    ['unfinished',{attemptId:attempt('game-held'),present:true,state:'scoring',finished:false}],
    ['unknown state',{attemptId:attempt('game-held'),present:true,state:'mystery',finished:true}],
    ['missing identity',{present:true,state:'aborted',finished:true}],
  ])('retains the fence for %s status',async(_label,status)=>{
    const calls:string[]=[];let statuses=0,reads=0;const game=directGame({measureStatus:async()=>{statuses++;return status;},measureRead:async()=>{reads++;return{finished:true,state:'aborted'};}});
    const fence={id:'game-held-1',attemptId:attempt('game-held'),release:()=>calls.push('release')};Object.assign(game,{measurementFences:new Map([['game-held',fence]])});
    expect(await game.reconcileCancellation(heldSession('game-held'),built('game-held'),'game-held:1:measure')).toMatchObject({outcome:'unknown'});expect(statuses).toBe(1);expect(reads).toBe(0);expect(calls).toEqual([]);expect((game as unknown as {measurementFences:Map<string,unknown>}).measurementFences.get('game-held')).toBe(fence);
  });
  it('rejects operation and built artifact mismatches without asking the game for status',async()=>{
    let reads=0;const game=directGame({measureStatus:async()=>{reads++;return finalStatus('game-held');},measureRead:async()=>({finished:true,state:'aborted'})});
    expect(await game.reconcileCancellation(heldSession('game-held'),built('game-held'),'game-held:2:measure')).toMatchObject({outcome:'unknown'});
    expect(await game.reconcileCancellation(heldSession('game-held'),built('elsewhere'),'game-held:1:measure')).toMatchObject({outcome:'unknown'});expect(reads).toBe(0);
  });
  it.each(['finished','aborted','invalid'])('accepts an exact terminal %s receipt and releases the old reservation',async state=>{
    const root=mkdtempSync(path.join(os.tmpdir(),'af-terminal-recovery-')),calls:string[]=[],game=directGame({measureStatus:async()=>finalStatus('game-held',1,state),measureRead:async()=>({finished:true,state})},root,async()=>()=>calls.push('release'));
    const fence={schema:1,sessionId:'game-held',id:'game-held-1',attemptId:attempt('game-held')};writeFileSync(path.join(root,'workshop-measurement-fence.json'),JSON.stringify(fence));
    Object.assign(game,{measurementFences:new Map([['game-held',{id:'game-held-1',attemptId:attempt('game-held'),release:()=>calls.push('release')} ]])});
    try{expect(await game.reconcileCancellation(heldSession('game-held'),built('game-held'),'game-held:1:measure')).toMatchObject({outcome:'cancelled',effectId:'game-held:1:measure'});expect(calls).toEqual(['release']);expect(()=>readFileSync(path.join(root,'workshop-measurement-fence.json'),'utf8')).toThrow();
      expect(await game.reconcileCancellation(heldSession('game-held'),built('game-held'),'game-held:1:measure')).toMatchObject({outcome:'cancelled'});expect(calls).toEqual(['release']);
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  it('accepts exact not-admitted status as proof of absence',async()=>{
    const game=directGame({measureStatus:async()=>({attemptId:attempt('game-absent'),present:false,state:'not-admitted',finished:true})});
    expect(await game.reconcileCancellation(heldSession('game-absent'),built('game-absent'),'game-absent:1:measure')).toMatchObject({outcome:'cancelled'});
  });
  it('retains the reservation for unreadable, conflicting or unfinished terminal pages',async()=>{
    for(const read of [async()=>{throw new Error('page unavailable');},async()=>({finished:true,state:'finished'}),async()=>({finished:false,state:'aborted'})]){
      const calls:string[]=[],game=directGame({measureStatus:async()=>finalStatus('game-page'),measureRead:read},null,async()=>()=>calls.push('release'));
      Object.assign(game,{measurementFences:new Map([['game-page',{id:'game-page-1',attemptId:attempt('game-page'),release:()=>calls.push('release')} ]])});
      expect(await game.reconcileCancellation(heldSession('game-page'),built('game-page'),'game-page:1:measure')).toMatchObject({outcome:'unknown'});expect(calls).toEqual([]);
    }
  });
  it('keeps a mismatched durable fence and reservation intact',async()=>{
    const root=mkdtempSync(path.join(os.tmpdir(),'af-measurement-mismatch-')),file=path.join(root,'workshop-measurement-fence.json'),calls:string[]=[];
    try{writeFileSync(file,JSON.stringify({schema:1,sessionId:'game-file',id:'other-built',attemptId:attempt('game-file')}));const game=directGame({measureStatus:async()=>finalStatus('game-file'),measureRead:async()=>({finished:true,state:'aborted'})},root,async()=>()=>calls.push('release'));
      Object.assign(game,{measurementFences:new Map([['game-file',{id:'game-file-1',attemptId:attempt('game-file'),release:()=>calls.push('release')} ]])});
      expect(await game.reconcileCancellation(heldSession('game-file'),built('game-file'),'game-file:1:measure')).toMatchObject({outcome:'unknown'});expect(readFileSync(file,'utf8')).toContain('other-built');expect(calls).toEqual([]);
    }finally{rmSync(root,{recursive:true,force:true});}
  });
});
