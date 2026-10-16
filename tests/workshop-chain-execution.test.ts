import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BlueprintDocument, MachineFact, ProductionAvailability, ProductionCatalog, ProductionProduct, RecipeFact, WorkshopAssignment, WorkshopEvaluationReport } from '@autofactorio/contracts';
import { SqliteJournal } from '../packages/storage/src/journal.js';
import type { EventContext } from '../packages/core/execution/durable.js';
import { WorkshopOrchestrator } from '../packages/core/workshop/orchestrator.js';
import type { WorkshopSessionState } from '../packages/core/workshop/orchestrator.js';
import { WorkshopRuntime } from '../packages/core/workshop/runtime.js';
import { BlueprintLibrary } from '../packages/core/workshop/library.js';
import { LearningService } from '../packages/core/workshop/learning.js';
import { WorkshopUsageLedger } from '../packages/core/workshop/usage.js';
import { installedChainContext } from '../packages/core/workshop/installed-chain.js';
import type { InstalledChainPreset } from '../packages/core/workshop/installed-chain.js';
import { resolveInstalledWorkshopChain } from '../apps/runtime/workshop-chain-resolution.js';
import { prepareChainConstruction } from '../apps/runtime/workshop-chain-construction.js';
import { bindChainStages, chainMeasurementRequirements } from '../apps/runtime/workshop-chain-measurement.js';
import { LiveWorkshopHost } from '../apps/runtime/workshop-live-host.js';
import type { WorkshopGame, WorkshopInference, WorkshopActivity } from '../apps/runtime/workshop-live-host.js';
import { blueprintContentHash } from '../packages/core/workshop/blueprint.js';

