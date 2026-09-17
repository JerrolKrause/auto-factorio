import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { reportUsage, estimateCost, evaluatePlan, validatePlan } from '../scripts/dev/usage.mjs';
import { dashboardSnapshot, project, watch } from '../scripts/dev/watch.mjs';
import { prepareContract, summarizeContract } from '../scripts/dev/contract.mjs';
import { runPreflight } from '../scripts/dev/preflight.mjs';
import { discoverCodex, parseRouting, selectTask } from '../scripts/dev/task.mjs';
import { safeRuntimePath, sha256 } from '../scripts/dev/safe-artifacts.mjs';

const temp = prefix => mkdtemp(path.join(os.tmpdir(), prefix));
const execute = promisify(execFile);
const lines = async (file, values, tail = '') => writeFile(file, `${values.map(value => JSON.stringify(value)).join('\n')}\n${tail}`);

describe('development usage attribution and accounting', () => {
  it('selects only root, descendants and explicit run mappings and exports no private fields', async () => {
    const dir = await temp('af-usage-');
    await lines(path.join(dir, 'root.jsonl'), [
      { type: 'session_meta', payload: { id: 'root', model: 'gpt-5.6-sol', transcript: 'secret', credential: 'token' } },
      { type: 'response_usage', timestamp: '2026-09-17T10:00:00Z', responseId: 'r1', usage: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 5, reasoningTokens: 3 }, message: 'private' },
    ]);
    await lines(path.join(dir, 'child.jsonl'), [{ type: 'session_meta', payload: { id: 'child', parent_thread_id: 'root' } }, { type: 'response_usage', responseId: 'c1', usage: { input: 4, output: 2 } }]);
    await lines(path.join(dir, 'game.jsonl'), [{ type: 'session_meta', payload: { id: 'game' } }, { type: 'response_usage', responseId: 'g1', usage: { input: 3, output: 1 } }]);
    await lines(path.join(dir, 'other.jsonl'), [{ type: 'session_meta', payload: { id: 'other' } }, { type: 'response_usage', responseId: 'o1', usage: { input: 999, output: 999 } }]);
    const report = await reportUsage({ rolloutDirectory: dir, rootSessionId: 'root', mappings: [{ runId: 'run-1', sessionId: 'game' }] });
    expect(report.sessions.map(item => item.sessionId).sort()).toEqual(['child', 'game', 'root']);
    expect(report.usage).toEqual({ input: 17, cachedInput: 2, output: 8, reasoning: 3 }); expect(report.unrelatedSessionCount).toBe(1);
    expect(JSON.stringify(report)).not.toMatch(/secret|credential|private|999/);
  });

  it('deduplicates responses, includes compaction once and exposes disagreement/corruption/reset gaps', async () => {
    const dir = await temp('af-usage-');
    await lines(path.join(dir, 'root.jsonl'), [
      { type: 'session_meta', payload: { id: 'root' } },
      { type: 'response_usage', responseId: 'same', usage: { input: 10, cachedInput: 4, output: 6, reasoning: 2 } },
      { type: 'response_usage', responseId: 'same', usage: { input: 10, cachedInput: 4, output: 6, reasoning: 2 } },
      { type: 'compaction', compactionUsage: { input: 2, output: 1 } },
      { cumulativeUsage: { input: 20, output: 10 } }, { cumulativeUsage: { input: 5, output: 2 } },
    ], '{bad');
    const report = await reportUsage({ rolloutDirectory: dir, rootSessionId: 'root' });
    expect(report.usage).toEqual({ input: 12, cachedInput: 4, output: 7, reasoning: 2 });
    expect(report.coverage.gaps.map(item => item.code)).toEqual(expect.arrayContaining(['incomplete-tail', 'cumulative-counter-reset', 'representation-disagreement']));
  });

  it('reconciles cumulative-only intervals and reports missing baselines/mappings', async () => {
    const dir = await temp('af-usage-');
    await lines(path.join(dir, 'root.jsonl'), [
      { type: 'session_meta', payload: { id: 'root' } },
      { timestamp: '2026-09-17T09:00:00Z', cumulativeUsage: { input: 10, output: 4 } },
      { timestamp: '2026-09-17T11:00:00Z', cumulativeUsage: { input: 25, output: 9 } },
    ]);
    const report = await reportUsage({ rolloutDirectory: dir, rootSessionId: 'root', start: '2026-09-17T10:00:00Z', cutoff: '2026-09-17T12:00:00Z', mappings: [{ runId: 'x', sessionId: 'absent' }] });
    expect(report.sessions.find(item => item.sessionId === 'root').usage.input).toBe(15);
    expect(report.coverage.gaps.map(item => item.code)).toContain('missing-mapped-session');
  });

  it('does not attribute undated or unidentified responses to a bounded interval', async () => {
    const dir = await temp('af-usage-'); await lines(path.join(dir, 'root.jsonl'), [{ type: 'session_meta', payload: { id: 'root' } }, { type: 'response_usage', usage: { input: 8, output: 2 } }, { type: 'response_usage', timestamp: '2026-09-17T10:30:00Z', usage: { input: 8, output: 2 } }]);
    const report = await reportUsage({ rolloutDirectory: dir, rootSessionId: 'root', start: '2026-09-17T10:00:00Z', cutoff: '2026-09-17T11:00:00Z' });
    expect(report.usage.input).toBe(0); expect(report.coverage.complete).toBe(false); expect(report.coverage.gaps.map(item => item.code)).toEqual(expect.arrayContaining(['missing-response-timestamp', 'missing-response-identity']));
  });

  it('adds cumulative-only compaction only when metadata proves exclusion', async () => {
    for (const [included, expected] of [[true, 20], [false, 23]]) {
      const dir = await temp('af-usage-'); await lines(path.join(dir, 'root.jsonl'), [{ type: 'session_meta', payload: { id: 'root' } }, { type: 'compaction', compactionIncludedInCumulative: included, compactionUsage: { input: 3, output: 1 } }, { cumulativeUsage: { input: 20, output: 10 } }]);
      const report = await reportUsage({ rolloutDirectory: dir, rootSessionId: 'root' }); expect(report.usage.input).toBe(expected);
    }
    const dir = await temp('af-usage-'); await lines(path.join(dir, 'root.jsonl'), [{ type: 'session_meta', payload: { id: 'root' } }, { type: 'compaction', compactionUsage: { input: 3, output: 1 } }, { cumulativeUsage: { input: 20, output: 10 } }]);
    const unknown = await reportUsage({ rolloutDirectory: dir, rootSessionId: 'root' }); expect(unknown.usage.input).toBe(20); expect(unknown.coverage.gaps.map(item => item.code)).toContain('compaction-inclusion-unknown');
  });

  it('keeps unknown rates and stale/reset account state explicit', () => {
    const estimate = estimateCost([{ sessionId: 's', model: 'unknown', usage: { input: 1, cachedInput: 0, output: 1, reasoning: 0 } }], { version: 1, effectiveDate: '2026-09-17', source: 'https://example.test/rates', rates: [] });
    expect(estimate).toMatchObject({ complete: false, knownSubtotal: 0, exactSubscriptionSpend: false }); expect(estimate.components[0].estimate).toBeNull();
    const base = { usage: { input: 10, output: 5 }, coverage: { complete: true }, account: { ageMs: 9999, windowId: 'new', allowance: { used: 2 } } };
    const plan = { version: 1, objective: 'bounded', sessions: { author: 'a', workers: [], runs: [] }, startTime: new Date().toISOString(), checkpointCadenceMs: 10000, limits: [{ unit: 'allowance', value: 10, closeoutReserve: 1, freshnessMs: 100, windowId: 'old' }] };
    expect(evaluatePlan(plan, base).decision).toBe('unknown');
  });

  it('validates named limits and makes known exhaustion override unknown telemetry', () => {
    const plan = { version: 1, objective: 'bounded', sessions: { author: 'a', workers: ['w'], runs: ['r'] }, startTime: new Date().toISOString(), checkpointCadenceMs: 10000, limits: [{ unit: 'tokens', value: 100, closeoutReserve: 10 }, { unit: 'estimatedCost', value: 2, closeoutReserve: 0.2 }] };
    const result = evaluatePlan(plan, { usage: { input: 95, output: 0 }, coverage: { complete: true } });
    expect(result.decision).toBe('stop'); expect(result.advisory).toBe(true); expect(result.authorizesInference).toBe(false);
    const missing = evaluatePlan({ ...plan, limits: [{ unit: 'tokens', value: 1000, closeoutReserve: 10 }] }, { sessions: [{ sessionId: 'a' }], usage: { input: 1, output: 1 }, coverage: { complete: true } }); expect(missing.decision).toBe('unknown'); expect(missing.reasons.some(item => item.reason === 'planned-session-missing')).toBe(true);
    expect(() => validatePlan({ ...plan, limits: [{ unit: 'tokens', value: 1, closeoutReserve: 1 }] })).toThrow('invalid limit');
  });
});

