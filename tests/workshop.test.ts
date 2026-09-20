import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { rationalFromDecimal, resolveWorkshopModels, validateRequest, validateWorkshopAssignment } from '@autofactorio/contracts';
import type { BlueprintDocument, BlueprintRevisionMetadata } from '@autofactorio/contracts';
import { billOfMaterials, blueprintContentHash, exportBlueprint, exportBlueprintBook, importBlueprint, normalizeBlueprint, sanitizedBundle, transformBlueprint } from '../packages/core/workshop/blueprint.js';
import { BlueprintLibrary } from '../packages/core/workshop/library.js';
import type { LibraryAdmission } from '../packages/core/workshop/library.js';
import { compileCharacterBlueprint, constructionBatches } from '../packages/core/workshop/construction.js';
import { DirectMaterializer } from '../packages/core/workshop/materializer.js';
import { SqliteJournal } from '../packages/storage/src/journal.js';
import { WorkshopControl, WorkshopMeasurementSession } from '../packages/factorio/src/workshop.js';
import { conservativeLower, evaluateWorkshop, requiredQuantity } from '../packages/core/workshop/evaluation.js';
import type { WorkshopScore, WorkshopWindowMeasurement } from '@autofactorio/contracts';
import { compareWorkshopScores, paretoDistinct, rawCostVector, scoreWorkshop, workshopRubricHash } from '../packages/core/workshop/scoring.js';
import { checkWorkshopCompatibility, currentRunRequest, installedFingerprint, presetRequest, resolveProfile } from '../packages/core/workshop/profiles.js';
import type { InstalledData } from '../packages/core/workshop/profiles.js';

