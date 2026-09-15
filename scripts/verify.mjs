import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChecks } from './dev/checks.mjs';
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(cwd, '.runtime/verification'); await mkdir(base, { recursive: true });
const evidence = await mkdtemp(path.join(base, 'check-'));
const node = (name, ...args) => ({ name, command: process.execPath, args });
const steps = [node('build', 'node_modules/typescript/bin/tsc', '-b', '--stopBuildOnErrors'), node('lint', 'node_modules/eslint/bin/eslint.js', 'scripts', 'packages', 'tests'), node('test', 'node_modules/vitest/vitest.mjs', 'run'), node('docs', 'scripts/check-docs.mjs')];
const game = process.argv.includes('--game') || process.argv.includes('--pause');
const profileFile = path.join(evidence, 'headless-profile.json');
if (game) steps.push(node('headless-launch', 'dist/scripts/game-launch.js', '--headless', '--result-file', profileFile), node('headless-smoke', 'dist/scripts/game-smoke.js', '--profile-file', profileFile));
let result = await runChecks(steps, { cwd, evidence });
const summary = { softwareAndSmoke: result, cleanup: null, visible: null, passed: result.passed };
if (game) {
  try {
    await readFile(profileFile);
    const cleanup = await runChecks([node('headless-cleanup', 'dist/scripts/game-processes.js', '--stop-profile-file', profileFile)], { cwd, evidence: path.join(evidence, 'cleanup') });
    summary.cleanup = cleanup;
    if (!cleanup.passed) result = { ...result, passed: false };
  } catch (error) { if (error.code !== 'ENOENT') { summary.cleanup = { passed: false, error: 'cleanup unconfirmed' }; console.error('Smoke cleanup unconfirmed'); result = { ...result, passed: false }; } }
}
if (result.passed && process.argv.includes('--pause')) {
  const profile = path.join(evidence, 'visible-profile.json');
  result = await runChecks([node('visible-launch', 'dist/scripts/game-launch.js', '--phase04', '--result-file', profile), node('pause-probe', 'dist/scripts/game-pause-probe.js', '--profile-file', profile)], { cwd, evidence: path.join(evidence, 'visible') });
  summary.visible = result;
}
summary.passed = result.passed;
await writeFile(path.join(evidence, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ passed: result.passed, evidence })); if (!result.passed) process.exitCode = 1;