describe('bounded read-only watcher', () => {
  it('caps projections and suppresses unchanged detail with heartbeats', async () => {
    const projected = project({ status: 'running', results: Array.from({ length: 30 }, (_, i) => ({ check: `check-${i}`, secret: 'no' })), credential: 'never' }, { maxItems: 2, maxString: 5 });
    expect(projected.results).toMatchObject({ total: 30, truncated: true }); expect(JSON.stringify(projected)).not.toContain('credential');
    const dir = await temp('af-watch-'); await writeFile(path.join(dir, 'results.json'), JSON.stringify({ status: 'running', results: [] }));
    const report = await watch({ kind: 'verification', directory: dir, pollMs: 2, heartbeatMs: 1, requestTimeoutMs: 10, durationMs: 100, maxOutputBytes: 5000 });
    expect(report.events.filter(item => item.type === 'change')).toHaveLength(1); expect(report.events.some(item => item.type === 'heartbeat')).toBe(true);
  });

  it('rejects non-loopback, redirects and never forwards a capability', async () => {
    await expect(dashboardSnapshot({ url: 'https://example.com/state', capability: 'secret' }, 10)).rejects.toThrow('loopback');
    let received = null; const sink = createServer((request, response) => { received = request.headers.authorization; response.end('{}'); });
    await new Promise(resolve => sink.listen(0, '127.0.0.1', resolve));
    const redirect = createServer((_request, response) => { response.writeHead(302, { Location: `http://127.0.0.1:${sink.address().port}/stolen` }); response.end(); });
    await new Promise(resolve => redirect.listen(0, '127.0.0.1', resolve));
    await expect(dashboardSnapshot({ url: `http://127.0.0.1:${redirect.address().port}/state`, capability: 'secret' }, 1000)).rejects.toThrow('redirects');
    expect(received).toBeNull(); await Promise.all([new Promise(resolve => sink.close(resolve)), new Promise(resolve => redirect.close(resolve))]);
  });

  it('reports timeouts/disconnects without control operations', async () => {
    const server = createServer(() => {}); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const report = await watch({ kind: 'dashboard', descriptor: { url: `http://127.0.0.1:${server.address().port}/snapshot`, capability: 'x' }, pollMs: 1, heartbeatMs: 10, requestTimeoutMs: 10, durationMs: 50, maxOutputBytes: 1000 });
    expect(report.outcome).toBe('timeout'); await new Promise(resolve => server.close(resolve));
  });
});

