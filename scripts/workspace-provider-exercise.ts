import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { effectReceipt } from '@autofactorio/contracts';
import type { WorkshopEvaluationReport } from '@autofactorio/contracts';
import { AppServerRpc } from '../packages/codex/src/rpc.js';
import { managedCatalog, requireManagedSelection } from '../packages/codex/src/preflight.js';
import { object } from '../packages/codex/src/protocol.js';
import { SqliteJournal } from '../packages/storage/src/journal.js';
import { composeWorkshop } from '../apps/runtime/workshop-composition.js';
import { LiveWorkshopHost, ManagedWorkshopInference } from '../apps/runtime/workshop-live-host.js';
import type { WorkshopGame } from '../apps/runtime/workshop-live-host.js';
import { invocationFile, readInvocationPage } from '../apps/runtime/workshop-invocation.js';

const option=(name:string)=>{const at=process.argv.indexOf(name);return at<0?null:process.argv[at+1]??null;};
const executable=option('--codex');
if(!process.argv.includes('--live')||!executable||!path.isAbsolute(executable))throw new Error('Usage: workspace-provider-exercise --live --codex <absolute managed Codex executable>');
const root=path.resolve('.runtime/workspace-provider');await mkdir(root,{recursive:true});
const directory=await mkdtemp(path.join(root,'exercise-'));
const selection={provider:'openai' as const,modelId:'gpt-6-astra',reasoningEffort:'low'};
const started=Date.now(),events:unknown[]=[];
const sink=(event:unknown)=>{events.push(event);appendFileSync(path.join(directory,'provider-events.jsonl'),JSON.stringify(event)+'\n');};
let failure:string|null=null,composition:ReturnType<typeof composeWorkshop>|null=null;
const bootstrap=new AppServerRpc(executable,directory,{forced_login_method:'chatgpt',model_provider:'openai','features.apps':false,'features.plugins':false});
const journal=new SqliteJournal(path.join(directory,'runtime.sqlite'));
const context=()=>({run:'workspace-provider',epoch:'exercise',wallTime:new Date().toISOString(),gameTick:null,actor:'operator',task:null,causation:null,correlation:null,visibility:{kind:'operator'} as const});
const installed={gameVersion:'2.0.77',mods:{base:'2.0.77'},profileId:'starter-assembly',profileRevision:1,surface:'nauvis',technologies:['automation'],allowedEquipment:['assembling-machine-1'],modules:[],beacons:[],recipe:{id:'electronic-circuit',category:'crafting',energy:0.5,ingredients:[{type:'item' as const,name:'iron-plate',amount:1}],products:[{type:'item' as const,name:'electronic-circuit',amount:1}]},machine:'assembling-machine-1'};
const game:WorkshopGame={async resolveProfile(){return structuredClone(installed);},async build(session){return{id:`${session.id}-${session.activeIteration}`,generation:1,surface:'af-provider-fixture',characterEvidence:null};},
  async measure(session):Promise<WorkshopEvaluationReport>{const output=session.assignment.ports.find(value=>value.direction==='output'&&value.required)!;
    return{schema:1,attemptId:`${session.id}:${session.activeIteration}`,valid:true,passed:session.activeIteration===2,reasons:session.activeIteration===2?[]:['sustained_target_failed'],ports:[{portId:output.id,windows:[]}],evidence:[`deterministic-window:${session.activeIteration}`]};},
  cancel:id=>effectReceipt(`game:${id}`,'cancelled')};