const rate = (numerator: string, denominator = '1') => ({ numerator, denominator });
const withoutEntityId=(entity:BlueprintDocument['entities'][number])=>{const copy:Partial<BlueprintDocument['entities'][number]>={...entity};delete copy.id;return copy;};
const assignment = () => ({
  schema: 1, id: 'circuits', revision: 1, comparisonSeries: 'series-1', objective: 'Produce electronic circuits',
  source: { kind: 'brief', id: null, numericTargetText: '60 per minute' },
  ports: [
    { id:'iron',direction:'input',product:{kind:'item',name:'iron-plate',quality:'normal',surface:'nauvis'},position:{x:0,y:0},facing:0,transport:'belt',lane:1,rate:rate('1'),unit:'units-per-game-second',required:true },
    { id:'circuits',direction:'output',product:{kind:'item',name:'electronic-circuit',quality:'normal',surface:'nauvis'},position:{x:10,y:0},facing:8,transport:'belt',lane:1,rate:rate('1'),unit:'units-per-game-second',required:true },
  ],
  profileId:'starter-assembly',profileRevision:1,gameFingerprint:'a'.repeat(64),footprint:{width:32,height:16,clearance:2,maxTiles:512},construction:'direct',libraryAccess:true,improveRevision:null,
  requestedSpeed:rate('10'),settlingTicks:600,throughput:[{portId:'circuits',windowTicks:3600,windows:5,quantum:rate('1'),productionError:rate('0'),deliveryError:rate('0'),maxStockDrawdown:rate('2'),maxResidual:rate('1'),interval:'(startTick,endTick]'}],
  rubric:{version:'rubric-1',weights:{throughput:rate('1')},materiality:{throughput:rate('1','100')}},iterations:{attempts:5,mode:'maximum',earlyStop:true,plateauRounds:2},
  checkpoints:{brief:false,afterScore:false,libraryAdmission:false,learningActivation:false,timeoutMs:600000,timeoutAction:'finish'},budgets:{wallMs:3600000,gameTicks:216000,turns:30,toolCalls:200,reportedTokens:null,learningReservedTurns:3,learningReservedTools:12},
  models:{sessionDefault:{provider:'openai',modelId:'gpt-6-astra',reasoningEffort:'low'},overrides:{scorer:{provider:'openai',modelId:'gpt-5.6-sol',reasoningEffort:'medium'}}},
});
const blueprint = (): BlueprintDocument => ({schema:1,label:'Circuit cell',description:'Starter circuit cell',entities:[
  {id:'pole',entityNumber:8,name:'small-electric-pole',position:{x:2,y:0},direction:0,quality:'normal'},
  {id:'assembler',entityNumber:2,name:'assembling-machine-1',position:{x:0,y:0},direction:4,quality:'normal',recipe:'electronic-circuit',modules:{'speed-module':2},filters:[{index:1,name:'iron-plate',quality:'normal'}]},
],wires:[{from:{entityId:'assembler',connector:'5'},to:{entityId:'pole',connector:'5'},color:'copper'}],ports:validateWorkshopAssignment(assignment()).ports,icons:[{index:1,name:'electronic-circuit'}],tiles:[]});
const installed = (): InstalledData => ({
  gameVersion:'2.0.77',mods:{base:'2.0.77','space-age':'2.0.77'},items:['assembling-machine-1','transport-belt','underground-belt','splitter','inserter','wooden-chest','small-electric-pole','electromagnetic-plant','beacon'],modules:['speed-module'],
  technologies:[{id:'automation',prerequisites:[],effects:[{type:'unlock-recipe',recipe:'electronic-circuit'}]},{id:'logistics',prerequisites:[],effects:[]},{id:'modules',prerequisites:['automation'],effects:[]},{id:'electromagnetic-plant',prerequisites:['automation','modules'],effects:[]}],
  recipes:[{id:'electronic-circuit',category:'crafting',enabled:false,ingredients:[{type:'item',name:'iron-plate',amount:1}],products:[{type:'item',name:'electronic-circuit',amount:1}]},{id:'electrolyte',category:'chemistry',enabled:true,ingredients:[{type:'fluid',name:'water',amount:10,temperature:15}],products:[{type:'fluid',name:'electrolyte',amount:10,temperature:15},{type:'item',name:'stone',amount:1}]}],
  entities:[{id:'assembling-machine-1',type:'assembling-machine',craftingCategories:['crafting'],moduleSlots:0,surfaceConditions:[],settings:['recipe','direction']},{id:'electromagnetic-plant',type:'electromagnetic-plant',craftingCategories:['crafting'],moduleSlots:5,surfaceConditions:[],settings:['recipe','direction','modules']},{id:'chemical-plant',type:'chemical-plant',craftingCategories:['chemistry'],moduleSlots:3,surfaceConditions:[],settings:['recipe','direction','modules']},...['transport-belt','underground-belt','splitter','inserter','wooden-chest','small-electric-pole','beacon'].map(id=>({id,type:id==='beacon'?'beacon':'container',craftingCategories:[],moduleSlots:0,surfaceConditions:[],settings:['direction']}))],
  surfaces:{nauvis:{properties:{gravity:1},conditions:[]}},
});

describe('workshop contracts', () => {
  it('normalizes exact rates and resolves role model inheritance', () => {
    expect(rationalFromDecimal('60','minute')).toEqual({numerator:'1',denominator:'1'});
    const value=validateWorkshopAssignment(assignment()); expect(value.ports[1]?.rate).toEqual(rate('1'));
    expect(resolveWorkshopModels(value.models)).toEqual({designer:value.models.sessionDefault,scorer:value.models.overrides.scorer,learnings:value.models.sessionDefault});
  });
  it('rejects contradictions, incomplete throughput rules, rich identity errors and impossible policies', () => {
    expect(()=>validateWorkshopAssignment({...assignment(),source:{kind:'brief',id:null,numericTargetText:'61 per minute'}})).toThrow('Contradictory');
    expect(()=>validateWorkshopAssignment({...assignment(),throughput:[]})).toThrow('throughput');
    const rich=assignment(); rich.ports[1]!.product.quality='legendary'; expect(()=>validateWorkshopAssignment(rich)).toThrow('normal quality');
    expect(()=>validateWorkshopAssignment({...assignment(),iterations:{attempts:5,mode:'exact',earlyStop:true,plateauRounds:2}})).toThrow('Contradictory');
    expect(()=>validateWorkshopAssignment({...assignment(),budgets:{...assignment().budgets,learningReservedTurns:31}})).toThrow('reserve');
    const missing={...assignment()} as Record<string,unknown>; delete missing.models; expect(()=>validateWorkshopAssignment(missing)).toThrow('missing');
  });
});

