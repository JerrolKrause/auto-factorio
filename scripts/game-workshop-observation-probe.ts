import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import { WorkshopControl } from '../packages/factorio/src/workshop.js';
import { LiveWorkshopGame } from '../apps/runtime/workshop-live-host.js';
import { preserveSnapshot } from '../apps/runtime/workshop-snapshot.js';
import { createProfile, identifyObserver, listProjectProcesses, startObserver, startServer, stopProfile, waitFor, waitForServer } from './dev/game-processes.js';
import { measurementLifecycleFixture } from './dev/workshop-measure-fixture.js';

const visible=process.argv.includes('--observer'),fixture=measurementLifecycleFixture();
if(visible&&(await listProjectProcesses()).some(value=>value.kind==='observer'))throw new Error('A project observer is already open; preserve it before running this dedicated visible probe.');
const profile=await createProfile(false,!visible,{port:27030,gamePort:34210}),evidence=await mkdtemp(path.join(profile.dir,'workshop-observation-probe-'));
const checks:string[]=[];let failure:string|null=null,observer=false,cleanup=false,port:Awaited<ReturnType<typeof waitForServer>>|undefined;
console.log(JSON.stringify({evidence,profile:profile.config}));
try{
  await startServer(profile);port=await waitForServer(profile);
  const control=new WorkshopControl(port),client=new GameClient(port,()=>{}),life=new Lifecycle(port,client,()=>{}),game=new LiveWorkshopGame(port,client,life,()=>{},undefined,profile.dir,visible?profile.observerData:null);
  await port.command('/silent-command rcon.print("workshop observation authorization")');
  await port.command('/silent-command rcon.print("workshop observation ready")');
  if(visible){await startObserver(profile);observer=true;await identifyObserver(profile);await waitFor('workshop builder',async()=>{const state=await client.request({op:'observe',surface:'nauvis',area:[{x:-32,y:-32},{x:32,y:32}],offset:0,limit:50}) as {actors?:Record<string,{connected?:boolean}>};return state.actors?.['builder-1']?.connected?true:undefined;},120000,500);}
  const setup=await control.setup({id:fixture.id,surface:fixture.surface,force:fixture.surface,profile:fixture.capability,area:[{x:-256,y:-256},{x:256,y:256}],maxTiles:512*512,fixtures:fixture.fixtures}),generation=Number(setup.generation);
  await control.materialize(fixture.id,generation,'observation-build',fixture.document);
  if(visible)await control.enter(fixture.id,'builder-1');
  await port.command(`/silent-command local s=game.surfaces[${JSON.stringify(fixture.surface)}];local f=s.find_entities_filtered{name="stone-furnace"}[1];f.get_inventory(defines.inventory.furnace_source).insert{name="iron-ore",count=50};f.get_fuel_inventory().insert{name="coal",count=20};game.speed=3;game.tick_paused=true;rcon.print("preloaded")`);
  await assert.rejects(control.observe(fixture.id,generation),/workshop_measurement_active/);checks.push('Observation refused before measurement');
  await control.measureConfigure({id:fixture.id,generation,attemptId:'observation-window',settlingTicks:1,windowTicks:120,windows:1,requestedSpeed:10,ports:[{id:'plates',fixtureId:'plate-sink',product:{kind:'item',name:'iron-plate',quality:'normal'}}]});
  const page=await waitFor('fixed-window finish',async()=>{const value=await control.measureRead(fixture.id,'observation-window',-1);return value.finished?value:undefined;},30000,100);
  const originalSamples=JSON.stringify(page.samples);assert.equal((await port.command('/silent-command rcon.print(tostring(game.tick_paused)..":"..game.speed)')).trim(),'true:3');checks.push('Fixed window restores original pause and speed');
  const built={id:fixture.id,generation,surface:fixture.surface,characterEvidence:null};
  const image=await game.screenshot(built,randomUUID());
  if(visible){assert.ok(image);const sha256=await preserveSnapshot(image.path,path.join(evidence,'final-build.png'));await writeFile(path.join(evidence,'snapshot.json'),JSON.stringify({sha256,tick:image.tick}));checks.push('Connected client rendered and preserved actual final-build PNG');}
  else{assert.equal(image,null);assert.equal((await control.screenshot(fixture.id,generation,randomUUID())).available,false);checks.push('Headless capture explicitly unavailable');}
  assert.equal(await control.observe(fixture.id,generation),true);const before=await control.measureRead(fixture.id,'observation-window',-1);await delay(1500);const after=await control.measureRead(fixture.id,'observation-window',-1);
  assert.ok(after.tick>before.tick+120);assert.equal(JSON.stringify(after.samples),originalSamples);assert.equal(after.achievedSpeed,10);checks.push('Final build continues at requested speed with immutable window samples');
  assert.equal(await control.observe(fixture.id,generation,true),false);const paused=await control.measureRead(fixture.id,'observation-window',-1);await delay(300);assert.equal((await control.measureRead(fixture.id,'observation-window',-1)).tick,paused.tick);assert.equal(paused.achievedSpeed,3);checks.push('Stop pauses and restores previous speed');
  assert.equal(await control.observe(fixture.id,generation),false);checks.push('Durable Stop prevents a racing/replayed resume');
  const save=path.join(profile.dir,'data','saves','observation-stopped.zip');await port.command('/silent-command game.server_save("observation-stopped");rcon.print("saved")');await waitFor('observation save',async()=>{try{await access(save);return true;}catch{return undefined;}},30000,100);
  if(observer){await stopProfile(profile.observerConfig);observer=false;}port.close();port=undefined;await stopProfile(profile.config);await startServer({...profile,save});port=await waitForServer(profile);const restored=new WorkshopControl(port);assert.equal(await restored.observe(fixture.id,generation),false);assert.equal(JSON.stringify((await restored.measureRead(fixture.id,'observation-window',-1)).samples),originalSamples);checks.push('Save/load preserves stopped observation and measurement evidence');
  if(image)await readFile(path.join(evidence,'final-build.png'));
}catch(error){failure=String(error);process.exitCode=1;console.error(failure.slice(0,1000));}
finally{port?.close();try{if(observer)await stopProfile(profile.observerConfig);await stopProfile(profile.config);cleanup=true;}catch(error){failure??=String(error);process.exitCode=1;}await writeFile(path.join(evidence,'result.json'),JSON.stringify({passed:failure===null,checks,failure,cleanup,modelInference:false,visible},null,2));console.log(JSON.stringify({evidence,checks:checks.length,failure,cleanup}));}
