import { describe, expect, it } from 'vitest';
import type { BlueprintDocument, WorkshopAssignment } from '@autofactorio/contracts';
import { installedChainContext } from '../packages/core/workshop/installed-chain.js';
import type { InstalledChainPreset } from '../packages/core/workshop/installed-chain.js';
import type { MachineFact, ProductionAvailability, ProductionCatalog, ProductionProduct, RecipeFact } from '@autofactorio/contracts';
import { resolveInstalledWorkshopChain } from '../apps/runtime/workshop-chain-resolution.js';
import { prepareChainConstruction } from '../apps/runtime/workshop-chain-construction.js';
import { LiveWorkshopGame } from '../apps/runtime/workshop-live-host.js';
import type { ControlState } from '../packages/factorio/src/lifecycle.js';

const item=(name:string):ProductionProduct=>({kind:'item',name,quality:'normal',surface:'nauvis'});
const fluid=(name:string):ProductionProduct=>({kind:'fluid',name,quality:'normal',surface:'nauvis'});
const flow=(p:ProductionProduct,amount:number)=>({type:p.kind,name:p.name,amount});
const recipe=(name:string,category:string,ingredients:[ProductionProduct,number][],products:[ProductionProduct,number][]):RecipeFact=>({id:`recipe:${name}`,name,category,seconds:1,ingredients:ingredients.map(([p,n])=>flow(p,n)),products:products.map(([p,n])=>flow(p,n)),unlocks:[],surfaceConditions:[]});
const pipe={connection_type:'pipe',direction:0,flow_direction:'input',positions:[{x:0,y:0},{x:0,y:-1},{x:1,y:0},{x:0,y:1}],connection_category:['default']};
const machine=(name:string,category:string):MachineFact=>({id:`machine:${name}`,name,type:'assembling-machine',categories:[category],speed:1,ingredientLimit:20,collisionBox:[{x:-2.5,y:-2.5},{x:2.5,y:2.5}],fluidBoxes:Array.from({length:6},(_,index)=>({index:index+1,productionType:'input-output' as const,volume:100,connections:[pipe]})),placementItems:[name],energy:{kind:'electric',maxJoulesPerTick:0,drainJoulesPerTick:0},baseEffects:{},surfaceConditions:[]});
const recipes=[recipe('basic-oil-processing','oil-processing',[[fluid('crude-oil'),100]],[[fluid('petroleum-gas'),45],[fluid('light-oil'),25],[fluid('heavy-oil'),10]]),recipe('sulfur','chemistry',[[fluid('petroleum-gas'),30],[fluid('water'),30]],[[item('sulfur'),2]])];
const catalog:ProductionCatalog={schema:1,mods:{base:'2.0.77',space_age:'2.0.77'},fingerprint:'a'.repeat(64),products:[...['crude-oil','petroleum-gas','light-oil','heavy-oil','water'].map(name=>({id:`fluid:${name}`,kind:'fluid' as const,name})),...['sulfur','oil-refinery','chemical-plant'].map(name=>({id:`item:${name}`,kind:'item' as const,name}))],recipes,machines:[machine('oil-refinery','oil-processing'),machine('chemical-plant','chemistry')]};
const snapshot={catalog,availability:{tick:14,force:'player',researched:['unrelated'],surfaceProperties:{pressure:1000},recipes:{sulfur:{enabled:false,productivity:0.2},'basic-oil-processing':{enabled:true,productivity:0.5}}} satisfies ProductionAvailability,availabilityRevision:'b'.repeat(64)};
const preset:InstalledChainPreset={schema:1,gameVersion:'2.0.77',mods:{base:'2.0.77',space_age:'2.0.77'},profileId:'production-chain',profileRevision:3,surface:'nauvis',technologies:['sulfur-processing'],recipes:['sulfur','basic-oil-processing'],allowedEquipment:['chemical-plant','oil-refinery']};
const context=()=>installedChainContext(preset,snapshot);
const request=(ctx=context())=>({schema:1 as const,target:item('sulfur'),mode:'rate' as const,rate:{numerator:'2',denominator:'1',unit:'items-per-game-second' as const},profile:{id:ctx.profile.id,revision:ctx.profile.revision,fingerprint:ctx.profile.fingerprint,recipes:ctx.profile.recipes,equipment:ctx.profile.allowedEquipment},facts:{schema:1 as const,id:`production.${catalog.fingerprint}`,fingerprint:catalog.fingerprint,availabilityRevision:ctx.snapshot.availabilityRevision},externalInputs:[{product:fluid('crude-oil'),capacity:{kind:'unlimited' as const}},{product:fluid('water'),capacity:{kind:'unlimited' as const}}],initialStock:[],utilities:{electricityWatts:100000},constructionEquipment:{'oil-refinery':1,'chemical-plant':1},sinks:[{product:fluid('light-oil'),capacity:{kind:'unlimited' as const}},{product:fluid('heavy-oil'),capacity:{kind:'unlimited' as const}}],routes:{'fluid:petroleum-gas':'recipe:basic-oil-processing','item:sulfur':'recipe:sulfur'},machines:{'recipe:basic-oil-processing':'machine:oil-refinery','recipe:sulfur':'machine:chemical-plant'},fuels:{}});
const raw=(id:string,construction:'direct'|'character'='direct')=>({schema:1,id,revision:1,comparisonSeries:`series-${id}`,objective:'Build a pinned sulfur chain',source:{kind:'brief',id:null},profileId:'production-chain',productionMode:'chain',chainRequest:request(),construction,libraryAccess:false,improveRevision:null,requestedSpeed:{numerator:'10',denominator:'1'},settlingTicks:0,windowTicks:60,windows:1,rubric:{version:'r1',weights:{throughput:{numerator:'1',denominator:'1'}},materiality:{throughput:{numerator:'0',denominator:'1'}},directions:{throughput:'maximize'}},iterations:{attempts:1,mode:'exact',earlyStop:false,plateauRounds:1},checkpoints:{brief:false,afterScore:false,libraryAdmission:false,learningActivation:false,timeoutMs:1000,timeoutAction:'finish'},budgets:{wallMs:60000,gameTicks:600,turns:3,toolCalls:8,reportedTokens:1000,learningReservedTurns:0,learningReservedTools:0},models:{sessionDefault:{provider:'openai',modelId:'gpt-6-astra',reasoningEffort:'low'},overrides:{}},learning:{cadence:'off',batchSessions:2,candidateCap:2,attemptsPerCandidate:1,autoActivate:false}});
const blueprint=(assignment:WorkshopAssignment,changes:Partial<BlueprintDocument>={}):BlueprintDocument=>({schema:1,label:'chain',description:'test chain',entities:[{id:'refinery',entityNumber:1,name:'oil-refinery',position:{x:0,y:0},direction:0,quality:'normal',recipe:'basic-oil-processing'},{id:'chemical',entityNumber:2,name:'chemical-plant',position:{x:8,y:0},direction:0,quality:'normal',recipe:'sulfur'}],wires:[],ports:assignment.ports,icons:[],tiles:[],...changes});

