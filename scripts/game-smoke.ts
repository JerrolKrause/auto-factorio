import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Rcon, wrapper } from '../packages/factorio/src/rcon.js';
import { GameClient, observeRequest } from '../packages/factorio/src/client.js';
import { requirements, record } from '@autofactorio/contracts';
import type { RecipeFacts } from '@autofactorio/contracts';
const profileFile=process.argv.includes('--profile-file')?process.argv[process.argv.indexOf('--profile-file')+1]!:'.runtime/phase03/headless.json';
const {dir}=JSON.parse(await readFile(profileFile,'utf8')) as {dir:string};
const config=JSON.parse(await readFile(dir+'/launch.json','utf8')) as {port:number;password:string};
const rcon=await Rcon.connect(config.port,config.password);const events:unknown[]=[];
const sink=(event:unknown)=>{events.push(event);console.log(JSON.stringify(event));};
try{
 await rcon.command('/silent-command rcon.print("AutoFactorio diagnostic")');await rcon.command('/silent-command rcon.print("AutoFactorio diagnostic")');
 const client=new GameClient(rcon,sink);const first=await client.request({...observeRequest,limit:1});
 assert.equal(first.truncated,true);assert.equal(first.nextOffset,1);assert.equal(first.total,9);
 const second=await client.request({...observeRequest,offset:1,limit:1});const chest=(second.entities as Record<string,unknown>[])[0]!;assert.equal(chest.name,'steel-chest');assert.equal(chest.protected,true);assert.deepEqual(record(chest.inventories).chest,[{name:'iron-plate',quality:'normal',count:7}]);
 assert.deepEqual(first.mods,{base:'2.0.77','elevated-rails':'2.0.77',quality:'2.0.77','space-age':'2.0.77',autofactorio:'0.1.0'});
 const recipe=await client.request({op:'recipe',name:'automation-science-pack'});assert.equal(requirements(recipe.recipe as RecipeFacts,'automation-science-pack',10).supported,true);
 const rich=await client.request({op:'recipe',name:'sulfur'});assert.equal(requirements(rich.recipe as RecipeFacts,'sulfur',10).supported,false);
 for(const request of [{op:'raw',lua:'game.player.insert{}'},{op:'observe',surface:'nauvis',area:[{x:-32,y:-32},{x:32,y:32}],offset:0,limit:51},{op:'recipe',name:'automation-science-pack',lua:'return 1'},{op:'submit',batch:{commandId:'bad',steps:[]}}]){
  const response=JSON.parse(await rcon.command(wrapper(request)));assert.equal(response.ok,false);sink({kind:'engine/rejected',request,response});
 }
 await writeFile(dir+'/smoke-result.json',JSON.stringify({passed:true,scope:'headless observations, recipes and malformed request rejection only',checks:9},null,2));
 console.log(JSON.stringify({passed:true,dir}));
}finally{rcon.close();await writeFile(dir+'/smoke-events.jsonl',events.map(e=>JSON.stringify(e)).join('\n')+'\n');}
