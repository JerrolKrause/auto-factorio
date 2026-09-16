import { diagnosticGrants } from '@autofactorio/contracts';
﻿import { beforeAll, describe, it, expect } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { safeProcess, ownedPath, waitFor } from '../scripts/dev/game-processes.js';
import { ProbeStages, readResume, resumeProfile } from '../scripts/dev/probe-stages.js';
import { sha256 } from '../packages/factorio/src/lifecycle.js';
import type { ControlState, Checkpoint } from '../packages/factorio/src/lifecycle.js';
import type { Batch } from '@autofactorio/contracts';
const tempRoot=path.resolve('.runtime/retro-improvements');
beforeAll(async()=>{await mkdir(tempRoot,{recursive:true});});
const temp=()=>mkdtemp(path.join(tempRoot,'test-'));
const batch:Batch={commandId:'pending',epoch:'e1',session:'s1',task:'phase03-actions',revision:1,actor:'builder-1',surface:'nauvis',grants: diagnosticGrants(1),deadline:200,steps:[{kind:'craft',recipe:'iron-gear-wheel',count:2}]};
async function resumeFixture(){
 const dir=await temp();const bytes=Buffer.alloc(68);bytes.writeUInt32LE(0x02014b50);bytes.writeUInt32LE(0x06054b50,46);bytes.writeUInt16LE(1,54);bytes.writeUInt16LE(1,56);bytes.writeUInt32LE(46,58);
 const captured:ControlState={ok:true,epoch:'e1',session:'s1',revision:2,generation:1,armed:false,ready:false,paused:true,neutral:true,ticksToRun:0,tick:100,ticksPlayed:200,experimentTick:100,scenarioElapsed:100,injections:1,checkpoint:'save',ledger:{pending:{commandId:'pending',status:'suspended',acceptedTick:10,completed:0,unexecuted:1,steps:[]}},intents:{pending:batch.steps},production:{},mods:{}};
 const checkpoint:Checkpoint={schema:1,source:'managed-disarmed',name:'save',save:'save.zip',sha256:sha256(bytes),size:bytes.length,eventCursor:1,captured,world:{},modHash:'mod'};
 const manifestPath=path.join(dir,'save.json');await writeFile(manifestPath,JSON.stringify(checkpoint));await writeFile(path.join(dir,'save.zip'),bytes);
 const journal=new ProbeStages(dir,{profile:dir,modHash:'mod',probeFingerprint:'probe'});
 const data={manifestPath,crafting:batch,post:{...batch,commandId:'post'},checks:['pause'],plan:{cancelledAfterCheckpoint:['pending'],absentAfterRollback:['post']}};
 return {dir,journal,data};
}
describe('development process and recovery helpers',()=>{
 it('projects only safe process fields even if credentials are present',()=>{const p=safeProcess({pid:12,config:'C:/repo/.runtime/config.ini',startedAt:'time',kind:'server',gamePort:34204,rconPort:27024,CommandLine:'--rcon-password secret',password:'secret',environment:{TOKEN:'secret'}});expect(Object.keys(p).sort()).toEqual(['config','gamePort','kind','pid','rconPort','startedAt']);expect(JSON.stringify(p)).not.toContain('secret');});
 it.each([0,-1,NaN,'123'])('rejects malformed process identity %s',pid=>expect(()=>safeProcess({pid,config:'a',startedAt:'b',kind:'server'})).toThrow());
 it('rejects paths outside project runtime before process mutation',async()=>{const outside=await mkdtemp(path.join(os.tmpdir(),'af-outsider-'));await expect(ownedPath(outside)).rejects.toThrow('project-owned');});
 it('waits for actual readiness and reports missing readiness',async()=>{let calls=0;expect(await waitFor('test',async()=>++calls===2?'ready':undefined,1000,1)).toBe('ready');await expect(waitFor('missing',async()=>undefined,5,1)).rejects.toThrow('readiness unconfirmed');});
 it('resumes from a persisted stage without a result file or live original server',async()=>{const {dir,journal,data}=await resumeFixture();await journal.complete('restore-ready',data);expect(await resumeProfile(dir)).toBe(dir);expect(await readResume(dir,'mod','probe')).toEqual(data);await expect(access(path.join(dir,'result.json'))).rejects.toThrow();});
 it.each(['source','mod','complete','captured-only','cancel-plan','checksum'])('rejects unsupported recovery: %s',async reason=>{const {dir,journal,data}=await resumeFixture();if(reason==='cancel-plan')data.plan.cancelledAfterCheckpoint=[];await journal.complete(reason==='captured-only'?'captured':'restore-ready',data);if(reason==='complete')await journal.complete('complete');if(reason==='checksum')await writeFile(path.join(dir,'save.zip'),'interrupted');await expect(readResume(dir,reason==='mod'?'changed':'mod',reason==='source'?'changed':'probe')).rejects.toThrow();});
 it('does not treat an uncommitted stage file as a continuation point',async()=>{const {dir}=await resumeFixture();await writeFile(path.join(dir,'stages.json.pending'),'{}');await expect(resumeProfile(dir)).rejects.toThrow('No stage journal');});
 it('does not emit JavaScript for a type error with the repository compiler policy',async()=>{const dir=await temp();await writeFile(path.join(dir,'bad.ts'),'export const value: number = "wrong";');await writeFile(path.join(dir,'tsconfig.json'),JSON.stringify({extends:path.resolve('tsconfig.base.json'),compilerOptions:{outDir:'out',types:[]},include:['bad.ts']}));const result=spawnSync(process.execPath,[path.resolve('node_modules/typescript/bin/tsc'),'-p',path.join(dir,'tsconfig.json')],{windowsHide:true,encoding:'utf8'});expect(result.status).not.toBe(0);expect(result.stdout).toContain('not assignable');await expect(access(path.join(dir,'out/bad.js'))).rejects.toThrow();const config=JSON.parse(await readFile('tsconfig.base.json','utf8'));expect(config.compilerOptions.noEmitOnError).toBe(true);});
});
