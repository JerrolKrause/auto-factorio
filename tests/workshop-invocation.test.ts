import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { invocationFile, readInvocationPage, WorkshopInvocationRecorder } from '../apps/runtime/workshop-invocation.js';

describe('recorded provider boundary',()=>{
  it('rejects imported session identities that would escape the registered artifact directory',()=>{
    for(const session of ['../outside','..','.','C:/outside','a/b','a\\b'])expect(()=>invocationFile('registered',session,`${session}:1:designer`)).toThrow('session identity');
    expect(()=>invocationFile('registered','safe','another:1:designer')).toThrow('session identity');
  });
  it('captures effective prompt, supplied context, delivered tools and exact short output with redaction',()=>{const root=mkdtempSync(path.join(os.tmpdir(),'af-invocation-'));
    try{const id='run:1:designer',record=new WorkshopInvocationRecorder(root,'run',id,'workshop-designer',{modelId:'gpt-6-astra'},'Base instructions','Initial prompt',
      {objective:'Make circuits',authorization:'Bearer secret-value',nested:{apiKey:'sk-very-long-test-secret'}});
      record.dispatch('Base instructions\nActivated lesson','Initial prompt\nCall observe once to obtain the immutable input.');
      record.delivery('tool/result',{tool:'observe',result:{state:{objective:'Make circuits',secret:'hidden'}}});record.complete('OK');
      const file=invocationFile(root,'run',id),instructions=readInvocationPage(file,id,'instructions'),context=readInvocationPage(file,id,'context'),messages=readInvocationPage(file,id,'messages'),output=readInvocationPage(file,id,'output');
      expect(instructions.text).toContain('Call observe once');expect(context.text).toContain('Make circuits');expect(context.text).not.toContain('secret-value');
      expect(context.coverage).toBe('redacted');expect(messages.coverage).toBe('redacted');
      expect(messages.text).toContain('observe');expect(messages.text).not.toContain('hidden');expect(output).toMatchObject({text:'OK',next:null,total:2,status:'complete'});
      expect(output.coverage).toBe('recorded');
      expect(readInvocationPage(file,id,'instructions',0,12)).toMatchObject({next:12,total:expect.any(Number)});
      expect(()=>readInvocationPage(file,'other','output')).toThrow('identity');
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  it('labels an output that has not been captured',()=>{const root=mkdtempSync(path.join(os.tmpdir(),'af-invocation-gap-'));
    try{const id='run:1:designer';new WorkshopInvocationRecorder(root,'run',id,'workshop-designer',{},'Instructions','Prompt',{});
      expect(readInvocationPage(invocationFile(root,'run',id),id,'output')).toMatchObject({text:'',coverage:'not-retained',status:'prepared'});
    }finally{rmSync(root,{recursive:true,force:true});}
  });
  it('pages a long recorded message without calling the capture truncated',()=>{const root=mkdtempSync(path.join(os.tmpdir(),'af-invocation-page-'));
    try{const id='run:1:scorer',record=new WorkshopInvocationRecorder(root,'run',id,'workshop-scorer',{},'Instructions','Prompt',{});
      record.complete('a'.repeat(20_000));const file=invocationFile(root,'run',id),first=readInvocationPage(file,id,'output'),last=readInvocationPage(file,id,'output',first.next!);
      expect(first).toMatchObject({coverage:'recorded',next:16_000,total:20_000});expect(first.text.length).toBe(16_000);
      expect(last).toMatchObject({coverage:'recorded',next:null,total:20_000});expect(last.text.length).toBe(4_000);
      expect(first.hash).toBe(last.hash);
    }finally{rmSync(root,{recursive:true,force:true});}
  });
});
