import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { effectReceipt } from '@autofactorio/contracts';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import { WorkshopControl } from '../packages/factorio/src/workshop.js';
import { SqliteJournal } from '../packages/storage/src/journal.js';
import { WorkspaceCatalog } from '../packages/storage/src/workspace-catalog.js';
import { composeWorkshop } from '../apps/runtime/workshop-composition.js';
import { LiveWorkshopGame, LiveWorkshopHost } from '../apps/runtime/workshop-live-host.js';
import type { WorkshopInference, WorkshopActivity } from '../apps/runtime/workshop-live-host.js';
import { createProfile, identifyObserver, startObserver, startServer, stopProfile, waitFor, waitForServer } from './dev/game-processes.js';

// These ports are reserved for this acceptance probe, separate from ordinary and legacy probes.
const profile=await createProfile(false,false,{port:27029,gamePort:34209});
const directory=await mkdtemp(path.join(profile.dir,'workspace-acceptance-'));
const events:unknown[]=[],activities:WorkshopActivity[]=[],checks:string[]=[];
let port:Awaited<ReturnType<typeof waitForServer>>|null=null,observer=false,server=false,failure:string|null=null;
const catalog=new WorkspaceCatalog(profile.dir);
const journal=new SqliteJournal(path.join(directory,'runtime.sqlite'));
const context=()=>({run:'workspace-game-acceptance',epoch:'probe',wallTime:new Date().toISOString(),gameTick:null,actor:'operator',task:null,causation:null,correlation:null,visibility:{kind:'operator'} as const});
const inference:WorkshopInference={
  async invoke(_session,role,_selection,observation){
    if(role==='workshop-designer'){
      const assignment=(observation as {assignment:{ports:unknown[]}}).assignment;
      return{text:JSON.stringify({schema:1,label:'Deterministic gear cell',description:'Legal character and direct acceptance probe',entities:[
        {id:'input',entityNumber:1,name:'wooden-chest',position:{x:-3.5,y:3.5},direction:0,quality:'normal',inventoryBar:8},
        {id:'assembler',entityNumber:2,name:'assembling-machine-1',position:{x:0.5,y:3.5},direction:0,quality:'normal',recipe:'iron-gear-wheel'},
        {id:'output',entityNumber:3,name:'wooden-chest',position:{x:4.5,y:3.5},direction:0,quality:'normal'}],wires:[],ports:assignment.ports,icons:[{index:1,name:'iron-gear-wheel'}],tiles:[]}),usage:{turns:1,tools:0,elapsedMs:1,tokens:100}};
    }
    return{text:JSON.stringify({schema:1,summary:'The deterministic window establishes the verdict.',findings:[]}),usage:{turns:1,tools:0,elapsedMs:1,tokens:100}};
  },cancel:id=>effectReceipt(`inference:${id}`,'cancelled'),async close(){}
};
const request=(id:string,construction:'direct'|'character',windowTicks:number,windows:number,attempts:number)=>({schema:1,id,revision:1,comparisonSeries:id,objective:'Produce 1 iron gear wheel per minute',source:{kind:'brief',id:null},profileId:'starter-assembly',construction,libraryAccess:false,improveRevision:null,requestedSpeed:{numerator:'10',denominator:'1'},settlingTicks:0,windowTicks,windows,rubric:{version:'rubric-1',weights:{throughput:{numerator:'1',denominator:'1'}},materiality:{throughput:{numerator:'0',denominator:'1'}},directions:{throughput:'maximize'}},iterations:{attempts,mode:'exact',earlyStop:false,plateauRounds:1},checkpoints:{brief:false,afterScore:false,libraryAdmission:false,learningActivation:false,timeoutMs:60000,timeoutAction:'finish'},budgets:{wallMs:180000,gameTicks:120000,turns:8,toolCalls:8,reportedTokens:null,learningReservedTurns:0,learningReservedTools:0},models:{sessionDefault:{provider:'openai',modelId:'gpt-6-astra',reasoningEffort:'low'},overrides:{}},learning:{cadence:'off',batchSessions:1,candidateCap:1,attemptsPerCandidate:1,autoActivate:false}});
const model={id:'gpt-6-astra',displayName:'Astra',efforts:['low']};
let composition:ReturnType<typeof composeWorkshop>|null=null;
try{
  await startServer(profile);server=true;port=await waitForServer(profile);
  await port.command('/silent-command rcon.print("workspace acceptance ready")');
  await startObserver(profile);observer=true;await identifyObserver(profile);
  const client=new GameClient(port,value=>events.push(value)),lifecycle=new Lifecycle(port,client,value=>events.push(value));
  await waitFor('visible builder',async()=>{const world=await client.request({op:'observe',surface:'nauvis',area:[{x:-32,y:-32},{x:32,y:32}],offset:0,limit:50});return (world.actors as Record<string,{connected:boolean}>|undefined)?.['builder-1']?.connected?true:undefined;},60000,200);
  const game=new LiveWorkshopGame(port,client,lifecycle,value=>activities.push(value),async()=>()=>{},profile.dir);
  const host=new LiveWorkshopHost(directory,inference,game,value=>activities.push(value));
  const store={directory,run:'workspace-game-acceptance',journal,context,record(type:string,changes:Parameters<SqliteJournal['append']>[2]){journal.append(context(),type,changes);}};
  composition=composeWorkshop(store as never,{workshopHost:host,managedModels:[model],workspaceCatalog:catalog});
  const runtime=composition.controller!;
  const character=request('workspace-character-stop','character',3600,5,2);runtime.accept(character);
  await waitFor('character submit acceptance',async()=>events.some(value=>{const event=value as {kind?:string;op?:string;response?:{ok?:boolean}};return event.kind==='game/response'&&event.op==='submit'&&event.response?.ok===true;})?true:undefined,90_000,50);
  await runtime.stop(character.id,'operator_stop');await runtime.pending(character.id);
  assert.equal(composition.orchestrator.get(character.id).stage,'stopped');assert.equal(composition.orchestrator.get(character.id).iterations.length,1);
  assert.equal(catalog.owner(),null);checks.push('Stop during legal character construction acknowledged game cancellation, closed later attempts and released exact ownership');

  const measured=request('workspace-measure-stop','direct',3600,5,2);runtime.accept(measured);
  await waitFor('measurement active',async()=>activities.some(value=>value.sessionId===measured.id&&value.category==='game'&&value.detail==='Fixed-window measurement'&&value.status==='started')?true:undefined,90_000,50);
  await new Promise(resolve=>setTimeout(resolve,200));
  await runtime.stop(measured.id,'operator_stop');await runtime.pending(measured.id);
  assert.equal(composition.orchestrator.get(measured.id).stage,'stopped');assert.equal(composition.orchestrator.get(measured.id).iterations.length,1);
  assert.equal(catalog.owner(),null);checks.push('Stop during fixed-window measurement obtained terminal abort/absence, restored control and admitted no next attempt');

  const successor=request('workspace-subsequent-run','direct',60,1,1);runtime.accept(successor);
  await waitFor('subsequent completion',async()=>{try{return composition!.orchestrator.get(successor.id).stage==='complete'?true:undefined;}catch{return undefined;}},90_000,100);
  const inspection=await new WorkshopControl(port).inspect(`${successor.id}-1`);
  assert(Array.isArray(inspection.entities)&&inspection.entities.length>=3,'Subsequent candidate not visible in the game inspection');
  assert.equal(catalog.request(successor.id)?.state,'completed');assert.equal(catalog.owner(),null);
  const details=[character.id,measured.id,successor.id].map(id=>catalog.detail(id,{directory,journal}));
  assert.deepEqual(details.map(value=>value.lifecycle.execution),['cancelled','cancelled','completed']);
  checks.push('A later direct run constructed a retained game candidate and completed; catalog history preserved both stopped runs');
  await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,'game-events.json'),JSON.stringify(events,null,2));
  await writeFile(path.join(directory,'report.json'),JSON.stringify({passed:true,checks,requests:details.map(value=>({id:value.run.identity.id,lifecycle:value.lifecycle,attempts:Array.isArray(value.session?.iterations)?value.session.iterations.length:0})),inspection,activities},null,2));
  console.log(JSON.stringify({evidence:directory,passed:true,checks:checks.length}));
}catch(error){failure=String(error);process.exitCode=1;
  await writeFile(path.join(directory,'report.json'),JSON.stringify({passed:false,checks,failure,stack:error instanceof Error?error.stack:null,requests:['workspace-character-stop','workspace-measure-stop','workspace-subsequent-run'].map(id=>catalog.request(id)),activities,events},null,2));
  console.error(JSON.stringify({evidence:directory,passed:false,failure}));
}finally{
  await composition?.controller?.close();composition?.library.close();journal.close();catalog.close();port?.close();
  let cleanup=true;try{if(observer)await stopProfile(profile.observerConfig);if(server)await stopProfile(profile.config);}catch(error){cleanup=false;failure??=String(error);process.exitCode=1;}
  await writeFile(path.join(directory,'cleanup.json'),JSON.stringify({cleanup,failure},null,2));
  console.log(JSON.stringify({evidence:directory,cleanup}));
}