describe('prepared installed-chain construction admission',()=>{
  it.each(['direct','character'] as const)('plans the complete external boundary for %s construction before effects',construction=>{
    const ctx=context(),assignment=resolveInstalledWorkshopChain(raw(`prepare-${construction}`,construction) as Record<string,unknown>,ctx).assignment;
    const prepared=prepareChainConstruction(assignment,blueprint(assignment),ctx.profile,ctx);
    expect(prepared.resolved.chain.stages.map(stage=>stage.recipe).sort()).toEqual(['basic-oil-processing','sulfur']);
    expect(prepared.fixtures.map(value=>value.id).sort()).toEqual(['input-fluid-crude-oil','input-fluid-water','output-item-sulfur','power','byproduct-fluid-heavy-oil','byproduct-fluid-light-oil'].sort());
    expect(prepared.fixtures.filter(value=>value.kind==='source').map(value=>value.id)).toEqual(['input-fluid-crude-oil','input-fluid-water']);
    expect(prepared.fixtures.filter(value=>value.kind==='sink').map(value=>value.id).sort()).toEqual(['byproduct-fluid-heavy-oil','byproduct-fluid-light-oil','output-item-sulfur'].sort());
    expect(prepared.fixtures.every(value=>value.bounded&&Number.isFinite(value.rate)&&value.rate>=0)).toBe(true);
    expect(prepared.fixtures.find(value=>value.id==='power')).toMatchObject({kind:'power',rate:100000});
    if(construction==='character')expect(prepared.character?.required).toEqual({'chemical-plant':1,'oil-refinery':1});
    else expect(prepared.character).toBeNull();
    if(prepared.character)expect(prepared.character.steps.filter(value=>value.kind==='walk').every(value=>Math.abs(value.position.x)>2.5||Math.abs(value.position.y)>2.5)).toBe(true);
  });

  it('rejects changed installed profile, boundary, required stages, equipment allowance, tiles and settings before any game effect',()=>{
    const ctx=context(),assignment=resolveInstalledWorkshopChain(raw('invalid-construction') as Record<string,unknown>,ctx).assignment,doc=blueprint(assignment);
    expect(()=>prepareChainConstruction(assignment,doc,{...ctx.profile,fingerprint:'f'.repeat(64)},ctx)).toThrow('profile differs');
    expect(()=>prepareChainConstruction(assignment,{...doc,ports:[]},ctx.profile,ctx)).toThrow('ports differ');
    expect(()=>prepareChainConstruction(assignment,{...doc,entities:doc.entities.slice(0,1)},ctx.profile,ctx)).toThrow('omits a required chain stage');
    expect(()=>prepareChainConstruction(assignment,{...doc,entities:[...doc.entities,{...doc.entities[0]!,id:'refinery-extra',entityNumber:3,position:{x:16,y:0}}]},ctx.profile,ctx)).toThrow('allowance exceeded');
    expect(()=>prepareChainConstruction(assignment,{...doc,tiles:[{name:'landfill',position:{x:0,y:0}}]},ctx.profile,ctx)).toThrow('blueprint tiles');
    expect(()=>prepareChainConstruction(assignment,{...doc,entities:doc.entities.map((entity,index)=>index?entity:{...entity,settings:{speed:2}})},ctx.profile,ctx)).toThrow('Unsupported chain entity setting');
    const changed=context();changed.profile.allowedEquipment=['chemical-plant'];
    expect(()=>prepareChainConstruction(assignment,doc,ctx.profile,changed)).toThrow();
  });

  it.each(['direct','character'] as const)('uses the pinned setup and %s construction receipts',async construction=>{
    const ctx=context(),assignment=resolveInstalledWorkshopChain(raw(`build-${construction}`,construction) as Record<string,unknown>,ctx).assignment,doc=blueprint(assignment);
    const calls:{setup:unknown[];materialize:number;provision:number;submits:number;receipts:number}={setup:[],materialize:0,provision:0,submits:0,receipts:0};
    const control={async setup(input:unknown){calls.setup.push(input);return{generation:2};},async inspect(){return{generation:2,boundaryFingerprint:'changed',profileFingerprint:'changed',candidateFingerprint:'candidate-build',entities:doc.entities.map((entity,index)=>({unit:index+11,name:entity.name,position:entity.position}))};},async materialize(){calls.materialize++;},async enter(){},async provision(_id:string,_actor:string,operationId:string,items:{name:string;count:number}[]){calls.provision++;return{operationId,tick:4,before:[],after:items.map(value=>({name:value.name,count:value.count}))};}};
    const state:ControlState={ok:true,epoch:'epoch',session:'session',revision:1,generation:1,armed:false,ready:true,paused:true,neutral:true,ticksToRun:0,tick:1,ticksPlayed:0,experimentTick:0,scenarioElapsed:0,injections:0,checkpoint:false,ledger:{},intents:{},production:{},mods:{}};
    const game=new LiveWorkshopGame({command:async()=>'',close(){}},{request:async (request:unknown)=>{if(typeof request==='object'&&request!==null&&'op'in request&&request.op==='submit')calls.submits++;return{actors:{}};},receipt:async (commandId:string)=>{calls.receipts++;return{commandId,status:'completed',endedTick:12};}} as never,{async inspect(){return state;},async reconcile(current:ControlState){return current;},async arm(current:ControlState){return current;},async heartbeat(current:ControlState){return current;},async pause(current:ControlState){return current;}} as never,()=>{},async()=>()=>{});
    (game as unknown as {control:typeof control}).control=control;
    (game as unknown as {resolveChainProfile:(id:string)=>Promise<ReturnType<typeof context>>}).resolveChainProfile=async()=>structuredClone(ctx);
    const result=await game.build({id:assignment.id,assignment,activeIteration:1} as never,doc,ctx.profile);
    expect(calls.setup).toHaveLength(1);
    expect(calls.setup[0]).toMatchObject({profile:ctx.profile,boundaryFingerprint:expect.any(String),fixtures:expect.arrayContaining([expect.objectContaining({id:'input-fluid-crude-oil',kind:'source',bounded:true}),expect.objectContaining({id:'power',kind:'power',rate:100000})])});
    if(construction==='direct')expect(calls).toMatchObject({materialize:1,provision:0,submits:0,receipts:0});
    else{expect(calls.provision).toBe(1);expect(calls.submits).toBeGreaterThan(0);expect(calls.receipts).toBeGreaterThan(0);expect(result.characterEvidence?.length).toBeGreaterThan(0);}
  });

  it('denies retry when an existing setup has a changed pinned boundary',async()=>{
    const ctx=context(),assignment=resolveInstalledWorkshopChain(raw('changed-setup') as Record<string,unknown>,ctx).assignment,doc=blueprint(assignment);let materialized=0;
    const control={async setup(){throw new Error('workshop_exists');},async inspect(){return{generation:2,boundaryFingerprint:'other',profileFingerprint:ctx.profile.fingerprint};},async materialize(){materialized++;},async enter(){},async provision(){throw new Error('unused');}};
    const game=new LiveWorkshopGame({command:async()=>'',close(){}},{request:async()=>({actors:{}})} as never,{} as never,()=>{},async()=>()=>{});
    (game as unknown as {control:typeof control}).control=control;
    (game as unknown as {resolveChainProfile:(id:string)=>Promise<ReturnType<typeof context>>}).resolveChainProfile=async()=>structuredClone(ctx);
    await expect(game.build({id:assignment.id,assignment,activeIteration:1} as never,doc,ctx.profile)).rejects.toThrow('boundary differs');
    expect(materialized).toBe(0);
  });
});
