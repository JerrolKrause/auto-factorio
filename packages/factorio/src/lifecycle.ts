import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import { record, validateReceipt } from '@autofactorio/contracts';
import type { Receipt } from '@autofactorio/contracts';
import type { CommandPort } from './rcon.js';
import { wrapper } from './rcon.js';
import type { GameClient } from './client.js';

export interface ControlState {
  ok: true; epoch: string; session: string; revision: number; generation: number;
  armed: boolean; ready: boolean; paused: boolean; neutral: boolean; ticksToRun: number;
  tick: number; ticksPlayed: number; experimentTick: number; scenarioElapsed: number; injections: number;
  checkpoint: string | false; ledger: Record<string, Receipt>; intents: Record<string, unknown>;
  production: Record<string, unknown>; mods: Record<string, string>;
}
export function state(value: unknown): ControlState {
  const s=record(value);
  for(const key of ['epoch','session'])if(typeof s[key]!=='string'||!s[key])throw new Error('Invalid control identity');
  for(const key of ['revision','generation','ticksToRun','tick','ticksPlayed','experimentTick','scenarioElapsed','injections'])if(!Number.isSafeInteger(s[key])||Number(s[key])<0)throw new Error('Invalid control counter');
  for(const key of ['armed','ready','paused','neutral'])if(typeof s[key]!=='boolean')throw new Error('Invalid control flag');
  if(s.checkpoint!==false&&(typeof s.checkpoint!=='string'||!/^[\w.-]{1,100}$/.test(s.checkpoint)))throw new Error('Invalid checkpoint identity');
  const ledger=record(s.ledger);for(const [id,r] of Object.entries(ledger)){const receipt=validateReceipt(r);if(!receipt||receipt.commandId!==id)throw new Error('Invalid ledger');}
  record(s.intents);record(s.production);record(s.mods);
  if(s.ok!==true)throw new Error('Unacknowledged control state');
  return s as unknown as ControlState;
}
export function barrier(s: ControlState): void {
  if(s.armed||!s.paused||!s.neutral||s.ticksToRun!==0)throw new Error('Restore requires a disarmed neutral paused barrier');
  if(Object.values(s.ledger).some(r=>r.status==='accepted'||r.status==='running'))throw new Error('Live order behind barrier');
}
export function fence(s: ControlState) {return {epoch:s.epoch,session:s.session,revision:s.revision};}
/** Only current world receipts are facts after rollback. Latest intent can cancel, never invent effects. */
export function reconciliation(saved: ControlState, latest: Record<string, Receipt>) {
  barrier(saved);
  return {
    worldLedger: saved.ledger,
    cancelledAfterCheckpoint: Object.keys(saved.intents).filter(id=>latest[id]?.status==='cancelled'),
    requiresFreshAuthorization: Object.keys(saved.intents),
    absentAfterRollback: Object.keys(latest).filter(id=>!saved.ledger[id]),
  };
}
export class Lifecycle {
  constructor(private port: CommandPort, private game: GameClient, private sink: (e: unknown)=>void) {}
  async rpc(request: Record<string, unknown>): Promise<ControlState> {
    this.sink({at:new Date().toISOString(),kind:'control/request',request});
    try {
      const response=record(JSON.parse(await this.port.command(wrapper(request,true))));
      this.sink({at:new Date().toISOString(),kind:'control/response',response});
      if(response.ok!==true)throw new Error(String(response.error??'Unacknowledged control'));
      return state(response);
    } catch(error) {this.game.admission=false;this.sink({kind:'control/unconfirmedOrRejected',error:String(error)});throw error;}
  }
  inspect() {return this.rpc({op:'state'});}
  async pause(s:ControlState) {
    this.game.admission=false;let paused=await this.rpc({op:'pause',...fence(s)});const revision=paused.revision;
    for(let i=0;i<50;i++){
      if(paused.revision!==revision||paused.epoch!==s.epoch||paused.session!==s.session)throw new Error('Pause control changed before acknowledgment');
      if(paused.paused&&paused.neutral&&paused.ticksToRun===0){barrier(paused);return paused;}
      await delay(50);paused=await this.inspect();
    }
    throw new Error('Neutral pause unconfirmed');
  }
  heartbeat(s:ControlState) {return this.rpc({op:'heartbeat',...fence(s)});}
  async reconcile(s:ControlState) {
    this.game.admission=false;barrier(s);
    return this.rpc({op:'reconcile',...fence(s),checkpoint:s.checkpoint,ledger:s.ledger,newEpoch:randomUUID(),newSession:randomUUID(),generation:s.generation+1});
  }
  async arm(s:ControlState) {
    if(this.game.unresolved.size)throw new Error('Unknown game outcomes require reconciliation before arm');
    const armed=await this.rpc({op:'arm',...fence(s)});
    if(!armed.armed||armed.paused)throw new Error('Arm not confirmed');
    this.game.admission=true;return armed;
  }
}
export interface Checkpoint {
  schema: 1; source: 'managed-disarmed'; name: string; save: string; sha256: string; size: number;
  eventCursor: number; captured: ControlState; world: Record<string,unknown>; modHash: string;
}
export const sha256=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** The final ZIP directory must exist, not merely a file with a .zip suffix. */
export function completeZip(bytes: Buffer): boolean {
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){
    if(bytes.readUInt32LE(i)!==0x06054b50)continue;
    return i+22+bytes.readUInt16LE(i+20)===bytes.length && bytes.readUInt16LE(i+4)===0 && bytes.readUInt16LE(i+6)===0 && bytes.readUInt16LE(i+10)>0 && bytes.readUInt32LE(i+12)+bytes.readUInt32LE(i+16)===i;
  }
  return false;
}
export async function validateCheckpoint(manifestPath:string, expectedModHash:string):Promise<Checkpoint> {
  let raw:unknown;try{raw=JSON.parse(await readFile(manifestPath,'utf8'));}catch{throw new Error('Uncontrolled or incomplete save: managed manifest required');}
  const m=record(raw);
  if(m.schema!==1||m.source!=='managed-disarmed'||typeof m.name!=='string'||!/^[\w.-]{1,100}$/.test(m.name)||m.save!==m.name+'.zip'||m.modHash!==expectedModHash||!Number.isSafeInteger(m.eventCursor)||Number(m.eventCursor)<0)throw new Error('Invalid or mismatched checkpoint manifest');
  const captured=state(m.captured);barrier(captured);
  if(captured.ready||captured.checkpoint!==m.name)throw new Error('Unpublished capture state');
  record(m.world);
  const bytes=await readFile(path.join(path.dirname(manifestPath),String(m.save)));
  if(bytes.length!==m.size||sha256(bytes)!==m.sha256||!completeZip(bytes))throw new Error('Checkpoint checksum or save completion mismatch');
  return m as unknown as Checkpoint;
}
export async function captureCheckpoint(options: {
  lifecycle:Lifecycle; paused:ControlState; saveDirectory:string; outputDirectory:string;
  logFile:string; eventCursor:()=>number; world:()=>Promise<Record<string,unknown>>; modHash:string; timeoutMs?:number;
}):Promise<string> {
  const {lifecycle,paused,saveDirectory,outputDirectory,logFile,world,modHash}=options;barrier(paused);
  const name='checkpoint-'+randomUUID();const savePath=path.join(saveDirectory,name+'.zip');
  const logStart=(await stat(logFile)).size;
  const captured=await lifecycle.rpc({op:'capture',...fence(paused),name});barrier(captured);
  const initialWorld=await world();const until=Date.now()+(options.timeoutMs??15000);let bytes:Buffer|undefined;
  while(Date.now()<until){
    try{
      const log=(await readFile(logFile)).subarray(logStart).toString();
      if(log.includes(name)&&/Saving finished/.test(log)) {const data=await readFile(savePath);if(completeZip(data)){bytes=data;break;}}
    }catch{/* Capture is unpublished while bytes or completion acknowledgment are unavailable. */}
    await delay(100);
  }
  if(!bytes)throw new Error('Save completion unconfirmed; capture not published');
  const after=await lifecycle.inspect();barrier(after);
  if(!isDeepStrictEqual({...captured,ticksPlayed:0},{...after,ticksPlayed:0}))throw new Error('Capture state changed while saving');
  const afterWorld=await world();
  const stable=(w:Record<string,unknown>)=>({...w,ticksPlayed:0});
  if(!isDeepStrictEqual(stable(initialWorld),stable(afterWorld)))throw new Error('Capture world changed while saving');
  await mkdir(outputDirectory,{recursive:true});
  await writeFile(path.join(outputDirectory,name+'.zip'),bytes,{flag:'wx'});
  const manifest:Checkpoint={schema:1,source:'managed-disarmed',name,save:name+'.zip',sha256:sha256(bytes),size:bytes.length,eventCursor:options.eventCursor(),captured,world:afterWorld,modHash};
  const file=path.join(outputDirectory,name+'.json');await writeFile(file+'.pending',JSON.stringify(manifest,null,2),{flag:'wx'});
  await rename(file+'.pending',file);await validateCheckpoint(file,modHash);return file;
}
/** Copy verified bytes into a fresh managed load directory; never start an arbitrary save. */
export async function prepareManagedLoad(manifestPath:string,modHash:string,directory:string):Promise<Checkpoint> {
  const manifest=await validateCheckpoint(manifestPath,modHash);
  await mkdir(directory);const source=path.join(path.dirname(manifestPath),manifest.save);const target=path.join(directory,manifest.save);
  await copyFile(source,target);const bytes=await readFile(target);
  if(sha256(bytes)!==manifest.sha256)throw new Error('Save changed during managed load preparation');
  return manifest;
}
export function verifyLoaded(manifest:Checkpoint,loaded:ControlState,world:Record<string,unknown>, allowDisconnected=false) {
  barrier(loaded);
  const stable=(s:ControlState)=>({...s,ticksPlayed:0});
  if(!isDeepStrictEqual(stable(manifest.captured),stable(loaded)))throw new Error('Restored ledger or barrier differs from checkpoint');
  // Network connection state can change; game effects cannot.
  const present=record(world.actors);
  const effects=(w:Record<string,unknown>)=>({tick:w.tick,entities:(w.entities as Record<string,unknown>[]).filter(e=>!allowDisconnected||e.type!=='character'),actors:Object.fromEntries(Object.entries(record(w.actors)).filter(([id])=>!allowDisconnected||id in present).map(([id,a])=>{const v=record(a);return [id,{position:v.position,inventory:v.inventory,crafting:v.crafting,walking:v.walking,mining:v.mining}];}))});
  if(!isDeepStrictEqual(effects(manifest.world),effects(world)))throw new Error('Restored world differs from checkpoint');
}