const assignment={schema:1,id:'workspace-managed-two-attempts',revision:1,comparisonSeries:'workspace-managed-two-attempts',objective:'Produce 60 electronic circuits per minute',source:{kind:'brief',id:null},profileId:'starter-assembly',construction:'direct',libraryAccess:false,improveRevision:null,requestedSpeed:{numerator:'10',denominator:'1'},settlingTicks:0,windowTicks:60,windows:1,rubric:{version:'rubric-1',weights:{throughput:{numerator:'1',denominator:'1'}},materiality:{throughput:{numerator:'0',denominator:'1'}},directions:{throughput:'maximize'}},iterations:{attempts:2,mode:'exact',earlyStop:false,plateauRounds:1},checkpoints:{brief:false,afterScore:false,libraryAdmission:false,learningActivation:false,timeoutMs:60000,timeoutAction:'finish'},budgets:{wallMs:15*60_000,gameTicks:1200,turns:4,toolCalls:8,reportedTokens:null,learningReservedTurns:0,learningReservedTools:0},models:{sessionDefault:selection,overrides:{}},learning:{cadence:'off',batchSessions:1,candidateCap:1,attemptsPerCandidate:1,autoActivate:false}};
await writeFile(path.join(directory,'manifest.json'),JSON.stringify({schema:1,assignment,selection,providerCallsMax:4,toolAttemptsMax:8,wallMsMax:15*60_000,game:'deterministic adapter; no Factorio process'},null,2));
try{
  await bootstrap.call('initialize',{clientInfo:{name:'autofactorio_workspace_exercise',version:'0.1.0'},capabilities:{experimentalApi:true}});
  const catalog=await managedCatalog(bootstrap);requireManagedSelection(catalog,selection);
  const config=object(object(await bootstrap.call('config/read',{cwd:directory})).config);
  const inference=new ManagedWorkshopInference(executable,directory,Object.keys(object(config.mcp_servers??{})),sink);
  const host=new LiveWorkshopHost(directory,inference,game);
  const store={directory,run:'workspace-provider',journal,context,record(type:string,changes:Parameters<SqliteJournal['append']>[2]){journal.append(context(),type,changes);}};
  composition=composeWorkshop(store as never,{workshopHost:host,managedModels:catalog.models,workshopBundleHash:'baseline'});
  const runtime=composition.controller!;await runtime.launch(assignment);
  const deadline=started+15*60_000;
  while(!['complete','stopped','held'].includes(composition.orchestrator.get(assignment.id).stage)){
    if(Date.now()>deadline){await runtime.stop(assignment.id,'exercise_budget_exhausted');throw new Error('Managed exercise exceeded 15-minute wall limit');}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const session=composition.orchestrator.get(assignment.id);
  assert.equal(session.stage,'complete',session.stopReason??'Workshop did not complete');
  assert.equal(session.iterations.length,2,'Exactly two attempts required');
  assert.equal(session.iterations[0]?.critique?.status,'validated','First measured failure needs validated critique');
  assert(session.iterations[0].critique.findings.length>0,'First critique needs a linked finding');
  assert(session.iterations[1]?.artifact?.changePlan,'Second designer needs a linked change plan');
  const firstOutput=readInvocationPage(invocationFile(directory,assignment.id,`${assignment.id}:1:designer`),`${assignment.id}:1:designer`,'output');
  const secondContext=readInvocationPage(invocationFile(directory,assignment.id,`${assignment.id}:2:designer`),`${assignment.id}:2:designer`,'context');
  const secondOutput=readInvocationPage(invocationFile(directory,assignment.id,`${assignment.id}:2:designer`),`${assignment.id}:2:designer`,'output');
  assert.equal(firstOutput.status,'complete');assert.equal(secondContext.status,'complete');assert.equal(secondOutput.status,'complete');
  assert(secondContext.text.includes(session.iterations[0].critique.findings[0]!.id),'Second input omitted first finding');
  const usage=JSON.parse(await (await import('node:fs/promises')).readFile(path.join(directory,'workshop-live',assignment.id,'provider-budget.json'),'utf8')) as {workshop:{turns:number;tools:number};invocations:Record<string,unknown>};
  assert(usage.workshop.turns<=4&&usage.workshop.tools<=8,'Provider budget exceeded');
  await writeFile(path.join(directory,'report.json'),JSON.stringify({schema:1,passed:true,session,usage,elapsedMs:Date.now()-started,events:events.length,firstOutputHash:createHash('sha256').update(firstOutput.text).digest('hex'),secondContextHash:createHash('sha256').update(secondContext.text).digest('hex'),secondOutputHash:createHash('sha256').update(secondOutput.text).digest('hex')},null,2));
  console.log(JSON.stringify({evidence:directory,passed:true,turns:usage.workshop.turns,tools:usage.workshop.tools,elapsedMs:Date.now()-started}));
}catch(error){failure=String(error);process.exitCode=1;
  let session:unknown=null;try{session=composition?.orchestrator.get(assignment.id)??null;}catch{/* failed before session configuration */}
  await writeFile(path.join(directory,'report.json'),JSON.stringify({schema:1,passed:false,failure,session,elapsedMs:Date.now()-started,events:events.length},null,2));
  console.error(JSON.stringify({evidence:directory,passed:false,failure}));
}finally{bootstrap.close();await composition?.controller?.close();composition?.library.close();journal.close();}