describe('installed capability profiles', () => {
  it('retains the pinned installed API/prototype sample used by the profile boundary', async () => {
    const sample=JSON.parse(await readFile('tests/fixtures/workshop-installed-sample.json','utf8')) as { game:{version:string;build:number}; runtime:Record<string,string[]>; prototypes:Record<string,{moduleSlots?:number;prerequisites?:string[]}> };
    expect(sample.game).toMatchObject({version:'2.0.77',build:84539}); expect(sample.runtime.LuaEntity).toContain('set_recipe'); expect(sample.runtime.LuaEntity).toContain('get_wire_connector');
    expect(sample.prototypes['electromagnetic-plant']).toMatchObject({moduleSlots:5}); expect(sample.prototypes['electromagnetic-plant-technology']?.prerequisites).toEqual(['holmium-processing']);
  });
  it('resolves prerequisite closure, bonuses, presets and current-run snapshots against a fingerprint', () => {
    const data=installed(); const fingerprint=installedFingerprint(data); const request=presetRequest('electromagnetic-production',data); request.researchBonuses={productivity:3}; request.allowedEquipment.push('chemical-plant');
    const profile=resolveProfile(data,request,fingerprint); expect(profile.technologies).toEqual(['automation','electromagnetic-plant','modules']); expect(profile.researchBonuses).toEqual({productivity:3}); expect(profile.allowedEquipment).toContain('electromagnetic-plant'); expect(profile.locallyManufacturable).not.toContain('electromagnetic-plant');
    expect(currentRunRequest('snapshot',2,{technologies:['automation'],researchBonuses:{speed:2},surface:'nauvis',allowedEquipment:['assembling-machine-1']})).toMatchObject({source:'current-run',revision:2,researchBonuses:{speed:2}});
    const changed=installed(); changed.gameVersion='2.0.78'; expect(()=>resolveProfile(changed,request,fingerprint)).toThrow('fingerprint changed');
    expect(()=>resolveProfile(data,{...request,quality:'legendary' as 'normal'})).toThrow('normal quality');
  });
  it('keeps allowed placement distinct from local manufacture and checks surface legality', () => {
    const data=installed(); const request=presetRequest('starter-assembly',data); request.locallyManufacturable=['electromagnetic-plant']; expect(()=>resolveProfile(data,request)).toThrow('locally manufacturable');
    expect(()=>resolveProfile(data,{...request,surface:'vulcanus'})).toThrow('Unknown surface');
  });
});

describe('workshop compatibility matrix', () => {
  it('accepts deterministic solid/fluid/module/byproduct content and rejects unsupported mechanics explicitly', () => {
    const data=installed(); const request=presetRequest('electromagnetic-production',data); request.allowedEquipment.push('chemical-plant'); request.recipes=['electronic-circuit','electrolyte']; const profile=resolveProfile(data,request);
    const plant=data.entities.find(e=>e.id==='chemical-plant')!; const fluid=checkWorkshopCompatibility({entity:plant,recipe:data.recipes.find(r=>r.id==='electrolyte')!,quality:'normal',surface:'nauvis',settings:['recipe','modules']},profile,data);
    expect(fluid).toMatchObject({supported:true,products:[{kind:'fluid',name:'electrolyte',temperature:15},{kind:'item',name:'stone'}]});
    expect(checkWorkshopCompatibility({entity:plant,quality:'legendary',surface:'nauvis',settings:[]},profile,data)).toMatchObject({supported:false,code:'unsupported_quality'});
    for(const designKind of ['train','platform','mining','power-generation','circuit-program']) expect(checkWorkshopCompatibility({entity:plant,quality:'normal',surface:'nauvis',settings:[],designKind},profile,data)).toMatchObject({supported:false,code:`unsupported_${designKind}`});
    const stochastic={...data.recipes[0]!,products:[{...data.recipes[0]!.products[0]!,probability:0.5}]}; expect(checkWorkshopCompatibility({entity:data.entities[0]!,recipe:stochastic,quality:'normal',surface:'nauvis',settings:['recipe']},profile,data)).toMatchObject({supported:false,code:'unsupported_stochastic'});
    expect(checkWorkshopCompatibility({entity:plant,recipe:{...data.recipes[1]!,spoilage:true},quality:'normal',surface:'nauvis',settings:['recipe']},profile,data)).toMatchObject({supported:false,code:'unsupported_spoilage'});
  });
});

