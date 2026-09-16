import { diagnosticGrants } from '@autofactorio/contracts';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { configureProfile, readProfile, startServer, waitForServer, startObserver, identifyObserver, waitFor } from './dev/game-processes.js';
import { ProbeStages, readResume, resumeProfile, fingerprint } from './dev/probe-stages.js';
import type { ControlState } from '../packages/factorio/src/lifecycle.js';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { record } from '@autofactorio/contracts';
import type { Batch, Step } from '@autofactorio/contracts';
import { Rcon, wrapper } from '../packages/factorio/src/rcon.js';
import { GameClient, observeRequest } from '../packages/factorio/src/client.js';
import { Lifecycle, barrier, fence, captureCheckpoint, validateCheckpoint, prepareManagedLoad, verifyLoaded, reconciliation, sha256 } from '../packages/factorio/src/lifecycle.js';

const continuation=process.argv.includes('--continue')?process.argv[process.argv.indexOf('--continue')+1]:undefined;
if(process.argv.includes('--continue')&&!continuation)throw new Error('--continue requires an evidence directory');
const profileFile=process.argv.includes('--profile-file')?process.argv[process.argv.indexOf('--profile-file')+1]!:'.runtime/phase04/current.json';
const dir=continuation?await resumeProfile(continuation):(JSON.parse(await readFile(profileFile,'utf8')) as {dir:string}).dir;
const launch=await readProfile(dir);
const evidence=await mkdtemp(path.join(dir,'pause-probe-'));let cursor=0;const checks:string[]=[];
const sink=(event:unknown)=>{appendFileSync(path.join(evidence,'events.jsonl'),JSON.stringify({sequence:++cursor,...record(event)})+'\n');};
const pass=(label:string)=>{checks.push(label);sink({kind:'probe/pass',label});console.log(label);};
const sourceFiles=['mods/autofactorio/control.lua','mods/autofactorio/lifecycle.lua','mods/autofactorio/ownership.lua','mods/autofactorio/actions.lua','mods/autofactorio/common.lua','mods/autofactorio/info.json'];
const hashes=Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,sha256(await readFile(file))])));const modHash=sha256(Buffer.from(JSON.stringify(hashes)));
await writeFile(path.join(evidence,'source-manifest.json'),JSON.stringify(hashes,null,2));
// A live profile must use exactly the sources being tested.
for(const file of sourceFiles)assert.equal(sha256(await readFile(path.join(dir,'mods/autofactorio_0.1.0',path.basename(file)))),hashes[file]);
const probeFingerprint=await fingerprint(['scripts/game-pause-probe.ts','scripts/dev/game-processes.ts','scripts/dev/probe-stages.ts','packages/factorio/src/lifecycle.ts','packages/factorio/src/client.ts','packages/contracts/src/game.ts']);
const stages=new ProbeStages(evidence,{profile:dir,modHash,probeFingerprint});
let port!:Rcon;let game!:GameClient;let life!:Lifecycle;let control!:ControlState;let serial=0;let stoppedAfter:string|undefined;
const observe=()=>game.request(observeRequest);
const actor=(w:Record<string,unknown>)=>record(record(w.actors)['builder-1']);
const batch=(steps:Step[]):Batch=>({commandId:path.basename(evidence)+'-'+ ++serial,epoch:control.epoch,session:control.session,task:'phase03-actions',revision:1,actor:'builder-1',surface:'nauvis',grants: diagnosticGrants(control.generation),deadline:control.tick+36000,steps});
const submit=async(steps:Step[])=>{control=await life.heartbeat(control);const b=batch(steps);await game.request({op:'submit',batch:b});return b;};
async function finish(b:Batch){for(let i=0;i<200;i++){control=await life.heartbeat(control);const r=await game.receipt(b.commandId);assert(r);if(!['running','accepted'].includes(r.status))return r;await delay(80);}throw new Error('Timed action did not finish');}
async function rearm(){control=await life.reconcile(control);control=await life.arm(control);}
async function frozen(label:string, polls=8){
 const before=await life.inspect();barrier(before);const w=await observe();
 for(let i=0;i<polls;i++){
  await delay(150);const current=await life.inspect();barrier(current);
  for(const field of ['tick','experimentTick','scenarioElapsed','injections','ledger','intents','production'] as const)assert.deepEqual(current[field],before[field],label+' '+field);
  const now=await observe();assert.deepEqual(now.actors,w.actors);assert.deepEqual(now.entities,w.entities);
 }
 const after=await life.inspect();assert(after.ticksPlayed>before.ticksPlayed,'Polling tick telemetry continues');
 sink({kind:'probe/frozen',label,before,after,world:w});pass(label);
}
let crafting:Batch;let post:Batch;let oldTraffic:Record<string,unknown>;let oldCancel:Record<string,unknown>;
let manifestPath:string|undefined;let restoredDirectory:string|undefined;let failure:string|null=null;let restorePid:number|undefined;let observerPid:number|undefined;
try {
 await stages.complete('started');
 if(!continuation){
 port=await waitForServer(launch);
 await port.command('/silent-command rcon.print("AutoFactorio phase04")');await port.command('/silent-command rcon.print("AutoFactorio phase04")');
 game=new GameClient(port,sink);life=new Lifecycle(port,game,sink);control=await life.inspect();
 let initial=await observe();console.log('Waiting for initial visible client to join');
 initial=await waitFor('Initial visible player',async()=>{const world=await observe();return record(world.actors)['builder-1']&&actor(world).connected===true?world:undefined;});
 await identifyObserver(launch);await stages.complete('initial-ready');
 assert.equal(actor(initial).connected,true,'Visible client must join before probe');assert.equal(control.armed,false);assert.equal(Object.keys(control.ledger).length,0,'Fresh world required');
 control=await life.rpc({op:'fixture'});control=await life.pause(control);await rearm();
 const productionStart=control.production;for(let i=0;i<24;i++){await delay(150);control=await life.heartbeat(control);}assert.notDeepEqual(control.production,productionStart);assert(Number(control.production.finished)>0);pass('Live furnace production and simulation timers advance before pause');
 const moving=await submit([{kind:'walk',position:{x:25,y:15}}]);await delay(300);const beforeMovement=await observe();assert.equal(record(actor(beforeMovement).walking).walking,true);
 control=await life.pause(control);assert.equal((await game.receipt(moving.commandId))?.status,'suspended');await frozen('Movement, production, timers and inventory freeze under repeated polling');
 await assert.rejects(()=>game.request({op:'submit',batch:batch([{kind:'walk',position:{x:0,y:0}}])}),/admission closed/);
 const raw=JSON.parse(await port.command(wrapper({op:'submit',batch:batch([{kind:'walk',position:{x:0,y:0}}])})));assert.equal(raw.error,'executor_disarmed');pass('Node and Lua both close action admission while paused');
 const oldArm={op:'arm',...fence(control)};await assert.rejects(()=>life.rpc(oldArm),/reconciliation_required/);control=await life.inspect();await rearm();
 const back=await submit([{kind:'walk',position:{x:0,y:0}}]);assert.equal((await finish(back)).status,'completed');
 crafting=await submit([{kind:'craft',recipe:'iron-gear-wheel',count:40},{kind:'place',item:'wooden-chest',quality:'normal',direction:0,position:{x:2.5,y:2.5}}]);
 await delay(200);const craftingWorld=await observe();assert(Array.isArray(actor(craftingWorld).crafting)&& (actor(craftingWorld).crafting as unknown[]).length>0);
 control=await life.pause(control);assert.equal((await game.receipt(crafting.commandId))?.status,'suspended');assert.equal(control.neutral,true);await frozen('Active native crafting is neutralized; saved pending intent cannot progress');
 manifestPath=await captureCheckpoint({lifecycle:life,paused:control,saveDirectory:path.join(dir,'data/saves'),outputDirectory:path.join(evidence,'checkpoints'),logFile:path.join(dir,'host-process.log'),eventCursor:()=>cursor,world:observe,modHash});
 const manifest=await validateCheckpoint(manifestPath,modHash);assert(Object.keys(manifest.captured.intents).includes(crafting.commandId));await stages.complete('captured',{manifestPath,sha256:manifest.sha256});pass('Completed disarmed checkpoint has verified ZIP checksum, ledger, world and event cursor');
 await game.request({op:'cancel',commandId:crafting.commandId,epoch:control.epoch,session:control.session});assert.equal((await game.receipt(crafting.commandId))?.status,'cancelled');
 control=await life.inspect();await rearm();post=await submit([{kind:'place',item:'wooden-chest',quality:'normal',direction:0,position:{x:2.5,y:2.5}}]);assert.equal((await finish(post)).status,'completed');
 const latest=await life.inspect();const plan=reconciliation(manifest.captured,latest.ledger);assert(plan.cancelledAfterCheckpoint.includes(crafting.commandId));assert(plan.absentAfterRollback.includes(post.commandId));await writeFile(path.join(evidence,'reconciliation-plan.json'),JSON.stringify(plan,null,2));
 // Retain a real armed native save as a rejected automatic source.
 const nativeName='unsafe-'+path.basename(evidence);assert.equal(JSON.parse(await port.command(wrapper({op:'save',name:nativeName},true))).ok,true);
 await assert.rejects(()=>prepareManagedLoad(path.join(dir,'data/saves',nativeName+'.json'),modHash,path.join(evidence,'unsafe-load')),/Uncontrolled/);pass('Armed native save is refused without a managed checkpoint manifest');
 control=await life.pause(control);oldTraffic={op:'submit',batch:crafting};oldCancel={op:'cancel',commandId:crafting.commandId,epoch:crafting.epoch,session:crafting.session};
 await stages.complete('restore-ready',{manifestPath,crafting,post,checks:[...checks],plan});
 }else{
  const previous=await readResume(continuation,modHash,probeFingerprint);manifestPath=previous.manifestPath;crafting=previous.crafting;post=previous.post;
  oldTraffic={op:'submit',batch:crafting};oldCancel={op:'cancel',commandId:crafting.commandId,epoch:crafting.epoch,session:crafting.session};
  sink({kind:'probe/continuation',source:continuation,previousChecks:previous.checks});checks.push(...previous.checks);
  await stages.complete('restore-ready',previous);
 }
 if(process.argv.includes('--stop-after')){
  if(process.argv[process.argv.indexOf('--stop-after')+1]!=='restore-ready')throw new Error('Only restore-ready is a supported deliberate stop');
  stoppedAfter='restore-ready';throw new Error('probe_stage_stop');
 }
 assert(manifestPath);const manifest=await validateCheckpoint(manifestPath,modHash);
 restoredDirectory=path.join(evidence,'managed-load');await prepareManagedLoad(manifestPath,modHash,restoredDirectory);
 const restored=await configureProfile(restoredDirectory,path.join(restoredDirectory,manifest.save),{source:launch,port:27025,gamePort:34205});
 restorePid=await startServer(restored);port?.close();port=await waitForServer(restored);
 await assert.rejects(()=>Rcon.connect(restored.port,launch.password),/authentication failed/);pass('Prior runtime credential cannot authenticate to the managed restore');
 game=new GameClient(port,sink);game.admission=false;life=new Lifecycle(port,game,sink);
 control=await life.inspect();verifyLoaded(manifest,control,await observe(),true);assert.equal((await game.receipt(post.commandId)),null);await frozen('Managed load preserves the pre-execution barrier before any client or reconciliation');
 // Saved-session traffic cannot arm an unreconciled checkpoint or move a suspended order.
 await assert.rejects(()=>life.rpc({op:'arm',...fence(manifest.captured)}),/reconciliation_required/);
 assert.equal(JSON.parse(await port.command(wrapper(oldTraffic))).receipt.status,'suspended');await frozen('Delayed saved-order replay remains inert before reconciliation',3);
 await stages.complete('load-held',{restoredDirectory,restorePid});
 const observerLauncherPid=await startObserver(restored,launch.observerConfig);
 await writeFile(path.join(evidence,'processes.json'),JSON.stringify({restorePid,observerLauncherPid,restoredDirectory},null,2));console.log('Waiting for visible restored client to join');
 await waitFor('Restored visible player',async()=>{const w=await observe();return record(w.actors)['builder-1']&&actor(w).connected===true?w:undefined;});
 observerPid=await identifyObserver(restored);
 await writeFile(path.join(evidence,'processes.json'),JSON.stringify({restorePid,observerPid,observerLauncherPid,restoredDirectory},null,2));
  verifyLoaded(manifest,await life.inspect(),await observe());pass('Visible multiplayer client joins held checkpoint without on_load mutation or world changes');await stages.complete('observer-verified',{observerPid});
 control=await life.inspect();control=await life.reconcile(control);assert.notEqual(control.epoch,manifest.captured.epoch);assert.equal(control.generation,manifest.captured.generation+1);assert.equal((await game.receipt(crafting.commandId))?.status,'cancelled');
 for(const request of [oldTraffic,oldCancel]){const r=JSON.parse(await port.command(wrapper(request)));assert.equal(r.error,'stale_epoch_or_session');}
 await assert.rejects(()=>life.rpc({op:'arm',...fence(manifest.captured)}),/stale_epoch_or_session/);await frozen('Reconciliation rejects cancelled saved intent and stale session traffic',3);await stages.complete('reconciled');
 const reconciled=control;control=await life.arm(control);await assert.rejects(()=>life.rpc({op:'arm',...fence(reconciled)}),/stale_control_revision/);game.admission=true;
 const fresh=await submit([{kind:'place',item:'wooden-chest',quality:'normal',direction:0,position:{x:2.5,y:2.5}}]);assert.equal((await finish(fresh)).status,'completed');const placed=await observe();assert.equal((placed.entities as Record<string,unknown>[]).filter(e=>e.name==='wooden-chest').length,1);pass('Only a fresh authorized command creates the rolled-back entity, exactly once');
 const watchdog=await submit([{kind:'craft',recipe:'iron-gear-wheel',count:35},{kind:'place',item:'wooden-chest',quality:'normal',direction:0,position:{x:4.5,y:2.5}}]);await delay(200);assert((actor(await observe()).crafting as unknown[]).length>0);
 port.close();await delay(3700);port=await Rcon.connect(restored.port,restored.password);game=new GameClient(port,sink);game.admission=false;life=new Lifecycle(port,game,sink);control=await life.inspect();assert.equal(control.armed,false);assert.equal(control.neutral,true);assert.equal(record(control).reason,'heartbeat_expired');assert.equal((await game.receipt(watchdog.commandId))?.status,'suspended');
 const beforeReconnect=await observe();control=await life.heartbeat(control);await delay(400);control=await life.heartbeat(control);assert.equal(control.armed,false);assert.deepEqual(actor(await observe()).inventory,actor(beforeReconnect).inventory);assert.equal((await game.receipt(watchdog.commandId))?.status,'suspended');pass('Heartbeat loss neutralizes native crafting; reconnect heartbeats cannot arm or run the next step');
 control=await life.pause(control);await rearm();const finalMove=await submit([{kind:'walk',position:{x:-2,y:0}}]);assert.equal((await finish(finalMove)).status,'completed');control=await life.pause(control);pass('Explicit reconciliation and fresh authorization recover after control loss');
 await stages.complete('complete',{checks});
 await writeFile(path.join(dir,'completed-pause-probe.json'),JSON.stringify({evidence,manifestPath,restoredDirectory,restorePid,observerPid},null,2));
} catch(error){if(!stoppedAfter){failure=String(error);process.exitCode=1;sink({kind:'probe/failed',failure});console.error(failure);}}
finally {
 try{if(life){control=await life.inspect();if(control.armed)control=await life.pause(control);}}catch(error){sink({kind:'probe/cleanupUnconfirmed',error:String(error)});}
 port?.close();await writeFile(path.join(evidence,'result.json'),JSON.stringify({passed:failure===null&&!stoppedAfter,stoppedAfter,continuation,failure,checks,manifestPath,restoredDirectory,restorePid,observerPid},null,2));console.log(JSON.stringify({evidence,failure,checks:checks.length}));
}