const item = (name: string): ProductionProduct => ({ kind: 'item', name, quality: 'normal', surface: 'nauvis' });
const fluid = (name: string): ProductionProduct => ({ kind: 'fluid', name, quality: 'normal', surface: 'nauvis' });
const flow = (p: ProductionProduct, amount: number) => ({ type: p.kind, name: p.name, amount });
const recipe = (name: string, category: string, ingredients: [ProductionProduct, number][], products: [ProductionProduct, number][]): RecipeFact => ({ id: `recipe:${name}`, name, category, seconds: 1, ingredients: ingredients.map(([p,n]) => flow(p,n)), products: products.map(([p,n]) => flow(p,n)), unlocks: [], surfaceConditions: [] });
const pipe = { connection_type:'pipe', direction:0, flow_direction:'input', positions:[{x:0,y:0},{x:0,y:-1},{x:1,y:0},{x:0,y:1}], connection_category:['default'] };
const machine = (name:string,category:string):MachineFact => ({ id:`machine:${name}`, name, type:'assembling-machine', categories:[category], speed:1, ingredientLimit:20, collisionBox:[{x:-1,y:-1},{x:1,y:1}], fluidBoxes:Array.from({length:6},(_,index)=>({index:index+1,productionType:'input-output' as const,volume:100,connections:[pipe]})), placementItems:[name], energy:{kind:'electric',maxJoulesPerTick:0,drainJoulesPerTick:0}, baseEffects:{}, surfaceConditions:[] });
const recipes = [recipe('basic-oil-processing','oil-processing',[[fluid('crude-oil'),100]],[[fluid('petroleum-gas'),45],[fluid('light-oil'),25],[fluid('heavy-oil'),10]]),recipe('sulfur','chemistry',[[fluid('petroleum-gas'),30],[fluid('water'),30]],[[item('sulfur'),2]])];
const catalog:ProductionCatalog = { schema:1, mods:{base:'2.0.77',space_age:'2.0.77'}, fingerprint:'a'.repeat(64), products:[...['crude-oil','petroleum-gas','light-oil','heavy-oil','water'].map(name=>({id:`fluid:${name}`,kind:'fluid' as const,name})),...['sulfur','oil-refinery','chemical-plant'].map(name=>({id:`item:${name}`,kind:'item' as const,name}))], recipes, machines:[machine('oil-refinery','oil-processing'),machine('chemical-plant','chemistry')] };
const availability:ProductionAvailability = { tick:14, force:'player', researched:['unrelated-tech'], surfaceProperties:{pressure:1000}, recipes:{sulfur:{enabled:false,productivity:0.2},'basic-oil-processing':{enabled:true,productivity:0.5}} };
const preset:InstalledChainPreset = {schema:1,gameVersion:'2.0.77',mods:{base:'2.0.77',space_age:'2.0.77'},profileId:'production-chain',profileRevision:3,surface:'nauvis',technologies:['sulfur-processing'],recipes:['sulfur','basic-oil-processing'],allowedEquipment:['chemical-plant','oil-refinery']};
const installed = () => installedChainContext(preset,{catalog,availability,availabilityRevision:'b'.repeat(64)});
const request = (ctx=installed()) => ({schema:1 as const,target:item('sulfur'),mode:'rate' as const,rate:{numerator:'2',denominator:'1',unit:'items-per-game-second' as const},profile:{id:ctx.profile.id,revision:ctx.profile.revision,fingerprint:ctx.profile.fingerprint,recipes:ctx.profile.recipes,equipment:ctx.profile.allowedEquipment},facts:{schema:1 as const,id:`production.${catalog.fingerprint}`,fingerprint:catalog.fingerprint,availabilityRevision:ctx.snapshot.availabilityRevision},externalInputs:[{product:fluid('crude-oil'),capacity:{kind:'unlimited' as const}},{product:fluid('water'),capacity:{kind:'unlimited' as const}}],initialStock:[],utilities:{electricityWatts:100000},constructionEquipment:{'oil-refinery':1,'chemical-plant':1},sinks:[{product:fluid('light-oil'),capacity:{kind:'unlimited' as const}},{product:fluid('heavy-oil'),capacity:{kind:'unlimited' as const}}],routes:{'fluid:petroleum-gas':'recipe:basic-oil-processing','item:sulfur':'recipe:sulfur'},machines:{'recipe:basic-oil-processing':'machine:oil-refinery','recipe:sulfur':'machine:chemical-plant'},fuels:{}});
const assignmentInput = (id:string,construction:'direct'|'character',changes:Record<string,unknown>={}) => ({schema:1,id,revision:1,comparisonSeries:`series-${id}`,objective:'Produce sulfur from the selected installed chain',source:{kind:'brief',id:null},profileId:'production-chain',productionMode:'chain',chainRequest:request(),construction,libraryAccess:false,improveRevision:null,requestedSpeed:{numerator:'10',denominator:'1'},settlingTicks:0,windowTicks:60,windows:1,rubric:{version:'r1',weights:{throughput:{numerator:'1',denominator:'1'}},materiality:{throughput:{numerator:'0',denominator:'1'}},directions:{throughput:'maximize'}},iterations:{attempts:1,mode:'exact',earlyStop:false,plateauRounds:1},checkpoints:{brief:false,afterScore:false,libraryAdmission:false,learningActivation:false,timeoutMs:1000,timeoutAction:'finish'},budgets:{wallMs:60000,gameTicks:600,turns:5,toolCalls:12,reportedTokens:1000,learningReservedTurns:0,learningReservedTools:0},models:{sessionDefault:{provider:'openai',modelId:'gpt-6-astra',reasoningEffort:'low'},overrides:{}},learning:{cadence:'off',batchSessions:2,candidateCap:2,attemptsPerCandidate:1,autoActivate:false},...changes});
const blueprint = (assignment:WorkshopAssignment):BlueprintDocument => ({schema:1,label:'Disconnected scripted chain',description:'A wiring-only acceptance fixture; no physical connection claim.',entities:[{id:'refinery',entityNumber:1,name:'oil-refinery',position:{x:0,y:0},direction:0,quality:'normal',recipe:'basic-oil-processing'},{id:'chemical',entityNumber:2,name:'chemical-plant',position:{x:80,y:0},direction:0,quality:'normal',recipe:'sulfur'}],wires:[],ports:assignment.ports,icons:[{index:1,name:'sulfur'}],tiles:[]});
const passedReport = (sessionId:string,assignment:WorkshopAssignment):WorkshopEvaluationReport => ({schema:1,attemptId:`${sessionId}:1`,valid:true,passed:true,reasons:[],ports:assignment.throughput.map(rule=>({portId:rule.portId,windows:Array.from({length:rule.windows},(_,index)=>({index,required:{numerator:'2',denominator:'1'},productionLower:{numerator:'2',denominator:'1'},deliveryLower:{numerator:'2',denominator:'1'},passed:true,reasons:[]}))})),evidence:['scripted-measurement-wiring-only']});
const selection = [{provider:'openai' as const,modelId:'gpt-6-astra',reasoningEffort:'low' as const}];