describe('canonical blueprint artifacts and library', () => {
  it('normalizes, hashes, transforms and round-trips supported configuration without mirroring', () => {
    const original=blueprint(),normalized=normalizeBlueprint(original); expect(normalized.entities.map(e=>e.id)).toEqual(['assembler','pole']); expect(normalized.entities.map(e=>e.entityNumber)).toEqual([1,2]);
    expect(blueprintContentHash({...original,label:'Renamed'})).toBe(blueprintContentHash(original)); expect(billOfMaterials(original)).toEqual({'assembling-machine-1':1,'small-electric-pole':1,'speed-module':2});
    const moved=transformBlueprint(original,{quarterTurns:1,translate:{x:10,y:5}}); expect(moved.entities.find(e=>e.id==='assembler')).toMatchObject({position:{x:10,y:5},direction:8}); expect(()=>transformBlueprint(original,{mirror:true})).toThrow('unsupported');
    const encoded=exportBlueprint(original),decoded=importBlueprint(encoded);expect(decoded.entities.map(withoutEntityId)).toEqual(normalized.entities.map(withoutEntityId));expect(decoded.wires.map(w=>({from:{...w.from,entityId:decoded.entities.find(e=>e.id===w.from.entityId)!.name},to:{...w.to,entityId:decoded.entities.find(e=>e.id===w.to.entityId)!.name},color:w.color}))).toEqual(normalized.wires.map(w=>({from:{...w.from,entityId:normalized.entities.find(e=>e.id===w.from.entityId)!.name},to:{...w.to,entityId:normalized.entities.find(e=>e.id===w.to.entityId)!.name},color:w.color})));expect(decoded.ports).toEqual([]);expect(exportBlueprintBook('Circuit variants',[original,moved])).toMatch(/^0/);
    expect(()=>normalizeBlueprint({...original,entities:[...original.entities,{...original.entities[0]!,id:'pole'}]})).toThrow('duplicate');
  });
  it('sanitizes portable metadata and admits immutable variants idempotently with rebuildable search', async () => {
    const root=await mkdtemp(path.join(tmpdir(),'autofactorio-library-')); const library=new BlueprintLibrary(root); const document=blueprint();
    const metadata:Omit<BlueprintRevisionMetadata,'revisionHash'>={schema:1,familyId:'electronic-circuit',variantId:'starter',parentHash:null,label:'Starter cell',product:{kind:'item',name:'electronic-circuit',quality:'normal',surface:'nauvis'},profileId:'starter-assembly',gameFingerprint:'a'.repeat(64),statuses:['export-valid','production-verified'],footprint:{width:12,height:8},machines:['assembling-machine-1'],rate:rate('1'),provenance:['session-1'],evidence:['measurement-1']};
    const admission=(value:BlueprintDocument,operationId:string,identity:Partial<Pick<BlueprintRevisionMetadata,'familyId'|'variantId'|'parentHash'|'label'>>={},profileId='starter-assembly'):LibraryAdmission=>{const artifactHash=blueprintContentHash(value),candidate={sessionId:'session-1',iteration:1,artifactHash,assignmentRevision:1,bundleHash:'baseline',evidence:['design-1']},rubric={version:'rubric-1',weights:{throughput:rate('1')},materiality:{throughput:rate('0')},directions:{throughput:'maximize' as const}};return{identity:{familyId:'electronic-circuit',variantId:'starter',parentHash:null,label:'Starter cell',...identity},document:value,proof:{score:{schema:1,candidate,rubricVersion:'rubric-1',eligible:true,dimensions:{throughput:{value:1,unit:'items',evidence:['measurement-1'],judgment:'measured'}},feedback:'verified',interactionFeedback:'',invalidReasons:[]},evaluation:{schema:1,attemptId:'session-1:1',valid:true,passed:true,reasons:[],ports:[],evidence:['measurement-1']},rubric,rubricHash:workshopRubricHash(rubric),profileId,gameFingerprint:'a'.repeat(64),outputPortId:'circuits',exportValid:true,characterBuildEvidence:null,compatibilityEvidence:['compatibility-1'],distinctionEvidence:['distinct-1'],admit:true},operationId};};
    try{const first=library.admit(admission(document,'admit-1'));const repeated=library.admit(admission(document,'admit-1',{label:'Different display name'}));expect(repeated.revisionHash).toBe(first.revisionHash);expect(()=>library.admit(admission(transformBlueprint(document,{translate:{x:1,y:0}}),'admit-1'))).toThrow('different revision');const forged=admission(document,'forged');forged.proof.score.eligible=false;expect(()=>library.admit(forged)).toThrow('eligible');expect(library.search({product:'electronic-circuit',profileId:'starter-assembly',status:'production-verified'})).toHaveLength(1);
      const emDocument={...document,entities:document.entities.map(e=>e.id==='assembler'?{...e,name:'electromagnetic-plant'}:e)};library.admit(admission(emDocument,'admit-2',{variantId:'em',label:'EM cell'},'electromagnetic-production'));expect(library.search({product:'electronic-circuit'})).toHaveLength(2);expect(library.search({profileId:'electromagnetic-production'})[0]).toMatchObject({variantId:'em'});
      library.rename(first.revisionHash,'Renamed cell');expect(library.search({machine:'assembling-machine-1'})[0]).toMatchObject({variantId:'starter',label:'Renamed cell'});expect(await library.rebuild()).toBe(2);expect(library.search({gameFingerprint:'a'.repeat(64)})).toHaveLength(2);
      const portable=sanitizedBundle(document,{...metadata,revisionHash:first.revisionHash});expect(JSON.stringify(portable)).not.toMatch(/providerTranscript|credential|fixture/);
    }finally{library.close();await rm(root,{recursive:true,force:true});}
  });
  it('compares eligible scores with frozen weights, directions, materiality and unknown handling',()=>{const candidate={sessionId:'s',iteration:1,artifactHash:'a',assignmentRevision:1,bundleHash:'b',evidence:[]};const score=(throughput:number|null,space:number|null):WorkshopScore=>({schema:1,candidate,rubricVersion:'r',eligible:true,dimensions:{throughput:{value:throughput,unit:'items',evidence:[],judgment:throughput===null?'unknown':'measured'},space:{value:space,unit:'tiles',evidence:[],judgment:space===null?'unknown':'derived'}},feedback:'',interactionFeedback:'',invalidReasons:[]});const rubric={version:'r',weights:{throughput:rate('1'),space:rate('10')},materiality:{throughput:rate('1','100'),space:rate('1')},directions:{throughput:'maximize' as const,space:'minimize' as const}};expect(compareWorkshopScores(score(9,50),score(10,100),rubric)).toBe(1);expect(compareWorkshopScores(score(10,100),score(10.005,100.5),rubric)).toBe(0);expect(compareWorkshopScores(score(10,100),score(null,100),rubric)).toBe(1);});
});

