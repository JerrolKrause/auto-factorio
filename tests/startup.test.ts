import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureVisibleObserver } from '../scripts/game-observer.js';
import type { GameProfile } from '../scripts/dev/game-processes.js';
import { PINNED_CODEX } from '../packages/codex/src/protocol.js';

const root=path.resolve('.'),script=path.join(root,'scripts','start.mjs');
const profile:GameProfile={dir:path.join(root,'.runtime','observer-test'),executable:'factorio.exe',config:path.join(root,'.runtime','observer-test','config.ini'),observerConfig:path.join(root,'.runtime','observer-test','observer-config.ini'),observerData:path.join(root,'.runtime','observer-test','observer-data'),mods:'mods',settings:'settings.json',save:'save.zip',log:'host.log',port:27018,gamePort:34198,password:'test'};

describe('supported startup modes',()=>{
  it('keeps startup discovery and its prerequisite message aligned with the exact adapter pin',()=>{
    const source=readFileSync(script,'utf8');
    expect(source).toContain(`version === 'codex-cli ${PINNED_CODEX}'`);
    expect(source).toContain(`Supported managed Codex ${PINNED_CODEX} was not found`);
  });
  it('selects only the supported managed Codex version from distinct discovered paths',()=>{
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
    const run=(versions:Record<string,string>,env:Record<string,string>={})=>{
      const checked:string[]=[];
      const context={
        process:{platform:'win32',env:{APPDATA:'C:/Users/test/AppData/Roaming',...env}},
        path:{join:(...parts:string[])=>parts.join('/')},
        which:(name:string)=>`PATH/${name}`,
        executableVersion:(candidate:string)=>{checked.push(candidate);return versions[candidate]??'';},
      };
      const find=vm.runInNewContext(`(${findCodexSource})`,context) as ()=>string|undefined;
      return {selected:find(),checked};
    };

    const supported=run({
      'override/codex.exe':'codex-cli 0.160.0',
      'PATH/codex.exe':'codex-cli 0.160.1',
      'PATH/codex.cmd':'codex-cli 0.160.2',
      'PATH/codex':'codex-cli 0.160.1',
      'C:/Users/test/AppData/Roaming/npm/codex.cmd':'codex-cli 0.160.1',
    },{AUTOFACTORIO_CODEX:'override/codex.exe'});
    expect(supported.selected).toBe('PATH/codex.exe');
    expect(supported.checked).toEqual(['override/codex.exe','PATH/codex.exe']);
    expect(new Set(supported.checked).size).toBe(supported.checked.length);
    const preFixSource=findCodexSource.replaceAll('codex-cli 0.160.1','codex-cli 0.160.0');
    const preFixFind=vm.runInNewContext(`(${preFixSource})`,{
      process:{platform:'win32',env:{APPDATA:'C:/Users/test/AppData/Roaming',AUTOFACTORIO_CODEX:'override/codex.exe'}},
      path:{join:(...parts:string[])=>parts.join('/')},which:(name:string)=>`PATH/${name}`,
      executableVersion:(candidate:string)=>({
        'override/codex.exe':'codex-cli 0.160.0','PATH/codex.exe':'codex-cli 0.160.1',
      } as Record<string,string>)[candidate]??'',
    }) as ()=>string|undefined;
    expect(preFixFind()).not.toBe('PATH/codex.exe');

    for(const unsupported of ['codex-cli 0.160.0','codex-cli 0.160.2']){
      const rejected=run({
        'override/codex.exe':unsupported,
        'PATH/codex.exe':unsupported,
        'PATH/codex.cmd':unsupported,
        'PATH/codex':unsupported,
        'C:/Users/test/AppData/Roaming/npm/codex.cmd':unsupported,
      },{AUTOFACTORIO_CODEX:'override/codex.exe'});
      expect(rejected.selected,`${unsupported} must not be accepted`).toBeUndefined();
    }
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
