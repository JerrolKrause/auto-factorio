import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface WorkshopInvocationEnvelope {
  schema: 1; id: string; sessionId: string; role: string; selection: unknown;
  status: 'prepared' | 'dispatched' | 'complete' | 'unknown';
  instructions: string; prompt: string; context: unknown;
  instructionsHash: string; promptHash: string; contextHash: string;
  deliveries: { at: string; kind: string; data: unknown }[];
  output: string | null; outputHash: string | null; failure: string | null;
  coverage: 'recorded' | 'legacy-not-retained';
}
const hash=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export function invocationFile(directory:string,sessionId:string,id:string):string {
  // Imported journals retain original IDs; those IDs must never become filesystem traversal.
  if(!/^[\w.-]{1,160}$/.test(sessionId)||sessionId==='.'||sessionId==='..'||!id.startsWith(`${sessionId}:`))throw new Error('Invalid invocation session identity');
  return path.join(directory,'workshop-live',sessionId,'invocations',`${hash(id)}.json`);
}
const secret=/authorization|bearer|credential|secret|password|api[_-]?key|(^|[_-])token([_-]|$)/i;
export function redactInvocation(value:unknown):unknown {
  if(typeof value==='string')return value.replace(/Bearer\s+[^\s"']+/gi,'Bearer [redacted]').replace(/sk-[A-Za-z0-9_-]{12,}/g,'[redacted-key]');
  if(Array.isArray(value))return value.map(redactInvocation);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,secret.test(key)?'[redacted]':redactInvocation(item)]));
  return value;
}
/** Synchronous artifact writes make the dispatch boundary durable before the provider can start. */
export class WorkshopInvocationRecorder {
  private readonly file:string;
  private envelope:WorkshopInvocationEnvelope;
  constructor(directory:string,sessionId:string,id:string,role:string,selection:unknown,instructions:string,prompt:string,context:unknown){
    if(!id.startsWith(`${sessionId}:`))throw new Error('Invocation identity outside session');
    this.file=invocationFile(directory,sessionId,id);
    const safeInstructions=redactInvocation(instructions) as string,safePrompt=redactInvocation(prompt) as string,safeContext=redactInvocation(context);
    this.envelope={schema:1,id,sessionId,role,selection:redactInvocation(selection),status:'prepared',instructions:safeInstructions,prompt:safePrompt,context:safeContext,
      instructionsHash:hash(safeInstructions),promptHash:hash(safePrompt),contextHash:hash(safeContext),deliveries:[],output:null,outputHash:null,failure:null,coverage:'recorded'};
    this.save();
  }
  dispatch(instructions:string,prompt:string):void{this.envelope.instructions=redactInvocation(instructions) as string;this.envelope.prompt=redactInvocation(prompt) as string;
    this.envelope.instructionsHash=hash(this.envelope.instructions);this.envelope.promptHash=hash(this.envelope.prompt);this.envelope.status='dispatched';this.save();}
  delivery(kind:string,data:unknown):void{this.envelope.deliveries.push({at:new Date().toISOString(),kind,data:redactInvocation(data)});this.save();}
  complete(output:string):void{this.envelope.output=redactInvocation(output) as string;this.envelope.outputHash=hash(this.envelope.output);this.envelope.status='complete';this.save();}
  unknown(error:unknown):void{this.envelope.failure=String(redactInvocation(String(error)));this.envelope.status='unknown';this.save();}
  private save():void{mkdirSync(path.dirname(this.file),{recursive:true});const temporary=this.file+'.pending';writeFileSync(temporary,JSON.stringify(this.envelope));renameSync(temporary,this.file);}
}

export function readInvocationPage(file:string,id:string,part:'instructions'|'context'|'messages'|'output',offset=0,limit=16000):{
  id:string;part:string;text:string;next:number|null;total:number;status:string;coverage:string;hash:string|null;
}{
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>16000)throw new Error('Invalid invocation page');
  const envelope=JSON.parse(readFileSync(file,'utf8'))as WorkshopInvocationEnvelope;
  if(envelope.id!==id||envelope.schema!==1)throw new Error('Invocation identity mismatch');
  const text=part==='instructions'?`${envelope.instructions}\n\n${envelope.prompt}`:part==='context'?JSON.stringify(envelope.context,null,2):part==='messages'?JSON.stringify(envelope.deliveries,null,2):envelope.output??'';
  const hashValue=part==='instructions'?hash(`${envelope.instructions}\n\n${envelope.prompt}`):part==='context'?envelope.contextHash:part==='output'?envelope.outputHash:hash(envelope.deliveries);
  const coverage=part==='output'&&envelope.output===null?'not-retained':text.includes('[redacted')?'redacted':envelope.coverage;
  return{id,part,text:text.slice(offset,offset+limit),next:offset+limit<text.length?offset+limit:null,total:text.length,status:envelope.status,coverage,hash:hashValue};
}