describe('character blueprint compilation', () => {
  it('plans bounded legal placement/configuration batches from actual inventory', () => {
    const plan=compileCharacterBlueprint(blueprint(),{'assembling-machine-1':1,'small-electric-pole':1,'speed-module':2},()=>true);expect(plan.required).toEqual({'assembling-machine-1':1,'small-electric-pole':1,'speed-module':2});expect(plan.steps.map(s=>s.kind)).toEqual(expect.arrayContaining(['walk','place','recipe','module','filter','wire']));
    const batches=constructionBatches(plan,{commandPrefix:'build',epoch:'e',session:'s',task:'t',revision:1,actor:'builder-1',surface:'nauvis',grants:[{id:'a',generation:1},{id:'b',generation:1},{id:'c',generation:1}],deadline:1000},4);expect(batches.length).toBeGreaterThan(1);expect(batches.every(b=>b.steps.length<=4)).toBe(true);expect(new Set(batches.map(b=>b.commandId)).size).toBe(batches.length);for(const batch of batches){expect(batch).not.toHaveProperty('commandPrefix');expect(()=>validateRequest({op:'submit',batch})).not.toThrow();}
  });
  it('rejects insufficient inventory and inaccessible work positions before mutation', () => {
    expect(()=>compileCharacterBlueprint(blueprint(),{'assembling-machine-1':1,'small-electric-pole':1,'speed-module':1},()=>true)).toThrow('Insufficient material');
    expect(()=>compileCharacterBlueprint(blueprint(),{'assembling-machine-1':1,'small-electric-pole':1,'speed-module':2},()=>false)).toThrow('Unreachable work position');
  });
  it('validates paired underground belts and compiles supported entity settings',()=>{
    const document:BlueprintDocument={schema:1,label:'settings',description:'paired underground',ports:[],icons:[],tiles:[],wires:[],entities:[
      {id:'in',entityNumber:1,name:'underground-belt',position:{x:0,y:0},direction:4,quality:'normal',undergroundType:'input'},
      {id:'out',entityNumber:2,name:'underground-belt',position:{x:3,y:0},direction:4,quality:'normal',undergroundType:'output'},
      {id:'split',entityNumber:3,name:'splitter',position:{x:5,y:0},direction:4,quality:'normal',settings:{splitter_output_priority:'right'}},
    ]};
    const plan=compileCharacterBlueprint(document,{'underground-belt':2,splitter:1},()=>true);expect(plan.steps.filter(v=>v.kind==='setting')).toHaveLength(3);
    expect(()=>compileCharacterBlueprint({...document,entities:document.entities.slice(0,1)},{'underground-belt':1},()=>true)).toThrow('Unconnected underground belt');
    expect(()=>compileCharacterBlueprint({...document,entities:[{...document.entities[2]!,settings:{circuit_program:'unsafe'}}]},{splitter:1},()=>true)).toThrow('Unsupported character setting');
  });
});