function runtimeFixture(root:string,ctx=installed(),calls:{events:WorkshopActivity[];inference:{role:string;prompt:string;observation:unknown}[];game:{preflight:number;build:number;measure:number};library:{reads:number;admissions:number}}={events:[],inference:[],game:{preflight:0,build:0,measure:0},library:{reads:0,admissions:0}},incompleteBlueprint=false){
  const journal = new SqliteJournal(path.join(root,'run.sqlite'));
  let clock = 0;
  const eventContext = ():EventContext => ({run:'run',epoch:'epoch',wallTime:new Date(1_800_000_000_000+clock++).toISOString(),gameTick:null,actor:'operator',task:null,causation:null,correlation:null,visibility:{kind:'operator'}});
  const orchestrator = new WorkshopOrchestrator(journal,eventContext);
  const library = new BlueprintLibrary(path.join(root,'library'));
  const search = library.search.bind(library), get = library.get.bind(library), admit = library.admit.bind(library);
  library.search = ((...args:Parameters<typeof library.search>)=>{calls.library.reads++;return search(...args);}) as typeof library.search;
  library.get = ((...args:Parameters<typeof library.get>)=>{calls.library.reads++;return get(...args);}) as typeof library.get;
  library.admit = ((...args:Parameters<typeof library.admit>)=>{calls.library.admissions++;return admit(...args);}) as typeof library.admit;
  const learning = new LearningService(journal,eventContext), usage = new WorkshopUsageLedger(journal,eventContext);
  const game:WorkshopGame = {
    async resolveProfile(){throw new Error('component resolver must not run');},
    async resolveChainProfile(){return structuredClone(ctx);},
    async preflight(){calls.game.preflight++;},
    async build(session,document,profile){
      calls.game.build++;
      const prepared=prepareChainConstruction(session.assignment,document,profile,ctx), inspected=document.entities.map((entity,index)=>({unit:index+101,name:entity.name,position:entity.position}));
      const requirements=chainMeasurementRequirements(session.assignment,prepared.resolved.chain);
      const chainMeasurement={schema:1 as const,...requirements,bindings:bindChainStages(prepared.resolved.chain.stages,document,inspected),boundaryFingerprint:prepared.boundaryFingerprint,candidateFingerprint:'fake-game-candidate'};
      return{id:`${session.id}-${session.activeIteration}`,generation:4,surface:'af-workshop-test',characterEvidence:session.assignment.construction==='character'?['fake-character-receipt']:null,chainMeasurement};
    },
    async measure(session){calls.game.measure++;return passedReport(session.id,session.assignment);},
  };
  const designerDoc=(id:string)=>blueprint(resolveInstalledWorkshopChain(assignmentInput(id,'direct') as Record<string,unknown>,ctx).assignment);
  const inference:WorkshopInference = {
    async invoke(session,role,_selection,observation,prompt){
      calls.inference.push({role,prompt,observation});
      if(role==='workshop-designer'){
        const document=designerDoc(session.id);
        return {text:JSON.stringify({blueprint:{label:document.label,description:document.description,entities:document.entities.slice(0,incompleteBlueprint?1:undefined).map(({id,entityNumber,name,position,direction,recipe})=>({id,entityNumber,name,position,direction,recipe})),wires:document.wires,icons:document.icons,tiles:document.tiles}}),usage:{turns:1,tools:1,elapsedMs:1,tokens:10}};
      }
      return {text:JSON.stringify({summary:'Measured scripted result; physical behavior remains unverified.'}),usage:{turns:1,tools:1,elapsedMs:1,tokens:10}};
    },
    async close(){},
  };
  const host=new LiveWorkshopHost(root,inference,game,activity=>calls.events.push(activity),false);
  host.bindServices({library,learning,usage,sessions:()=>journal.list('run','workshopSessions')});
  const runtime=new WorkshopRuntime(orchestrator,host,library,()=>selection,()=> 'baseline',()=>journal.list('run','workshopSessions'),()=>{});
  return{journal,eventContext,orchestrator,library,learning,usage,game,host,runtime,calls,async close(){await runtime.close();library.close();journal.close();}};
}

