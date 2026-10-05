import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import * as ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkshopAssignment } from '@autofactorio/contracts';
import { ensureVisibleObserver } from '../scripts/game-observer.js';
import type { ObserverDependencies } from '../scripts/game-observer.js';
import type { GameProfile, ProjectProcess } from '../scripts/dev/game-processes.js';
import { ObserverDisconnectedError } from '../scripts/dev/game-processes.js';
import { workshopObserver } from '../scripts/dev/workshop-observer.js';
import { LiveWorkshopGame, LiveWorkshopHost, prepareLiveWorkshopHost } from '../apps/runtime/workshop-live-host.js';
import { WorkshopRuntime } from '../packages/core/workshop/runtime.js';

const mocks=vi.hoisted(()=>({list:vi.fn(),start:vi.fn(),identify:vi.fn(),stop:vi.fn(),waitFor:vi.fn(),inGame:vi.fn(),delay:vi.fn(),rpcCall:vi.fn(),rpcClose:vi.fn(),catalog:vi.fn()}));
vi.mock('node:timers/promises',async importOriginal=>({...await importOriginal<typeof import('node:timers/promises')>(),setTimeout:mocks.delay}));
vi.mock('../scripts/dev/game-processes.js',async importOriginal=>({
  ...await importOriginal<typeof import('../scripts/dev/game-processes.js')>(),
  listProjectProcesses:mocks.list,startObserver:mocks.start,identifyObserver:mocks.identify,stopProfile:mocks.stop,waitFor:mocks.waitFor,observerInGame:mocks.inGame,
}));
vi.mock('../packages/codex/src/rpc.js',()=>({AppServerRpc:class {call=mocks.rpcCall;close=mocks.rpcClose;}}));
vi.mock('../packages/codex/src/preflight.js',async importOriginal=>({
  ...await importOriginal<typeof import('../packages/codex/src/preflight.js')>(),managedCatalog:mocks.catalog,
}));

const root=path.resolve('.');
const profile:GameProfile={dir:path.join(root,'.runtime','blueprint-client-test'),executable:'factorio.exe',config:path.join(root,'.runtime','blueprint-client-test','config.ini'),observerConfig:path.join(root,'.runtime','blueprint-client-test','observer-config.ini'),observerData:path.join(root,'.runtime','blueprint-client-test','observer-data'),mods:'mods',settings:'settings.json',save:'save.zip',log:'host.log',port:27018,gamePort:34198,password:'fake'};
const processFor=(config=profile.observerConfig,pid=12):ProjectProcess=>({pid,config,kind:'observer',startedAt:new Date(0).toISOString()});
const connected=(value:boolean)=>({actors:{'builder-1':{connected:value}}});
const assignment=(construction:'direct'|'character'):WorkshopAssignment=>({id:'client-run',construction,ports:[{product:{surface:'nauvis'}}]} as WorkshopAssignment);
const selected={provider:'openai' as const,modelId:'gpt-6-astra',reasoningEffort:'low'};
const launchRequest=(construction:'direct'|'character')=>({schema:1,id:'client-run',revision:1,comparisonSeries:'client-series',objective:'Produce 60 electronic circuits per minute',source:{kind:'brief',id:null},profileId:'starter-assembly',construction,libraryAccess:false,improveRevision:null,requestedSpeed:{numerator:'10',denominator:'1'},settlingTicks:0,windowTicks:60,windows:1,rubric:{version:'rubric-1',weights:{throughput:{numerator:'1',denominator:'1'}},materiality:{throughput:{numerator:'0',denominator:'1'}},directions:{throughput:'maximize'}},iterations:{attempts:1,mode:'exact',earlyStop:false,plateauRounds:1},checkpoints:{brief:false,afterScore:false,libraryAdmission:false,learningActivation:false,timeoutMs:1000,timeoutAction:'finish'},budgets:{wallMs:60000,gameTicks:600,turns:3,toolCalls:8,reportedTokens:1000,learningReservedTurns:1,learningReservedTools:2},models:{sessionDefault:selected,overrides:{}},learning:{cadence:'off',batchSessions:2,candidateCap:2,attemptsPerCandidate:1,autoActivate:false}});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}

let processes:ProjectProcess[]=[];
beforeEach(()=>{
  vi.resetAllMocks();processes=[];
  mocks.list.mockImplementation(async()=>[...processes]);
  mocks.start.mockImplementation(async(selected:GameProfile,_replace:unknown,onSpawn?:(pid:number)=>void)=>{onSpawn?.(25);processes.push(processFor(selected.observerConfig,25));return 25;});
  mocks.identify.mockResolvedValue(25);
  mocks.inGame.mockResolvedValue(true);
  mocks.delay.mockResolvedValue(undefined);
  mocks.stop.mockImplementation(async(config:string)=>{const stopped=processes.filter(value=>value.config===config).map(value=>value.pid);processes=processes.filter(value=>value.config!==config);return stopped;});
  // Exercise the production readiness predicate without its three-minute timeout.
  mocks.waitFor.mockImplementation(async(_label:string,read:()=>Promise<unknown>)=>{const value=await read();if(value===undefined)throw new Error('builder unavailable');return value;});
  mocks.rpcCall.mockResolvedValue({config:{mcp_servers:{}}});mocks.catalog.mockResolvedValue({models:[]});
});

function dependencies():ObserverDependencies{return{list:mocks.list,start:mocks.start,identify:mocks.identify,stop:mocks.stop};}

