import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BlueprintDocument, ProductionRequest, WorkshopAssignment } from '@autofactorio/contracts';
import type { ChainMeasurementManifest } from '../../apps/runtime/workshop-chain-measurement.js';
import type { LiveWorkshopHost } from '../../apps/runtime/workshop-live-host.js';
import type { WorkshopSessionState } from '../../packages/core/workshop/orchestrator.js';
import type { InstalledChainContext } from '../../packages/core/workshop/installed-chain.js';
import type { CommandPort } from '../../packages/factorio/src/rcon.js';
import type { WorkshopControl } from '../../packages/factorio/src/workshop.js';
import { blueprintContentHash } from '../../packages/core/workshop/blueprint.js';
import { evaluateWorkshop } from '../../packages/core/workshop/evaluation.js';
import { waitFor } from './game-processes.js';

/** Parent owns the dedicated world and transport. This conserves real fixture
 * items/native output; scripted transfers do not establish a legal layout. */
export async function calibrateWorkshopBurner(options: {
  host: LiveWorkshopHost; control: WorkshopControl; port: CommandPort;
  context: InstalledChainContext; base: WorkshopAssignment; evidence: string; checks: string[];
}) {
  const { host, control, port, context, base, evidence, checks } = options;
  const item = (name: string) => ({ kind:'item' as const, name, quality:'normal' as const, surface:'nauvis' });
  const request: ProductionRequest = {
    schema:1,target:item('iron-plate'),mode:'rate',rate:{numerator:'1',denominator:'5',unit:'items-per-game-second'},
    profile:{id:context.profile.id,revision:context.profile.revision,fingerprint:context.profile.fingerprint,recipes:context.profile.recipes,equipment:context.profile.allowedEquipment},
    facts:{schema:1,id:`production.${context.snapshot.catalog.fingerprint}`,fingerprint:context.snapshot.catalog.fingerprint,availabilityRevision:context.snapshot.availabilityRevision},
    externalInputs:['iron-ore','coal'].map(name=>({product:item(name),capacity:{kind:'rate' as const,numerator:'1',denominator:'1'}})),
    initialStock:[],utilities:{electricityWatts:0},constructionEquipment:{'stone-furnace':1},sinks:[],
    routes:{'item:iron-plate':'recipe:iron-plate'},machines:{'recipe:iron-plate':'machine:stone-furnace'},fuels:{'recipe:iron-plate':item('coal')},
  };
  for (const scenario of ['calibration','preload','wrong-fuel'] as const) {
    const id=`chain-burner-${scenario}`,raw:Record<string,unknown>={...base,id,comparisonSeries:id,profileId:'starter-assembly',chainRequest:request,construction:'direct',settlingTicks:0,windowTicks:scenario==='calibration'?3600:60,windows:1,requestedSpeed:{numerator:'1',denominator:'1'}};
    for(const field of ['ports','throughput','footprint','gameFingerprint','profileRevision'])delete raw[field];
    const assignment=await host.resolve(raw),directory=path.join(evidence,'workshop-live',id);
    // Stone furnaces occupy two tiles and require integer centres. Half-tile
    // centres copied from the three-tile electric furnace are snapped by native
    // placement, so they cannot satisfy exact host reconstruction identity.
    const document:BlueprintDocument={schema:1,label:'Native burner calibration',description:'Conserved diagnostic transfers; no physical acceptance',entities:[{id:'furnace',entityNumber:1,name:'stone-furnace',position:{x:0,y:4},direction:0,quality:'normal',recipe:'iron-plate'}],ports:assignment.ports,wires:[],icons:[{index:1,name:'iron-plate'}],tiles:[]};
    const hash=blueprintContentHash(document),session={id,assignment,activeIteration:1,pinnedBundleHash:'baseline'} as WorkshopSessionState;
    await mkdir(directory,{recursive:true});await writeFile(path.join(directory,hash+'.json'),JSON.stringify(document));
    await host.build(session,{sessionId:id,iteration:1,artifactHash:hash,assignmentRevision:1,bundleHash:'baseline',evidence:[]});
    const built=JSON.parse(await readFile(path.join(directory,hash+'.built.json'),'utf8')) as {id:string;generation:number;surface:string;chainMeasurement:ChainMeasurementManifest};
    const manifest=built.chainMeasurement;
    assert.equal(manifest.bindings.length,1);assert.equal(manifest.bindings[0]!.fuel,'coal');assert.equal(manifest.stages[0]!.fuel?.name,'coal');
    const configuration={id:built.id,generation:built.generation,attemptId:`burner-${scenario}`,settlingTicks:scenario==='wrong-fuel'?600:0,windowTicks:scenario==='calibration'?3600:60,windows:1,requestedSpeed:1,
      ports:assignment.ports.filter(value=>value.direction==='output').map(value=>({id:value.id,fixtureId:value.id,product:{kind:value.product.kind,name:value.product.name,quality:'normal' as const}})),
      chain:{boundaryFingerprint:manifest.boundaryFingerprint,candidateFingerprint:manifest.candidateFingerprint,stages:manifest.bindings}};
    const entity='/silent-command __autofactorio__ local e=game.surfaces['+JSON.stringify(built.surface)+'].find_entity("stone-furnace",{0,4});assert(e and e.unit_number=='+manifest.bindings[0]!.units[0]+');local b=e.burner;';
    await port.command('/silent-command game.tick_paused=true;game.speed=0.5;rcon.print("burner-held")');
    if(scenario==='preload') {
      await port.command(entity+'b.currently_burning=prototypes.item.coal;b.remaining_burning_fuel=prototypes.item.coal.fuel_value;rcon.print("burner-energy-preloaded")');
      await assert.rejects(control.measureConfigure(configuration),/chain_burner_preload_or_invalid_fuel/);
      const status=await control.measureStatus(built.id,configuration.attemptId);
      assert.equal(status.present,false);assert.equal(status.state,'not-admitted');
      assert.equal((await port.command('/silent-command rcon.print(tostring(game.tick_paused)..":"..tostring(game.speed))')).trim(),'true:0.5');
      await writeFile(path.join(evidence,'burner-preload.json'),JSON.stringify({manifest,status,controls:'true:0.5'},null,2));
      checks.push('Burner energy preload is rejected before measurement admission or control mutation');
      continue;
    }
    const admitted=await control.measureConfigure(configuration);
    if(scenario==='wrong-fuel') {
      const mutation=JSON.parse(await port.command(entity+'assert(b.inventory.insert{name="wood",quality="normal",count=1}==1);rcon.print(helpers.table_to_json{tick=game.tick})')) as {tick:number};
      const sampled=await waitFor('wrong fuel sampled',async()=>{const page=await control.measureRead(built.id,configuration.attemptId,-1);return page.tick>mutation.tick+5?page:undefined;},10000,100);
      assert.equal(sampled.finished,false);
      const restored=JSON.parse(await port.command(entity+'assert(storage.af.workshops['+JSON.stringify(built.id)+'].measurement.chain.fuel.invalid);b.inventory.clear();b.currently_burning=nil;b.heat=0;rcon.print(helpers.table_to_json{tick=game.tick,energy=b.remaining_burning_fuel+b.heat})')) as {tick:number;energy:number};
      assert.equal(restored.energy,0);assert(restored.tick<Number(admitted.admittedTick)+600);
      const page=await waitFor('sticky fuel invalid window',async()=>{const value=await control.measureRead(built.id,configuration.attemptId,-1);return value.finished?value:undefined;},15000,100);
      await writeFile(path.join(evidence,'burner-wrong-fuel.json'),JSON.stringify({admitted,mutation,sampled,restored,page,tamperOnly:true},null,2));
      assert.equal(page.samples.length,1);assert.equal(page.samples[0]!.stageCoverage,'unknown');assert.equal(page.samples[0]!.energyCoverage,'unknown');
      assert(page.samples[0]!.contamination.includes('chain_discontinuity'));assert(page.samples[0]!.startTick>restored.tick);
      checks.push('Unselected burner fuel invalidates stage and energy coverage even after restoration before scoring');
      continue;
    }
    await waitFor('empty burner scoring baseline',async()=>{
      const page=await control.measureRead(built.id,configuration.attemptId,-1);
      assert.equal(page.finished,false);return page.state==='scoring'?true:undefined;
    },5000,10);
    const transfer=`/silent-command __autofactorio__
      local w=storage.af.workshops[${JSON.stringify(built.id)}];local m=w.measurement;assert(m.attemptId==${JSON.stringify(configuration.attemptId)})
      local e=game.surfaces[w.surface].find_entity('stone-furnace',{0,4});local unit=e.unit_number;assert(unit==${manifest.bindings[0]!.units[0]})
      storage.af_burner_diag=storage.af_burner_diag or {coal=0,ore=0,plates=0};local d=storage.af_burner_diag
      if not d.opening then assert(m.state=='scoring' and m.baseline.chain.fuel.consumed[unit]==0 and m.baseline.chain.fuel.loads[unit]==0 and m.baseline.chain.fuel.energy[unit]==0);assert(e.products_finished==0 and e.burner.inventory.is_empty());d.opening=m.baseline.chain.fuel end
      local function fill(id,name,inventory,limit,key)
       local f=w.fixtures[id];assert(f.kind=='source' and f.bounded and f.product.name==name);local source=game.surfaces[w.surface].find_entity(f.entity,f.position)
       for lane=1,2 do local line=source.get_transport_line(lane);local amount=math.min(math.max(0,limit-inventory.get_item_count(name)),line.get_item_count(name),inventory.get_insertable_count(name))
        if amount>0 then local before=line.get_item_count(name)+inventory.get_item_count(name);assert(line.remove_item{name=name,quality='normal',count=amount}==amount);assert(inventory.insert{name=name,quality='normal',count=amount}==amount);assert(before==line.get_item_count(name)+inventory.get_item_count(name));d[key]=d[key]+amount end
       end
      end
      local out=e.get_inventory(defines.inventory.furnace_result);local sinkf=w.fixtures['output-item-iron-plate'];assert(sinkf.kind=='sink' and sinkf.bounded);local sink=game.surfaces[w.surface].find_entity(sinkf.entity,sinkf.position)
      if not m.finished then
       fill('input-item-coal','coal',e.burner.inventory,1,'coal');fill('input-item-iron-ore','iron-ore',e.get_inventory(defines.inventory.furnace_source),2,'ore')
       local line=sink.get_transport_line(1);if out.get_item_count('iron-plate')>0 and line.can_insert_at_back() then local before=out.get_item_count('iron-plate')+line.get_item_count('iron-plate');assert(out.remove{name='iron-plate',quality='normal',count=1}==1);assert(line.insert_at_back{name='iron-plate',quality='normal',count=1});assert(before==out.get_item_count('iron-plate')+line.get_item_count('iron-plate'));d.plates=d.plates+1 end
      end
      rcon.print(helpers.table_to_json{finished=m.finished,tick=game.tick,transferred=d,fuelValue=prototypes.item.coal.fuel_value,native={finished=e.products_finished,progress=e.crafting_progress,fuelInventory=e.burner.inventory.get_item_count('coal'),remaining=e.burner.remaining_burning_fuel,heat=e.burner.heat,output=out.get_item_count('iron-plate'),sinkStock=sink.get_transport_line(1).get_item_count('iron-plate')+sink.get_transport_line(2).get_item_count('iron-plate'),delivered=sinkf.delivered},closing=m.baseline.chain.fuel})`.replace(/\r?\n\s*/g,' ');
    type Observation={finished:boolean;tick:number;fuelValue:number;transferred:{coal:number;ore:number;plates:number};native:{finished:number;progress:number;fuelInventory:number;remaining:number;heat:number;output:number;sinkStock:number;delivered:number};closing:{energy:Record<string,number>;loads:Record<string,number>}};
    let terminal!:Observation,rounds=0;
    await waitFor('native burner interval',async()=>{
      const raw=await port.command(transfer);try{terminal=JSON.parse(raw) as Observation;}catch{await writeFile(path.join(evidence,'burner-console-failure.txt'),raw);throw new Error('Non-JSON burner calibration response');}
      rounds++;const page=await control.measureRead(built.id,configuration.attemptId,-1);return page.finished?true:undefined;
    },100000,10);
    terminal=JSON.parse(await port.command(transfer)) as Observation;
    const page=await control.measureRead(built.id,configuration.attemptId,-1);
    await writeFile(path.join(evidence,'burner-observations.json'),JSON.stringify({admitted,manifest,page,terminal,rounds,transportHarness:true,physicalConnectivityAcceptance:false},null,2));
    assert.equal(page.samples.length,1);const sample=page.samples[0]!;
    assert.equal(sample.endTick-sample.startTick,3600);assert.equal(sample.stageCoverage,'complete');assert.equal(sample.energyCoverage,'complete');assert.deepEqual(sample.contamination,[]);
    const stage=sample.stages![0]!,fuel=stage.inputs.find(value=>value.kind==='item'&&value.name==='coal')!;
    const quantity=(value:{numerator:string;denominator:string})=>Number(value.numerator)/Number(value.denominator);
    const loaded=terminal.transferred.coal-terminal.native.fuelInventory,energy=terminal.native.remaining+terminal.native.heat;
    const oracle=loaded-energy/terminal.fuelValue,measured=quantity(fuel.amount),error=quantity(fuel.error);
    assert(loaded>=2&&oracle>0&&measured>0);assert(Math.abs(measured-oracle)<=error+0.000001);
    assert.equal(terminal.closing.loads[String(manifest.bindings[0]!.units[0])],loaded);
    assert.equal(terminal.closing.energy[String(manifest.bindings[0]!.units[0])],energy);
    assert.equal(quantity(stage.crafts),terminal.native.finished);assert(terminal.native.finished>0&&terminal.native.delivered>0);
    assert.equal(terminal.native.finished,terminal.native.output+terminal.native.sinkStock+terminal.native.delivered);
    const evaluation=evaluateWorkshop(assignment,page.samples.map(value=>({...value,attemptId:`${id}:1`})),manifest.stages,manifest.coProducts);
    assert.equal(evaluation.valid,true);
    await writeFile(path.join(evidence,'burner-calibration.json'),JSON.stringify({admitted,manifest,page,terminal,rounds,oracle:{loaded,energy,consumed:oracle,measured,error},evaluation,transportHarness:true,physicalConnectivityAcceptance:false},null,2));
    checks.push('Native burner consumption crosses two fuel loads and agrees with conserved source debits, remaining inventory/heat and completed furnace output');
  }
}
