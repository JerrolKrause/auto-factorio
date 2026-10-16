import { describe, expect, it } from 'vitest';
import { defaultWorkshopChainSetup } from '@autofactorio/contracts';
import type { MachineFact, ProductionAvailability, ProductionCatalog, ProductionProduct, RecipeFact } from '@autofactorio/contracts';
import { installedChainContext, type InstalledChainContext, type InstalledChainPreset } from '../packages/core/workshop/installed-chain.js';
import { workshopSetupRequest } from '../apps/runtime/workshop-chain-setup.js';
import { resolveInstalledWorkshopChain } from '../apps/runtime/workshop-chain-resolution.js';
import { workshopChainDesignInput } from '../apps/runtime/workshop-chain-design.js';

const item=(name:string):ProductionProduct=>({kind:'item',name,quality:'normal',surface:'nauvis'});
const fluid=(name:string):ProductionProduct=>({kind:'fluid',name,quality:'normal',surface:'nauvis'});
const flow=(product:ProductionProduct,amount:number)=>({type:product.kind,name:product.name,amount});
const recipe=(name:string,category:string,inputs:[ProductionProduct,number][],outputs:[ProductionProduct,number][]):RecipeFact=>({id:`recipe:${name}`,name,category,seconds:1,ingredients:inputs.map(([product,amount])=>flow(product,amount)),products:outputs.map(([product,amount])=>flow(product,amount)),unlocks:[],surfaceConditions:[]});
const pipe={connection_type:'pipe',direction:0,flow_direction:'input',positions:[{x:0,y:0}],connection_category:['default']};
const machine=(name:string,category:string):MachineFact=>({id:`machine:${name}`,name,type:'assembling-machine',categories:[category],speed:1,ingredientLimit:20,collisionBox:[{x:-1,y:-1},{x:1,y:1}],fluidBoxes:Array.from({length:6},(_,index)=>({index:index+1,productionType:'input-output' as const,volume:100,connections:[pipe]})),placementItems:[name],energy:{kind:'electric',maxJoulesPerTick:0,drainJoulesPerTick:0},baseEffects:{},surfaceConditions:[]});
const recipes=[recipe('basic-oil-processing','oil-processing',[[fluid('crude-oil'),100]],[[fluid('petroleum-gas'),45],[fluid('light-oil'),25],[fluid('heavy-oil'),10]]),recipe('sulfur','chemistry',[[fluid('petroleum-gas'),30],[fluid('water'),30]],[[item('sulfur'),2]])];
const catalog:ProductionCatalog={schema:1,mods:{base:'2.0.77',space_age:'2.0.77'},fingerprint:'a'.repeat(64),products:[...['crude-oil','petroleum-gas','light-oil','heavy-oil','water'].map(name=>({id:`fluid:${name}`,kind:'fluid' as const,name})),...['sulfur','oil-refinery','chemical-plant','pipe','storage-tank'].map(name=>({id:`item:${name}`,kind:'item' as const,name}))],recipes,machines:[machine('oil-refinery','oil-processing'),machine('chemical-plant','chemistry')]};
const snapshot={catalog,availability:{tick:0,force:'player',researched:[],surfaceProperties:{pressure:1000},recipes:Object.fromEntries(recipes.map(row=>[row.name,{enabled:true,productivity:0}]))} satisfies ProductionAvailability,availabilityRevision:'b'.repeat(64)};
const preset=(changes:Partial<InstalledChainPreset>={}):InstalledChainPreset=>({schema:1,gameVersion:'2.0.77',mods:{base:'2.0.77',space_age:'2.0.77'},profileId:'production-chain',profileRevision:4,surface:'nauvis',technologies:['sulfur-processing'],recipes:['basic-oil-processing','sulfur'],allowedEquipment:['oil-refinery','chemical-plant','pipe','storage-tank'],...changes});
const context=(p=preset(),s:InstalledChainContext['snapshot']=snapshot)=>installedChainContext(p,s);
const setup={target:'sulfur',rate:'2.5',inputs:'crude-oil 100\nwater 100',sinks:'light-oil 25\nheavy-oil 10',electricityMW:'3.75',equipment:'oil-refinery 5\nchemical-plant 10\npipe 200\nstorage-tank 20',oilRoute:'basic' as const};
const assignment=(changes:Record<string,unknown>={})=>({schema:1,id:'chain-setup',revision:1,comparisonSeries:'series-chain-setup',objective:'Produce sulfur from raw supplies',source:{kind:'brief',id:null},profileId:'production-chain',productionMode:'chain',construction:'direct',libraryAccess:false,improveRevision:null,requestedSpeed:{numerator:'10',denominator:'1'},settlingTicks:0,windowTicks:60,windows:1,rubric:{version:'rubric-1',weights:{throughput:{numerator:'1',denominator:'1'}},materiality:{throughput:{numerator:'0',denominator:'1'}},directions:{throughput:'maximize'}},iterations:{attempts:1,mode:'exact',earlyStop:false,plateauRounds:1},checkpoints:{brief:false,afterScore:false,libraryAdmission:false,learningActivation:false,timeoutMs:1000,timeoutAction:'finish'},budgets:{wallMs:60000,gameTicks:600,turns:3,toolCalls:8,reportedTokens:1000,learningReservedTurns:0,learningReservedTools:0},models:{sessionDefault:{provider:'openai',modelId:'gpt-6-astra',reasoningEffort:'low'},overrides:{}},learning:{cadence:'off',batchSessions:2,candidateCap:2,attemptsPerCandidate:1,autoActivate:false},...changes});

