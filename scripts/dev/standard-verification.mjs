import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { prepareContract } from './contract.mjs';
import { fingerprintInputs } from './receipts.mjs';
import { executeManifest, commandIdentity } from './verification.mjs';
import { createEvidenceDirectory, sha256, writeNewJson } from './safe-artifacts.mjs';

const exec = promisify(execFile);
const software = [
  ['build', 'node_modules/typescript/bin/tsc', '-b', '--stopBuildOnErrors', '--force'],
  ['dashboard-build', 'node_modules/vite/bin/vite.js', 'build', 'apps/dashboard'],
  ['lint', 'node_modules/eslint/bin/eslint.js', 'scripts', 'packages', 'apps', 'tests'],
  ['test', 'node_modules/vitest/vitest.mjs', 'run'],
  ['docs', 'scripts/check-docs.mjs'],
];

/** Ordinary verify flags authorize this fixed composition, never arbitrary shell text. */
export async function standardVerification(args = [], { root = process.cwd(), status = console.log } = {}) {
  const planIndex = args.indexOf('--plan');
  const planArgument = planIndex >= 0 ? args[planIndex + 1] : null;
  if (planIndex >= 0 && !planArgument) throw new Error('--plan requires a shared session plan');
  const flags = planIndex >= 0 ? args.filter((_, index) => index !== planIndex && index !== planIndex + 1) : args;
  if (flags.some(arg => !['--game', '--pause', '--workshop-measure'].includes(arg))) throw new Error('verify supports --game, --pause, --workshop-measure and --plan <shared.json>');
  if (args.includes('--workshop-measure') && args.some(arg => ['--game', '--pause'].includes(arg))) throw new Error('choose one live composition');
  const { stdout } = await exec('git', ['ls-files', '-c', '-o', '--exclude-standard'], { cwd: root });
  const sourcePaths = [...new Set(stdout.trim().split(/\r?\n/).filter(Boolean))].sort();
  const inputs = sourcePaths.map(file => ({ path: file, kind: 'source' }));
  const dependencies = await fingerprintInputs(root, inputs);
  const packages = {};
  for (const tool of ['typescript', 'eslint', 'vitest', 'vite']) packages[tool] = sha256(await readFile(path.join(root, `node_modules/${tool}/package.json`)));
  const tools = { node: process.version, assertion: 'standard-verification-v2', packages };
  const candidate = sha256(JSON.stringify([dependencies, tools]));
  const base = path.join(root, '.runtime/development/standard', candidate); await mkdir(base, { recursive: true });
  // Candidate changes do not replenish the session. A new task/session is an explicit
  // --plan selection; ordinary retries and game extensions retain the same allowance.
  const planFile = planArgument ? path.resolve(root, planArgument) : path.join(root, '.runtime/development/standard/session-plan.json'); let plan;
  try { plan = JSON.parse(await readFile(planFile, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT' || planArgument) throw error;
    plan = { version: 1, objective: 'Standard verification work session', startTime: new Date().toISOString(), sessions: { author: 'standard-owner', workers: [], runs: [] }, checkpointCadenceMs: 300000, limits: [{ unit: 'wallMs', value: 14400000, closeoutReserve: 120000 }] };
    await writeNewJson(planFile, plan);
  }
  const prepared = await createEvidenceDirectory(root, '.runtime/development/standard', 'composition');
  const relative = file => path.relative(root, file).split(path.sep).join('/');
  const artifact = name => relative(path.join(prepared, name));
  const checks = software.map(([id, ...argv], index) => ({ id, assignmentCheckId: id, command: process.execPath, args: argv, dependsOn: index ? [software[index - 1][0]] : [], criteria: [id], inputs, effects: 'none', resources: [], timeoutMs: 300000, freshRequired: false, observation: 'exit', observationVersion: 'software-exit-v1', configIdentity: candidate }));
  checks[0].outputRoots = ['dist', 'packages/contracts/dist'];
  checks[0].producesOutputs = true;
  checks[1].outputRoots = ['apps/dashboard/dist'];
  checks[1].producesOutputs = true;
  for (const check of checks.slice(2)) check.outputRoots = ['dist', 'packages/contracts/dist', 'apps/dashboard/dist'];
  const resources = [];
  const gameInputs = inputs.filter(row => row.path.startsWith('mods/') || /\.(ts|tsx)$/.test(row.path) || /(^|\/)(package\.json|pnpm-lock\.yaml|tsconfig[^/]*\.json)$/.test(row.path));
  let gameTools;
  if (flags.length) {
    const installation = process.env.AUTOFACTORIO_FACTORIO_DIR ?? 'C:/Program Files (x86)/Steam/steamapps/common/Factorio';
    const executable = path.resolve(installation, 'bin/x64/factorio.exe');
    const { stdout: version } = await exec(executable, ['--version'], { cwd: root, windowsHide: true, timeout: 15000 });
    if (!/^Version: 2\.0\./m.test(version)) throw new Error('Installed Factorio 2.0 with Space Age required');
    const files = [];
    for (const filename of [executable, ...['base', 'space-age', 'quality', 'elevated-rails'].map(mod => path.resolve(installation, `data/${mod}/info.json`))]) files.push({ path: filename, sha256: sha256(await readFile(filename)) });
    gameTools = { ...tools, gameVersion: version.split(/\r?\n/)[0], files };
  }
  const addGame = (id, argv, ports, observation, predecessors, profileFile) => {
    const resourceId = ports[0].number === 27024 ? 'factorio-visible' : 'factorio-headless';
    if (!resources.some(row => row.id === resourceId)) resources.push({ id: resourceId, cleanup: [{ command: process.execPath, args: ['dist/scripts/game-processes.js', '--stop-owned-root', artifact('profiles')] }] });
    checks.push({ id, assignmentCheckId: id, command: process.execPath, args: argv, env: { AF_GAME_PROFILE_ROOT: artifact('profiles'), ...(process.env.AUTOFACTORIO_FACTORIO_DIR ? { AUTOFACTORIO_FACTORIO_DIR: process.env.AUTOFACTORIO_FACTORIO_DIR } : {}) }, dependsOn: predecessors, criteria: [id], inputs: gameInputs, outputRoots: ['dist', 'packages/contracts/dist'], effects: 'game', resources: [resourceId], timeoutMs: 900000, freshRequired: true, observation, observationVersion: 'game-observation-v1', configIdentity: 'standard-owned-game-v1', preflight: { fakeCheckId: 'test', timeoutMs: 900000, intervalMs: 200, paths: [artifact('profiles'), profileFile], ports, gui: resourceId === 'factorio-visible' } });
    checks.at(-1).tools = gameTools;
  };
  const headlessPorts = [{ number: 27019, protocol: 'tcp' }, { number: 34199, protocol: 'udp' }];
  if (args.includes('--workshop-measure')) {
    const profile = artifact('measure-profile.json'); const observed = artifact('measure-result.json');
    addGame('workshop-measure', ['dist/scripts/game-workshop-measure-probe.js', '--profile-result-file', profile, '--result-file', observed], headlessPorts, { path: observed, truthyFields: ['passed', 'cleanup', 'assertionsComplete'] }, ['docs', 'test'], profile);
  } else if (args.includes('--game') || args.includes('--pause')) {
    const profile = artifact('headless-profile.json');
    addGame('headless-launch', ['dist/scripts/game-launch.js', '--headless', '--result-file', profile], headlessPorts, { path: profile, truthyFields: ['ready'] }, ['docs', 'test'], profile);
    // An observation of the already-owned server must not require its live ports to
    // be unoccupied. Freshness and resource ownership still apply to the smoke.
    checks.push({ ...checks.at(-1), id: 'headless-smoke', assignmentCheckId: 'headless-smoke', args: ['dist/scripts/game-smoke.js', '--profile-file', profile, '--result-file', artifact('smoke-result.json')], dependsOn: ['headless-launch', 'test'], criteria: ['headless-smoke'], preflight: { fakeCheckId: 'test', mode: 'owned-observation', timeoutMs: 900000, intervalMs: 200, paths: [profile], ports: [] }, observation: { path: artifact('smoke-result.json'), truthyFields: ['passed'] } });
    if (args.includes('--pause')) {
      checks.push({ ...checks.at(-1), id: 'headless-cleanup', assignmentCheckId: 'headless-cleanup', args: ['dist/scripts/game-processes.js', '--stop-profile-file', profile, '--result-file', artifact('headless-cleanup.json')], dependsOn: ['headless-smoke', 'test'], criteria: ['headless-cleanup'], observation: { path: artifact('headless-cleanup.json'), truthyFields: ['completed'] } });
      const visible = artifact('visible-profile.json'); const observed = artifact('pause-result.json');
      addGame('visible-launch', ['dist/scripts/game-launch.js', '--phase04', '--result-file', visible], [{ number: 27024, protocol: 'tcp' }, { number: 34204, protocol: 'udp' }], { path: visible, truthyFields: ['ready'] }, ['headless-cleanup', 'test'], visible);
      checks.push({ ...checks.at(-1), id: 'pause-probe', assignmentCheckId: 'pause-probe', args: ['dist/scripts/game-pause-probe.js', '--profile-file', visible, '--result-file', observed, '--cleanup'], dependsOn: ['visible-launch', 'test'], criteria: ['pause-probe'], preflight: { fakeCheckId: 'test', mode: 'owned-observation', timeoutMs: 900000, intervalMs: 200, paths: [visible], ports: [] }, observation: { path: observed, truthyFields: ['passed', 'cleanup'] } });
    }
  }
  // Indexes are hints. Original receipt integrity and dependencies are revalidated.
  for (const file of (await readdir(base)).filter(file => file.startsWith('receipts-')).sort().reverse()) {
    const retained = JSON.parse(await readFile(path.join(base, file), 'utf8'));
    for (const check of checks) if (!check.freshRequired && !check.retainedReceipt && retained[check.id]) check.retainedReceipt = retained[check.id];
  }
  const manifest = { version: 1, change: 'standard-verification', slice: 'standard', candidate, owner: 'standard-owner', criteria: checks.map(check => check.id), checks, resources, tools, plan, sharedAdmission: true, usageReport: { sessions: [], usage: { input: 0, output: 0 }, coverage: { complete: false, aggregate: false } }, unknownAlternative: { reason: 'No provider inference: finite deterministic checks under the persistent shared session wall limit and sixty admissions, with separate cleanup reserve', maxAdmissions: 60, deadlineMs: Date.parse(plan.startTime) + 14280000 }, cleanupReserveMs: 120000 };
  const { stdout: revision } = await exec('git', ['rev-parse', 'HEAD'], { cwd: root });
  await writeNewJson(path.join(prepared, 'manifest.json'), manifest);
  const { assignment } = await prepareContract({ version: 2, execution: { manifestSha256: sha256(JSON.stringify(manifest)), reusePolicy: 'matching-receipt-only' }, role: 'verification', objective: 'Execute fixed standard verification composition', criteria: manifest.criteria.map(id => ({ id, description: id })), revision: revision.trim(), sourcePaths: [...sourcePaths, artifact('manifest.json')], scope: sourcePaths.map(file => ({ path: file, boundary: 'whole input' })), checks: [...checks.map(check => ({ id: check.id, command: commandIdentity(check), expected: 'Passing exit and declared observation' })), ...resources.flatMap(resource => resource.cleanup.map((command, index) => ({ id: `${resource.id}-cleanup-${index}`, command: commandIdentity(command), expected: 'Exact owned profile cleanup' })))], allowedActions: ['Execute this manifest within declared effects and resources'], additionalChecks: 'forbidden', resources: resources.map(row => ({ id: row.id, owner: manifest.owner, cleanup: 'Identity-matched owned profile cleanup' })), budget: { timeSeconds: 3600, providerCalls: 0 }, stopConditions: ['Stop new checks on failure, changed inputs, interrupted outcome or exhausted admission'], returnConditions: ['Return criterion outcomes and cleanup observations'], outputRoot: relative(prepared) }, root);
  const controller = new AbortController(); const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  let report;
  try { report = await executeManifest(manifest, assignment, { root, status, signal: controller.signal }); }
  finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
  const retained = Object.fromEntries(report.results.filter(row => row.receipt).map(row => [row.id, row.receipt]));
  await writeNewJson(path.join(base, `receipts-${Date.now()}.json`), retained);
  return report;
}
