import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { readFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import path from 'node:path';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import { LiveWorkshopGame } from '../apps/runtime/workshop-live-host.js';
import { WorkshopControl } from '../packages/factorio/src/workshop.js';
import { workshopObserver } from './dev/workshop-observer.js';
import { createProfile, listProjectProcesses, startServer, stopProfile, waitFor, waitForServer } from './dev/game-processes.js';
import { measurementLifecycleFixture } from './dev/workshop-measure-fixture.js';

// Never replace an existing observer just to run a diagnostic.
if((await listProjectProcesses()).some(value=>value.kind==='observer'))throw new Error('Close the project observer before the dedicated client recovery probe.');
await mkdir('.runtime/blueprint-client',{recursive:true});
const evidence=await mkdtemp(path.resolve('.runtime/blueprint-client/probe-'));
const profile=await createProfile(false,false,{port:27031,gamePort:34211});
const checks:string[]=[];let failure:string|null=null,cleanup=false;
let port:Awaited<ReturnType<typeof waitForServer>>|undefined;
let observer:ReturnType<typeof workshopObserver>|undefined;
let child:ReturnType<typeof spawn>|undefined;
console.log(JSON.stringify({evidence,profile:profile.config}));
try{
  await startServer(profile);port=await waitForServer(profile);
  const client=new GameClient(port,()=>{}),life=new Lifecycle(port,client,()=>{});
  await waitFor('Factorio operator RPC',async()=>{try{return await life.inspect();}catch{return undefined;}},180000,500);
  observer=workshopObserver(profile,client);
  const game=new LiveWorkshopGame(port,client,life,()=>{},undefined,profile.dir,profile.observerData,()=>observer!.ensure());
  const fixture=measurementLifecycleFixture(),assignment={...fixture.assignment,ports:[]};
  await game.preflight(assignment);
  const first=(await listProjectProcesses()).find(value=>value.config.toLowerCase()===profile.observerConfig.toLowerCase());assert.ok(first);
  checks.push('Direct blueprint preflight starts an absent client and waits for builder');
  await game.preflight(assignment);
  assert.equal((await listProjectProcesses()).find(value=>value.config.toLowerCase()===profile.observerConfig.toLowerCase())?.pid,first.pid);
  checks.push('Next blueprint run reuses the connected visible client');
  await stopProfile(profile.observerConfig);
  assert.equal((await listProjectProcesses()).some(value=>value.config.toLowerCase()===profile.observerConfig.toLowerCase()),false);
  await game.preflight({...assignment,construction:'character'});
  const second=(await listProjectProcesses()).find(value=>value.config.toLowerCase()===profile.observerConfig.toLowerCase());assert.ok(second);assert.notEqual(second.pid,first.pid);
  checks.push('Closing the game between runs starts a fresh connected client on character preflight');
  const built=await game.build({id:'client-recovery',activeIteration:1,assignment} as never,fixture.document,fixture.capability);
  const inspected=await new WorkshopControl(port).inspect(built.id);assert.ok(inspected);
  assert.ok(await game.screenshot(built,'client-recovery-final'));
  checks.push('Blueprint builds through production adapter and renders after recovery');
  if(process.platform==='win32'){
    await observer.close();observer=undefined;
    const profileFile=path.join(evidence,'profile.json'),marker=path.join(evidence,'observer-owned.json'),signalMarker=path.join(evidence,'child-signal.txt');
    await writeFile(profileFile,JSON.stringify({dir:profile.dir}));
    const moduleUrl=(file:string)=>pathToFileURL(path.resolve(`dist/${file}`)).href;
    const childFile=path.join(evidence,'shutdown-child.mjs');
    await writeFile(childFile,`
import {writeFileSync} from 'node:fs';
import {readProfile,waitForServer} from ${JSON.stringify(moduleUrl('scripts/dev/game-processes.js'))};
import {workshopObserver} from ${JSON.stringify(moduleUrl('scripts/dev/workshop-observer.js'))};
import {GameClient} from ${JSON.stringify(moduleUrl('packages/factorio/src/client.js'))};
const profile=await readProfile(${JSON.stringify(profile.dir)}),port=await waitForServer(profile);
const manager=workshopObserver(profile,new GameClient(port,()=>{}),()=>writeFileSync(${JSON.stringify(marker)},JSON.stringify({profileFile:${JSON.stringify(profileFile)},observerConfig:profile.observerConfig})));
process.on('SIGINT',()=>{writeFileSync(${JSON.stringify(signalMarker)},'handled');void manager.close();});
await manager.ensure();process.send({ready:true});setInterval(()=>{},1000);
`);
    await new Promise<void>((resolve,reject)=>{
      child=spawn(process.execPath,[childFile],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
      const timer=setTimeout(()=>reject(new Error('Shutdown child readiness timed out')),180000);
      child.once('message',()=>{clearTimeout(timer);resolve();});
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',()=>{clearTimeout(timer);reject(new Error('Shutdown child exited before readiness'));});
    });
    await access(marker);
    await new Promise<void>(resolve=>{child!.once('exit',()=>resolve());child!.kill('SIGINT');});
    assert.equal(existsSync(signalMarker),false,'Windows termination bypasses the JS cleanup handler');
    assert.ok((await listProjectProcesses()).some(value=>value.config.toLowerCase()===profile.observerConfig.toLowerCase()));
    // Execute the actual launcher cleanup functions after the child is gone.
    // This isolates ownership cleanup from provider preparation and inference.
    const source=await readFile('scripts/start.mjs','utf8');
    const cleanup=source.slice(source.indexOf('async function stopObserver('),source.indexOf('\nasync function main()'));
    const ownership=source.slice(source.indexOf('async function stopDashboardObserver('),source.indexOf('\nasync function shutdown()'));
    const context=vm.createContext({path,readFile,existsSync,process,ownedObserver:false,dashboardDirectory:evidence,console,text:String,run:(command:string,args:string[])=>promisify(execFile)(command,args,{windowsHide:true,timeout:30000})});
    vm.runInContext(`${cleanup}\n${ownership}`,context);
    await (vm.runInContext('stopDashboardObserver',context) as (file:string)=>Promise<void>)(profileFile);
    assert.equal((await listProjectProcesses()).some(value=>value.config.toLowerCase()===profile.observerConfig.toLowerCase()),false);
    checks.push('Windows parent cleans the recovered client after terminating dashboard child before signal cleanup');
  }
}catch(error){failure=String(error);process.exitCode=1;console.error(failure.slice(0,1000));}
finally{
  try{child?.kill();await observer?.close();await stopProfile(profile.observerConfig);port?.close();await stopProfile(profile.config);cleanup=true;}
  catch(error){failure??=String(error);process.exitCode=1;}
  await writeFile(path.join(evidence,'result.json'),JSON.stringify({passed:failure===null,checks,failure,cleanup,modelInference:false},null,2));
  console.log(JSON.stringify({evidence,checks:checks.length,failure,cleanup}));
}
