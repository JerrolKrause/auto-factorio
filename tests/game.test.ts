import { diagnosticGrants } from '@autofactorio/contracts';
import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { validateRequest, validateReceipt, requirements } from '@autofactorio/contracts';
import type { Batch, RecipeFacts } from '@autofactorio/contracts';
import { Rcon, wrapper } from '../packages/factorio/src/rcon.js';
import { GameTools } from '../packages/tools/src/game.js';
import { GameClient } from '../packages/factorio/src/client.js';
const batch: Batch={commandId:'c1',epoch:'phase03',session:'local-test',task:'phase03-actions',revision:1,actor:'builder-1',surface:'nauvis',grants: diagnosticGrants(1),deadline:1000,steps:[{kind:'walk',position:{x:1,y:2}}]};
const recipe: RecipeFacts={name:'iron-gear-wheel',energy:0.5,category:'crafting',ingredients:[{type:'item',name:'iron-plate',amount:2}],products:[{type:'item',name:'iron-gear-wheel',amount:1}]};
describe('structured game boundary',()=>{
 it('validates a bounded grant-bearing batch',()=>{expect(validateRequest({op:'submit',batch})).toEqual({op:'submit',batch});});
 it.each([{op:'raw',lua:'game.player.insert{name="iron-plate",count=100}'},{op:'save',name:'personal'},{op:'recipe',name:'iron-gear-wheel',lua:'return 1'},{op:'observe',surface:'nauvis',area:[{x:0,y:0},{x:2,y:2}],offset:0,limit:500}])('rejects arbitrary or oversized requests %j',r=>{expect(()=>validateRequest(r)).toThrow();});
 it.each([[],Array(101).fill({kind:'walk',position:{x:0,y:0}}),[{kind:'teleport',position:{x:0,y:0}}],[{kind:'walk',position:{x:Infinity,y:0}}]])('rejects malformed steps',steps=>{expect(()=>validateRequest({op:'submit',batch:{...batch,steps}})).toThrow();});
 it('enforces runtime role and actor authority before dispatch',async()=>{let calls=0;const dispatch=async()=>{calls++;};const foreman=new GameTools('foreman','builder-1',dispatch);await expect(foreman.call({op:'submit',batch})).rejects.toThrow('Role');const engineer=new GameTools('engineer','builder-2',dispatch);await expect(engineer.call({op:'submit',batch})).rejects.toThrow('Actor');expect(calls).toBe(0);});
 it('encodes injection-shaped text exclusively as decimal Lua bytes',()=>{
  const payload={op:'evil',text:'\"));game.player.insert{};--\nUnicode: \u00e9'};const code=wrapper(payload);
  const encoded=code.match(/,"((?:\\\d{3})+)"\)\)$/)![1]!;const decoded=Buffer.from([...encoded.matchAll(/\\(\d{3})/g)].map(m=>Number(m[1]))).toString('utf8');
  expect(JSON.parse(decoded)).toEqual(payload);expect(code).not.toContain('game.player');expect(()=>wrapper('x'.repeat(65537))).toThrow('large');
 });
 it('allows a bounded large held-ledger echo only for operator reconciliation',()=>{
  const ledger={receipt:'x'.repeat(100000)};
  expect(()=>wrapper({op:'reconcile',ledger},true)).not.toThrow();
  expect(()=>wrapper({op:'reconcile',ledger})).toThrow('large');
  expect(()=>wrapper({op:'state',ledger},true)).toThrow('large');
  expect(()=>wrapper({op:'reconcile',ledger:'x'.repeat(4*1024*1024)},true)).toThrow('large');
 });
 it.each([{commandId:'c1',status:'completed'},{commandId:'c1',status:'completed',acceptedTick:0,completed:1,unexecuted:0,steps:[]},{commandId:'c1',status:'completed',acceptedTick:0,completed:0,unexecuted:1,steps:[]}])('rejects incomplete or inconsistent receipt %j',r=>{expect(()=>validateReceipt(r)).toThrow();});
 it('uses recipe facts and rejects advanced forms without flattening',()=>{
  expect(requirements(recipe,'iron-gear-wheel',3)).toEqual({supported:true,crafts:3,seconds:1.5,ingredients:[{name:'iron-plate',quality:'normal',count:6}]});
  for(const r of [{...recipe,category:'chemistry'},{...recipe,ingredients:[{type:'fluid',name:'water',amount:1}]},{...recipe,products:[{type:'item',name:'iron-gear-wheel',amount:1,probability:0.5}]},{...recipe,products:[...recipe.products,...recipe.products]}])expect(requirements(r,'iron-gear-wheel',3).supported).toBe(false);
 });
 it('blocks conflicting actions until a persistent receipt resolves a lost acknowledgment',async()=>{
  let response='';let lose=true;let writes=0;
  const client=new GameClient({command:async()=>{writes++;if(lose)throw new Error('lost acknowledgment');return response;},close:()=>{}},()=>{});
  await expect(client.request({op:'submit',batch})).rejects.toThrow('lost');expect(client.unresolved.has('c1')).toBe(true);
  await expect(client.request({op:'submit',batch:{...batch,commandId:'c2'}})).rejects.toThrow('reconciliation');expect(writes).toBe(1);
  lose=false;response=JSON.stringify({ok:true,receipt:null});await client.receipt('c1');expect(client.unresolved.has('c1')).toBe(true);
  response=JSON.stringify({ok:true,receipt:{commandId:'c1',status:'completed',acceptedTick:1,completed:0,unexecuted:0,steps:[]}});await client.receipt('c1');expect(client.unresolved.size).toBe(0);
  response=JSON.stringify({ok:false,error:'invalid_grant'});await expect(client.request({op:'submit',batch})).rejects.toThrow('invalid_grant');expect(client.unresolved.size).toBe(0);
 });
});
describe('loopback RCON framing',()=>{
 it('assembles fragmented multi-packet responses and rejects concurrent requests',async()=>{
  const sockets=new Set<net.Socket>();
  const packet=(id:number,type:number,text:string)=>{const body=Buffer.from(text);const b=Buffer.alloc(body.length+14);b.writeInt32LE(body.length+10);b.writeInt32LE(id,4);b.writeInt32LE(type,8);body.copy(b,12);return b;};
  const server=net.createServer(socket=>{sockets.add(socket);let buffer=Buffer.alloc(0);socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4&&buffer.length>=buffer.readInt32LE(0)+4){const length=buffer.readInt32LE(0);const frame=buffer.subarray(4,length+4);buffer=buffer.subarray(length+4);const id=frame.readInt32LE(0);const type=frame.readInt32LE(4);if(type===3){socket.write(packet(id,2,''));continue;}const text=frame.subarray(8,-2).toString();const result=text==='test'?Buffer.concat([packet(id,0,'first'),packet(id,0,'second')]):packet(id,0,'');setTimeout(()=>{socket.write(result.subarray(0,2));socket.write(result.subarray(2));},text==='test'?30:0);}});});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));let rcon:Rcon|undefined;
  try{rcon=await Rcon.connect((server.address() as net.AddressInfo).port,'local');const result=rcon.command('test');await expect(rcon.command('other')).rejects.toThrow('Concurrent');expect(await result).toBe('firstsecond');}finally{rcon?.close();for(const s of sockets)s.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
 });
});