describe('ordinary installed-chain runtime execution',()=>{
  it('admits chain evidence, restores an exact Improve and requires fresh evaluation for a changed boundary',async()=>{
    const root=mkdtempSync(path.join(os.tmpdir(),'af-chain-library-')),fixture=runtimeFixture(root);
    try{
      const input=assignmentInput('library-chain','direct',{libraryAccess:true});
      const first=await fixture.runtime.launch(input);await fixture.runtime.pending(first.id);
      expect(fixture.orchestrator.get(first.id)).toMatchObject({stage:'complete',finalOutcome:'best-valid'});
      const entry=fixture.library.search()[0]!;
      expect(entry).toMatchObject({boundaryStatus:'known',attestationId:expect.stringMatching(/^attestation-/)});
      const proof=fixture.library.get(entry.attestationId!).evidence.provenance!;
      expect(proof).toMatchObject({assignment:{id:first.id},chain:{plan:{id:`plan.${first.id}`,revision:1}}});
      const improve={...input,id:'improve-chain',source:{kind:'revision',id:entry.attestationId},improveRevision:entry.attestationId};
      delete (improve as {chainRequest?:unknown}).chainRequest;
      const second=await fixture.runtime.launch(improve);await fixture.runtime.pending(second.id);
      expect(fixture.orchestrator.get(second.id)).toMatchObject({stage:'complete',assignment:{chainRequest:proof.chain!.request}});
      const observation=fixture.calls.inference.find(row=>(row.observation as {assignment:{id:string}}).assignment.id===second.id)!.observation;
      expect(observation).toMatchObject({sourceRevision:{hash:entry.attestationId},designPlan:{plan:{id:`plan.${second.id}`}}});
      const before={game:structuredClone(fixture.calls.game),inference:fixture.calls.inference.length};
      const changed={...improve,id:'changed-improve',chainRequest:{...proof.chain!.request,utilities:{electricityWatts:200000}}};
      await expect(fixture.runtime.launch(changed)).rejects.toThrow(/boundary.*changed/i);
      expect(fixture.calls.game).toEqual(before.game);expect(fixture.calls.inference).toHaveLength(before.inference);
      const fresh=await fixture.runtime.launch({...changed,id:'fresh-boundary',source:{kind:'brief',id:null},improveRevision:null});await fixture.runtime.pending(fresh.id);
      expect(fixture.orchestrator.get(fresh.id).stage).toBe('complete');
      const entries=fixture.library.search();expect(entries).toHaveLength(2);
      expect(new Set(entries.map(row=>row.revisionHash)).size).toBe(1);
      expect(new Set(entries.map(row=>row.boundaryHash)).size).toBe(2);
      expect(fixture.library.get(entry.attestationId!).evidence.provenance!.assignment.id).toBe(first.id);
    }finally{await fixture.close();rmSync(root,{recursive:true,force:true});}
  });
  it.each(['direct','character'] as const)('completes the ordinary %s launch, design, build, measure, score, and finalization path',async construction=>{
    const root=mkdtempSync(path.join(os.tmpdir(),'af-chain-execution-')),fixture=runtimeFixture(root);
    try{
      const launched=await fixture.runtime.launch(assignmentInput(`ordinary-${construction}`,construction));
      const work=fixture.runtime.pending(launched.id);if(work)await work;
      const completed=fixture.orchestrator.get(launched.id);
      expect(completed.stage,completed.stopReason??'no stop reason recorded').toBe('complete');
      expect(completed.iterations[0]?.artifact).toMatchObject({sessionId:launched.id,iteration:1,assignmentRevision:1,bundleHash:'baseline'});
      expect(completed.iterations[0]?.evaluation).toMatchObject({attemptId:`${launched.id}:1`,valid:true,passed:true});
      expect(fixture.calls.game).toEqual({preflight:1,build:1,measure:1});
      expect(fixture.calls.inference.map(value=>value.role)).toEqual(['workshop-designer','workshop-scorer']);
      const design=fixture.calls.inference[0]!;
      expect(design.observation).toMatchObject({designPlan:{mode:'chain',plan:{stages:expect.arrayContaining([expect.objectContaining({recipe:'recipe:basic-oil-processing'}),expect.objectContaining({recipe:'recipe:sulfur'})])},stageInterfaces:expect.arrayContaining([expect.objectContaining({recipe:'basic-oil-processing'}),expect.objectContaining({recipe:'sulfur'})])}});
      expect(design.observation).toMatchObject({sourceRevision:null,activatedLearning:{lessons:null,helperPlan:null}});
      expect(fixture.calls.library).toEqual({reads:0,admissions:0});
      expect(completed.iterations[0]?.artifact?.bundleHash).toBe(completed.pinnedBundleHash);
      expect(fixture.calls.events.some(event=>event.category==='provider'&&event.role==='workshop-designer'&&event.status==='completed')).toBe(true);
      // The accepted scripted game report is test wiring. The deliberately disconnected blueprint does not establish physical success.
      expect(completed.iterations[0]?.artifact?.artifactHash).toBe(blueprintContentHash(blueprint(completed.assignment)));
      expect(blueprint(completed.assignment).wires).toEqual([]);
      expect(fixture.calls.game).toBeDefined();
    }finally{await fixture.close();rmSync(root,{recursive:true,force:true});}
  });

  it('rejects forged candidate/session/iteration/bundle identities and changed evaluation or document before scorer inference',async()=>{
    const root=mkdtempSync(path.join(os.tmpdir(),'af-chain-execution-pins-')),fixture=runtimeFixture(root);
    try{
      const assignment=await fixture.host.resolve(assignmentInput('pin-guards','direct')),session={id:assignment.id,assignment,activeIteration:1,pinnedBundleHash:'baseline',selections:{designer:selection[0],scorer:selection[0],learnings:selection[0]},iterations:[],assistance:[]} as unknown as WorkshopSessionState;
      const candidate=await fixture.host.design(session,1),hash=candidate.artifactHash;
      const forged=[{...candidate,sessionId:'other-session'},{...candidate,iteration:2},{...candidate,assignmentRevision:2},{...candidate,bundleHash:'changed-bundle'}];
      for(const bad of forged)await expect(fixture.host.build(session,bad)).rejects.toThrow();
      await expect(fixture.host.build({...session,id:'other-session'},candidate)).rejects.toThrow();
      expect(fixture.calls.game.build).toBe(0);
      await fixture.host.build(session,candidate);
      const evaluation=await fixture.host.measure(session,candidate);
      for(const bad of forged)await expect(fixture.host.score(session,bad,evaluation)).rejects.toThrow();
      await expect(fixture.host.score({...session,id:'other-session'},candidate,evaluation)).rejects.toThrow();
      await expect(fixture.host.score(session,candidate,{...evaluation,evidence:['changed-report']})).rejects.toThrow(/measured candidate|evaluation/i);
      const changed=blueprint(assignment);changed.entities[1]!.position={x:82,y:0};
      writeFileSync(path.join(root,'workshop-live',assignment.id,`${hash}.json`),JSON.stringify(changed));
      await expect(fixture.host.score(session,candidate,evaluation)).rejects.toThrow(/measured candidate|evaluation/i);
      expect(fixture.calls.inference.filter(value=>value.role==='workshop-scorer')).toHaveLength(0);
      expect(fixture.calls.game).toMatchObject({build:1,measure:1});
    }finally{await fixture.close();rmSync(root,{recursive:true,force:true});}
  });

  it('refuses a missing planned stage before dispatching the fake game build',async()=>{
    const root=mkdtempSync(path.join(os.tmpdir(),'af-chain-missing-stage-')),fixture=runtimeFixture(root,installed(),undefined, true);
    try{
      const assignment=await fixture.host.resolve(assignmentInput('missing-stage','direct'));
      const session={id:assignment.id,assignment,activeIteration:1,pinnedBundleHash:'baseline',selections:{designer:selection[0],scorer:selection[0],learnings:selection[0]},iterations:[],assistance:[]} as unknown as WorkshopSessionState;
      await expect(fixture.host.design(session,1)).rejects.toThrow('omits a required chain stage');
      expect(fixture.calls.game.build).toBe(0);
    }finally{await fixture.close();rmSync(root,{recursive:true,force:true});}
  });

  it('preserves off, after-session, and batch learning cadence in direct finalization',async()=>{
    const root=mkdtempSync(path.join(os.tmpdir(),'af-chain-learning-cadence-')),fixture=runtimeFixture(root);
    try{
      for(const [cadence,completedCount,expected] of [['off',0,false],['after-session',0,true],['batch',0,false],['batch',1,true]] as const){
        const id=`cadence-${cadence}-${completedCount}`,assignment=await fixture.host.resolve(assignmentInput(id,'direct',{learning:{cadence,batchSessions:2,candidateCap:2,attemptsPerCandidate:1,autoActivate:false}}));
        const completed=Array.from({length:completedCount},(_,index)=>({stage:'complete',assignment:{id:`prior-${index}`}}));
        fixture.host.bindServices({library:fixture.library,learning:fixture.learning,usage:fixture.usage,sessions:()=>completed as never});
        const result=await fixture.host.finalization({id,assignment,stage:'finalizing',iterations:[],activeIteration:1,bestIteration:null,validIterations:[],pinnedBundleHash:'baseline'} as never);
        expect(result).toMatchObject({admission:null,learningRequired:expected});
      }
      expect(fixture.calls.library).toEqual({reads:0,admissions:0});
    }finally{await fixture.close();rmSync(root,{recursive:true,force:true});}
  });

  it('refuses stale installed facts before preflight and designer inference',async()=>{
    const root=mkdtempSync(path.join(os.tmpdir(),'af-chain-stale-before-inference-')),initial=installed();let current=structuredClone(initial);
    const fixture=runtimeFixture(root,initial);fixture.game.resolveChainProfile=async()=>structuredClone(current);
    try{
      const input=assignmentInput('stale-chain','direct'),resolved=await fixture.host.resolve(input);current=installed();current.profile.revision++;
      // Keep the captured plan but change the adapter facts before launch reaches readiness.
      await expect(fixture.runtime.launch(input)).rejects.toThrow(/installed|profile|authorized/i);
      expect(fixture.calls.game.preflight).toBe(0);
      expect(fixture.calls.inference).toHaveLength(0);
      expect(fixture.journal.get('run','workshopSessions',resolved.id)).toBeUndefined();
    }finally{await fixture.close();rmSync(root,{recursive:true,force:true});}
  });
});