describe('contract preparation and summaries', () => {
  const inputFor = () => ({ role: 'verification', objective: 'Verify bounded helper', criteria: [{ id: 'C1', description: 'Check fixture' }], revision: 'worktree-test', sourcePaths: ['source.txt', 'absent.txt'], scope: [{ path: 'source.txt', boundary: 'whole file' }], checks: [{ id: 'T1', command: 'node fixture.mjs', expected: 'exit 0' }], allowedActions: ['Run prescribed fixture'], additionalChecks: 'within-scope', resources: [], budget: { timeSeconds: 60, providerCalls: 0 }, stopConditions: ['Stop on source change'], returnConditions: ['Return all criteria'], outputRoot: '.runtime/contracts' });
  it('creates a fresh source-checked v1 assignment including intentional absence', async () => {
    const root = await temp('af-contract-'); await mkdir(path.join(root, '.runtime')); await writeFile(path.join(root, 'source.txt'), 'source');
    const first = await prepareContract(inputFor(root), root); const second = await prepareContract(inputFor(root), root);
    expect(first.assignment.version).toBe(1); expect(first.assignment.assignmentId).not.toBe(second.assignment.assignmentId);
    expect(first.assignment.source.files.find(item => item.path === 'absent.txt').sha256).toBeNull(); expect(await readFile(first.output, 'utf8')).toContain(first.assignment.assignmentId);
  });

  it('preserves findings and refuses stale/finding-bearing readiness', async () => {
    const root = await temp('af-contract-'); await mkdir(path.join(root, '.runtime')); await writeFile(path.join(root, 'source.txt'), 'source');
    const { assignment } = await prepareContract(inputFor(root), root); await writeFile(path.join(root, 'source.txt'), 'changed');
    const result = { version: 1, assignmentId: assignment.assignmentId, role: 'verification', summary: 'failed', disposition: 'returned', source: { ...assignment.source, stable: true }, limits: [{ description: 'gap', affectsCoverage: true }], model: { requested: 'gpt-5.6-luna / medium', observed: null, usage: null }, cleanup: [], criteria: [{ id: 'C1', status: 'unverified', observation: 'gap', evidence: [], checks: [] }], checks: [{ id: 'T1', command: 'node fixture.mjs', authorization: null, status: 'skipped', exit: null, outcome: 'unverified', observation: 'not run', evidence: [] }] };
    const summary = await summarizeContract(assignment, result, root); expect(summary.ready).toBe(false); expect(summary.readinessGaps.join(' ')).toMatch(/stale|coverage|mismatch/);
  });
});

