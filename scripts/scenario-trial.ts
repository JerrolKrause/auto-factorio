import { appendFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { prepareFirstShift } from './dev/first-shift-session.js';
import { stopProfile } from './dev/game-processes.js';
import { briefing, fingerprint, FirstShiftAttempt, FirstShiftControl, evaluatorManifest } from '../packages/factorio/src/first-shift.js';
import { VerificationControl } from '../packages/factorio/src/verification.js';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { Coordinator } from '../packages/core/orchestration/coordinator.js';
import { team } from '../packages/core/orchestration/roles.js';
import { ASTRA, PINNED_CODEX } from '../packages/codex/src/protocol.js';
import { Operator } from '../apps/runtime/operator.js';
import { dashboard } from '../apps/runtime/http.js';
import { CoordinationGateway } from '../packages/tools/src/coordination.js';
import { CoordinationMcp } from '../packages/tools/src/coordination-mcp.js';
import { GameplayProvider, gameplayInstructions } from '../apps/runtime/gameplay-provider.js';
import { referencePreflight, TRIAL_CAPS, TRIAL_PLAN } from '../apps/runtime/trial-plan.js';
import type { Command } from '../packages/core/execution/durable.js';
import { SerialPort } from '../packages/factorio/src/serial-port.js';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import { cleanupSetupFailure, replacementMatchesPending, trialControl, replacementStatus, trialFailure, TrialResources } from '../apps/runtime/trial-state.js';
import type { ReplacementEvidence } from '../apps/runtime/trial-state.js';
import { object } from '../packages/codex/src/protocol.js';

const value = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const kind = value('--trial'); const executable = value('--codex'); const reference = value('--reference');
if (!['unassisted-team-replacement', 'assisted-team'].includes(kind ?? '') || !executable || !path.isAbsolute(executable) || !reference) throw new Error('Use --trial unassisted-team-replacement|assisted-team --codex <absolute executable> --reference <passed S1 evidence directory> [--hint-file <exact operator text>] [--reset <held run.json>] [--preflight]');
const codexExecutable = executable; const referenceDirectory = reference;
const hint = value('--hint-file') ? await readFile(value('--hint-file')!, 'utf8') : null;
if (kind === 'assisted-team' && (!hint?.trim() || hint.length > 8000) || kind !== 'assisted-team' && hint !== null) throw new Error('Exactly the assisted trial requires an operator hint file');
await referencePreflight(reference);
await mkdir('.runtime/phase12', { recursive: true });
const inherited = await GameplayProvider.inherited(executable, path.resolve('.runtime/phase12'));
const preparedGame = await prepareFirstShift('team', value('--reset'));
const resources = new TrialResources();
let cleanupLife: Lifecycle | null = null;
async function executeTrial() {
const { run, profile } = preparedGame;
const port = new SerialPort(preparedGame.port);
resources.register('rcon', () => port.close());
const gameSink = (e: unknown) => appendFileSync(path.join(run.directory, 'trial-game.jsonl'), JSON.stringify(e) + '\n');
const game = new GameClient(port, gameSink); const life = new Lifecycle(port, game, gameSink);
cleanupLife = life;
const evidence = await referencePreflight(referenceDirectory, run.fixtureHash);
const runtime = new DurableRuntime(run.directory, run.run, run.epoch, game, life, [profile.password]);
resources.register('runtime', () => runtime.close());
const agents = team().map(a => ({ ...a, definition: { ...a.definition, limits: { tools: TRIAL_CAPS.tools } } }));
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true });
const instructions = Object.fromEntries(agents.map(a => [a.id, fingerprint(gameplayInstructions + '\n' + a.definition.instructions)]));
runtime.initialize({ objective: 'Sustain 30 automatic red science/minute for five scored minutes', scenario: run.manifest.id, scenarioVersion: run.manifest.version, seed: run.manifest.seed,
  codeCommit: revision.stdout.trim() + '+phase12-working-tree', gameVersion: run.manifest.mods.base!, mods: run.manifest.mods, roster: agents.map(a => a.id), model: ASTRA, effort: 'low', instructionHashes: instructions, assisted: hint !== null, status: 'ready' });
