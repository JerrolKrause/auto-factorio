import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquireResource, releaseResource } from './resources.mjs';
import { createEvidenceDirectory, safeRuntimePath, sha256, writeNewJson } from './safe-artifacts.mjs';

export function classifyMutation(run, diagnostic) {
  if (run.timedOut) return 'timeout';
  if (run.error) return 'harness-error';
  const report = run.report;
  const assertions = report?.testResults?.flatMap(row => row.assertionResults ?? []) ?? [];
  const executed = assertions.filter(row => ['passed', 'failed'].includes(row.status));
  if (!report || run.runtimeErrors > 0 || report.numRuntimeErrorTestSuites > 0 || report.testResults?.some(row => row.message)) return 'harness-error';
  if (!executed.length) return 'zero-selection';
  const failed = executed.filter(row => row.status === 'failed');
  if (run.exit === 0 && failed.length === 0 && report.success === true) return 'pass';
  if (run.exit !== 1 || !failed.length) return 'harness-error';
  // Match the actual failed assertion, never incidental stdout or an import error.
  return failed.some(row => row.failureMessages?.some(message => new RegExp(diagnostic, 'u').test(message))) ? 'expected-regression' : 'wrong-failure';
}

async function executeVitest({ root, args, timeoutMs, directory, phase }) {
  const reportFile = path.join(directory, `${phase}.json`);
  const runtimeFile = path.join(directory, `${phase}-runtime.json`);
  const child = spawn(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...args,
    '--reporter=json', `--reporter=${fileURLToPath(new URL('./mutation-reporter.mjs', import.meta.url))}`,
    `--outputFile.json=${reportFile}`], { cwd: root, windowsHide: true, env: { ...process.env, AF_MUTATION_RUNTIME_REPORT: runtimeFile }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', timedOut = false, error = null;
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
  const timer = setTimeout(() => {
    timedOut = true;
    // This PID belongs to this invocation. Do not enumerate or kill unrelated tools.
    if (process.platform === 'win32' && child.pid) {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => child.kill());
    } else child.kill('SIGKILL');
  }, timeoutMs);
  const exit = await new Promise(resolve => {
    child.once('error', value => { error = value.message; resolve(null); }); child.once('close', resolve);
  });
  clearTimeout(timer);
  await writeFile(path.join(directory, `${phase}.log`), stdout + stderr, 'utf8');
  let report = null;
  try { report = JSON.parse(await readFile(reportFile, 'utf8')); } catch { error ??= 'Missing or malformed Vitest JSON report'; }
  let runtimeErrors;
  try {
    const runtime = JSON.parse(await readFile(runtimeFile, 'utf8'));
    if (!Number.isSafeInteger(runtime.runtimeErrors) || runtime.runtimeErrors < 0 || !['passed', 'failed'].includes(runtime.reason)) throw new Error('Invalid runtime reporter observation');
    runtimeErrors = runtime.runtimeErrors;
  } catch { error ??= 'Missing or malformed runtime reporter observation'; }
  return { exit, timedOut, error, report, runtimeErrors };
}

export async function mutationProof(input, { root = process.cwd(), run = executeVitest, lock = acquireResource, unlock = releaseResource } = {}) {
  if (input.exclusiveSourceAccess !== true) throw new Error('Stop source reviewers/verifiers and declare exclusiveSourceAccess before mutation');
  if (!Array.isArray(input.tests) || !input.tests.length || input.tests.some(file => typeof file !== 'string' || !/^tests\/[\w./-]+\.test\.(?:ts|mjs)$/.test(file) || file.includes('..'))) throw new Error('Explicit repository test files required');
  if (typeof input.testName !== 'string' || !input.testName || typeof input.diagnostic !== 'string' || !input.diagnostic) throw new Error('Exact test-name pattern and expected assertion diagnostic required');
  new RegExp(input.diagnostic, 'u'); new RegExp(input.testName, 'u');
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 300000) throw new Error('timeoutMs must be 1..300000');
  if (typeof input.source !== 'string' || !/^(?:scripts|packages|apps|mods)\/[\w./-]+$/.test(input.source) || input.source.includes('..')) throw new Error('Invalid mutation source');
  // safeRuntimePath checks real ancestors; use its confinement check for the mutation payload.
  const mutationFile = await safeRuntimePath(root, input.mutationFile, { mustExist: true });
  const source = path.resolve(root, input.source);
  const { realpath } = await import('node:fs/promises');
  const actual = await realpath(source), base = await realpath(root), relative = path.relative(base, actual);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Mutation source escapes workspace');
  const lease = await lock({ id: 'source-access' }, 'mutation-proof', { root });
  let original, mutated, changed = false, directory, result;
  try {
    original = await readFile(source);
    if (sha256(original) !== input.sha256) throw new Error('Source drift before mutation');
    mutated = await readFile(mutationFile);
    if (sha256(mutated) === input.sha256) throw new Error('Mutation must change source bytes');
    directory = await createEvidenceDirectory(root, input.outputRoot ?? '.runtime/mutations', 'proof');
    await writeFile(path.join(directory, 'original.bin'), original, { flag: 'wx' });
    if (sha256(await readFile(source)) !== input.sha256) throw new Error('Concurrent source drift before mutation');
    await writeFile(source, mutated); changed = true;
    const args = [...input.tests, '-t', input.testName];
    const mutant = await run({ root, args, timeoutMs: input.timeoutMs, directory, phase: 'mutant' });
    result = { version: 1, source: input.source, originalSha256: input.sha256, mutatedSha256: sha256(mutated),
      mutation: classifyMutation(mutant, input.diagnostic), restored: false, focused: 'unverified', passed: false, directory };
  } finally {
    try {
      if (changed) {
        if (sha256(await readFile(source)) !== sha256(mutated)) throw new Error(`Concurrent source drift: restoration refused; original retained at ${directory}/original.bin`);
        await writeFile(source, original);
        if (sha256(await readFile(source)) !== input.sha256) throw new Error('Restoration hash mismatch');
        if (result) result.restored = true;
      }
      if (result) {
        const focused = await run({ root, args: [...input.tests, '-t', input.testName], timeoutMs: input.timeoutMs, directory, phase: 'restored' });
        result.focused = classifyMutation(focused, input.diagnostic);
        result.finalSha256 = sha256(await readFile(source));
        result.restored = result.finalSha256 === input.sha256;
        if (!result.restored) result.focused = 'source-drift';
        result.passed = result.restored && result.mutation === 'expected-regression' && result.focused === 'pass';
        await writeNewJson(path.join(directory, 'result.json'), result);
      }
    } finally { await unlock(lease); }
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const filename = process.argv[2];
  Promise.resolve().then(async () => {
    if (!filename) throw new Error('Usage: node scripts/dev/mutation.mjs <task-input.json>');
    const result = await mutationProof(JSON.parse(await readFile(filename, 'utf8')));
    console.log(JSON.stringify(result)); if (!result.passed) process.exitCode = 1;
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
