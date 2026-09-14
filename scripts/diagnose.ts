import { mkdtemp, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { CompatibilityCheck, CompatibilityReport } from '@autofactorio/contracts';
import { canonical, contains, prepareDataDirectory } from './data-directory.js';
import { commandCheck, modCheck, pendingLiveChecks } from './compatibility.js';
import { probeSqlite } from './sqlite-probe.js';

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    'data-dir': { type: 'string' }, 'factorio-dir': { type: 'string' },
    'sqlite-driver': { type: 'string', default: 'better-sqlite3' },
  } });
  const dataArgument = values['data-dir'];
  const factorioArgument = values['factorio-dir'];
  if (!dataArgument || !factorioArgument || !path.isAbsolute(factorioArgument)) {
    throw new Error('Usage: corepack pnpm diagnose --data-dir <absolute empty/dedicated directory> --factorio-dir <absolute installation directory> [--sqlite-driver better-sqlite3]');
  }
  const project = await canonical(fileURLToPath(new URL('../../', import.meta.url)));
  const factorio = await canonical(factorioArgument);
  const dataCandidate = await canonical(path.resolve(dataArgument));
  if (contains(dataCandidate, project)) throw new Error('Data path conflict: project root or its ancestor.');
  if (contains(project, dataCandidate)) {
    const ignore = commandCheck('data-ignore', ['git', 'check-ignore', '--', path.join(dataCandidate, 'compatibility.json')], project);
    if (ignore.status !== 'supported') throw new Error('Data directory inside the repository must be Git-ignored before use.');
  }
  const protectedPaths = [factorio, path.join(homedir(), '.codex'), path.join(homedir(), '.factorio'), path.join(project, '.git'), path.join(project, '.codex'), path.join(project, '.agents')];
  if (process.env['APPDATA']) protectedPaths.push(path.join(process.env['APPDATA'], 'Factorio'));
  const data = await prepareDataDirectory(dataArgument, protectedPaths);
  const evidence = await mkdtemp(path.join(data, 'diagnostic-'));
  console.log(`AutoFactorio compatibility diagnostic\nEvidence: ${evidence}`);
  const checks: CompatibilityCheck[] = [];
  const add = (check: CompatibilityCheck) => { checks.push(check); console.log(`[${check.status}] ${check.id}: ${check.stdout || check.detail}`); };
  add(commandCheck('node', [process.execPath, '--version'], project, output => /^v24\./.test(output)));
  add(commandCheck('pnpm', ['corepack', 'pnpm', '--version'], project, output => output === '12.4.1'));
  add(commandCheck('codex', ['codex', '--version'], project, output => /^codex-cli \d+\./.test(output)));
  add(commandCheck('revision', ['git', 'rev-parse', 'HEAD'], project));
  add(commandCheck('working-tree', ['git', 'status', '--short'], project));
  add(commandCheck('factorio', [path.join(factorio, 'bin', 'x64', process.platform === 'win32' ? 'factorio.exe' : 'factorio'), '--version'], project, output => /Version: 2\.0\.\d+/.test(output)));
  for (const name of ['base', 'space-age', 'quality', 'elevated-rails']) add(await modCheck(factorio, name));
  add(await probeSqlite(evidence, values['sqlite-driver']));
  for (const check of pendingLiveChecks) add({ ...check });
  const report: CompatibilityReport = {
    schemaVersion: 1, observedAt: new Date().toISOString(), platform: process.platform, architecture: process.arch,
    paths: { project, factorio, data, evidence }, checks,
    foundationPassed: checks.every(check => check.status !== 'unsupported'),
  };
  const reportPath = path.join(evidence, 'compatibility.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  console.log(`Report: ${reportPath}\nFoundation: ${report.foundationPassed ? 'PASS' : 'FAIL'}; live gates remain unverified.`);
  if (!report.foundationPassed) process.exitCode = 1;
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