// Hold the first unsent batch across the controlled context replacement. Provider
// startup latency must not race a short construction batch out of the exercise.
let holdForReplacement = kind === 'unassisted-team-replacement';
const c = new Coordinator(runtime, TRIAL_CAPS, () => performance.now(), () => !holdForReplacement); agents.forEach(a => c.register(a));
runtime.record('scenario/clock', [{ entity: 'runs', id: 'scenario-clock', value: { originTick: run.originTick, originWallMs: run.originWallMs, gameLimitTicks: TRIAL_PLAN.gameLimitTicks, wallLimitMs: TRIAL_CAPS.runMs } }]);
const manifest = { schema: 1, kind, plan: TRIAL_PLAN, run: run.run, fixtureHash: run.fixtureHash, reference: evidence, model: ASTRA, effort: 'low', codex: PINNED_CODEX, instructions,
  originTick: run.originTick, originWallMs: run.originWallMs, inferenceStarted: false, providerTelemetry: 'unknown until observed' };
await writeFile(path.join(run.directory, 'trial-manifest.json'), JSON.stringify(manifest, null, 2));
runtime.record('trial/manifest', [{ entity: 'runs', id: 'trial', value: manifest }]);
const operator = new Operator(c); await operator.control('pause');
let verifyRequested = false; let attempt: FirstShiftAttempt | null = null;
const gateway = new CoordinationGateway(c, undefined, { briefing: briefing(run.manifest, 'team'), verify: () => {
  if (verifyRequested || attempt) throw new Error('One verification attempt per trial');
  if (runtime.execution.pending().some(x => !['completed', 'failed', 'partial', 'cancelled'].includes(x.receipt?.status ?? ''))) throw new Error('Wait for construction receipts before verification');
  verifyRequested = true; return { requested: true, success: 'Only the evaluator can establish success' };
} });
let replacement: ReplacementEvidence | null = null;
const mcp = new CoordinationMcp(c, gateway, (binding, name, args, result) => {
  if (replacement && binding.session === replacement.session && name === 'replacement') {
    const world = object(object(result).world);
    const taskId = String(object(args).task); const task = c.tasks().find(candidate => candidate.id === taskId);
    const commands = runtime.journal.list<Command>(run.run, 'commands');
    if (Number.isSafeInteger(world.tick) && replacementMatchesPending(replacement, taskId, task, commands)) {
      replacement.observation = { tick: Number(world.tick), task: taskId, session: binding.session };
      runtime.record('trial/replacement-observed', [{ entity: 'runs', id: 'replacement', value: { ...replacement } }]);
      holdForReplacement = false;
    }
  }
}); const transport = await mcp.listen();
resources.register('mcp', () => transport.close());
const sink = (e: Parameters<ConstructorParameters<typeof GameplayProvider>[6]>[0]) => {
  appendFileSync(path.join(run.directory, 'provider-events.jsonl'), JSON.stringify(e) + '\n');
  c.activity(e.role, 'provider', e);
  if (['turn/submitted', 'turn/completed', 'provider/ready'].includes(e.kind)) console.log(JSON.stringify({ role: e.role, kind: e.kind, turn: e.turn }));
};
const providers = new GameplayProvider(codexExecutable, run.directory, c, mcp, transport.url, inherited, sink);
resources.register('providers', () => providers.close());
const server = dashboard(operator);
resources.register('dashboard', () => server.close());
const origin = await server.listen(0);
await writeFile(path.join(run.directory, 'dashboard.json'), JSON.stringify({ origin, url: origin + '/#cap=' + server.capability }));
console.log(JSON.stringify({ directory: run.directory, run: run.run, kind, caps: TRIAL_CAPS, origin, dashboard: path.join(run.directory, 'dashboard.json') }));
let failure: string | null = null; let reason = 'preflight-only'; let preflightPassed = false;
let providerStop: string | null = null;
let closing = false;
const interrupt = () => { closing = true; c.stop('operator_interrupt'); };
process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
resources.register('signal-handlers', () => { process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt); });
const stopPolling = operator.start(250);
resources.register('operator-polling', stopPolling);
const evaluatorSink = (e: unknown) => { runtime.evidence('operator-telemetry', e, { kind: 'operator' }); };
const pending = () => runtime.execution.pending().filter(x => x.state !== 'rolled_back' && !['completed', 'failed', 'partial', 'cancelled'].includes(x.receipt?.status ?? ''));
const versions = new Map<string, string>();
function wakeKey(role: string) {
  const view = c.view(role);
  return fingerprint({ tasks: view.tasks, messages: view.messages,
    commands: runtime.journal.list<Command>(run.run, 'commands').filter(x => view.tasks.some(t => t.id === x.batch.task)).map(x => ({ id: x.batch.commandId, state: x.state, receipt: x.receipt })),
    hints: runtime.journal.list(run.run, 'interventions') });
}
try {
  // Both exact role catalogs, auth and environment isolation pass before the first turn.
  for (const a of agents) { const prepared = await providers.prepare(a.id); prepared.close(); }
  preflightPassed = true;
  if (!process.argv.includes('--preflight')) {
    if ((await operator.control('resume')).status !== 'running') throw new Error('Game resume not acknowledged');
    manifest.inferenceStarted = true;
    await writeFile(path.join(run.directory, 'trial-manifest.json'), JSON.stringify(manifest, null, 2));
    let lastProgress = Date.now();
    while (!closing && !c.budget.state.closed) {
      const control = trialControl(operator.state());
      if (control === 'stop' || control === 'disconnected') { reason = 'operator_' + control; break; }
      if (control === 'wait') { lastProgress = Date.now(); await delay(250); continue; }
      if (verifyRequested && !providers.active.size) {
        attempt = new FirstShiftAttempt(randomUUID(), evaluatorManifest(run.manifest, run.fixtureHash, run.originTick, run.originWallMs), new FirstShiftControl(port), new VerificationControl(port, evaluatorSink), evaluatorSink);
        runtime.record('verification/requested', [{ entity: 'runs', id: 'verification', value: { active: true, valid: true } }]);
        await attempt.admit(await runtime.inspectControl());
        while (['admitting', 'settling', 'scoring'].includes(attempt.engine.report().state) && !c.budget.state.closed && !closing) {
          const state = trialControl(operator.state());
          if (state === 'stop' || state === 'disconnected') break;
          if (state === 'run' || operator.state().status === 'paused') await attempt.poll();
          await delay(250);
        }
        reason = 'evaluator_' + attempt.engine.report().state; break;
      }
      if (c.budget.state.spentTurns >= TRIAL_CAPS.turns) { reason = 'turn_cap'; break; }
      let worked = false;
      const replacementDue = kind === 'unassisted-team-replacement' && !replacement && c.agent('engineer').lineage.length > 0 && pending().length > 0;
      for (const role of replacementDue ? ['engineer', 'foreman'] : ['foreman', 'engineer']) {
        if (c.budget.state.spentTurns >= TRIAL_CAPS.turns || c.budget.state.closed || closing || verifyRequested || trialControl(operator.state()) !== 'run') break;
        const key = wakeKey(role);
        if (versions.get(role) === key || role === 'engineer' && !c.tasks().some(t => t.owner === role)) continue;
        // Ordinary work waits on deterministic reconciliation, not repeated provider polling.
        const replace = kind === 'unassisted-team-replacement' && role === 'engineer' && !replacement && c.agent(role).lineage.length > 0 && pending().length > 0;
        if (role === 'engineer' && pending().length > 0 && !replace) continue;
        const previous = providers.sessions.get(role); const before = c.budget.snapshot();
        if (replace) await operator.poll();
        const prepared = await providers.prepare(role, replace);
        if (replace) {
          replacement = { previousSession: previous!, session: prepared.provider.session!, pendingAtBinding: [], budgetBefore: before, budgetAtBinding: null, observation: null, at: new Date().toISOString(), tick: operator.state().gameTick };
          runtime.record('trial/replacement-prepared', [{ entity: 'runs', id: 'replacement', value: { ...replacement } }]);
        }
        try {
          if (trialControl(operator.state()) !== 'run') continue;
          await prepared.start(replace ? 'Your old context has been replaced. First call replacement for your assigned task (area 0, offset 0), reconcile pending work and continue without duplicating actions. Finish the turn if the batch is still running.' : 'Continue the S1 objective using scenario and observe, assigned work, receipts and messages. Interpret any received operator hint. Plan or act when useful; end the turn while deterministic work runs.', () => {
            if (replace && replacement) {
              replacement.pendingAtBinding = pending().map(x => x.batch.commandId); replacement.budgetAtBinding = c.budget.snapshot();
              runtime.record('trial/replacement-bound', [{ entity: 'runs', id: 'replacement', value: { ...replacement } }]);
            }
          });
          while (!prepared.provider.turn?.finished) {
            if (closing) c.stop('operator_interrupt');
            if (prepared.provider.turn?.closed && prepared.provider.turn.elapsedMs > TRIAL_CAPS.turnMs + 30_000) throw new Error('Provider completion unconfirmed');
            await delay(100);
          }
        } finally {
          if (prepared.provider.turn && !prepared.provider.turn.finished) {
            await prepared.provider.interrupt();
            const deadline = Date.now() + 10_000;
            while (!prepared.provider.turn.finished && Date.now() < deadline) await delay(100);
          }
          prepared.close();
        }
        await operator.poll();
        if (hint && !runtime.journal.get(run.run, 'interventions', 'planned-hint')) {
          operator.interventions.advice('planned-hint', 'foreman', hint, operator.state().gameTick); operator.interventions.deliver();
          console.log(JSON.stringify({ kind: 'operator/hint', recipient: 'foreman', text: hint, gameTick: operator.state().gameTick }));
        }
        // Keep the pre-turn key: new assignments/receipts/messages warrant a follow-up.
        versions.set(role, key); worked = true; lastProgress = Date.now();
      }
      if (!worked && pending().length === 0 && Date.now() - lastProgress > 3000) { reason = 'model_idle_without_actionable_progress'; break; }
      await delay(100);
    }
    if (c.budget.state.closed) reason = c.budget.state.reason ?? 'budget_closed';
  }
} catch (error) {
  ({ failure, reason, providerStop } = trialFailure(error, manifest.inferenceStarted));
  if (failure) process.exitCode = 1;
}
finally {
  c.stop(reason); await operator.poll();
  for (const provider of providers.active.values()) await provider.interrupt();
  const held = await operator.control('stop');
  if (held.cancellation !== 'confirmed' || held.inference !== 'confirmed') { failure ??= 'Shutdown cancellation or inference unconfirmed'; process.exitCode = 1; }
  if (attempt && !['passed', 'failed', 'invalid', 'aborted'].includes(attempt.engine.report().state)) attempt.stop(reason);
  const budget = c.budget.snapshot();
  const report = { schema: 1, run: run.run, kind, reason, failure, providerStop, reference: evidence, manifest, budget,
    reportedTokens: Object.keys(budget.usageBySession).length ? budget.reportedTokens : null,
    replacement, agents: c.agents(), tasks: c.tasks(), commands: runtime.journal.list(run.run, 'commands'), interventions: runtime.journal.list(run.run, 'interventions'),
    evaluator: attempt?.engine.report() ?? { state: 'not-requested' }, cleanup: held,
    integration: { providerPreflight: preflightPassed, freshContext: replacementStatus(replacement), assistance: runtime.journal.list<{ delivery: string }>(run.run, 'interventions').some(x => x.delivery === 'interpreted') } };
  await writeFile(path.join(run.directory, 'trial-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ directory: run.directory, reason, failure, spentTurns: budget.spentTurns, reportedTokens: report.reportedTokens }));
}
}
let setupError: unknown;
try { await executeTrial(); }
catch (error) { setupError = error; }
finally {
  const { run, profile } = preparedGame;
  if (setupError) {
    // Once the trial wrapper exists, every cleanup request shares its FIFO with polling.
    const life = cleanupLife ?? preparedGame.life;
    const cleanup = await cleanupSetupFailure({
      hold: async () => { const state = await life.inspect(); return state.paused ? state : life.pause(state); },
      closeResources: () => resources.close(),
      stopObserver: () => stopProfile(profile.observerConfig),
      stopServer: () => stopProfile(profile.config),
      record: result => writeFile(path.join(run.directory, 'trial-setup-failure.json'), JSON.stringify({ schema: 1, run: run.run, reason: 'setup_failure', failure: String(setupError), cleanup: result }, null, 2)),
    });
    if (cleanup.errors.length) console.error(JSON.stringify({ run: run.run, setupFailure: String(setupError), cleanupErrors: cleanup.errors }));
  } else {
    const cleanup = await resources.close();
    await writeFile(path.join(run.directory, 'trial-resource-cleanup.json'), JSON.stringify({ schema: 1, run: run.run, cleanup }, null, 2));
  }
}
if (setupError) throw setupError;
