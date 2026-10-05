import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function snapshotFile(directory:string,sessionId:string,iteration:number):string {
  if(!/^[\w.-]+$/.test(sessionId)||['.','..'].includes(sessionId)||!Number.isSafeInteger(iteration)||iteration<1)throw new Error('Invalid snapshot identity');
  return path.join(directory,'workshop-live',sessionId,`attempt-${iteration}.png`);
}
export function snapshotHash(bytes:Buffer):string {
  if(bytes.length<45||bytes.length>16*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)<1||bytes.readUInt32BE(20)<1||bytes.readUInt32BE(16)>4096||bytes.readUInt32BE(20)>4096||!bytes.subarray(-12).equals(Buffer.from([0,0,0,0,73,69,78,68,174,66,96,130])))throw new Error('Invalid build screenshot');
  return createHash('sha256').update(bytes).digest('hex');
}
export async function preserveSnapshot(source:string,destination:string):Promise<string> {
  const bytes=await readFile(source),sha256=snapshotHash(bytes);
  await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,bytes);
  return sha256;
}
