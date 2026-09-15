import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile, appendFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { record, requirements } from '@autofactorio/contracts';
import type { Batch, Step, Target, Item, RecipeFacts } from '@autofactorio/contracts';
import { Rcon, wrapper } from '../packages/factorio/src/rcon.js';
import { GameClient, observeRequest } from '../packages/factorio/src/client.js';
import { GameTools } from '../packages/tools/src/game.js';
const {dir}=JSON.parse(await readFile('.runtime/phase03/current.json','utf8')) as {dir:string};
const config=JSON.parse(await readFile(path.join(dir,'launch.json'),'utf8')) as {port:number;password:string};
await mkdir(path.join(dir,'evidence'),{recursive:true});const evidence=await mkdtemp(path.join(dir,'evidence/probe-'));
const sink=(event:unknown)=>{const line=JSON.stringify(event);appendFileSync(path.join(evidence,'events.jsonl'),line+'\n');console.log(line);};
const rcon=await Rcon.connect(config.port,config.password);
// Dedicated generated sandbox only: acknowledge Factorio's console-achievement notice with harmless prints.
await rcon.command('/silent-command rcon.print("AutoFactorio diagnostic")');
await rcon.command('/silent-command rcon.print("AutoFactorio diagnostic")');
let drop=false;
const client=new GameClient({command:async lua=>{const result=await rcon.command(lua);if(drop){drop=false;throw new Error('Simulated lost acknowledgment after engine response');}return result;},close:()=>rcon.close()},sink);
const tools=new GameTools('engineer','builder-1',r=>client.request(r));
let sequence=0;const results:string[]=[];const commands:string[]=[];
async function observe(){return client.request(observeRequest);}
function items(v:unknown):Item[]{return Array.isArray(v)?v as Item[]:[];}
function count(v:unknown,name:string){return items(v).filter(i=>i.name===name&&i.quality==='normal').reduce((n,i)=>n+i.count,0);}
function actor(o:Record<string,unknown>){return record(record(o.actors)['builder-1']);}
function target(e:Record<string,unknown>):Target{return {name:String(e.name),quality:String(e.quality),position:e.position as Target['position'],unit:typeof e.unit==='number'?e.unit:null};}
async function find(name:string,x?:number){const o=await observe();const e=(o.entities as Record<string,unknown>[]).find(e=>e.name===name&&(x===undefined||(e.position as {x:number}).x===x));assert(e, 'Missing entity '+name);return target(e);}
async function make(steps:Step[]):Promise<Batch>{const o=await observe();const commandId=path.basename(evidence)+'-'+ ++sequence;commands.push(commandId);return {commandId,epoch:String(o.epoch),session:String(o.session),task:'phase03-actions',revision:1,actor:'builder-1',surface:'nauvis',grant:{id:'test-area',generation:1},deadline:Number(o.tick)+3600,steps};}
async function finish(id:string){const deadline=Date.now()+65000;while(Date.now()<deadline){const r=await client.receipt(id);assert(r);if(!['accepted','running'].includes(r.status))return r;await delay(100);}throw new Error('Receipt timeout');}
async function run(label:string,steps:Step[],expected='completed'){const b=await make(steps);await tools.call({op:'submit',batch:b});const r=await finish(b.commandId);assert.equal(r.status,expected,label+': '+JSON.stringify(r));results.push(label);return r;}
const place=(item:string,x:number,y:number):Step=>({kind:'place',item,quality:'normal',direction:0,position:{x,y}});
let failure:string|null=null;
try{
 const initial=await observe();assert.equal(record(initial.mods)['space-age'],'2.0.77');assert.equal(actor(initial).connected,true,'Visible player required');assert.equal(initial.loadedReadOnly,false,'Fresh assigned sandbox required');
 const page=await client.request({...observeRequest,limit:2});assert.equal((page.entities as unknown[]).length,2);assert.equal(page.truncated,true);const next=await client.request({...observeRequest,limit:2,offset:2});assert.notDeepEqual(page.entities,next.entities);results.push('bounded live pagination and mod fingerprint');
 const facts=await client.request({op:'recipe',name:'automation-science-pack'});assert.deepEqual(requirements(facts.recipe as RecipeFacts,'automation-science-pack',10),{supported:true,crafts:10,seconds:50,ingredients:[{name:'copper-plate',quality:'normal',count:10},{name:'iron-gear-wheel',quality:'normal',count:10}]});
 const rich=await client.request({op:'recipe',name:'sulfur'});assert.equal(requirements(rich.recipe as RecipeFacts,'sulfur',10).supported,false);results.push('engine-derived ratios and explicit unsupported fluid recipe');
 const denied=JSON.parse(await rcon.command(wrapper({op:'raw',lua:'game.player.insert{}'})));assert.equal(denied.ok,false);results.push('Lua raw-operation rejection');
 const baseline=actor(await observe()).inventory;
 const reach=await run('out-of-reach rejection',[place('wooden-chest',30.5,0.5)],'failed');assert.match(JSON.stringify(reach),/out_of_reach/);assert.equal(count(actor(await observe()).inventory,'wooden-chest'),count(baseline,'wooden-chest'));
 await run('insufficient inventory rejection',[place('rocket-silo',4.5,0.5)],'failed');
 const collision=await run('collision rejection',[place('wooden-chest',3.5,-3.5)],'failed');assert.match(JSON.stringify(collision),/occupied_or_collision/);assert.deepEqual(actor(await observe()).inventory,baseline);
 const protectedTarget=await find('steel-chest');const protect=await run('protected fixture rejection',[{kind:'mine',target:protectedTarget}],'failed');assert.match(JSON.stringify(protect),/protected_fixture/);
 const walk=await run('normal timed movement',[{kind:'walk',position:{x:4,y:0}}]);assert(walk.steps[0]!.endedTick-walk.steps[0]!.startedTick>=20);
 const blocked=await run('blocked path rejection',[{kind:'walk',position:{x:8.5,y:0.5}}],'failed');assert.match(JSON.stringify(blocked),/path_unreachable|movement_blocked|deadline_exceeded/);
 await run('path around protected wall',[{kind:'walk',position:{x:11,y:0}}]);await run('return walk',[{kind:'walk',position:{x:0,y:0}}]);
 const craft=await run('normal timed crafting',[{kind:'craft',recipe:'iron-gear-wheel',count:2}]);assert(craft.steps[0]!.endedTick-craft.steps[0]!.startedTick>=59);assert.equal(count(craft.steps[0]!.after,'iron-gear-wheel')-count(craft.steps[0]!.before,'iron-gear-wheel'),2);assert.equal(count(craft.steps[0]!.after,'iron-plate')-count(craft.steps[0]!.before,'iron-plate'),-4);
 await run('walk into resource reach',[{kind:'walk',position:{x:-2,y:2}}]);const ore=await find('iron-ore');const mine=await run('normal timed resource mining',[{kind:'mine',target:ore}]);assert(mine.steps[0]!.endedTick>mine.steps[0]!.startedTick+1);assert.equal(count(mine.steps[0]!.after,'iron-ore')-count(mine.steps[0]!.before,'iron-ore'),1);
 await run('return from mining',[{kind:'walk',position:{x:0,y:0}}]);
 await run('inventory-backed placement',[place('wooden-chest',2.5,2.5),place('transport-belt',1.5,3.5),place('assembling-machine-1',-3.5,-3.5)]);
 const chest=await find('wooden-chest',2.5);const belt=await find('transport-belt',1.5);const assembler=await find('assembling-machine-1');
 await run('rotation recipe and inventory transfers',[{kind:'rotate',target:belt},{kind:'recipe',target:assembler,recipe:'automation-science-pack'},{kind:'transfer',target:chest,inventory:'chest',flow:'put',item:{name:'iron-plate',quality:'normal',count:5}},{kind:'transfer',target:chest,inventory:'chest',flow:'take',item:{name:'iron-plate',quality:'normal',count:5}}]);
 const changed=await observe();const machine=(changed.entities as Record<string,unknown>[]).find(e=>e.name==='assembling-machine-1');assert.equal(machine?.recipe,'automation-science-pack');assert.equal(machine?.craftingSpeed,0.5);const rotated=(changed.entities as Record<string,unknown>[]).find(e=>e.name==='transport-belt');assert.notEqual(rotated?.direction,0);
 const partial=await run('partial batch stops without rollback',[place('transport-belt',-1.5,3.5),place('transport-belt',-1.5,3.5),place('transport-belt',-2.5,3.5)],'partial');assert.equal(partial.completed,1);assert.equal(partial.unexecuted,1);await client.request({op:'cancel',commandId:partial.commandId});assert.equal((await client.receipt(partial.commandId))!.status,'partial');
 const cancellation=await make([{kind:'craft',recipe:'iron-gear-wheel',count:40},place('transport-belt',-4.5,3.5)]);await tools.call({op:'submit',batch:cancellation});await delay(250);await tools.call({op:'cancel',commandId:cancellation.commandId});const cancelled=await finish(cancellation.commandId);assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.unexecuted,1);results.push('active crafting cancellation and native refunds');
 const lostBefore=count(actor(await observe()).inventory,'wooden-chest');const lost=await make([place('wooden-chest',-3.5,0.5)]);drop=true;await assert.rejects(()=>tools.call({op:'submit',batch:lost}),/Simulated lost/);await assert.rejects(()=>tools.call({op:'submit',batch:{...lost,commandId:lost.commandId+'-other'}}),/reconciliation/);assert(await client.receipt(lost.commandId));const settled=await finish(lost.commandId);assert.equal(settled.completed,1);const replay=await client.request({op:'submit',batch:lost});assert.equal(record(replay.receipt).completed,1);const lostWorld=await observe();assert.equal(count(actor(lostWorld).inventory,'wooden-chest'),lostBefore-1);assert.equal((lostWorld.entities as Record<string,unknown>[]).filter(e=>e.name==='wooden-chest'&&(e.position as {x:number}).x===-3.5).length,1);results.push('lost response reconciled and duplicate ID idempotent');
 const deconstruct=await run('timed deconstruction returns item',[{kind:'mine',target:chest}]);assert(deconstruct.steps[0]!.endedTick>deconstruct.steps[0]!.startedTick);assert.equal(count(deconstruct.steps[0]!.after,'wooden-chest')-count(deconstruct.steps[0]!.before,'wooden-chest'),1);
 await appendFile(path.join(evidence,'operator.jsonl'),await rcon.command(wrapper({op:'screenshot',name:'phase03-complete'},true))+'\n');
 const save=await rcon.command(wrapper({op:'save',name:'phase03-complete'},true));await writeFile(path.join(evidence,'save-request.json'),save);assert.equal(JSON.parse(save).ok,true,'Quiescent save accepted');
 await writeFile(path.join(dir,'completed-probe.json'),JSON.stringify({evidence,commands,saveName:'phase03-complete'}));
}catch(error){failure=String(error);process.exitCode=1;sink({kind:'probe/failed',failure});}
finally{
 for(const commandId of commands){try{const r=await client.receipt(commandId);if(r&&['accepted','running'].includes(r.status))await client.request({op:'cancel',commandId});}catch{/* Unknown stays recorded. */}}
 client.close();await writeFile(path.join(evidence,'result.json'),JSON.stringify({failure,results,commands},null,2));console.log(JSON.stringify({evidence,failure,checks:results.length}));
}
