import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { prepareFirstShift } from './dev/first-shift-session.js';
import { briefing, fingerprint } from '../packages/factorio/src/first-shift.js';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { Coordinator } from '../packages/core/orchestration/coordinator.js';
import { team, soloTeam } from '../packages/core/orchestration/roles.js';
import { PROBE_CAPS } from '../packages/codex/src/budget.js';
import { ASTRA } from '../packages/codex/src/protocol.js';
import { DEFAULT_OPERATIONAL_LIMITS } from '@autofactorio/contracts';
import { Operator } from '../apps/runtime/operator.js';
import { dashboard } from '../apps/runtime/http.js';
import { prepareLiveWorkshopHost } from '../apps/runtime/workshop-live-host.js';
import { WorkspaceCatalog, WorkspaceOwnershipConflict } from '../packages/storage/src/workspace-catalog.js';
import { ownedPath } from './dev/game-processes.js';

const value = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const scenario = value('--scenario') ?? '01-first-shift';
if (!['01-first-shift', '02-some-assembly-required'].includes(scenario)) throw new Error('Unknown scenario selector');
const roster = value('--roster') ?? 'team'; if (roster !== 'team' && roster !== 'solo') throw new Error('Select --roster team or solo');
const workspaceCatalog = new WorkspaceCatalog(path.resolve('.runtime'));
const requestId = value('--request-id') ?? randomUUID();
const requestPayload = { scenario, roster };
const resetFile = value('--reset');
if (resetFile) {
  const previous = JSON.parse(await readFile(await ownedPath(resetFile), 'utf8')) as {workspaceRequestId?:string};
  if (!previous.workspaceRequestId || workspaceCatalog.owner()?.id !== previous.workspaceRequestId) throw new Error('Scenario reset requires the exact owned prior run');
} else {
  const admission = workspaceCatalog.admit(requestId, 'scenario', requestPayload);
  if (!admission.newlyAdmitted) { console.log(JSON.stringify({ request: admission.request, duplicate: true })); workspaceCatalog.close(); process.exit(0); }
}
const { run, profile, port, game, life } = await prepareFirstShift(roster, resetFile, scenario as '01-first-shift' | '02-some-assembly-required', {
  requestId, afterPreviousStopped: previous => { workspaceCatalog.transferScenario(previous.workspaceRequestId!, requestId, requestPayload); },
});
const runtime = new DurableRuntime(run.directory, run.run, run.epoch, game, life, [profile.password]);
const agents = roster === 'team' ? team() : soloTeam();
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true });
const manifest = { objective: 'Sustain 30 automatic red science/minute for five scored minutes', scenario: run.manifest.id, scenarioVersion: run.manifest.version, seed: run.manifest.seed, codeCommit: revision.status === 0 ? revision.stdout.trim() + '+working-tree' : 'unknown', gameVersion: run.manifest.mods.base!, mods: run.manifest.mods, roster: agents.map(a => a.id), model: ASTRA, effort: 'low', instructionHashes: Object.fromEntries(agents.map(a => [a.id, fingerprint(a.definition)])), assisted: false, status: 'ready', operationalLimits: DEFAULT_OPERATIONAL_LIMITS, contextLifecycle: { schema: 1 as const, maxTurns: DEFAULT_OPERATIONAL_LIMITS.rotationTurns, maxDeliveredBytes: DEFAULT_OPERATIONAL_LIMITS.rotationBytes } };
runtime.initialize(manifest);
const history=workspaceCatalog.beginScenario(run.directory,run.run,requestId,manifest);
runtime.record('workspace/identity-recorded',[{entity:'workspaceGroups',id:history.group.id,value:{...history.group}},{entity:'workspaceRuns',id:history.run.id,value:{...history.run}}]);
workspaceCatalog.journaled(history.run.id);
workspaceCatalog.transitionRequest(requestId,'active');
const c = new Coordinator(runtime, { ...PROBE_CAPS, runMs: run.manifest.wallLimitMs }); agents.forEach(a => c.register(a));
runtime.evidence('agent-observation', briefing(run.manifest, roster), { kind: 'shared' });
runtime.record('scenario/origin', [{ entity: 'runs', id: 'scenario-origin', value: { ...run } }]);
runtime.record('scenario/clock', [{ entity: 'runs', id: 'scenario-clock', value: { originTick: run.originTick, originWallMs: run.originWallMs, gameLimitTicks: run.manifest.gameLimitTicks, wallLimitMs: run.manifest.wallLimitMs } }]);
const operator = new Operator(c); await operator.control('pause');
operator.workspaceAdmission = action => { if(action==='resume'){const owner=workspaceCatalog.owner();if(owner?.id!==requestId){if(owner)throw new WorkspaceOwnershipConflict(owner);throw new Error('Scenario ownership unavailable for resume');}} };
operator.workspaceControlSettled = (action,state) => { if(action==='stop'&&state.status==='stopped'&&state.cancellation==='confirmed'&&state.inference==='confirmed')workspaceCatalog.transitionRequest(requestId,'cancelled','operator_stop'); };
await writeFile(path.join(run.directory, 'launch-result.json'), JSON.stringify({ runFile: path.join(run.directory, 'run.json'), profileFile: path.join(run.directory, 'profile.json'), directory: run.directory }));
if (value('--result-file')) await writeFile(value('--result-file')!, JSON.stringify({ runFile: path.join(run.directory, 'run.json'), profileFile: path.join(run.directory, 'profile.json'), directory: run.directory }));
console.log(JSON.stringify({ scenario: run.manifest.id, roster, directory: run.directory, runFile: path.join(run.directory, 'run.json'), inference: 'not started' }));
if (process.argv.includes('--hold')) { runtime.close(); port.close(); workspaceCatalog.close(); }
else {
  const codex=value('--codex');if(!codex||!path.isAbsolute(codex))throw new Error('Interactive scenario dashboard requires --codex <absolute managed Codex executable>');
  const prepared=await prepareLiveWorkshopHost({directory:run.directory,codexExecutable:codex,port,game,lifecycle:life});
  const server = dashboard(operator,undefined,{workshopHost:prepared.host,managedModels:prepared.catalog.models,workspaceCatalog}); const origin = await server.listen(0);
  await writeFile(path.join(run.directory, 'dashboard.json'), JSON.stringify({ origin, url: origin, capability: server.capability }));
  console.log(JSON.stringify({ origin, launchFile: path.join(run.directory, 'dashboard.json') }));
  const stop = operator.start(); let closing = false;
  const close = async () => { if (closing) return; closing = true; await stop(); await operator.control('pause'); await server.close(); runtime.close(); port.close(); workspaceCatalog.close(); };
  process.on('SIGINT', () => void close()); process.on('SIGTERM', () => void close());
}
