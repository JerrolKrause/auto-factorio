import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runChecks } from '../scripts/dev/checks.mjs';
import { editUtf8 } from '../scripts/edit-utf8.mjs';
describe('fail-fast development commands',()=>{
 it('retains logs and exact exit while skipping all dependent commands',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'af-checks-'));const marker=path.join(dir,'should-not-exist');const status=[];
  const result=await runChecks([{name:'bad-build',command:process.execPath,args:['-e','console.error("compile-failed");process.exit(7)']},{name:'game',command:process.execPath,args:['-e',`require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`]}],{cwd:dir,evidence:path.join(dir,'logs'),status:s=>status.push(s)});
  expect(result.passed).toBe(false);expect(result.results[0].exit).toBe(7);expect(result.skipped).toEqual(['game']);expect(await readFile(result.results[0].log,'utf8')).toContain('compile-failed');await expect(access(marker)).rejects.toThrow();expect(status).toHaveLength(2);
 });
 it('records a missing executable as failed without running later steps',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'af-checks-'));const result=await runChecks([{name:'missing',command:path.join(dir,'not-an-executable'),args:[]},{name:'later',command:process.execPath,args:['-e','process.exit(0)']}],{cwd:dir,evidence:path.join(dir,'logs'),status:()=>{}});expect(result.passed).toBe(false);expect(result.skipped).toEqual(['later']);});
});
describe('contextual UTF-8 fallback edits',()=>{
 it('preserves Unicode, BOM and CRLF',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'af-edit-'));await writeFile(path.join(dir,'doc.md'),'\ufeffCafé — before\r\nNext\r\n');await editUtf8({path:'doc.md',edits:[{before:'Café — before',after:'Café — after'}]},dir);expect(await readFile(path.join(dir,'doc.md'),'utf8')).toBe('\ufeffCafé — after\r\nNext\r\n');});
 it('leaves a file intact when context is absent or ambiguous',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'af-edit-'));const file=path.join(dir,'code.txt');await writeFile(file,'same\nsame\n');for(const before of ['same','missing'])await expect(editUtf8({path:'code.txt',edits:[{before,after:'changed'}]},dir)).rejects.toThrow('match count');expect(await readFile(file,'utf8')).toBe('same\nsame\n');});
 it('rejects invalid UTF-8 and stale expected hashes',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'af-edit-'));const file=path.join(dir,'doc.md');await writeFile(file,Buffer.from([0xff]));await expect(editUtf8({path:'doc.md',edits:[{before:'x',after:'y'}]},dir)).rejects.toThrow();await writeFile(file,'x');await expect(editUtf8({path:'doc.md',sha256:'wrong',edits:[{before:'x',after:'y'}]},dir)).rejects.toThrow('snapshot');expect(await readFile(file,'utf8')).toBe('x');});
});
