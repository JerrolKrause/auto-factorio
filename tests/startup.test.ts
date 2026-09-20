import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureVisibleObserver } from '../scripts/game-observer.js';
import type { GameProfile } from '../scripts/dev/game-processes.js';

const root=path.resolve('.'),script=path.join(root,'scripts','start.mjs');
const profile:GameProfile={dir:path.join(root,'.runtime','observer-test'),executable:'factorio.exe',config:path.join(root,'.runtime','observer-test','config.ini'),observerConfig:path.join(root,'.runtime','observer-test','observer-config.ini'),observerData:path.join(root,'.runtime','observer-test','observer-data'),mods:'mods',settings:'settings.json',save:'save.zip',log:'host.log',port:27018,gamePort:34198,password:'test'};

describe('supported startup modes',()=>{
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
