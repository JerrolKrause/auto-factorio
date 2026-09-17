import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runChecks } from './checks.mjs';
import { boundedJson, createEvidenceDirectory, sha256, workspaceRoot, writeNewJson } from './safe-artifacts.mjs';

const defaultSteps = root => [
  { name: 'composition-regressions', command: process.execPath, args: [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/gameplay-provider.test.ts', 'tests/provider.test.ts', 'tests/trial-plan.test.ts', 'tests/trial-state.test.ts'] },
  { name: 'development-tools', command: process.execPath, args: [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/development-js.test.mjs'] },
];

async function sourceMatches(root, dependencies) {
  const gaps = [];
  for (const item of dependencies ?? []) {
    try {
      const actual = await realpath(path.resolve(root, item.path));
      const relative = path.relative(root, actual);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('escapes workspace');
      const digest = sha256(await readFile(actual));
      if (digest !== item.sha256) gaps.push(`stale source: ${item.path}`);
    } catch (error) { gaps.push(`cannot validate source ${item.path}: ${error.code ?? error.message}`); }
  }
  return gaps;
}

export async function runPreflight(input, { root = process.cwd(), steps, status } = {}) {
  const base = await workspaceRoot(root);
  if (input?.version !== 1 || !Array.isArray(input.criteria) || input.criteria.length === 0) throw new Error('invalid preflight declaration');
  const ids = new Set();
  for (const criterion of input.criteria) {
    if (!criterion.id || ids.has(criterion.id) || !['software', 'retained'].includes(criterion.kind)) throw new Error(`invalid criterion: ${criterion.id ?? 'unknown'}`);
    if (criterion.kind === 'software' && (!Array.isArray(criterion.checks) || criterion.checks.length === 0)) throw new Error(`software criterion needs checks: ${criterion.id}`);
    if (criterion.kind === 'retained' && (!Array.isArray(criterion.evidence?.dependencies) || criterion.evidence.dependencies.length === 0)) throw new Error(`retained criterion needs source dependencies: ${criterion.id}`);
    ids.add(criterion.id);
  }
  const evidence = await createEvidenceDirectory(base, input.outputRoot ?? '.runtime/preflight', 'check');
  const software = await runChecks(steps ?? defaultSteps(base), { cwd: base, evidence: path.join(evidence, 'software'), status: status ?? (() => {}) });
  const criteria = [];
  for (const criterion of input.criteria) {
    const gaps = [];
    if (criterion.kind === 'software') {
      for (const checkId of criterion.checks) {
        const observed = software.results.find(result => result.check === checkId);
        if (!observed) gaps.push(`check missing or skipped: ${checkId}`); else if (observed.exit !== 0) gaps.push(`check failed: ${checkId} exit ${observed.exit}`);
      }
      if (!criterion.coverage) gaps.push('software coverage description missing');
    } else {
      const retained = criterion.evidence;
      if (!retained?.path) gaps.push('retained evidence absent');
      else {
        try {
          const actual = await realpath(path.resolve(base, retained.path));
          const rel = path.relative(path.join(base, '.runtime'), actual);
          if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) gaps.push('retained evidence escapes .runtime');
          else {
            const body = JSON.parse(await readFile(actual, 'utf8'));
            const covered = Array.isArray(body.criteria) && body.criteria.some(item => item.id === criterion.id && item.status === 'pass');
            if (body.passed !== true || body.complete !== true || !covered) gaps.push('retained evidence failed, incomplete or does not cover criterion');
            const artifactDependencies = body.dependencies ?? body.source?.files;
            for (const dependency of retained.dependencies) if (!Array.isArray(artifactDependencies) || !artifactDependencies.some(item => item.path === dependency.path && item.sha256 === dependency.sha256)) gaps.push(`retained evidence source mismatch: ${dependency.path}`);
          }
        } catch (error) { gaps.push(`retained evidence unreadable: ${error.code ?? error.message}`); }
      }
      gaps.push(...await sourceMatches(base, retained?.dependencies));
    }
    criteria.push({ id: criterion.id, description: criterion.description, kind: criterion.kind, ready: gaps.length === 0, checks: criterion.kind === 'software' ? criterion.checks : [], coverage: criterion.coverage ?? null, artifact: criterion.kind === 'software' ? path.relative(base, path.join(evidence, 'software', 'results.json')).split(path.sep).join('/') : criterion.evidence?.path ?? null, dependencies: criterion.evidence?.dependencies ?? [], gaps });
  }
  const report = {
    version: 1, ready: software.passed && criteria.every(item => item.ready), scope: 'no-inference preflight only',
    establishesLiveTrialAcceptance: false, authorizesGameOrProviderRun: false,
    software, criteria, gaps: criteria.flatMap(item => item.gaps.map(gap => ({ criterion: item.id, gap }))),
  };
  await writeNewJson(path.join(evidence, 'manifest.json'), report);
  return { evidence, report };
}

function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
async function main() {
  const inputFile = option('--input'); if (!inputFile) throw new Error('usage: dev:preflight --input <declaration.json>');
  const { evidence, report } = await runPreflight(JSON.parse(await readFile(inputFile, 'utf8')), { status: line => console.log(boundedJson(JSON.parse(line))) });
  console.log(boundedJson({ evidence, ready: report.ready, gaps: report.gaps })); if (!report.ready) process.exitCode = 2;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { console.error(boundedJson({ error: error.message })); process.exitCode = 1; });
