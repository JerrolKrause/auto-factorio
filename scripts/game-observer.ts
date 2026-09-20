import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { record } from '@autofactorio/contracts';
import { GameClient, observeRequest } from '../packages/factorio/src/client.js';
import { identifyObserver, listProjectProcesses, ownedPath, readProfile, startObserver, stopProfile, waitFor, waitForServer } from './dev/game-processes.js';
import type { GameProfile, ProjectProcess } from './dev/game-processes.js';

export interface ObserverDependencies {
  list():Promise<ProjectProcess[]>;
  start(profile:GameProfile,replaceConfig?:string,onSpawn?:(pid:number)=>void):Promise<number>;
  identify(profile:GameProfile):Promise<number>;
  stop(config:string):Promise<number[]>;
}
const observerDependencies:ObserverDependencies={list:listProjectProcesses,start:startObserver,identify:identifyObserver,stop:stopProfile};

/** Own only observers started by this call; a reused supplied-profile observer survives failures and shutdown. */
export async function ensureVisibleObserver(profile:GameProfile,ready:()=>Promise<void>,dependencies:ObserverDependencies=observerDependencies,onOwned:()=>void=()=>{}):Promise<{observerPid:number;launched:boolean}>{
  const processes=await dependencies.list(),matching=processes.find(value=>value.kind==='observer'&&path.resolve(value.config).toLowerCase()===path.resolve(profile.observerConfig).toLowerCase());
  let observerPid=matching?.pid,launched=false;
  try{
    if(!observerPid){const markOwned=()=>{if(!launched){launched=true;onOwned();}};await dependencies.start(profile,undefined,markOwned);markOwned();observerPid=await dependencies.identify(profile);}
    await ready();
    return{observerPid,launched};
  }catch(error){
    if(launched)await dependencies.stop(profile.observerConfig);
    throw error;
  }
}

async function main(){
  const flag=process.argv.indexOf('--profile-file');
  if(flag<0||!process.argv[flag+1])throw new Error('Use --profile-file <project profile JSON>');
  const profileFile=await ownedPath(path.resolve(process.argv[flag+1]!)),descriptor=JSON.parse(await readFile(profileFile,'utf8')) as {dir?:unknown};
  if(typeof descriptor.dir!=='string')throw new Error('Project profile descriptor is missing its directory');
  const profile=await readProfile(descriptor.dir);let owned=false,exiting=false;
  const interrupted=async(code:number)=>{if(exiting)return;exiting=true;try{if(owned)await stopProfile(profile.observerConfig);}finally{process.exit(code);}};
  process.once('SIGINT',()=>{void interrupted(130);});process.once('SIGTERM',()=>{void interrupted(143);});
  const result=await ensureVisibleObserver(profile,async()=>{
    const port=await waitForServer(profile);
    try{const game=new GameClient(port,()=>{});await waitFor('Visible AutoFactorio builder',async()=>{try{const world=await game.request(observeRequest),actor=record(record(world.actors)['builder-1']);return actor.connected===true?true:undefined;}catch{return undefined;}},180000,500);}finally{port.close();}
  },observerDependencies,()=>{owned=true;});
  console.log(JSON.stringify({visible:true,launched:result.launched,observerPid:result.observerPid,player:'builder-1',connected:true}));
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url)))await main();
