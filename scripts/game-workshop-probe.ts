import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BlueprintDocument } from '@autofactorio/contracts';
import { WorkshopControl } from '../packages/factorio/src/workshop.js';
import { wrapper } from '../packages/factorio/src/rcon.js';
import { createProfile, startServer, stopProfile, waitForServer } from './dev/game-processes.js';
import type { CapabilityProfile } from '../packages/core/workshop/profiles.js';

const profile=await createProfile(false,true);const evidence=await mkdtemp(path.join(profile.dir,'workshop-probe-'));const checks:string[]=[];let failure:string|null=null;let installedGameVersion:string|undefined;let prototypeEvidence:WorkshopPrototypeEvidence|undefined;const recipeMatrix:RecipeMatrixObservation[]=[];let port:Awaited<ReturnType<typeof waitForServer>>|undefined;const pass=(message:string)=>{checks.push(message);console.log(message);};
const count=(value:unknown)=>Array.isArray(value)?value.length:value&&typeof value==='object'?Object.keys(value).length:0;
console.log(JSON.stringify({evidence,profile:profile.config}));const events=(event:unknown)=>appendFileSync(path.join(evidence,'events.jsonl'),JSON.stringify(event)+'\n');
type WorkshopPrototypeEvidence={entities:Record<string,{type:string;craftingCategories:string[]}>,recipes:Record<string,{category:string}>};
type RecipeMatrixObservation={id:string;entityName:string;entityType:string;craftingCategories:string[];recipeName:string;recipeCategory:string;annotation:'compatible'|'incompatible'|'invalid-noncrafting';expected:'accepted'|'rejected';outcome:'not-run'|'accepted'|'rejected'|'skipped';reason?:string};
const coverageLimits=[
  'The recipe matrix is limited to the named assembler, furnace, pole and belt prototypes and the named recipes; it is not an exhaustive entity or recipe-category survey.',
  'Steel-furnace and copper-plate matrix cases are recorded as skipped when their installed prototypes are absent.',
  'Furnace recipe annotations are checked for placement validity; only the separate stone-furnace iron-plate case observes physical smelting with explicitly inserted ore and fuel.',
];
const capability:CapabilityProfile={schema:1,id:'live-workshop',revision:1,fingerprint:'live-game-probe',source:'custom',technologies:['automation','automation-2','electronics','modules','speed-module'],researchBonuses:{},recipes:['electronic-circuit','iron-plate','copper-plate'],allowedEquipment:['assembling-machine-2','stone-furnace','steel-furnace','small-electric-pole','transport-belt','speed-module','underground-belt'],locallyManufacturable:[],modules:['speed-module'],beacons:[],quality:'normal',surface:'nauvis'};
let document:BlueprintDocument;
try{
  await startServer(profile);port=await waitForServer(profile);await port.command('/silent-command rcon.print("workshop console authorization")');await port.command('/silent-command rcon.print("workshop console ready")');const wireIds=JSON.parse(await port.command('/silent-command rcon.print(helpers.table_to_json(defines.wire_connector_id))')) as {pole_copper:number};const control=new WorkshopControl(port);
  document={schema:1,label:'Live workshop cell',description:'Direct materialization smoke',entities:[
    {id:'assembler',entityNumber:1,name:'assembling-machine-2',position:{x:0,y:0},direction:0,quality:'normal',recipe:'electronic-circuit',modules:{'speed-module':1}},
    {id:'pole-a',entityNumber:2,name:'small-electric-pole',position:{x:4,y:0},direction:0,quality:'normal'},
    {id:'pole-b',entityNumber:3,name:'small-electric-pole',position:{x:7,y:0},direction:0,quality:'normal'},
    {id:'underground-in',entityNumber:4,name:'underground-belt',position:{x:0,y:5},direction:4,quality:'normal',undergroundType:'input'},
    {id:'underground-out',entityNumber:5,name:'underground-belt',position:{x:3,y:5},direction:4,quality:'normal',undergroundType:'output'},
  ],wires:[{from:{entityId:'pole-a',connector:String(wireIds.pole_copper)},to:{entityId:'pole-b',connector:String(wireIds.pole_copper)},color:'copper'}],ports:[],icons:[{index:1,name:'electronic-circuit'}],tiles:[]};
  const installed=await control.installedProfile('starter-assembly','electronic-circuit');installedGameVersion=installed.gameVersion;events({installed});await writeFile(path.join(evidence,'installed-profile.json'),JSON.stringify(installed,null,2));assert.match(installed.gameVersion,/^2\./);assert.equal(installed.recipe.id,'electronic-circuit');assert(installed.recipe.ingredients.some(value=>value.name==='iron-plate'));assert(installed.allowedEquipment.includes(installed.machine));
  assert.equal(installed.profileRevision,2);
  for(const name of ['fast-transport-belt','fast-underground-belt','fast-splitter','express-transport-belt','express-underground-belt','express-splitter'])assert(installed.allowedEquipment.includes(name),`Workshop transport headroom missing ${name}`);
  assert(installed.technologies.includes('logistics-2')&&installed.technologies.includes('logistics-3'));
  type Point={x:number;y:number};
  type EquipmentFact={name:string;type:string;beltSpeed?:number;tileWidth:number;tileHeight:number;inserterPickupPosition?:Point;inserterDropPosition?:Point};
  type Diagnostic={name:string;position:Point;status:string;pickupPosition?:Point;dropPosition?:Point;pickupTarget?:{name:string};dropTarget?:{name:string};heldItem?:{name:string;quality:string;count:number};contents?:{name:string;count:number}[];outputContents?:{name:string;count:number}[];fuel?:{name:string;count:number}[]};
  // MapPosition has eight fractional bits, unlike the prototype Vector's decimal offsets.
  // Limit this comparison to derived endpoints; target references and physical delivery remain independent assertions.
  // https://lua-api.factorio.com/latest/concepts/MapPosition.html
  const assertPrototypeEndpoint=(actual:Point,expected:Point)=>{for(const axis of ['x','y'] as const){assert(Number.isFinite(expected[axis]));assert(Number.isInteger(actual[axis]*256),'Live endpoint must lie on the documented 1/256 tile grid');assert(Math.abs(actual[axis]-expected[axis])<=1/256,`${axis} endpoint differs by more than one engine position quantum`);}};
  const equipmentFacts=installed.equipmentFacts as EquipmentFact[]|undefined;
  const beltSpeed=(name:string)=>Number(equipmentFacts?.find(row=>row.name===name)?.beltSpeed);
  assert(beltSpeed('express-transport-belt')>beltSpeed('fast-transport-belt')&&beltSpeed('fast-transport-belt')>beltSpeed('transport-belt'));
  pass(`Resolved the selected workshop profile from Factorio ${installed.gameVersion} prototypes and active mod set, with measured faster transport and matching research`);
  const rawPrototypes=JSON.parse(await port.command('/silent-command rcon.print(helpers.table_to_json((function() local function sorted(set) local out={} for name,_ in pairs(set or {}) do out[#out+1]=name end table.sort(out); return out end; local entities={}; for _,name in ipairs({"assembling-machine-2","stone-furnace","steel-furnace","small-electric-pole","transport-belt"}) do local p=prototypes.entity[name]; if p then entities[name]={type=p.type,craftingCategories=sorted(p.crafting_categories)} end end; local recipes={}; for _,name in ipairs({"electronic-circuit","iron-plate","copper-plate"}) do local p=prototypes.recipe[name]; if p then recipes[name]={category=p.category} end end; return {entities=entities,recipes=recipes} end)()))')) as {
    entities:Record<string,{type:string;craftingCategories:string[]|Record<string,boolean>}>,recipes:Record<string,{category:string}>;
  };
  prototypeEvidence={entities:Object.fromEntries(Object.entries(rawPrototypes.entities).map(([name,prototype])=>[name,{type:prototype.type,craftingCategories:Array.isArray(prototype.craftingCategories)?prototype.craftingCategories:Object.keys(prototype.craftingCategories)}])),recipes:rawPrototypes.recipes};
  const entityPrototype=(name:string)=>prototypeEvidence?.entities[name];const recipePrototype=(name:string)=>prototypeEvidence?.recipes[name];
  const required=[['assembling-machine-2','electronic-circuit'],['assembling-machine-2','iron-plate'],['stone-furnace','iron-plate'],['stone-furnace','electronic-circuit'],['small-electric-pole','iron-plate'],['transport-belt','iron-plate']] as const;
  for(const [entityName,recipeName] of required){assert(entityPrototype(entityName),`Required installed entity prototype missing: ${entityName}`);assert(recipePrototype(recipeName),`Required installed recipe prototype missing: ${recipeName}`);}
  const defineMatrixCase=(id:string,entityName:string,recipeName:string,annotation:RecipeMatrixObservation['annotation'],requiredCase=false)=>{
    const entity=entityPrototype(entityName);const recipe=recipePrototype(recipeName);
    if(!entity||!recipe){assert(!requiredCase,`Required recipe matrix prototype missing: ${entityName}/${recipeName}`);recipeMatrix.push({id,entityName,entityType:entity?.type??'unavailable',craftingCategories:entity?.craftingCategories??[],recipeName,recipeCategory:recipe?.category??'unavailable',annotation,expected:annotation==='compatible'?'accepted':'rejected',outcome:'skipped',reason:'prototype_not_installed'});return;}
    const compatible=entity.craftingCategories.includes(recipe.category);
    if(annotation==='compatible')assert(compatible,`${entityName} does not support installed recipe category ${recipe.category} for ${recipeName}`);
    if(annotation==='incompatible')assert(!compatible,`${entityName} unexpectedly supports installed recipe category ${recipe.category} for ${recipeName}`);
    if(annotation==='invalid-noncrafting')assert(!['assembling-machine','furnace'].includes(entity.type),`${entityName} is unexpectedly a recipe-capable machine`);
    recipeMatrix.push({id,entityName,entityType:entity.type,craftingCategories:entity.craftingCategories,recipeName,recipeCategory:recipe.category,annotation,expected:annotation==='compatible'?'accepted':'rejected',outcome:'not-run'});
  };
  defineMatrixCase('assembler-circuit','assembling-machine-2','electronic-circuit','compatible',true);
  defineMatrixCase('assembler-iron','assembling-machine-2','iron-plate','incompatible',true);
  defineMatrixCase('stone-furnace-iron','stone-furnace','iron-plate','compatible',true);
  defineMatrixCase('stone-furnace-circuit','stone-furnace','electronic-circuit','incompatible',true);
  for(const furnace of ['stone-furnace','steel-furnace'])for(const recipe of ['iron-plate','copper-plate']){
    if(furnace==='stone-furnace'&&recipe==='iron-plate')continue;
    defineMatrixCase(`${furnace}-${recipe}`,furnace,recipe,'compatible');
  }
  defineMatrixCase('pole-iron-annotation','small-electric-pole','iron-plate','invalid-noncrafting',true);
  defineMatrixCase('belt-iron-annotation','transport-belt','iron-plate','invalid-noncrafting',true);
  pass(`Captured installed entity types, crafting categories and recipe categories for ${recipeMatrix.length} bounded annotation cases`);
  const setup=await control.setup({id:'live',surface:'af-workshop-live',force:'af-workshop-live',profile:capability,area:[{x:-256,y:-256},{x:256,y:256}],maxTiles:1024*1024,fixtures:[]});assert.deepEqual(setup.area,[{x:-256,y:-256},{x:256,y:256}]);pass('Created an isolated 512 x 512 workshop surface and profile force');
  const receipt=await control.materialize('live',Number(setup.generation),'materialize-1',document);assert.equal(Object.keys(receipt.entities as object).length,5);assert.deepEqual(Object.values(receipt.entities as Record<string,{undergroundType?:string}>).filter(value=>value.undergroundType).map(value=>value.undergroundType).sort(),['input','output']);const repeated=await control.materialize('live',Number(setup.generation),'materialize-1',document);assert.deepEqual(repeated.entities,receipt.entities);pass('Direct placement preserved recipe, module, wire and underground-belt configuration with idempotent receipt reconciliation');
  const furnaceSetup = await control.setup({
    id: 'furnace', surface: 'af-workshop-furnace', force: 'af-workshop-furnace', profile: capability,
    area: [{ x: -256, y: -256 }, { x: 256, y: 256 }], maxTiles: 512 * 512, fixtures: [],
  });
  const furnaceDocument: BlueprintDocument = {
    schema: 1, label: 'Furnace recipe hint', description: 'A valid furnace recipe is an automatic-selection hint',
    entities: [
      { id: 'earlier', entityNumber: 1, name: 'small-electric-pole', position: { x: 0, y: 0 }, direction: 0, quality: 'normal' },
      { id: 'furnace', entityNumber: 2, name: 'stone-furnace', position: { x: 4, y: 0 }, direction: 0, quality: 'normal', recipe: 'iron-plate' },
    ],
    wires: [], ports: [], icons: [], tiles: [],
  };
  const furnaceReceipt = await control.materialize('furnace', Number(furnaceSetup.generation), 'furnace-hint', furnaceDocument);
  assert.equal(count(furnaceReceipt.entities), 2);
  const furnaceAgain = await control.materialize('furnace', Number(furnaceSetup.generation), 'furnace-hint', furnaceDocument);
  assert.deepEqual(furnaceAgain.entities, furnaceReceipt.entities);

  const emptyFurnace = JSON.parse(await port.command('/silent-command rcon.print(helpers.table_to_json((function() local s=game.surfaces["af-workshop-furnace"]; local e=s.find_entities_filtered{name="stone-furnace"}[1]; return {recipe=e.get_recipe() and e.get_recipe().name or nil,source=#e.get_inventory(defines.inventory.furnace_source).get_contents(),result=#e.get_inventory(defines.inventory.furnace_result).get_contents(),fuel=#e.get_inventory(defines.inventory.fuel).get_contents()} end)()))')) as {
    recipe?: string; source: number; result: number; fuel: number;
  };
  assert.equal(emptyFurnace.recipe, undefined);
  assert.equal(emptyFurnace.source, 0);
  assert.equal(emptyFurnace.result, 0);
  assert.equal(emptyFurnace.fuel, 0);

  const inserted = JSON.parse(await port.command('/silent-command rcon.print(helpers.table_to_json((function() local e=game.surfaces["af-workshop-furnace"].find_entities_filtered{name="stone-furnace"}[1]; return {ore=e.insert{name="iron-ore",count=1},fuel=e.insert{name="coal",count=1}} end)()))')) as { ore: number; fuel: number };
  assert.equal(inserted.ore, 1);
  assert.equal(inserted.fuel, 1);

  // Furnace recipe discovery follows inserted ingredients; the blueprint hint alone must not configure or stock it.
  await port.command('/silent-command game.tick_paused=false');
  assert.equal((await port.command('/silent-command rcon.print(tostring(game.tick_paused))')).trim(), 'false');
  let observedRecipe: string | undefined;
  let ironPlates = 0;
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const state = JSON.parse(await port.command('/silent-command rcon.print(helpers.table_to_json((function() local e=game.surfaces["af-workshop-furnace"].find_entities_filtered{name="stone-furnace"}[1]; local result=e.get_inventory(defines.inventory.furnace_result); return {recipe=e.get_recipe() and e.get_recipe().name or nil,ironPlates=result.get_item_count({name="iron-plate",quality="normal"})} end)()))')) as {
      recipe?: string; ironPlates: number;
    };
    // The furnace clears its active recipe after consuming the last input, so retain the observed selection.
    observedRecipe = state.recipe ?? observedRecipe;
    ironPlates = state.ironPlates;
    if (ironPlates > 0) break;
  }
  assert.equal(observedRecipe, 'iron-plate');
  assert.equal(ironPlates, 1);
  pass('Stone furnace accepted an iron-plate automatic-selection hint without recipe or item injection, then smelted one explicitly supplied iron ore with explicitly supplied coal');

  // Installed facts describe north-facing offsets. Confirm their rotation against live east-facing inserters.
  const rawInserterFacts=JSON.parse(await port.command('/silent-command rcon.print(helpers.table_to_json((function() local out={};for _,name in ipairs({"fast-inserter","long-handed-inserter"}) do local p=prototypes.entity[name];out[name]={pickup=p.inserter_pickup_position,drop=p.inserter_drop_position} end;return out end)()))')) as Record<string,{pickup:[number,number]|Point;drop:[number,number]|Point}>;
  events({rawInserterFacts});await writeFile(path.join(evidence,'raw-inserter-facts.json'),JSON.stringify(rawInserterFacts,null,2));
  const namedVector=(value:[number,number]|Point):Point=>Array.isArray(value)?{x:value[0],y:value[1]}:value;
  for(const [name,raw] of Object.entries(rawInserterFacts)){const fact=equipmentFacts?.find(row=>row.name===name);assert.deepEqual(fact?.inserterPickupPosition,namedVector(raw.pickup));assert.deepEqual(fact?.inserterDropPosition,namedVector(raw.drop));}
  for(const fact of equipmentFacts??[]){assert(Number.isInteger(fact.tileWidth)&&fact.tileWidth>0);assert(Number.isInteger(fact.tileHeight)&&fact.tileHeight>0);if(fact.type!=='inserter'){assert.equal(fact.inserterPickupPosition,undefined);assert.equal(fact.inserterDropPosition,undefined);}}
  assert.deepEqual([equipmentFacts?.find(row=>row.name==='transport-belt')?.tileWidth,equipmentFacts?.find(row=>row.name==='transport-belt')?.tileHeight],[1,1]);
  const ironInstalled=await control.installedProfile('starter-assembly','iron-plate');
  const furnaceFact=(ironInstalled.equipmentFacts as EquipmentFact[]).find(row=>row.name==='stone-furnace');assert.deepEqual([furnaceFact?.tileWidth,furnaceFact?.tileHeight],[2,2]);
  const geometryProfile={...capability,allowedEquipment:[...capability.allowedEquipment,'fast-inserter','long-handed-inserter']};
  const geometrySetup=await control.setup({id:'geometry',surface:'af-workshop-geometry',force:'af-workshop-geometry',profile:geometryProfile,area:[{x:-256,y:-256},{x:256,y:256}],maxTiles:512*512,fixtures:[]});
  const geometryDocument:BlueprintDocument={...document,entities:['fast-inserter','long-handed-inserter'].map((name,index)=>({id:`endpoint-${index}`,entityNumber:index+1,name,position:{x:10.5+index*10,y:10.5},direction:4,quality:'normal'})),wires:[]};
  await control.materialize('geometry',Number(geometrySetup.generation),'geometry-build',geometryDocument);
  const endpointRows=(await control.inspect('geometry')).diagnostics as Diagnostic[];
  events({geometryFacts:equipmentFacts,endpointRows,furnaceFact});await writeFile(path.join(evidence,'geometry-endpoints.json'),JSON.stringify({geometryFacts:equipmentFacts,endpointRows,furnaceFact},null,2));
  for(const entity of geometryDocument.entities){
    const fact=equipmentFacts?.find(row=>row.name===entity.name);const row=endpointRows.find(row=>row.name===entity.name);assert(fact?.inserterPickupPosition&&fact.inserterDropPosition&&row?.pickupPosition&&row.dropPosition);
    const east=(offset:Point)=>({x:entity.position.x-offset.y,y:entity.position.y+offset.x});
    const expectedDrop=east(fact.inserterDropPosition),actualDrop=row.dropPosition;
    assertPrototypeEndpoint(row.pickupPosition,east(fact.inserterPickupPosition));assertPrototypeEndpoint(actualDrop,expectedDrop);
    assert.throws(()=>assertPrototypeEndpoint({...actualDrop,x:actualDrop.x+1},expectedDrop),/more than one engine position quantum/);
    assert.throws(()=>assertPrototypeEndpoint({...actualDrop,y:actualDrop.y+1},expectedDrop),/more than one engine position quantum/);
    assert.equal(row.heldItem,undefined);assert.equal(row.pickupTarget,undefined);assert.equal(row.dropTarget,undefined);
  }
  events({geometryFacts:equipmentFacts,endpointRows,furnaceFact});
  pass('Installed tile dimensions and normal/long-handed inserter offsets matched live rotated endpoints without reading inserter-only properties on other prototypes');

  // The earlier campaign misplaced extraction by one tile. Reproduce missing pickup without assuming waiting alone means failure.
  const extractionEvidence:unknown[]=[];
  for(const shifted of [true,false]){
    const id=shifted?'extraction-shifted':'extraction-corrected';const surface=`af-${id}`;
    const cellSetup=await control.setup({id,surface,force:surface,profile:geometryProfile,area:[{x:-256,y:-256},{x:256,y:256}],maxTiles:512*512,fixtures:[
      {id:'sink',kind:'sink',position:{x:-4.5,y:-0.5},product:{kind:'item',name:'iron-plate',quality:'normal'},rate:45,transport:'belt',facing:12},
      {id:'power',kind:'power',position:{x:0,y:4},product:{kind:'item',name:'electricity',quality:'normal'},rate:0},
    ]});
    const entities:BlueprintDocument['entities']=[
      {id:'furnace',entityNumber:1,name:'stone-furnace',position:{x:0,y:0},direction:0,quality:'normal'},
      {id:'extractor',entityNumber:2,name:'fast-inserter',position:{x:shifted?-2.5:-1.5,y:-0.5},direction:4,quality:'normal'},
      {id:'pole-a',entityNumber:3,name:'small-electric-pole',position:{x:-1.5,y:-2.5},direction:0,quality:'normal'},
      {id:'pole-b',entityNumber:4,name:'small-electric-pole',position:{x:0.5,y:2.5},direction:0,quality:'normal'},
      {id:'belt-last',entityNumber:5,name:'transport-belt',position:{x:-3.5,y:-0.5},direction:12,quality:'normal'},
    ];
    if(!shifted)entities.push({id:'belt-first',entityNumber:6,name:'transport-belt',position:{x:-2.5,y:-0.5},direction:12,quality:'normal'});
    await control.materialize(id,Number(cellSetup.generation),`${id}-build`,{...document,entities,wires:[]});
    await port.command(`/silent-command local e=game.surfaces["${surface}"].find_entities_filtered{name="stone-furnace"}[1];assert(e.insert{name="iron-ore",count=10}==10);assert(e.insert{name="coal",count=1}==1);rcon.print("explicit cell inputs inserted")`);
    await control.measureConfigure({id,generation:Number(cellSetup.generation),attemptId:id,settlingTicks:600,windowTicks:600,windows:1,requestedSpeed:10,ports:[{id:'plates',fixtureId:'sink',product:{kind:'item',name:'iron-plate',quality:'normal'}}]});
    const deadline=Date.now()+30000;let measurement:Awaited<ReturnType<WorkshopControl['measureRead']>>|undefined;
    do{measurement=await control.measureRead(id,id,-1);if(measurement.finished)break;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<deadline);
    assert(measurement?.finished);assert.equal(measurement.samples.length,1);
    const rows=(await control.inspect(id)).diagnostics as Diagnostic[];const furnace=rows.find(row=>row.name==='stone-furnace');const inserter=rows.find(row=>row.name==='fast-inserter');assert(furnace&&inserter?.pickupPosition&&inserter.dropPosition);
    const delivery=Number(measurement.samples[0]!.ports[0]!.delivery.numerator);const stored=(furnace.outputContents??[]).filter(item=>item.name==='iron-plate').reduce((sum,item)=>sum+item.count,0);
    const extractorFact=equipmentFacts?.find(row=>row.name==='fast-inserter');assert(extractorFact?.inserterPickupPosition&&extractorFact.inserterDropPosition);
    const extractorX=shifted?-2.5:-1.5;const eastEndpoint=(offset:Point)=>({x:extractorX-offset.y,y:-0.5+offset.x});
    assertPrototypeEndpoint(inserter.pickupPosition,eastEndpoint(extractorFact.inserterPickupPosition));assertPrototypeEndpoint(inserter.dropPosition,eastEndpoint(extractorFact.inserterDropPosition));
    if(shifted){assert.equal(inserter.pickupTarget,undefined);assert.equal(inserter.status,'waiting_for_source_items');assert(stored>0);assert.equal(delivery,0);}
    else{assert.equal(inserter.pickupTarget?.name,'stone-furnace');assert(delivery>0,'Corrected extraction must physically reach the sink');}
    extractionEvidence.push({id,shifted,rows,measurement,stored,delivery});
  }
  events({extractionEvidence});
  pass('Shifted furnace extraction exposed empty pickup and retained output stock with zero delivery; the corrected powered cell physically delivered newly smelted plates to its belt sink');

  await port.command('/silent-command local e=game.surfaces["af-workshop-live"].find_entities_filtered{name="assembling-machine-2"}[1];e.active=false;assert(e.get_inventory(defines.inventory.assembling_machine_input).insert{name="iron-plate",count=3}==3);assert(e.get_inventory(defines.inventory.assembling_machine_output).insert{name="electronic-circuit",count=2}==2);rcon.print("assembler diagnostic markers inserted")');
  const assemblerRow=((await control.inspect('live')).diagnostics as Diagnostic[]).find(row=>row.name==='assembling-machine-2');assert(assemblerRow);
  assert.equal(assemblerRow.contents?.find(item=>item.name==='iron-plate')?.count,3);assert.equal(assemblerRow.outputContents?.find(item=>item.name==='electronic-circuit')?.count,2);
  events({assemblerRow});pass('Inspection reported assembler input/output separately using entity-specific inventory indexes');

  for(const observation of recipeMatrix){
    if(observation.outcome==='skipped')continue;
    const workshopId=`matrix-${observation.id}`;
    const matrixSetup=await control.setup({
      id:workshopId,surface:`af-${workshopId}`,force:`af-${workshopId}`,profile:capability,
      area:[{x:-256,y:-256},{x:256,y:256}],maxTiles:512*512,fixtures:[],
    });
    const annotatedEntity={id:'annotated',entityNumber:2,name:observation.entityName,position:{x:4,y:0},direction:0 as const,quality:'normal' as const,recipe:observation.recipeName};
    const hasEarlierEntity=observation.expected==='rejected';
    const matrixDocument:BlueprintDocument={
      schema:1,label:`Recipe annotation ${observation.id}`,description:'Installed-prototype-bounded recipe annotation case',
      entities:hasEarlierEntity?[
        {id:'earlier',entityNumber:1,name:'small-electric-pole',position:{x:0,y:0},direction:0,quality:'normal'},
        annotatedEntity,
      ]:[{...annotatedEntity,position:{x:0,y:0},entityNumber:1}],
      wires:[],ports:[],icons:[],tiles:[],
    };
    const operation=`${observation.id}-operation`;
    if(observation.expected==='accepted'){
      const accepted=await control.materialize(workshopId,Number(matrixSetup.generation),operation,matrixDocument);
      assert.equal(count(accepted.entities),matrixDocument.entities.length);
      const repeated=await control.materialize(workshopId,Number(matrixSetup.generation),operation,matrixDocument);
      assert.deepEqual(repeated.entities,accepted.entities);
      observation.outcome='accepted';
    }else{
      await assert.rejects(()=>control.materialize(workshopId,Number(matrixSetup.generation),operation,matrixDocument),/direct_recipe_unavailable/);
      assert.equal(count((await control.inspect(workshopId)).entities),0);
      const correctedEntities=matrixDocument.entities.map(entity=>{const copy={...entity};delete copy.recipe;return copy;});
      const corrected=await control.materialize(workshopId,Number(matrixSetup.generation),operation,{...matrixDocument,entities:correctedEntities});
      assert.equal(count(corrected.entities),correctedEntities.length);
      observation.outcome='rejected';
    }
    pass(`${observation.id}: ${observation.entityType} ${observation.entityName} ${observation.annotation} ${observation.recipeName} (${observation.recipeCategory}) => ${observation.outcome}${hasEarlierEntity?' with rollback and same-operation correction':''}`);
  }
  const before=await control.inspect('live');const expanded=await control.expand('live',Number(setup.generation),[{x:-384,y:-384},{x:384,y:384}]);const after=await control.inspect('live');assert.equal(after.candidateFingerprint,before.candidateFingerprint);assert.equal(after.generation,expanded.generation);await assert.rejects(()=>control.expand('live',Number(expanded.generation),[{x:-600,y:-600},{x:600,y:600}]),/workshop_area_cap/);pass('Nondestructive expansion preserved the candidate and enforced the configured cap');
  const denied=JSON.parse(await port.command(wrapper({op:'workshop-inspect',id:'live'})))as{ok:boolean;error:string};assert.equal(denied.ok,false);assert.match(denied.error,/unsupported_gameplay_operation/);pass('Ordinary gameplay RPC could not invoke workshop privileges');
  const malformed={...document,entities:[...document.entities,{...document.entities[0]!,id:'assembler'}]};assert.throws(()=>control.materialize('live',Number(expanded.generation),'malformed',malformed),/duplicate/);const unchanged=await control.inspect('live');assert.equal(count(unchanged.entities),5);pass('Malformed content failed host preflight before game mutation');
  const rollbackSetup=await control.setup({id:'rollback',surface:'af-workshop-rollback',force:'af-workshop-rollback',profile:capability,area:[{x:-256,y:-256},{x:256,y:256}],maxTiles:512*512,fixtures:[]});const lateFailure:BlueprintDocument={...document,entities:[document.entities[1]!,{...document.entities[2]!,recipe:'missing-recipe'}],wires:[]};await assert.rejects(()=>control.materialize('rollback',Number(rollbackSetup.generation),'rollback-operation',lateFailure),/direct_recipe_unavailable/);assert.equal(count((await control.inspect('rollback')).entities),0);const cleanEntities=lateFailure.entities.map(entity=>{const copy={...entity};delete copy.recipe;return copy;});const retried=await control.materialize('rollback',Number(rollbackSetup.generation),'rollback-operation',{...lateFailure,entities:cleanEntities});assert.equal(count(retried.entities),2);pass('Late direct-configuration failure rolled back every created entity and the same operation retried cleanly');
  const setup2=await control.setup({id:'reconstruction',surface:'af-workshop-reconstruct',force:'af-workshop-reconstruct',profile:capability,area:[{x:-256,y:-256},{x:256,y:256}],maxTiles:512*512,fixtures:[]});await control.materialize('reconstruction',Number(setup2.generation),'reconstruct-1',document);const reconstructed=await control.inspect('reconstruction');assert.equal(count(reconstructed.entities),5);pass('Clean isolated reconstruction reproduced the exported candidate');events({installedGameVersion,prototypeEvidence,recipeMatrix,setup,receipt,expanded,reconstructed});
  const largeSetup=await control.setup({id:'large-belts',surface:'af-workshop-large-belts',force:'af-workshop-large-belts',profile:{...capability,allowedEquipment:[...capability.allowedEquipment,'transport-belt']},area:[{x:-256,y:-256},{x:256,y:256}],maxTiles:512*512,fixtures:[{id:'ore-in',kind:'source',position:{x:-2.5,y:30.5},product:{kind:'item',name:'iron-ore',quality:'normal'},rate:30,transport:'belt',facing:4},{id:'ore-out',kind:'sink',position:{x:2.5,y:30.5},product:{kind:'item',name:'iron-ore',quality:'normal'},rate:15,transport:'belt',facing:4},{id:'power',kind:'power',position:{x:0,y:40},product:{kind:'item',name:'electricity',quality:'normal'},rate:0}]});
  const beltEntities:BlueprintDocument['entities']=Array.from({length:600},(_,index)=>({id:`large-${index}`,entityNumber:index+1,name:'transport-belt',position:{x:100.5+index%60,y:100.5+Math.floor(index/60)},direction:4,quality:'normal'}));
  for(let x=-1.5;x<2;x++)beltEntities.push({id:`connector-${beltEntities.length}`,entityNumber:beltEntities.length+1,name:'transport-belt',position:{x,y:30.5},direction:4,quality:'normal'});
  const largeDocument:BlueprintDocument={...document,entities:beltEntities,wires:[]};assert(Buffer.byteLength(JSON.stringify(largeDocument))>65536);
  await control.materialize('large-belts',Number(largeSetup.generation),'large-build',largeDocument);
  assert.equal(count((await control.inspect('large-belts')).entities),beltEntities.length);pass('Operator materialized a candidate larger than 64 KiB through the real Lua boundary');
  await control.measureConfigure({id:'large-belts',generation:Number(largeSetup.generation),attemptId:'belt-flow',settlingTicks:600,windowTicks:600,windows:1,requestedSpeed:10,ports:[{id:'ore-out',fixtureId:'ore-out',product:{kind:'item',name:'iron-ore',quality:'normal'}}]});
  const flowDeadline=Date.now()+30000;let flow:Awaited<ReturnType<WorkshopControl['measureRead']>>|undefined;
  do{flow=await control.measureRead('large-belts','belt-flow',-1);if(flow.finished)break;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<flowDeadline);
  assert(flow?.finished);assert.equal(flow.samples.length,1);const beltSample=flow.samples[0]!.ports[0]!;
  assert(Number(beltSample.delivery.numerator)/Number(beltSample.delivery.denominator)>=149,'Both belt lanes must deliver a full yellow belt');assert.equal(beltSample.production.numerator,'0','Transport alone must not count as manufacturing');
  pass('Physical source/sink belt fixtures sustain both lanes without inventing production; power fixture defaults remain compatible');
}catch(error){failure=String(error);process.exitCode=1;await writeFile(path.join(evidence,'failure.txt'),failure);console.error(failure.slice(0,1500));}finally{port?.close();let cleanup=false;try{await stopProfile(profile.config);cleanup=true;}catch(error){failure??=String(error);process.exitCode=1;}await writeFile(path.join(evidence,'result.json'),JSON.stringify({passed:failure===null,checks,failure,cleanup,installedGameVersion,prototypeEvidence,recipeMatrix,coverageLimits,modelInference:false},null,2));console.log(JSON.stringify({evidence,checks:checks.length,failure:failure?.slice(0,300),cleanup}));}
