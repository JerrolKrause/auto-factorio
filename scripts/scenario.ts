import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareFirstShift } from './dev/first-shift-session.js';
import { briefing, fingerprint } from '../packages/factorio/src/first-shift.js';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { Coordinator } from '../packages/core/orchestration/coordinator.js';
import { team, soloTeam } from '../packages/core/orchestration/roles.js';
import { PROBE_CAPS } from '../packages/codex/src/budget.js';
import { ASTRA } from '../packages/codex/src/protocol.js';
import { Operator } from '../apps/runtime/operator.js';
import { dashboard } from '../apps/runtime/http.js';

const value = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
if (value('--scenario') && value('--scenario') !== '01-first-shift') throw new Error('Only 01-first-shift is implemented');
const roster = value('--roster') ?? 'team'; if (roster !== 'team' && roster !== 'solo') throw new Error('Select --roster team or solo');
const { run, profile, port, game, life } = await prepareFirstShift(roster, value('--reset'));
const runtime = new DurableRuntime(run.directory, run.run, run.epoch, game, life, [profile.password]);
const agents = roster === 'team' ? team() : soloTeam();
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true });
runtime.initialize({ objective: 'Sustain 30 automatic red science/minute for five scored minutes', scenario: run.manifest.id, scenarioVersion: run.manifest.version, seed: run.manifest.seed, codeCommit: revision.status === 0 ? revision.stdout.trim() + '+working-tree' : 'unknown', gameVersion: run.manifest.mods.base!, mods: run.manifest.mods, roster: agents.map(a => a.id), model: ASTRA, effort: 'low', instructionHashes: Object.fromEntries(agents.map(a => [a.id, fingerprint(a.definition)])), assisted: false, status: 'ready' });
const c = new Coordinator(runtime, { ...PROBE_CAPS, runMs: run.manifest.wallLimitMs }); agents.forEach(a => c.register(a));
runtime.evidence('agent-observation', briefing(run.manifest, roster), { kind: 'shared' });
runtime.record('scenario/origin', [{ entity: 'runs', id: 'scenario-origin', value: { ...run } }]);
runtime.record('scenario/clock', [{ entity: 'runs', id: 'scenario-clock', value: { originTick: run.originTick, originWallMs: run.originWallMs, gameLimitTicks: run.manifest.gameLimitTicks, wallLimitMs: run.manifest.wallLimitMs } }]);
const operator = new Operator(c); await operator.control('pause');
await writeFile(path.join(run.directory, 'launch-result.json'), JSON.stringify({ runFile: path.join(run.directory, 'run.json'), profileFile: path.join(run.directory, 'profile.json'), directory: run.directory }));
if (value('--result-file')) await writeFile(value('--result-file')!, JSON.stringify({ runFile: path.join(run.directory, 'run.json'), profileFile: path.join(run.directory, 'profile.json'), directory: run.directory }));
console.log(JSON.stringify({ scenario: run.manifest.id, roster, directory: run.directory, runFile: path.join(run.directory, 'run.json'), inference: 'not started' }));
if (process.argv.includes('--hold')) { runtime.close(); port.close(); }
else {
  const server = dashboard(operator); const origin = await server.listen(0);
  await writeFile(path.join(run.directory, 'dashboard.json'), JSON.stringify({ origin, url: origin + '/#cap=' + server.capability }));
  console.log(JSON.stringify({ origin, launchFile: path.join(run.directory, 'dashboard.json') }));
  const stop = operator.start(); let closing = false;
  const close = async () => { if (closing) return; closing = true; await stop(); await operator.control('pause'); await server.close(); runtime.close(); port.close(); };
  process.on('SIGINT', () => void close()); process.on('SIGTERM', () => void close());
}