describe('host-pinned production chain setup',()=>{
  it('turns human rates and boundaries into a request pinned only from installed profile and facts',()=>{
    const ctx=context(),request=workshopSetupRequest(setup,ctx);
    expect(request).toMatchObject({schema:1,mode:'rate',target:item('sulfur'),rate:{numerator:'25',denominator:'10',unit:'items-per-game-second'},profile:{id:ctx.profile.id,revision:ctx.profile.revision,fingerprint:ctx.profile.fingerprint,recipes:ctx.profile.recipes,equipment:ctx.profile.allowedEquipment},facts:{id:`production.${catalog.fingerprint}`,fingerprint:catalog.fingerprint,availabilityRevision:ctx.snapshot.availabilityRevision},initialStock:[],externalInputs:[{product:fluid('crude-oil'),capacity:{kind:'rate',numerator:'100',denominator:'1'}},{product:fluid('water'),capacity:{kind:'rate',numerator:'100',denominator:'1'}}],utilities:{electricityWatts:3750000},constructionEquipment:{'oil-refinery':5,'chemical-plant':10,pipe:200,'storage-tank':20},sinks:[{product:fluid('light-oil'),capacity:{kind:'rate',numerator:'25',denominator:'1'}},{product:fluid('heavy-oil'),capacity:{kind:'rate',numerator:'10',denominator:'1'}}]});
    expect(resolveInstalledWorkshopChain(assignment({profileId:ctx.profile.id,chainSetup:setup}) as Record<string,unknown>,ctx).assignment.chainRequest).toEqual(request);
  });
  it.each([
    ['raw-only supply denial',{...setup,inputs:'sulfur 1'}],
    ['duplicate supply rows',{...setup,inputs:'crude-oil 1\ncrude-oil 2'}],
    ['oversize fields',{...setup,inputs:'x'.repeat(8193)}],
    ['malformed finite rate',{...setup,rate:'Infinity'}],
    ['unknown product',{...setup,target:'not-installed'}],
  ])('rejects %s before plan creation',(_label,value)=>expect(()=>workshopSetupRequest(value,context())).toThrow());
  it('rejects unknown or ambiguous installed products and disallowed equipment',()=>{
    const ctx=context();
    expect(()=>workshopSetupRequest({...setup,target:'missing'},ctx)).toThrow('Unknown or ambiguous installed product');
    const ambiguous={...snapshot,catalog:{...catalog,products:[...catalog.products,{id:'duplicate:sulfur',kind:'item' as const,name:'sulfur'}]}};
    expect(()=>workshopSetupRequest(setup,context(preset(),ambiguous))).toThrow('Unknown or ambiguous installed product');
    expect(()=>workshopSetupRequest({...setup,equipment:'oil-refinery 1\nchemical-plant 1\npipe 1\nstorage-tank 1\nwooden-chest 1'},ctx)).toThrow('Profile-denied equipment');
    expect(()=>context(preset({profileId:'unrecognized'}))).toThrow('Invalid installed chain preset');
  });
  it('rejects caller-supplied request or boundary alongside human setup',()=>{
    const ctx=context(),request=workshopSetupRequest(setup,ctx);
    expect(()=>resolveInstalledWorkshopChain(assignment({profileId:ctx.profile.id,chainSetup:setup,chainRequest:request}) as Record<string,unknown>,ctx)).toThrow('cannot override');
    expect(()=>resolveInstalledWorkshopChain(assignment({profileId:ctx.profile.id,chainSetup:setup,ports:[]}) as Record<string,unknown>,ctx)).toThrow('cannot override');
  });
  it('does not add an oil route or oil stages to an installed starter iron chain',()=>{
    const ore=item('iron-ore'),plate=item('iron-plate'),coal=item('coal');
    const ironRecipe=recipe('iron-plate','smelting',[[ore,1]],[[plate,1]]);
    const furnace:MachineFact={id:'machine:stone-furnace',name:'stone-furnace',type:'furnace',categories:['smelting'],speed:1,ingredientLimit:2,collisionBox:[{x:-1,y:-1},{x:1,y:1}],fluidBoxes:[],placementItems:['stone-furnace'],energy:{kind:'burner',maxJoulesPerTick:1,drainJoulesPerTick:0,effectivity:1,fuelCategories:['chemical']},baseEffects:{},surfaceConditions:[]};
    const equipment=['stone-furnace','transport-belt','inserter','small-electric-pole'];
    const ironCatalog:ProductionCatalog={schema:1,mods:{base:'2.0.77',space_age:'2.0.77'},fingerprint:'c'.repeat(64),products:[ore,plate,coal,...equipment.map(item)].map(product=>({id:`${product.kind}:${product.name}`,kind:product.kind,name:product.name,...(product.name==='coal'?{fuelValue:60,fuelCategory:'chemical'}:{})})),recipes:[ironRecipe],machines:[furnace]};
    const ironSnapshot={catalog:ironCatalog,availability:{tick:0,force:'player',researched:[],surfaceProperties:{pressure:1000},recipes:{'iron-plate':{enabled:true,productivity:0}}},availabilityRevision:'d'.repeat(64)};
    const ctx=context(preset({profileId:'starter-assembly',technologies:['automation'],recipes:['iron-plate'],allowedEquipment:equipment}),ironSnapshot);
    const ironSetup={target:'iron-plate',rate:'1',inputs:'iron-ore 10\ncoal 1',sinks:'',electricityMW:'1',equipment:'stone-furnace 5\ntransport-belt 20\ninserter 10\nsmall-electric-pole 10',oilRoute:'basic' as const};
    const resolved=resolveInstalledWorkshopChain(assignment({profileId:ctx.profile.id,chainSetup:ironSetup}) as Record<string,unknown>,ctx);
    expect(resolved.chain.request.routes).not.toHaveProperty('fluid:petroleum-gas');
    expect(resolved.chain.stages.map(stage=>stage.recipe)).toEqual(['iron-plate']);
    expect(resolved.chain.stages.some(stage=>/oil|chemical/.test(stage.recipe))).toBe(false);
  });
  it('resolves default sulfur setup with installed equipment and petroleum-only basic refining',()=>{
    const extraEquipment=['pipe-to-ground','small-electric-pole','transport-belt','inserter'];
    const basic=recipe('basic-oil-processing','oil-processing',[[fluid('crude-oil'),100]],[[fluid('petroleum-gas'),45]]);
    const actualLikeCatalog:ProductionCatalog={...catalog,products:[...catalog.products,...extraEquipment.map(name=>({id:`item:${name}`,kind:'item' as const,name}))],recipes:[basic,recipes.find(row=>row.name==='sulfur')!]};
    const actualLikeSnapshot={...snapshot,catalog:actualLikeCatalog,availability:{...snapshot.availability,recipes:Object.fromEntries(actualLikeCatalog.recipes.map(row=>[row.name,{enabled:true,productivity:0}]))}};
    const permitted=['oil-refinery','chemical-plant','pipe','pipe-to-ground','small-electric-pole','transport-belt','inserter'];
    const ctx=context(preset({allowedEquipment:permitted}),actualLikeSnapshot);
    expect(defaultWorkshopChainSetup.equipment).not.toContain('storage-tank');
    const request=workshopSetupRequest(defaultWorkshopChainSetup,ctx);
    expect(request.constructionEquipment).not.toHaveProperty('storage-tank');
    const resolved=resolveInstalledWorkshopChain(assignment({profileId:ctx.profile.id,chainSetup:defaultWorkshopChainSetup}) as Record<string,unknown>,ctx);
    expect(resolved.chain.request.routes).toHaveProperty('fluid:petroleum-gas','recipe:basic-oil-processing');
    expect(resolved.chain.stages.map(stage=>stage.recipe).sort()).toEqual(['basic-oil-processing','sulfur']);
    expect(resolved.assignment.ports.filter(port=>port.direction==='byproduct')).toEqual([]);
    expect(JSON.stringify(resolved.chain.stages)).not.toMatch(/light-oil|heavy-oil/);
  });
  it('builds a bounded public design input from the selected installed plan',()=>{
    const ctx=context(),resolved=resolveInstalledWorkshopChain(assignment({profileId:ctx.profile.id,chainSetup:setup}) as Record<string,unknown>,ctx);
    const input=workshopChainDesignInput(resolved);
    expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThanOrEqual(96000);
    expect(input).toMatchObject({plan:{id:resolved.chain.plan.id,revision:resolved.chain.plan.revision,fingerprint:resolved.chain.plan.fingerprint,availabilityRevision:resolved.chain.plan.availabilityRevision,routes:resolved.chain.plan.routes,stages:expect.any(Array),balances:expect.any(Array),assumptions:expect.any(Array),transport:expect.anything()},request:resolved.chain.request,stageInterfaces:expect.any(Array),ports:resolved.chain.ports,profile:resolved.profile,connectivity:'unverified'});
    expect(input.plan.stages.length).toBeGreaterThan(0);
    expect(input.installed.machines).toEqual(expect.arrayContaining([expect.objectContaining({name:'oil-refinery',collisionBox:expect.any(Array),fluidBoxes:expect.any(Array)}),expect.objectContaining({name:'chemical-plant',collisionBox:expect.any(Array),fluidBoxes:expect.any(Array)})]));
    expect(input.ports.map(port=>port.product.name)).toEqual(expect.arrayContaining(['crude-oil','water','sulfur','light-oil','heavy-oil']));
  });
  it('rejects an oversized public design input without changing its resolved source',()=>{
    const ctx=context(),resolved=resolveInstalledWorkshopChain(assignment({profileId:ctx.profile.id,chainSetup:setup}) as Record<string,unknown>,ctx),before=JSON.stringify(resolved);
    const oversized=structuredClone(resolved);
    (oversized.chain.plan as unknown as {assumptions:unknown}).assumptions=['x'.repeat(96001)];
    expect(()=>workshopChainDesignInput(oversized)).toThrow('96000-byte');
    expect(JSON.stringify(resolved)).toBe(before);
  });
});