describe('matching project client recovery',()=>{
  it('retries a new terminally disconnected client once after the server peer backoff',async()=>{
    const ready=vi.fn().mockRejectedValueOnce(new ObserverDisconnectedError('duplicate peer')).mockResolvedValueOnce(undefined),owned=vi.fn();
    expect(await ensureVisibleObserver(profile,ready,dependencies(),owned,true)).toEqual({observerPid:25,launched:true});
    expect(mocks.delay).toHaveBeenCalledExactlyOnceWith(30000);expect(mocks.start).toHaveBeenCalledTimes(2);expect(owned).toHaveBeenCalledTimes(2);expect(ready).toHaveBeenCalledTimes(2);
    expect(mocks.stop).toHaveBeenCalledExactlyOnceWith(profile.observerConfig);
    expect(mocks.stop.mock.invocationCallOrder[0]).toBeLessThan(mocks.delay.mock.invocationCallOrder[0]!);expect(mocks.delay.mock.invocationCallOrder[0]).toBeLessThan(mocks.start.mock.invocationCallOrder[1]!);
  });
  it('does not attempt a third client when the one terminal-disconnect retry also fails',async()=>{
    const ready=vi.fn().mockRejectedValue(new ObserverDisconnectedError('duplicate peer'));
    await expect(ensureVisibleObserver(profile,ready,dependencies(),()=>{},true)).rejects.toBeInstanceOf(ObserverDisconnectedError);
    expect(mocks.start).toHaveBeenCalledTimes(2);expect(mocks.stop).toHaveBeenCalledTimes(2);expect(mocks.delay).toHaveBeenCalledExactlyOnceWith(30000);expect(ready).toHaveBeenCalledTimes(2);
  });
  it('does not back off or repeat an ordinary new-client readiness failure',async()=>{
    const ready=vi.fn().mockRejectedValue(new Error('ordinary readiness failure'));
    await expect(ensureVisibleObserver(profile,ready,dependencies(),()=>{},true)).rejects.toThrow('ordinary readiness failure');
    expect(mocks.start).toHaveBeenCalledOnce();expect(mocks.stop).toHaveBeenCalledExactlyOnceWith(profile.observerConfig);expect(mocks.delay).not.toHaveBeenCalled();expect(ready).toHaveBeenCalledOnce();
  });
  it('backs off once before replacing a matching terminally disconnected client',async()=>{
    processes=[processFor()];const ready=vi.fn().mockRejectedValueOnce(new ObserverDisconnectedError('disconnected')).mockResolvedValueOnce(undefined);
    await ensureVisibleObserver(profile,ready,dependencies(),()=>{},true);
    expect(mocks.stop).toHaveBeenCalledExactlyOnceWith(profile.observerConfig);expect(mocks.delay).toHaveBeenCalledExactlyOnceWith(30000);expect(mocks.start).toHaveBeenCalledOnce();
  });
  it('cleans a terminally disconnected new client without retry when permission is disabled',async()=>{
    await expect(ensureVisibleObserver(profile,async()=>{throw new ObserverDisconnectedError('disconnected');},dependencies())).rejects.toBeInstanceOf(ObserverDisconnectedError);
    expect(mocks.start).toHaveBeenCalledOnce();expect(mocks.stop).toHaveBeenCalledExactlyOnceWith(profile.observerConfig);expect(mocks.delay).not.toHaveBeenCalled();
  });
  it('rechecks dynamic permission after the disconnect backoff before relaunch',async()=>{
    const entered=deferred<void>(),release=deferred<void>();let permitted=true;
    mocks.delay.mockImplementationOnce(async()=>{entered.resolve();await release.promise;});
    const pending=ensureVisibleObserver(profile,async()=>{throw new ObserverDisconnectedError('disconnected');},dependencies(),()=>{},()=>permitted),failed=expect(pending).rejects.toBeInstanceOf(ObserverDisconnectedError);
    await entered.promise;permitted=false;release.resolve();await failed;
    expect(mocks.delay).toHaveBeenCalledExactlyOnceWith(30000);expect(mocks.start).toHaveBeenCalledOnce();expect(mocks.stop).toHaveBeenCalledExactlyOnceWith(profile.observerConfig);
  });
  it('starts an absent observer and records ownership before readiness',async()=>{
    const events:string[]=[];
    const result=await ensureVisibleObserver(profile,async()=>{events.push('ready');},dependencies(),()=>events.push('owned'),true);
    expect(result).toEqual({observerPid:25,launched:true});expect(events).toEqual(['owned','ready']);
    expect(mocks.start).toHaveBeenCalledOnce();expect(mocks.stop).not.toHaveBeenCalled();
  });
  it('reuses a healthy matching client without claiming ownership',async()=>{
    processes=[processFor(profile.observerConfig.toUpperCase())];const owned=vi.fn(),ready=vi.fn().mockResolvedValue(undefined);
    expect(await ensureVisibleObserver(profile,ready,dependencies(),owned,true)).toEqual({observerPid:12,launched:false});
    expect(ready).toHaveBeenCalledOnce();expect(owned).not.toHaveBeenCalled();expect(mocks.start).not.toHaveBeenCalled();expect(mocks.stop).not.toHaveBeenCalled();
  });
  it('replaces one matching disconnected client only after readiness fails',async()=>{
    const other=processFor(path.join(root,'.runtime','other-profile','observer-config.ini'),90);processes=[processFor(),other];
    const ready=vi.fn().mockRejectedValueOnce(new Error('disconnected')).mockResolvedValueOnce(undefined),owned=vi.fn();
    expect(await ensureVisibleObserver(profile,ready,dependencies(),owned,true)).toEqual({observerPid:25,launched:true});
    expect(ready).toHaveBeenCalledTimes(2);expect(mocks.stop).toHaveBeenCalledExactlyOnceWith(profile.observerConfig);
    expect(mocks.start).toHaveBeenCalledOnce();expect(owned).toHaveBeenCalledOnce();expect(processes).toContainEqual(other);
    expect(ready.mock.invocationCallOrder[0]).toBeLessThan(mocks.stop.mock.invocationCallOrder[0]!);
  });
  it('does not repeat replacement when the new client also fails readiness',async()=>{
    processes=[processFor()];const ready=vi.fn().mockRejectedValue(new Error('still disconnected'));
    await expect(ensureVisibleObserver(profile,ready,dependencies(),()=>{},true)).rejects.toThrow('still disconnected');
    expect(ready).toHaveBeenCalledTimes(2);expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.stop.mock.calls).toEqual([[profile.observerConfig],[profile.observerConfig]]);expect(processes).toEqual([]);
  });
  it.each([false,()=>false])('preserves a reused client when replacement is disabled (%s)',async permission=>{
    processes=[processFor()];
    await expect(ensureVisibleObserver(profile,async()=>{throw new Error('disconnected');},dependencies(),()=>{},permission)).rejects.toThrow('disconnected');
    expect(mocks.stop).not.toHaveBeenCalled();expect(mocks.start).not.toHaveBeenCalled();expect(processes).toEqual([processFor()]);
  });
  it('cleans only its new client when another profile exists and readiness fails',async()=>{
    const other=processFor(path.join(root,'.runtime','other-profile','observer-config.ini'),90);processes=[other];
    await expect(ensureVisibleObserver(profile,async()=>{throw new Error('disconnected');},dependencies(),()=>{},true)).rejects.toThrow('disconnected');
    expect(mocks.stop).toHaveBeenCalledExactlyOnceWith(profile.observerConfig);expect(mocks.start).toHaveBeenCalledOnce();expect(processes).toEqual([other]);
  });
  it('cleans a failed launch after ownership was recorded at spawn',async()=>{
    mocks.start.mockImplementationOnce(async(_profile:GameProfile,_replace:unknown,onSpawn?:(pid:number)=>void)=>{onSpawn?.(25);processes.push(processFor(undefined,25));throw new Error('spawn bookkeeping failed');});
    const ready=vi.fn(),owned=vi.fn();
    await expect(ensureVisibleObserver(profile,ready,dependencies(),owned,true)).rejects.toThrow('spawn bookkeeping failed');
    expect(owned).toHaveBeenCalledOnce();expect(ready).not.toHaveBeenCalled();expect(mocks.stop).toHaveBeenCalledExactlyOnceWith(profile.observerConfig);expect(processes).toEqual([]);
  });
});

