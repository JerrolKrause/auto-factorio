import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureVisibleObserver } from '../scripts/game-observer.js';
import type { GameProfile } from '../scripts/dev/game-processes.js';

const root=path.resolve('.'),script=path.join(root,'scripts','start.mjs');
const profile:GameProfile={dir:path.join(root,'.runtime','observer-test'),executable:'factorio.exe',config:path.join(root,'.runtime','observer-test','config.ini'),observerConfig:path.join(root,'.runtime','observer-test','observer-config.ini'),observerData:path.join(root,'.runtime','observer-test','observer-data'),mods:'mods',settings:'settings.json',save:'save.zip',log:'host.log',port:27018,gamePort:34198,password:'test'};

function discoverCodex(versions:Record<string,string>,env:Record<string,string>={}) {
  const source=readFileSync(script,'utf8');
  const start=source.indexOf('function findCodex() {');
  expect(start).toBeGreaterThanOrEqual(0);
  let depth=0,end=-1;
  for(let index=source.indexOf('{',start);index<source.length;index++){
    if(source[index]==='{')depth++;
    if(source[index]==='}'&&--depth===0){end=index+1;break;}
  }
  expect(end).toBeGreaterThan(start);
  const findCodexSource=source.slice(start,end);
  const checked:string[]=[];
  const context={
    process:{platform:'win32',env:{APPDATA:'C:/Users/test/AppData/Roaming',...env}},
    path:{join:(...parts:string[])=>parts.join('/')},
    which:(name:string)=>`PATH/${name}`,
    executableVersion:(candidate:string)=>{checked.push(candidate);return versions[candidate]??'';},
  };
  const find=vm.runInNewContext(`(${findCodexSource})`,context) as ()=>string|undefined;
  return {selected:find(),checked};
}

describe('supported startup modes',()=>{
  it.each(['0.154.0','0.160.0','0.160.1','0.160.2','1.2.3','2.0.0-preview.1','2.0.0+build.5'])('discovers Codex %s without an exact-version gate',version=>{
    const result=discoverCodex({'override/codex.exe':`codex-cli ${version}`,'PATH/codex.exe':'codex-cli 0.160.1'},{AUTOFACTORIO_CODEX:'override/codex.exe'});
    expect(result.selected).toBe('override/codex.exe');
    expect(result.checked).toEqual(['override/codex.exe']);
  });

  it.each(['','codex-cli unknown','codex-cli 0.160','other-cli 0.160.1','codex-cli 0.160.1 trailing','warning\ncodex-cli 0.160.1','codex-cli 0.160.1-'])('skips unavailable or malformed discovery output %j',output=>{
    const result=discoverCodex({'override/codex.exe':output,'PATH/codex.exe':'codex-cli 1.2.3'},{AUTOFACTORIO_CODEX:'override/codex.exe'});
    expect(result.selected).toBe('PATH/codex.exe');
    expect(result.checked).toEqual(['override/codex.exe','PATH/codex.exe']);
  });

  it('retains PATH and npm discovery order after unavailable candidates',()=>{
    const npm='C:/Users/test/AppData/Roaming/npm/codex.cmd';
    const candidates=['PATH/codex.exe','PATH/codex.cmd','PATH/codex',npm];
    for(const [index,candidate] of candidates.entries()) {
      const result=discoverCodex({[candidate]:'codex-cli 9.1.0'});
      expect(result.selected).toBe(candidate);
      expect(result.checked).toEqual(candidates.slice(0,index+1));
    }
    const unavailable=discoverCodex({});
    expect(unavailable.selected).toBeUndefined();
    expect(unavailable.checked).toEqual(candidates);
  });
  it('documents visible startup as the default and headless as explicit',()=>{
    const result=spawnSync(process.execPath,[script,'--help'],{cwd:root,encoding:'utf8',windowsHide:true});
    expect(result.status).toBe(0);expect(result.stdout).toContain('open visible Factorio');expect(result.stdout).toContain('npm start -- --headless');
    const source=readFileSync(script,'utf8');expect(source).toContain("const gameArgs = ['dist/scripts/game-launch.js', '--result-file', profileFile]");expect(source).toContain("if (selected.headless) gameArgs.push('--headless')");
  });

  it('rejects the meaningless fixture plus headless combination before startup work',()=>{
    const result=spawnSync(process.execPath,[script,'--fixture','--headless'],{cwd:root,encoding:'utf8',windowsHide:true});
    expect(result.status).toBe(1);expect(result.stderr).toContain('--headless cannot be combined with fixture mode');
  });

  it('cleans a newly launched supplied-profile observer when readiness fails',async()=>{
    const stopped:string[]=[];await expect(ensureVisibleObserver(profile,async()=>{throw new Error('builder unavailable');},{async list(){return[];},async start(_profile,_replace,onSpawn){onSpawn?.(10);return 10;},async identify(){return 11;},async stop(config){stopped.push(config);return[11];}})).rejects.toThrow('builder unavailable');expect(stopped).toEqual([profile.observerConfig]);
  });

  it('preserves a reused supplied-profile observer when readiness fails',async()=>{
    let started=false,stopped=false;await expect(ensureVisibleObserver(profile,async()=>{throw new Error('builder unavailable');},{async list(){return[{pid:12,config:profile.observerConfig,startedAt:new Date(0).toISOString(),kind:'observer'}];},async start(){started=true;return 12;},async identify(){return 12;},async stop(){stopped=true;return[12];}})).rejects.toThrow('builder unavailable');expect({started,stopped}).toEqual({started:false,stopped:false});
  });

  it('records ownership at spawn and cleans when startup is interrupted before bookkeeping completes',async()=>{
    let owned=false;const stopped:string[]=[];await expect(ensureVisibleObserver(profile,async()=>{}, {async list(){return[];},async start(_profile,_replace,onSpawn){onSpawn?.(13);throw new Error('interrupted during observer startup');},async identify(){throw new Error('not reached');},async stop(config){stopped.push(config);return[13];}},()=>{owned=true;})).rejects.toThrow('interrupted during observer startup');expect(owned).toBe(true);expect(stopped).toEqual([profile.observerConfig]);
  });
});
