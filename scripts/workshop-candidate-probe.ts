import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LiveWorkshopGame } from '../apps/runtime/workshop-live-host.js';
import type { WorkshopSessionState } from '../packages/core/workshop/orchestrator.js';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import { SerialPort } from '../packages/factorio/src/serial-port.js';
import { createProfile, listProjectProcesses, ownedPath, startServer, stopProfile, waitFor, waitForServer } from './dev/game-processes.js';
import { cleanupAll } from './dev/cleanup.js';

// Replay exact model-produced candidates to distinguish harness defects from design
// defects without consuming another inference or modifying the original evidence.
const run=await ownedPath(process.argv[2]??'');
if((await listProjectProcesses()).some(value=>value.kind==='server'))throw new Error('Preserve the existing server before running this isolated probe');
const session=JSON.parse(await readFile(path.join(run,'outcome.json'),'utf8')) as WorkshopSessionState;
const selected=Number(process.argv[3]??session.activeIteration);if(!Number.isInteger(selected)||selected<1||!session.iterations[selected-1]?.artifact)throw new Error('Choose an iteration with a retained candidate');session.activeIteration=selected;
const source=path.join(run,'startup/dashboard-trial/workshop-live',session.id);
const resolved=JSON.parse(await readFile(path.join(source,'resolved.json'),'utf8'));
const candidate=session.iterations[session.activeIteration!-1]!.artifact!;
const document=JSON.parse(await readFile(path.join(source,`${candidate.artifactHash}.json`),'utf8'));
await mkdir('.runtime/workshop-candidate-probe',{recursive:true});
const evidence=await mkdtemp(path.resolve('.runtime/workshop-candidate-probe/run-'));
process.env.AF_GAME_PROFILE_ROOT=path.join(evidence,'profiles');
const profile=await createProfile(false,true);let port:SerialPort|undefined;
let failure:string|null=null;let evaluation:unknown=null;let inspection:unknown=null;
console.log(JSON.stringify({evidence,source:run,candidate:candidate.artifactHash}));
try{
  await startServer(profile);port=new SerialPort(await waitForServer(profile));
  const game=new GameClient(port,()=>{}),life=new Lifecycle(port,game,()=>{});
  await waitFor('operator ready',async()=>{try{return await life.inspect();}catch{return undefined;}});
  const host=new LiveWorkshopGame(port,game,life,event=>console.log(JSON.stringify(event)));
  const built=await host.build(session,document,resolved.profile);
  evaluation=await host.measure(session,built);
  inspection=await port.command(`/silent-command local s=game.surfaces["${built.surface}"];local out={};for _,e in pairs(s.find_entities_filtered{type="furnace"}) do out[#out+1]={position=e.position,status=e.status,products=e.products_finished,energy=e.energy} end;rcon.print(helpers.table_to_json(out))`);
  await port.command('/silent-command game.server_save("candidate-final")');
  await waitFor('saved candidate',async()=>{try{const b=await readFile(path.join(profile.dir,'data/saves/candidate-final.zip'));return b.includes(Buffer.from([0x50,0x4b,0x05,0x06]))?true:undefined;}catch{return undefined;}},30000,250);
}catch(error){failure=String(error);process.exitCode=1;}
finally{
  const cleanupReceipts=await cleanupAll([{id:'port',run:()=>port?.close()},{id:'game',run:()=>stopProfile(profile.config)}]);
  const cleanup=cleanupReceipts.every(value=>value.completed);
  const passed=!failure&&cleanup&&(evaluation as {passed?:boolean}|null)?.passed===true;
  if(!passed)process.exitCode=1;
  await writeFile(path.join(evidence,'result.json'),JSON.stringify({passed,source:run,iteration:selected,candidate:candidate.artifactHash,failure,evaluation,inspection,cleanup,cleanupReceipts},null,2));
  console.log(JSON.stringify({evidence,passed,failure,evaluation,cleanup}));
}