describe('no-inference preflight', () => {
  it('stops after failure and never dispatches later game/provider steps', async () => {
    const root = await temp('af-preflight-'); await mkdir(path.join(root, '.runtime')); const marker = path.join(root, 'forbidden');
    const input = { version: 1, criteria: [{ id: 'C1', description: 'software', kind: 'software', checks: ['fail'], coverage: 'fixture' }] };
    const { report } = await runPreflight(input, { root, steps: [{ name: 'fail', command: process.execPath, args: ['-e', 'process.exit(4)'] }, { name: 'game-provider', command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`] }] });
    expect(report.ready).toBe(false); expect(report.software.skipped).toEqual(['game-provider']); await expect(readFile(marker)).rejects.toThrow();
  });

  it('accepts source-matched retained evidence only within declared scope', async () => {
    const root = await temp('af-preflight-'); await mkdir(path.join(root, '.runtime/evidence'), { recursive: true }); await writeFile(path.join(root, 'source.txt'), 'x'); await writeFile(path.join(root, '.runtime/evidence/result.json'), JSON.stringify({ passed: true, complete: true, criteria: [{ id: 'R1', status: 'pass' }], dependencies: [{ path: 'source.txt', sha256: sha256('x') }] }));
    const input = { version: 1, criteria: [{ id: 'R1', description: 'recovery', kind: 'retained', coverage: 'ledger/recovery only', evidence: { path: '.runtime/evidence/result.json', complete: true, dependencies: [{ path: 'source.txt', sha256: sha256('x') }] } }] };
    const pass = await runPreflight(input, { root, steps: [{ name: 'software', command: process.execPath, args: ['-e', 'process.exit(0)'] }] });
    expect(pass.report.ready).toBe(true); expect(pass.report.establishesLiveTrialAcceptance).toBe(false);
    input.criteria[0].evidence.dependencies[0].sha256 = sha256('old'); const stale = await runPreflight(input, { root, steps: [{ name: 'software', command: process.execPath, args: ['-e', 'process.exit(0)'] }] }); expect(stale.report.ready).toBe(false); expect(stale.report.gaps.map(item => item.gap).join(' ')).toContain('stale');
  });

  it('rejects criteria not bound to exact checks or retained artifact coverage', async () => {
    const root = await temp('af-preflight-'); await mkdir(path.join(root, '.runtime/evidence'), { recursive: true }); await writeFile(path.join(root, 'source.txt'), 'x'); await writeFile(path.join(root, '.runtime/evidence/result.json'), JSON.stringify({ passed: true, complete: true, criteria: [{ id: 'different', status: 'pass' }], dependencies: [{ path: 'source.txt', sha256: sha256('x') }] }));
    await expect(runPreflight({ version: 1, criteria: [{ id: 'S1', description: 'software', kind: 'software', coverage: 'x' }] }, { root, steps: [] })).rejects.toThrow('needs checks');
    const retained = await runPreflight({ version: 1, criteria: [{ id: 'R1', description: 'retained', kind: 'retained', coverage: 'x', evidence: { path: '.runtime/evidence/result.json', dependencies: [{ path: 'source.txt', sha256: sha256('x') }] } }] }, { root, steps: [{ name: 'ok', command: process.execPath, args: ['-e', 'process.exit(0)'] }] }); expect(retained.report.ready).toBe(false); expect(retained.report.gaps[0].gap).toContain('does not cover');
  });
});

describe('task routing and preview-first launch', () => {
  const markdown = done => `- [${done ? 'x' : ' '}] 1.1 Implement safely\n- [ ] 5.1 Verify safely\n\n## Model routing\n\n| Task | Role | Model | Effort | Rationale | Escalate when |\n| --- | --- | --- | --- | --- | --- |\n| 1.1 | author | gpt-5.6-terra | medium | Bounded | Invariant conflicts |\n| 5.1 | verification | gpt-5.6-luna | medium | Routine | Unknown failure |\n`;
  it('requires exact complete metadata and rejects duplicate/unknown/completed tasks', async () => {
    expect(parseRouting(markdown(false)).get('1.1')).toMatchObject({ role: 'author', model: 'gpt-5.6-terra' });
    expect(() => parseRouting(markdown(false).replace('| 5.1 | verification', '| 9.9 | verification'))).toThrow('unknown');
    const root = await temp('af-task-'); await mkdir(path.join(root, '.runtime')); const file = path.join(root, 'tasks.md'); await writeFile(file, markdown(true));
    await expect(selectTask({ tasksFile: file, taskId: '1.1', root })).rejects.toThrow('completed');
  });

  it('previews without discovery and routes verification to its dedicated workflow', async () => {
    const root = await temp('af-task-'); await mkdir(path.join(root, '.runtime')); const file = path.join(root, 'tasks.md'); await writeFile(file, markdown(false));
    const preview = await selectTask({ tasksFile: file, taskId: '1.1', root }, { discover: () => { throw new Error('must not run'); } }); expect(preview.started).toBe(false);
    const dedicated = await selectTask({ tasksFile: file, taskId: '5.1', root, start: true }); expect(dedicated).toMatchObject({ started: false, dedicatedWorkflow: 'verification' });
    await expect(selectTask({ tasksFile: file, taskId: '1.1', root, model: 'gpt-5.6-sol' })).rejects.toThrow('reason');
  });

  it('launches once with safe argv after discovery and records uncertain outcomes', async () => {
    const root = await temp('af-task-'); await mkdir(path.join(root, '.runtime')); const file = path.join(root, 'tasks.md'); await writeFile(file, markdown(false)); const calls = [];
    const result = await selectTask({ tasksFile: file, taskId: '1.1', root, start: true, model: 'gpt-5.6-sol', reason: 'broader ownership' }, { discover: async () => ({ authentication: 'chatgpt', model: 'gpt-5.6-sol', effort: 'medium' }), launch: (script, args) => { calls.push({ script, args }); return { pid: null, unref() {} }; } });
    expect(calls).toHaveLength(1); expect(calls[0].args).toEqual(expect.arrayContaining(['-Model', 'gpt-5.6-sol', '-Effort', 'medium'])); expect(result.launchOutcome).toBe('unknown');
  });

  it('refuses a task source change between discovery and launch', async () => {
    const root = await temp('af-task-'); await mkdir(path.join(root, '.runtime')); const file = path.join(root, 'tasks.md'); await writeFile(file, markdown(false)); let launched = false;
    await expect(selectTask({ tasksFile: file, taskId: '1.1', root, start: true }, { discover: async () => { await writeFile(file, `${markdown(false)}\nchanged`); return { authentication: 'chatgpt' }; }, launch: () => { launched = true; return { pid: 1 }; } })).rejects.toThrow('source changed');
    expect(launched).toBe(false);
  });

  it('refuses non-ChatGPT authentication and unavailable models without launching a thread', async () => {
    const fakeSpawn = replies => () => {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.stdin.setEncoding('utf8'); child.kill = () => { child.emit('exit', 0); };
      let buffer = ''; child.stdin.on('data', chunk => { buffer += chunk; let index; while ((index = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); if (!line) continue; const request = JSON.parse(line); if (!request.id) continue; const result = replies[request.method]; queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`)); } }); return child;
    };
    const common = { initialize: {}, 'getAuthStatus': { authMethod: 'chatgpt' }, 'model/list': { data: [], nextCursor: null }, 'account/rateLimits/read': { ordinaryUsageAllowed: true } };
    await expect(discoverCodex('fake', 'gpt-5.6-sol', 'medium', { spawnProcess: fakeSpawn({ ...common, 'account/read': { account: { type: 'api' } } }) })).rejects.toThrow('ChatGPT');
    await expect(discoverCodex('fake', 'gpt-5.6-sol', 'medium', { spawnProcess: fakeSpawn({ ...common, 'account/read': { account: { type: 'chatgpt' } } }) })).rejects.toThrow('unavailable');
  });
});

describe('routing pilot template', () => {
  it('preserves unknowns and starts neither comparison nor future work', async () => {
    const template = JSON.parse(await readFile(path.resolve('docs/examples/routing-outcome.template.json'), 'utf8'));
    expect(template.actual.observedModel).toBeNull(); expect(template.usage.coverage).toBe('unknown'); expect(template).toMatchObject({ measuredSavingsClaimed: false, comparativeRunStarted: false, futureTaskStarted: false });
  });
});

describe('CLI artifact safety', () => {
  it('writes bounded output only beneath the selected runtime and never overwrites evidence', async () => {
    const root = await temp('af-cli-'); await mkdir(path.join(root, '.runtime')); const rollouts = path.join(root, 'rollouts'); await mkdir(rollouts);
    await lines(path.join(rollouts, 'root.jsonl'), [{ type: 'session_meta', payload: { id: 'root' } }, { type: 'response_usage', responseId: 'r', usage: { input: 1, output: 1 } }]);
    const script = path.resolve('scripts/dev/usage.mjs'); const args = [script, '--rollouts', rollouts, '--root', 'root', '--output', '.runtime/report.json'];
    const first = await execute(process.execPath, args, { cwd: root }); expect(Buffer.byteLength(first.stdout)).toBeLessThan(4096); expect(JSON.parse(await readFile(path.join(root, '.runtime/report.json'), 'utf8')).usage.input).toBe(1);
    await expect(execute(process.execPath, args, { cwd: root })).rejects.toMatchObject({ code: 1 });
    await expect(execute(process.execPath, [script, '--rollouts', rollouts, '--root', 'root', '--output', '../escape.json'], { cwd: root })).rejects.toMatchObject({ code: 1 });
  });

  it('rejects an existing junction that redirects a runtime output elsewhere in the workspace', async () => {
    const root = await temp('af-runtime-'); const runtime = path.join(root, '.runtime'); const outside = path.join(root, 'outside'); await Promise.all([mkdir(runtime), mkdir(outside)]); await symlink(outside, path.join(runtime, 'link'), 'junction');
    await expect(safeRuntimePath(root, '.runtime/link/report.json')).rejects.toThrow('escapes .runtime');
  });
});