describe('per-run workshop observer manager',()=>{
  it('coalesces concurrent runs while a terminal disconnect is backing off',async()=>{
    const entered=deferred<void>(),release=deferred<void>(),request=vi.fn().mockResolvedValue(connected(true)),owned=vi.fn(),manager=workshopObserver(profile,{request} as never,owned);
    mocks.inGame.mockRejectedValueOnce(new ObserverDisconnectedError('duplicate peer')).mockResolvedValueOnce(true);mocks.delay.mockImplementationOnce(async()=>{entered.resolve();await release.promise;});
    const first=manager.ensure();await entered.promise;const second=manager.ensure();expect(second).toBe(first);expect(request).not.toHaveBeenCalled();expect(mocks.start).toHaveBeenCalledOnce();
    release.resolve();await Promise.all([first,second]);expect(mocks.start).toHaveBeenCalledTimes(2);expect(owned).toHaveBeenCalledTimes(2);expect(request).toHaveBeenCalledOnce();await manager.close();
  });
  it('prevents a terminal-disconnect retry if shutdown starts during backoff',async()=>{
    const entered=deferred<void>(),release=deferred<void>(),request=vi.fn(),manager=workshopObserver(profile,{request} as never);
    mocks.inGame.mockRejectedValueOnce(new ObserverDisconnectedError('duplicate peer'));mocks.delay.mockImplementationOnce(async()=>{entered.resolve();await release.promise;});
    const pending=manager.ensure(),failed=expect(pending).rejects.toBeInstanceOf(ObserverDisconnectedError);await entered.promise;
    const closing=manager.close();release.resolve();await failed;await closing;await expect(manager.ensure()).rejects.toThrow('shutting down');
    expect(mocks.start).toHaveBeenCalledOnce();expect(mocks.delay).toHaveBeenCalledExactlyOnceWith(30000);expect(request).not.toHaveBeenCalled();
  });
  it('transfers ownership synchronously at spawn for each newly launched client',async()=>{
    const events:string[]=[],onOwned=vi.fn(()=>events.push('owned')),request=vi.fn(async()=>{events.push('ready');return connected(true);}),manager=workshopObserver(profile,{request} as never,onOwned);
    await manager.ensure();await manager.ensure();processes=[];await manager.ensure();
    expect(onOwned).toHaveBeenCalledTimes(2);expect(events).toEqual(['owned','ready','ready','owned','ready']);await manager.close();
  });
  it('does not transfer ownership for a healthy reused client',async()=>{
    processes=[processFor()];const onOwned=vi.fn(),manager=workshopObserver(profile,{request:vi.fn().mockResolvedValue(connected(true))} as never,onOwned);
    await manager.ensure();await manager.close();expect(onOwned).not.toHaveBeenCalled();expect(mocks.stop).not.toHaveBeenCalled();
  });
  it('cleans a newly spawned client when the ownership transfer itself fails',async()=>{
    const request=vi.fn(),manager=workshopObserver(profile,{request} as never,()=>{throw new Error('ownership receipt write failed');});
    await expect(manager.ensure()).rejects.toThrow('ownership receipt write failed');expect(request).not.toHaveBeenCalled();expect(mocks.stop).toHaveBeenCalledExactlyOnceWith(profile.observerConfig);
  });
  it('does not trust a stale connected actor until the current client joins the game',async()=>{
    const request=vi.fn().mockResolvedValue(connected(true)),manager=workshopObserver(profile,{request} as never);
    mocks.inGame.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mocks.waitFor.mockImplementationOnce(async(_label:string,read:()=>Promise<unknown>)=>{
      expect(await read()).toBeUndefined();expect(request).not.toHaveBeenCalled();
      expect(await read()).toBe(true);
    });
    await manager.ensure();expect(mocks.inGame).toHaveBeenCalledTimes(2);expect(request).toHaveBeenCalledOnce();expect(mocks.start).toHaveBeenCalledOnce();await manager.close();
  });
  it('withholds game observation on failed join readiness and permits a later successful launch',async()=>{
    const request=vi.fn().mockResolvedValue(connected(true)),manager=workshopObserver(profile,{request} as never);
    mocks.inGame.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(manager.ensure()).rejects.toThrow('builder unavailable');expect(request).not.toHaveBeenCalled();expect(mocks.stop).toHaveBeenCalledExactlyOnceWith(profile.observerConfig);
    await manager.ensure();expect(mocks.start).toHaveBeenCalledTimes(2);expect(request).toHaveBeenCalledOnce();await manager.close();
  });
  it('checks readiness on every run and reuses a healthy owned client',async()=>{
    const request=vi.fn().mockResolvedValue(connected(true)),manager=workshopObserver(profile,{request} as never);
    await manager.ensure();await manager.ensure();expect(request).toHaveBeenCalledTimes(2);expect(mocks.start).toHaveBeenCalledOnce();
    await manager.close();expect(mocks.stop).toHaveBeenCalledExactlyOnceWith(profile.observerConfig);
  });
  it('recovers a client that disconnects between successful runs',async()=>{
    const request=vi.fn().mockResolvedValueOnce(connected(true)).mockResolvedValueOnce(connected(false)).mockResolvedValueOnce(connected(true)),manager=workshopObserver(profile,{request} as never);
    await manager.ensure();await manager.ensure();expect(request).toHaveBeenCalledTimes(3);expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.stop).toHaveBeenCalledExactlyOnceWith(profile.observerConfig);await manager.close();expect(mocks.stop).toHaveBeenCalledTimes(2);
  });
  it('launches after the process disappears even if the game retains a connected actor flag',async()=>{
    const request=vi.fn().mockResolvedValue(connected(true)),manager=workshopObserver(profile,{request} as never);
    await manager.ensure();processes=[];await manager.ensure();
    expect(mocks.start).toHaveBeenCalledTimes(2);expect(request).toHaveBeenCalledTimes(2);expect(mocks.stop).not.toHaveBeenCalled();await manager.close();
  });
  it('coalesces concurrent launch and readiness attempts',async()=>{
    const read=deferred<ReturnType<typeof connected>>(),entered=deferred<void>(),request=vi.fn(async()=>{entered.resolve();return read.promise;}),manager=workshopObserver(profile,{request} as never);
    const first=manager.ensure(),second=manager.ensure();expect(second).toBe(first);await entered.promise;
    expect(mocks.start).toHaveBeenCalledOnce();expect(request).toHaveBeenCalledOnce();read.resolve(connected(true));await Promise.all([first,second]);await manager.close();
  });
  it('clears a rejected attempt so the next run can launch and succeed',async()=>{
    const request=vi.fn().mockRejectedValueOnce(new Error('RCON dropped')).mockResolvedValueOnce(connected(true)),manager=workshopObserver(profile,{request} as never);
    await expect(manager.ensure()).rejects.toThrow('RCON dropped');expect(mocks.stop).toHaveBeenCalledExactlyOnceWith(profile.observerConfig);
    await expect(manager.ensure()).resolves.toBeUndefined();expect(mocks.start).toHaveBeenCalledTimes(2);expect(request).toHaveBeenCalledTimes(2);await manager.close();
  });
  it('does not clean up a healthy client that it reused',async()=>{
    processes=[processFor()];const manager=workshopObserver(profile,{request:vi.fn().mockResolvedValue(connected(true))} as never);
    await manager.ensure();await manager.close();expect(mocks.start).not.toHaveBeenCalled();expect(mocks.stop).not.toHaveBeenCalled();
  });
  it('prevents replacement and later relaunch after shutdown starts',async()=>{
    processes=[processFor()];const read=deferred<ReturnType<typeof connected>>(),entered=deferred<void>(),manager=workshopObserver(profile,{request:async()=>{entered.resolve();return read.promise;}} as never);
    const attempt=manager.ensure();await entered.promise;const failed=expect(attempt).rejects.toThrow('builder unavailable'),closing=manager.close();
    read.resolve(connected(false));await failed;await closing;
    await expect(manager.ensure()).rejects.toThrow('shutting down');expect(mocks.start).not.toHaveBeenCalled();expect(mocks.stop).not.toHaveBeenCalled();
  });
});