describe('durable direct materialization', () => {
  it('cancels before dispatch and reconciles a lost acknowledgement without duplicate effects', async () => {
    const root=await mkdtemp(path.join(tmpdir(),'autofactorio-materializer-'));const journal=new SqliteJournal(path.join(root,'runtime.sqlite'));const context=()=>({run:'run',epoch:'epoch',wallTime:new Date().toISOString(),gameTick:null,actor:null,task:null,causation:null,correlation:null,visibility:{kind:'operator'} as const});let effects=0,lose=true;const receipts=new Map<string,Record<string,unknown>>();
    const port={materialize:async(_id:string,_generation:number,operationId:string)=>{const prior=receipts.get(operationId);if(prior)return prior;effects++;const receipt={ok:true,operationId,entities:{assembler:{unit:1}}};receipts.set(operationId,receipt);if(lose){lose=false;throw new Error('lost response');}return receipt;},inspect:async()=>({ok:true,entities:[{unit:1}]})};const service=new DirectMaterializer(journal,context,port);
    try{service.intent({id:'cancel',workshop:'w',generation:1,artifactHash:'a',document:blueprint()});service.cancel('cancel');expect(journal.get<{state:string}>('run','workshopOperations','cancel')).toMatchObject({state:'cancelled'});
      service.intent({id:'build',workshop:'w',generation:1,artifactHash:'b',document:blueprint()});await expect(service.dispatch('build')).rejects.toThrow('lost response');const recovered=await service.reconcile('build');expect(recovered.state).toBe('completed');expect(effects).toBe(1);expect(journal.events().filter(e=>e.type==='workshop/materialization-reconciled')).toHaveLength(1);
    }finally{journal.close();await rm(root,{recursive:true,force:true});}
  });
});

