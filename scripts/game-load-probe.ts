import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { Rcon } from '../packages/factorio/src/rcon.js';
import { GameClient, observeRequest } from '../packages/factorio/src/client.js';
const {dir}=JSON.parse(await readFile('.runtime/phase03/current.json','utf8')) as {dir:string};
const config=JSON.parse(await readFile(path.join(dir,'launch.json'),'utf8')) as {executable:string;password:string};
const completed=JSON.parse(await readFile(path.join(dir,'completed-probe.json'),'utf8')) as {evidence:string;commands:string[];saveName:string};
const save=path.join(dir,'data/saves',completed.saveName+'.zip');
for(let i=0;;i++){try{assert((await stat(save)).size>0);break;}catch(e){if(i>=50)throw e;await delay(100);}}
const events=(await readFile(path.join(completed.evidence,'events.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line) as {kind:string;response?:{receipt?:{commandId:string}}});
const expected=new Map(events.filter(e=>e.kind==='game/response'&&e.response?.receipt).map(e=>[e.response!.receipt!.commandId,e.response!.receipt]));
const loadDir=path.join(dir,'receipt-readback');await mkdir(path.join(loadDir,'data'),{recursive:true});
const originalConfig=await readFile(path.join(dir,'config.ini'),'utf8');await writeFile(path.join(loadDir,'config.ini'),originalConfig.replace(/^write-data=.*$/m,'write-data='+path.join(loadDir,'data').replaceAll('\\','/')));
const fd=openSync(path.join(loadDir,'process.log'),'a');const child=spawn(config.executable,['--config',path.join(loadDir,'config.ini'),'--mod-directory',path.join(dir,'mods'),'--start-server',save,'--server-settings',path.join(dir,'server-settings.json'),'--bind','127.0.0.1:34200','--rcon-bind','127.0.0.1:27020','--rcon-password',config.password],{windowsHide:true,stdio:['ignore',fd,fd]});
let rcon:Rcon|undefined;const trace:unknown[]=[];
try{
 for(let i=0;!rcon;i++){try{rcon=await Rcon.connect(27020,config.password);}catch(e){if(i>=60)throw e;await delay(200);}}
 const client=new GameClient(rcon,e=>trace.push(e));const o=await client.request(observeRequest);assert.equal(o.loadedReadOnly,true);
 for(const id of completed.commands){const r=await client.receipt(id);assert.deepEqual(r,expected.get(id),'Persisted receipt '+id);}
 await assert.rejects(()=>client.request({op:'submit',batch:{commandId:'readback-new',epoch:o.epoch,session:o.session,task:'phase03-actions',revision:1,actor:'builder-1',surface:'nauvis',grant:{id:'test-area',generation:1},deadline:Number(o.tick)+100,steps:[{kind:'walk',position:{x:0,y:0}}]}}),/executor_disarmed/);
 await writeFile(path.join(loadDir,'result.json'),JSON.stringify({passed:true,receipts:completed.commands.length,loadedReadOnly:true},null,2));console.log(JSON.stringify({passed:true,receipts:completed.commands.length,loadDir}));
}finally{rcon?.close();child.kill();closeSync(fd);await writeFile(path.join(loadDir,'events.jsonl'),trace.map(e=>JSON.stringify(e)).join('\n')+'\n');}