describe('current observer multiplayer readiness',()=>{
  const source=readFileSync(path.join(root,'scripts/dev/game-processes.ts'),'utf8'),start=source.indexOf('export async function observerInGame('),end=source.indexOf('\n}',start)+2;
  const helperSource=source.slice(start,end).replace('export async','async');
  function helper(options:{processes?:ProjectProcess[];mtime?:number;log?:string;failure?:'path'|'stat'|'read';code?:string}={}){
    expect(start).toBeGreaterThanOrEqual(0);expect(end).toBeGreaterThan(start);
    const error=Object.assign(new Error('log unavailable'),{code:options.code??'ENOENT'}),list=vi.fn().mockResolvedValue(options.processes??[{...processFor(),startedAt:new Date(1000).toISOString()}]);
    const owned=vi.fn().mockResolvedValue('/fake/current.log'),stat=vi.fn().mockResolvedValue({mtimeMs:options.mtime??1000}),read=vi.fn().mockResolvedValue(options.log??'ClientMultiplayerManager.cpp: changing state from(ConnectedWaitingForMap) to(InGame)');
    if(options.failure==='path')owned.mockRejectedValue(error);if(options.failure==='stat')stat.mockRejectedValue(error);if(options.failure==='read')read.mockRejectedValue(error);
    const script=ts.transpileModule(helperSource,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.None}}).outputText;
    const check=vm.runInNewContext(`${script};observerInGame`,{path,listProjectProcesses:list,ownedPath:owned,stat,readFile:read,ObserverDisconnectedError}) as (profile:GameProfile)=>Promise<boolean>;
    return{check:()=>check(profile),list,owned,stat,read};
  }
  it('rejects a missing observer before reading a log',async()=>{
    const f=helper({processes:[]});expect(await f.check()).toBe(false);expect(f.owned).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();
  });
  it('ignores another profile even when its log says InGame',async()=>{
    const f=helper({processes:[processFor(path.join(root,'.runtime','other-profile','observer-config.ini'))]});expect(await f.check()).toBe(false);expect(f.read).not.toHaveBeenCalled();
  });
  it('does not treat a matching server process as a client',async()=>{
    const f=helper({processes:[{...processFor(),kind:'server'}]});expect(await f.check()).toBe(false);expect(f.read).not.toHaveBeenCalled();
  });
  it('matches the observer config without case sensitivity',async()=>{
    const f=helper({processes:[{...processFor(profile.observerConfig.toUpperCase()),startedAt:new Date(1000).toISOString()}]});expect(await f.check()).toBe(true);expect(f.read).toHaveBeenCalledExactlyOnceWith('/fake/current.log','utf8');
  });
  it('rejects the prior process log even when its latest state is InGame',async()=>{
    const f=helper({mtime:999});expect(await f.check()).toBe(false);expect(f.read).not.toHaveBeenCalled();
  });
  it('accepts a current log written at the process start time',async()=>{expect(await helper({mtime:1000}).check()).toBe(true);});
  it.each([
    {log:'ClientMultiplayerManager.cpp: changing state from(Ready) to(ConnectedWaitingForMap)',ready:false},
    {log:'ClientMultiplayerManager.cpp: changing state from(Ready) to(InGame)',ready:true},
    {log:'ClientMultiplayerManager.cpp: changing state from(Ready) to(InGame)\nClientMultiplayerManager.cpp: changing state from(InGame) to(DisconnectScheduled)',ready:false},
    {log:'ClientMultiplayerManager.cpp: changing state from(InGame) to(Disconnected)\nClientMultiplayerManager.cpp: changing state from(Ready) to(InGame)',ready:true},
    {log:'ServerMultiplayerManager.cpp: changing state from(Ready) to(InGame)',ready:false},
    {log:'',ready:false},
  ])('uses the latest client state ($ready): $log',async({log,ready})=>{expect(await helper({log}).check()).toBe(ready);});
  it('reports a terminal client disconnect with the typed retry signal',async()=>{
    const log='ClientMultiplayerManager.cpp: changing state from(Ready) to(InGame)\nClientMultiplayerManager.cpp: changing state from(InGame) to(Disconnected)';
    await expect(helper({log}).check()).rejects.toBeInstanceOf(ObserverDisconnectedError);
  });
  it.each(['path','stat','read'] as const)('treats a missing log at the %s boundary as not ready',async failure=>{expect(await helper({failure}).check()).toBe(false);});
  it('propagates unexpected log errors instead of silently reporting disconnection',async()=>{await expect(helper({failure:'read',code:'EACCES'}).check()).rejects.toThrow('log unavailable');});
});