describe('workshop operator receipts', () => {
  it('requires a complete idempotent inventory replenishment receipt', async () => {
    let response:Record<string,unknown>={ok:true,operationId:'provision-1',tick:42,before:[],after:[{name:'assembling-machine-1',quality:'normal',count:1}]};const port={command:async()=>JSON.stringify(response),close:()=>{}};const control=new WorkshopControl(port);
    await expect(control.provision('workshop','builder-1','provision-1',[{name:'assembling-machine-1',quality:'normal',count:1}])).resolves.toMatchObject({tick:42,operationId:'provision-1'});response={ok:true,operationId:'provision-1',tick:42};await expect(control.provision('workshop','builder-1','provision-1',[])).rejects.toThrow('Incomplete provision receipt');
  });
  it('invalidates a disconnected measurement and refuses scoring after budget closure',async()=>{
    let disconnected=true;const port={command:async()=>{if(disconnected)throw new Error('RCON disconnected');return JSON.stringify({ok:true,tick:1,state:'scoring',finished:false,samples:[],requestedSpeed:1,achievedSpeed:1});},close:()=>{}};const session=new WorkshopMeasurementSession(new WorkshopControl(port),'w','a');await expect(session.poll()).rejects.toThrow('disconnected');expect(session).toMatchObject({state:'invalid',reason:expect.stringContaining('measurement_disconnect')});disconnected=false;await expect(session.poll()).rejects.toThrow('closed');
    const closed=new WorkshopMeasurementSession(new WorkshopControl(port),'w','b');closed.close('budget_closed');await expect(closed.poll()).rejects.toThrow('closed');expect(closed.samples).toHaveLength(0);
  });
});

describe('independent workshop evaluation', () => {
  const windows=(values:number[],options:{delivery?:number[];opening?:number;closing?:number;residual?:number;coverage?:'complete'|'partial';contamination?:string[];connected?:boolean;energy?:'complete'|'unknown';duplicate?:boolean}={}):WorkshopWindowMeasurement[]=>values.map((production,index)=>({schema:1,attemptId:'attempt-1',index,startTick:600+index*3600,endTick:600+(index+1)*3600,interval:'(startTick,endTick]',ports:[{portId:'circuits',product:{kind:'item',name:'electronic-circuit',quality:'normal',surface:'nauvis'},production:rate(String(production)),delivery:rate(String(options.delivery?.[index]??production)),openingStock:rate(String(options.opening??0)),closingStock:rate(String(options.closing??0)),residual:rate(String(options.residual??0)),productionAllocationId:options.duplicate?'shared':`cell-${index}`,coverage:options.coverage??'complete',evidence:[`port-${index}`]}],stageCoverage:'complete',energyCoverage:options.energy??'complete',contamination:options.contamination??[],mutationsFrozen:true,connected:options.connected??true,evidence:[`window-${index}`]}));
  it('uses exact item and fluid quantization at lower-bound thresholds',()=>{
    expect(requiredQuantity(rate('601','600'),3600,rate('1'))).toEqual(rate('61'));expect(conservativeLower(rate('5999','100'),rate('0'),rate('1'))).toEqual(rate('59'));
    expect(conservativeLower(rate('1005','1000'),rate('5','1000'),rate('1','100'))).toEqual(rate('1'));expect(conservativeLower(rate('1004','1000'),rate('5','1000'),rate('1','100'))).toEqual({numerator:'99',denominator:'100'});
  });
  it('requires production and delivery in every window and rejects burst, preload, hidden/manual contamination and missing coverage',()=>{
    const manifest=validateWorkshopAssignment(assignment());expect(evaluateWorkshop(manifest,windows([60,60,60,60,60]))).toMatchObject({valid:true,passed:true});
    const burst=evaluateWorkshop(manifest,windows([300,0,0,0,0]));expect(burst).toMatchObject({valid:true,passed:false,reasons:['sustained_target_failed']});expect(burst.ports[0]!.windows[1]).toMatchObject({passed:false,reasons:['production_below_target','delivery_below_target']});
    expect(evaluateWorkshop(manifest,windows([60,60,60,60,60],{delivery:[59,60,60,60,60]})).passed).toBe(false);expect(evaluateWorkshop(manifest,windows([60,60,60,60,60],{opening:100,closing:0}))).toMatchObject({valid:true,passed:false});
    for(const altered of [windows([60,60,60,60,60],{coverage:'partial'}),windows([60,60,60,60,60],{contamination:['manual-output']}),windows([60,60,60,60,60],{connected:false}),windows([60,60,60,60,60],{energy:'unknown'})])expect(evaluateWorkshop(manifest,altered).valid).toBe(false);
  });
  it('prevents duplicate production allocation across output ports',()=>{
    const manifest=validateWorkshopAssignment({...assignment(),ports:[...assignment().ports,{...assignment().ports[1]!,id:'circuits-2',position:{x:10,y:2}}],throughput:[...assignment().throughput,{...assignment().throughput[0]!,portId:'circuits-2'}]});const measured=windows([60,60,60,60,60],{duplicate:true}).map(w=>({...w,ports:[...w.ports,{...w.ports[0]!,portId:'circuits-2'}]}));expect(evaluateWorkshop(manifest,measured)).toMatchObject({valid:false,passed:false,reasons:expect.arrayContaining(['duplicate_production_allocation'])});
  });
});

