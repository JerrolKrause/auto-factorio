import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BlueprintDocument } from '@autofactorio/contracts';
import { WorkshopControl } from '../packages/factorio/src/workshop.js';
import { wrapper } from '../packages/factorio/src/rcon.js';
import { createProfile, startServer, stopProfile, waitForServer } from './dev/game-processes.js';
import type { CapabilityProfile } from '../packages/core/workshop/profiles.js';

const profile=await createProfile(false,true);const evidence=await mkdtemp(path.join(profile.dir,'workshop-probe-'));const checks:string[]=[];let failure:string|null=null;const pass=(message:string)=>{checks.push(message);console.log(message);};
const count=(value:unknown)=>Array.isArray(value)?value.length:value&&typeof value==='object'?Object.keys(value).length:0;
console.log(JSON.stringify({evidence,profile:profile.config}));await startServer(profile);const port=await waitForServer(profile);await port.command('/silent-command rcon.print("workshop console authorization")');await port.command('/silent-command rcon.print("workshop console ready")');const wireIds=JSON.parse(await port.command('/silent-command rcon.print(helpers.table_to_json(defines.wire_connector_id))')) as {pole_copper:number};const control=new WorkshopControl(port);const events=(event:unknown)=>appendFileSync(path.join(evidence,'events.jsonl'),JSON.stringify(event)+'\n');
const capability:CapabilityProfile={schema:1,id:'live-workshop',revision:1,fingerprint:'live-2.0.77',source:'custom',technologies:['automation','automation-2','electronics','modules','speed-module'],researchBonuses:{},recipes:['electronic-circuit','iron-plate'],allowedEquipment:['assembling-machine-2','stone-furnace','small-electric-pole','speed-module','underground-belt'],locallyManufacturable:[],modules:['speed-module'],beacons:[],quality:'normal',surface:'nauvis'};
const document:BlueprintDocument={schema:1,label:'Live workshop cell',description:'Direct materialization smoke',entities:[
  {id:'assembler',entityNumber:1,name:'assembling-machine-2',position:{x:0,y:0},direction:0,quality:'normal',recipe:'electronic-circuit',modules:{'speed-module':1}},
  {id:'pole-a',entityNumber:2,name:'small-electric-pole',position:{x:4,y:0},direction:0,quality:'normal'},
  {id:'pole-b',entityNumber:3,name:'small-electric-pole',position:{x:7,y:0},direction:0,quality:'normal'},
  {id:'underground-in',entityNumber:4,name:'underground-belt',position:{x:0,y:5},direction:4,quality:'normal',undergroundType:'input'},
  {id:'underground-out',entityNumber:5,name:'underground-belt',position:{x:3,y:5},direction:4,quality:'normal',undergroundType:'output'},
],wires:[{from:{entityId:'pole-a',connector:String(wireIds.pole_copper)},to:{entityId:'pole-b',connector:String(wireIds.pole_copper)},color:'copper'}],ports:[],icons:[{index:1,name:'electronic-circuit'}],tiles:[]};
try{
  const installed=await control.installedProfile('starter-assembly','electronic-circuit');assert.equal(installed.gameVersion,'2.0.77');assert.equal(installed.recipe.id,'electronic-circuit');assert(installed.recipe.ingredients.some(value=>value.name==='iron-plate'));assert(installed.allowedEquipment.includes(installed.machine));pass('Resolved the selected workshop profile from the running game prototypes and active mod set');
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

  const furnaceBad: BlueprintDocument = {
    ...furnaceDocument, label: 'Invalid furnace recipe',
    entities: furnaceDocument.entities.map(entity => entity.id === 'furnace' ? { ...entity, recipe: 'electronic-circuit' } : entity),
  };
  const poleBad: BlueprintDocument = {
    ...furnaceDocument, label: 'Invalid pole recipe',
    entities: [
      { id: 'earlier', entityNumber: 1, name: 'small-electric-pole', position: { x: 0, y: 0 }, direction: 0, quality: 'normal' },
      { id: 'pole', entityNumber: 2, name: 'small-electric-pole', position: { x: 4, y: 0 }, direction: 0, quality: 'normal', recipe: 'iron-plate' },
    ],
  };
  const invalidRecipeCases = [
    { operation: 'bad-furnace', bad: furnaceBad, corrected: furnaceDocument },
    { operation: 'bad-pole', bad: poleBad, corrected: { ...poleBad, entities: poleBad.entities.map(entity => { const copy = { ...entity }; delete copy.recipe; return copy; }) } },
  ];
  for (const { operation, bad, corrected } of invalidRecipeCases) {
    const rollbackId = `rollback-${operation}`;
    const failedSetup = await control.setup({
      id: rollbackId, surface: `af-${rollbackId}`, force: `af-${rollbackId}`, profile: capability,
      area: [{ x: -256, y: -256 }, { x: 256, y: 256 }], maxTiles: 512 * 512, fixtures: [],
    });
    await assert.rejects(
      () => control.materialize(rollbackId, Number(failedSetup.generation), operation, bad),
      /direct_recipe_unavailable/,
    );
    assert.equal(count((await control.inspect(rollbackId)).entities), 0);
    const fixed = await control.materialize(rollbackId, Number(failedSetup.generation), operation, corrected);
    assert.equal(count(fixed.entities), corrected.entities.length);
    pass(`${operation} rejected an unavailable direct recipe and rolled back all entities; correcting the same operation succeeded`);
  }
  const before=await control.inspect('live');const expanded=await control.expand('live',Number(setup.generation),[{x:-384,y:-384},{x:384,y:384}]);const after=await control.inspect('live');assert.equal(after.candidateFingerprint,before.candidateFingerprint);assert.equal(after.generation,expanded.generation);await assert.rejects(()=>control.expand('live',Number(expanded.generation),[{x:-600,y:-600},{x:600,y:600}]),/workshop_area_cap/);pass('Nondestructive expansion preserved the candidate and enforced the configured cap');
  const denied=JSON.parse(await port.command(wrapper({op:'workshop-inspect',id:'live'})))as{ok:boolean;error:string};assert.equal(denied.ok,false);assert.match(denied.error,/unsupported_gameplay_operation/);pass('Ordinary gameplay RPC could not invoke workshop privileges');
  const malformed={...document,entities:[...document.entities,{...document.entities[0]!,id:'assembler'}]};assert.throws(()=>control.materialize('live',Number(expanded.generation),'malformed',malformed),/duplicate/);const unchanged=await control.inspect('live');assert.equal(count(unchanged.entities),5);pass('Malformed content failed host preflight before game mutation');
  const rollbackSetup=await control.setup({id:'rollback',surface:'af-workshop-rollback',force:'af-workshop-rollback',profile:capability,area:[{x:-256,y:-256},{x:256,y:256}],maxTiles:512*512,fixtures:[]});const lateFailure:BlueprintDocument={...document,entities:[document.entities[1]!,{...document.entities[2]!,recipe:'missing-recipe'}],wires:[]};await assert.rejects(()=>control.materialize('rollback',Number(rollbackSetup.generation),'rollback-operation',lateFailure),/direct_recipe_unavailable/);assert.equal(count((await control.inspect('rollback')).entities),0);const cleanEntities=lateFailure.entities.map(entity=>{const copy={...entity};delete copy.recipe;return copy;});const retried=await control.materialize('rollback',Number(rollbackSetup.generation),'rollback-operation',{...lateFailure,entities:cleanEntities});assert.equal(count(retried.entities),2);pass('Late direct-configuration failure rolled back every created entity and the same operation retried cleanly');
  const setup2=await control.setup({id:'reconstruction',surface:'af-workshop-reconstruct',force:'af-workshop-reconstruct',profile:capability,area:[{x:-256,y:-256},{x:256,y:256}],maxTiles:512*512,fixtures:[]});await control.materialize('reconstruction',Number(setup2.generation),'reconstruct-1',document);const reconstructed=await control.inspect('reconstruction');assert.equal(count(reconstructed.entities),5);pass('Clean isolated reconstruction reproduced the exported candidate');events({setup,receipt,expanded,reconstructed});
}catch(error){failure=String(error);process.exitCode=1;await writeFile(path.join(evidence,'failure.txt'),failure);console.error(failure.slice(0,1500));}finally{port.close();let cleanup=false;try{await stopProfile(profile.config);cleanup=true;}catch(error){failure??=String(error);process.exitCode=1;}await writeFile(path.join(evidence,'result.json'),JSON.stringify({passed:failure===null,checks,failure,cleanup,modelInference:false},null,2));console.log(JSON.stringify({evidence,checks:checks.length,failure:failure?.slice(0,300),cleanup}));}