describe('workshop game client preflight',()=>{
  it.each(['direct','character'] as const)('ensures the visible client before each %s run',async construction=>{
    const calls:string[]=[],ensure=vi.fn(async()=>{calls.push('ensure');}),request=vi.fn(async()=>{calls.push('connected');return connected(true);});
    const game=new LiveWorkshopGame({} as never,{request} as never,{} as never,undefined,undefined,null,null,ensure);
    await game.preflight(assignment(construction));await game.preflight(assignment(construction));expect(ensure).toHaveBeenCalledTimes(2);
    expect(calls).toEqual(construction==='character'?['ensure','connected','ensure','connected']:['ensure','ensure']);
  });
  it.each(['direct','character'] as const)('propagates client launch failure before %s game operations',async construction=>{
    const ensure=vi.fn().mockRejectedValueOnce(new Error('visible launch failed')).mockResolvedValueOnce(undefined),request=vi.fn().mockResolvedValue(connected(true));
    const game=new LiveWorkshopGame({} as never,{request} as never,{} as never,undefined,undefined,null,null,ensure);
    await expect(game.preflight(assignment(construction))).rejects.toThrow('visible launch failed');expect(request).not.toHaveBeenCalled();
    await expect(game.preflight(assignment(construction))).resolves.toBeUndefined();expect(ensure).toHaveBeenCalledTimes(2);
  });
  it('still rejects a disconnected legal character after client preparation',async()=>{
    const ensure=vi.fn().mockResolvedValue(undefined),request=vi.fn().mockResolvedValue(connected(false)),game=new LiveWorkshopGame({} as never,{request} as never,{} as never,undefined,undefined,null,null,ensure);
    await expect(game.preflight(assignment('character'))).rejects.toThrow('connected builder-1');expect(ensure).toHaveBeenCalledOnce();expect(request).toHaveBeenCalledOnce();
  });
  it('keeps explicit headless direct construction usable without a callback',async()=>{
    const request=vi.fn(),game=new LiveWorkshopGame({} as never,{request} as never,{} as never);
    await expect(game.preflight(assignment('direct'))).resolves.toBeUndefined();expect(request).not.toHaveBeenCalled();
  });
  it.each(['direct','character'] as const)('rejects a %s launch before inference or construction admission',async construction=>{
    const directory=mkdtempSync(path.join(os.tmpdir(),'af-client-admission-')),ensure=vi.fn().mockRejectedValue(new Error('visible client unavailable')),invoke=vi.fn(),build=vi.fn(),configure=vi.fn();
    const game=new LiveWorkshopGame({} as never,{} as never,{} as never,undefined,undefined,null,null,ensure);
    Object.assign(game,{resolveProfile:async()=>({gameVersion:'2.0.77',mods:{base:'2.0.77'},profileId:'starter-assembly',profileRevision:1,surface:'nauvis',technologies:['automation'],allowedEquipment:['assembling-machine-1'],modules:[],beacons:[],recipe:{id:'electronic-circuit',category:'crafting',energy:0.5,ingredients:[{type:'item',name:'iron-plate',amount:1}],products:[{type:'item',name:'electronic-circuit',amount:1}]},machine:'assembling-machine-1'}),build});
    const host=new LiveWorkshopHost(directory,{invoke,close:async()=>{}},game),runtime=new WorkshopRuntime({get(){throw new Error('not configured');},configure} as never,host,{} as never,()=>[selected],()=>'',()=>[],()=>{});
    try{
      await expect(runtime.launch(launchRequest(construction))).rejects.toThrow('visible client unavailable');
      expect(ensure).toHaveBeenCalledOnce();expect(configure).not.toHaveBeenCalled();expect(invoke).not.toHaveBeenCalled();expect(build).not.toHaveBeenCalled();
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
  it('forwards production host preparation into every run without provider inference',async()=>{
    const directory=mkdtempSync(path.join(os.tmpdir(),'af-blueprint-client-')),ensure=vi.fn().mockResolvedValue(undefined);
    try{
      const {host}=await prepareLiveWorkshopHost({directory,codexExecutable:path.resolve('fake-codex.exe'),port:{} as never,game:{} as never,lifecycle:{} as never,ensureVisibleClient:ensure});
      await host.preflight(assignment('direct'));await host.preflight(assignment('direct'));expect(ensure).toHaveBeenCalledTimes(2);
      expect(mocks.rpcCall.mock.calls.map(([method])=>method)).toEqual(['initialize','config/read']);expect(mocks.rpcClose).toHaveBeenCalledOnce();
    }finally{rmSync(directory,{recursive:true,force:true});}
  });
  it('discriminates a missing client callback using an in-memory preflight mutation',async()=>{
    const source=LiveWorkshopGame.prototype.preflight.toString();
    const mutated=source.replace(/await this\.ensureVisibleClient\?\.\(\);?/, '');expect(mutated).not.toBe(source);
    type Preflight=(this:{ensureVisibleClient:()=>Promise<void>;builderConnected:()=>Promise<boolean>},value:WorkshopAssignment)=>Promise<void>;
    const check=async(method:Preflight)=>{const ensure=vi.fn().mockResolvedValue(undefined);for(const mode of ['direct','character'] as const)await method.call({ensureVisibleClient:ensure,builderConnected:async()=>true},assignment(mode));expect(ensure).toHaveBeenCalledTimes(2);};
    const original=vm.runInNewContext(`({${source}}).preflight`) as Preflight,missing=vm.runInNewContext(`({${mutated}}).preflight`) as Preflight;
    await check(original);await expect(check(missing)).rejects.toThrow();
  });
});

describe('headless dashboard launch forwarding',()=>{
  it.each([false,true])('injects a per-run client manager only in visible mode (headless=%s)',async headless=>{
    const source=readFileSync(path.join(root,'scripts/dashboard.ts'),'utf8'),managerSource=/const observer=.*?;\s*closeObserver=.*?;/.exec(source)?.[0],callback=/ensureVisibleClient:([^,]+)/.exec(source)?.[1];
    expect(managerSource).toBeDefined();expect(callback).toBeDefined();
    const ensure=vi.fn().mockResolvedValue(undefined),close=vi.fn().mockResolvedValue(undefined),factory=vi.fn<(profile:unknown,game:unknown,onOwned:()=>void)=>{ensure:typeof ensure;close:typeof close}>(()=>({ensure,close})),writeFileSync=vi.fn(),file=path.join(profile.dir,'descriptor.json'),directory=path.join(root,'.runtime','fake-dashboard');
    const injected=vm.runInNewContext(`(()=>{let closeObserver;${managerSource}return{ensureVisibleClient:${callback},closeObserver};})()`,{process:{argv:headless?['--headless']:[]},workshopObserver:factory,profile,game:{},path,file,directory,writeFileSync}) as {ensureVisibleClient:(()=>Promise<void>)|null;closeObserver:()=>Promise<void>};
    expect(writeFileSync).not.toHaveBeenCalled();
    if(headless){expect(factory).not.toHaveBeenCalled();expect(injected.ensureVisibleClient).toBeNull();}
    else{expect(factory).toHaveBeenCalledOnce();await injected.ensureVisibleClient?.();await injected.ensureVisibleClient?.();expect(ensure).toHaveBeenCalledTimes(2);factory.mock.calls[0]![2]();expect(writeFileSync).toHaveBeenCalledExactlyOnceWith(path.join(directory,'observer-owned.json'),JSON.stringify({profileFile:path.resolve(file),observerConfig:profile.observerConfig}));}
    await injected.closeObserver();expect(close).toHaveBeenCalledTimes(headless?0:1);
  });
  it.each([false,true])('passes the explicit headless choice to the dashboard (%s)',async headless=>{
    const source=readFileSync(path.join(root,'scripts/start.mjs'),'utf8'),start=source.indexOf('async function launchDashboard('),end=source.indexOf('\nasync function stopGame(',start);
    expect(start).toBeGreaterThanOrEqual(0);expect(end).toBeGreaterThan(start);
    const spawn=vi.fn(()=>({stdout:{on:vi.fn()},stderr:{on:vi.fn()},once:vi.fn()}));
    const launch=vm.runInNewContext(`(${source.slice(start,end).trim()})`,{mkdtemp:async()=>'/fake/dashboard',path,runtimeRoot:'/fake/runtime',port:3000,spawn,root,process:{execPath:'node',env:{},stdout:{write:vi.fn()},stderr:{write:vi.fn()}},childProcesses:new Set(),waitForHealth:async()=>{}}) as (...args:unknown[])=>Promise<unknown>;
    await launch('real','fake-codex','profile.json',null,headless);
    expect(spawn).toHaveBeenCalledOnce();const args=spawn.mock.calls[0] as unknown[];expect((args[1] as string[]).includes('--headless')).toBe(headless);
  });
});

describe('launcher ownership transfer cleanup',()=>{
  const source=readFileSync(path.join(root,'scripts/start.mjs'),'utf8'),descriptor=path.join(profile.dir,'descriptor.json'),directory=path.join(root,'.runtime','fake-dashboard');
  const receipt={profileFile:path.resolve(descriptor),observerConfig:profile.observerConfig};
  const helperStart=source.indexOf('async function stopDashboardObserver('),helperEnd=source.indexOf('\nasync function shutdown(',helperStart),helperSource=source.slice(helperStart,helperEnd);
  function cleanup(options:{marker?:unknown;readError?:string;owned?:boolean;directory?:string|null}={}){
    expect(helperStart).toBeGreaterThanOrEqual(0);expect(helperEnd).toBeGreaterThan(helperStart);
    const read=vi.fn().mockResolvedValue(typeof options.marker==='string'?options.marker:JSON.stringify(options.marker??receipt)),stop=vi.fn().mockResolvedValue(undefined),warn=vi.fn();
    if(options.readError)read.mockRejectedValue(Object.assign(new Error('receipt unavailable'),{code:options.readError}));
    const check=vm.runInNewContext(`(${helperSource})`,{path,ownedObserver:options.owned??false,dashboardDirectory:options.directory===null?undefined:options.directory??directory,readFile:read,stopObserver:stop,console:{error:warn}}) as (file?:string)=>Promise<void>;
    return{check,read,stop,warn};
  }
  it('preserves a supplied healthy reused client without an ownership marker',async()=>{
    const f=cleanup({readError:'ENOENT'});await f.check(descriptor);expect(f.stop).not.toHaveBeenCalled();expect(f.warn).not.toHaveBeenCalled();
  });
  it('cleans a recovered client using the exact config retained at spawn',async()=>{
    const f=cleanup();await f.check(descriptor);expect(f.read).toHaveBeenCalledExactlyOnceWith(path.join(directory,'observer-owned.json'),'utf8');expect(f.stop).toHaveBeenCalledExactlyOnceWith(descriptor,profile.observerConfig);
  });
  it.each([
    {marker:{...receipt,profileFile:path.join(root,'.runtime','other-profile','descriptor.json')}},
    {marker:{profileFile:receipt.profileFile}},
    {marker:{...receipt,observerConfig:17}},
    {marker:{...receipt,observerConfig:''}},
    {marker:{...receipt,observerConfig:'relative/observer-config.ini'}},
    {marker:'{invalid json'},
    {marker:'null'},
  ])('preserves reused clients and reports invalid ownership evidence ($marker)',async options=>{
    const f=cleanup(options);await f.check(descriptor);expect(f.stop).not.toHaveBeenCalled();expect(f.warn).toHaveBeenCalledOnce();
  });
  it('preserves a reused client when marker reading fails unexpectedly',async()=>{
    const f=cleanup({readError:'EACCES'});await f.check(descriptor);expect(f.stop).not.toHaveBeenCalled();expect(f.warn).toHaveBeenCalledOnce();
  });
  it('retains startup-owned client cleanup without requiring a dashboard marker',async()=>{
    const f=cleanup({owned:true,readError:'ENOENT'});await f.check(descriptor);expect(f.read).not.toHaveBeenCalled();expect(f.stop).toHaveBeenCalledExactlyOnceWith(descriptor,undefined);
  });
  it('performs no observer cleanup without a supplied profile',async()=>{
    const f=cleanup();await f.check();expect(f.read).not.toHaveBeenCalled();expect(f.stop).not.toHaveBeenCalled();
  });
  it('preserves unowned clients before a dashboard directory has been established',async()=>{
    const f=cleanup({directory:null});await f.check(descriptor);expect(f.read).not.toHaveBeenCalled();expect(f.stop).not.toHaveBeenCalled();
  });
  it('uses the retained config when the profile descriptor has disappeared',async()=>{
    const start=source.indexOf('async function stopObserver('),end=source.indexOf('\nasync function main(',start),run=vi.fn().mockResolvedValue(undefined),existsSync=vi.fn().mockReturnValue(false);
    expect(start).toBeGreaterThanOrEqual(0);expect(end).toBeGreaterThan(start);
    const stop=vm.runInNewContext(`(${source.slice(start,end)})`,{existsSync,run,process:{execPath:'node'},console:{error:vi.fn()},text:String}) as (file:string,config:string)=>Promise<void>;
    await stop(descriptor,profile.observerConfig);expect(existsSync).not.toHaveBeenCalled();expect(run).toHaveBeenCalledExactlyOnceWith('node',['dist/scripts/game-processes.js','--stop-profile',profile.observerConfig],{label:'Factorio observer cleanup'});
  });
  it.each([{unexpected:false,marker:true},{unexpected:false,marker:false},{unexpected:true,marker:true},{unexpected:true,marker:false}])('handles dashboard exit without its JS cleanup handler (unexpected=$unexpected, marker=$marker)',async({unexpected,marker})=>{
    const mainStart=source.indexOf('async function main()'),tailStart=source.indexOf('\nlet stopping = false;',mainStart);expect(mainStart).toBeGreaterThanOrEqual(0);expect(tailStart).toBeGreaterThan(mainStart);
    const registered=deferred<void>(),signals=new Map<string,()=>void>();let exitChild!:(code:number|null,signal:string)=>void;
    const child={once:vi.fn((_event:string,callback:typeof exitChild)=>{exitChild=callback;registered.resolve();}),kill:vi.fn((signal:string)=>{exitChild(null,signal);return true;})},stop=vi.fn().mockResolvedValue(undefined),stopGame=vi.fn(),read=vi.fn().mockResolvedValue(JSON.stringify(receipt)),warn=vi.fn();
    if(!marker)read.mockRejectedValue(Object.assign(new Error('missing ownership marker'),{code:'ENOENT'}));
    const fakeProcess={env:{AUTOFACTORIO_PROFILE_FILE:descriptor},execPath:'node',exitCode:0,on:(name:string,callback:()=>void)=>signals.set(name,callback)};
    class StartupError extends Error{constructor(readonly stage:string,message:string){super(message);}}
    const context={path,options:()=>({mode:'real',headless:false}),mkdir:async()=>{},runtimeRoot:directory,probePort:async()=>false,prepareDependencies:async()=>{},findCodex:()=>'/fake/codex',factorioAvailable:()=>'/fake/factorio',existsSync:()=>true,run:async()=>({stdout:JSON.stringify({launched:false})}),writeFile:async()=>{},readFile:read,console:{log:vi.fn(),warn:vi.fn(),error:warn},openBrowser:()=>true,url:'http://localhost:3000',port:3000,process:fakeProcess,StartupError,stopObserver:stop,stopGame,childProcesses:new Set([child]),fixtureChild:child,fixtureDirectory:directory,text:String};
    // Run production main, shutdown, and catch/finally against a harmless child.
    const execution=vm.runInNewContext(`(async()=>{async function launchDashboard(){dashboardDirectory=fixtureDirectory;return{child:fixtureChild,directory:fixtureDirectory};}${source.slice(mainStart)}})()`,context) as Promise<void>;
    await registered.promise;if(unexpected)exitChild(1,'SIGKILL');else signals.get('SIGINT')!();await execution;
    expect(stopGame).not.toHaveBeenCalled();expect(stop).toHaveBeenCalledTimes(marker?1:0);
    if(marker)expect(stop).toHaveBeenCalledExactlyOnceWith(path.resolve(descriptor),profile.observerConfig);
    expect(fakeProcess.exitCode).toBe(unexpected?1:0);expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