describe('deterministic workshop scoring', () => {
  it('derives itemized/raw costs, measured expansion scales and separate interaction feedback',()=>{
    const manifest=validateWorkshopAssignment(assignment()),evaluation=evaluateWorkshop(manifest,[60,60,60,60,60].map((production,index)=>({schema:1,attemptId:'attempt-1',index,startTick:600+index*3600,endTick:600+(index+1)*3600,interval:'(startTick,endTick]' as const,ports:[{portId:'circuits',product:{kind:'item' as const,name:'electronic-circuit',quality:'normal' as const,surface:'nauvis'},production:rate(String(production)),delivery:rate(String(production)),openingStock:rate('0'),closingStock:rate('0'),residual:rate('0'),productionAllocationId:`cell-${index}`,coverage:'complete' as const,evidence:[]}],stageCoverage:'complete' as const,energyCoverage:'complete' as const,contamination:[],mutationsFrozen:true,connected:true,evidence:[]})));
    const score=scoreWorkshop({sessionId:'s',iteration:1,assignmentRevision:1,bundleHash:'bundle',document:blueprint(),evaluation,rubricVersion:'r1',routes:[{item:'assembling-machine-1',recipe:'assembler',amount:1,ingredients:[{name:'iron-plate',amount:9}],productAmount:1},{item:'small-electric-pole',recipe:'pole',amount:1,ingredients:[{name:'wood',amount:2},{name:'copper-plate',amount:2}],productAmount:1},{item:'speed-module',recipe:'speed',amount:1,ingredients:[{name:'electronic-circuit',amount:5}],productAmount:1}],rawResources:['iron-plate','wood','copper-plate','electronic-circuit'],expansion:[1,2,3,4].map(scale=>({scale:scale as 1|2|3|4,passed:scale<=3,removed:0,replaced:0,connections:scale,evidence:[`expand-${scale}`]})),energy:20,inputs:{iron:1,copper:3},outputs:{circuit:2},interaction:{rejectedCalls:1,rebuilds:2,unknownOutcomes:1,toolCalls:12,reportedTokens:null,evidence:['interaction']}});expect(score).toMatchObject({eligible:true,dimensions:{expandability:{value:3,judgment:'measured'},constructionCost:{judgment:'derived'},aesthetics:{judgment:'subjective'},interactionQuality:{value:4}},interactionFeedback:expect.stringContaining('reported tokens unknown')});
    expect(rawCostVector({'mystery-machine':1},[],['iron-plate'])).toEqual({vector:{},unknown:['mystery-machine'],recipes:[]});
  });
  it('preserves Pareto/interface tradeoffs instead of selecting a universal winner',()=>{
    const base:WorkshopScore={schema:1,candidate:{sessionId:'s',iteration:1,artifactHash:'a',assignmentRevision:1,bundleHash:'b',evidence:[]},rubricVersion:'r',eligible:true,dimensions:{space:{value:10,unit:'tiles',evidence:[],judgment:'derived'},constructionCost:{value:20,unit:'raw',evidence:[],judgment:'derived'}},feedback:'',interactionFeedback:'',invalidReasons:[]};const alternative:WorkshopScore={...base,candidate:{...base.candidate,artifactHash:'c'},dimensions:{space:{...base.dimensions.space!,value:20},constructionCost:{...base.dimensions.constructionCost!,value:10}}};expect(paretoDistinct(base,alternative,['space','constructionCost'])).toBe(true);
  });
});
