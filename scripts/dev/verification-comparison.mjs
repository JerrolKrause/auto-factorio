import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareContract } from './contract.mjs';
import { executeManifest, commandIdentity } from './verification.mjs';
import { runChecks } from './checks.mjs';
import { boundedJson, createEvidenceDirectory, sha256, writeNewJson } from './safe-artifacts.mjs';

/** Exact mechanical comparison. It proves execution/output behavior, not model savings. */
export async function compareVerification({ root = process.cwd(), outputRoot = '.runtime/development' } = {}) {
  const directory = await createEvidenceDirectory(root, outputRoot, 'comparison');
  await writeFile(path.join(directory, 'input.json'), JSON.stringify({ values: [1, 2], expected: 3 }));
  await writeFile(path.join(directory, 'checker.mjs'), `import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';const v=JSON.parse(await readFile('input.json','utf8'));assert.equal(v.values.reduce((a,b)=>a+b,0),v.expected);console.log(JSON.stringify({passed:true}));`);
  const node = (id, args) => ({ id, assignmentCheckId: id, command: process.execPath, args, criteria: [id], dependsOn: [], inputs: [{ path: 'input.json', kind: 'fixture' }, { path: 'checker.mjs', kind: 'source' }], resources: [], effects: 'none', timeoutMs: 1000, freshRequired: false, observation: 'exit', observationVersion: 'fixture-sum-v1', configIdentity: 'sum-contract-1' });
  const shared = [node('sum-one', ['checker.mjs']), node('sum-two', ['checker.mjs'])];
  const baseline = await runChecks(shared.map(check => ({ name: check.id, command: check.command, args: check.args })), { cwd: directory, evidence: path.join(directory, '.runtime/baseline'), status() {} });
  let serial = 0;
  const plan = { version: 1, objective: 'Finite deterministic comparison; no inference', startTime: new Date().toISOString(), sessions: { author: 'comparison', workers: [], runs: [] }, checkpointCadenceMs: 300000, limits: [{ unit: 'wallMs', value: 60000, closeoutReserve: 5000 }] };
  const run = async checks => {
    const manifest = { version: 1, change: 'verification-comparison', slice: 'B', candidate: `candidate-${++serial}`, owner: 'comparison', criteria: checks.map(row => row.id), checks, resources: [], plan, sharedAdmission: true, cleanupReserveMs: 5000, tools: { node: process.version, assertion: 'comparison-1' }, usageReport: { sessions: [], usage: { input: 0, output: 0 }, coverage: { complete: false, aggregate: false } }, unknownAlternative: { reason: 'No provider calls; at most twelve deterministic checks within one minute', maxAdmissions: 12, deadlineMs: Date.parse(plan.startTime) + 55000 } };
    const manifestPath = `.runtime/manifest-${serial}.json`; await writeNewJson(path.join(directory, manifestPath), manifest);
    const { assignment } = await prepareContract({ version: 2, execution: { manifestSha256: sha256(JSON.stringify(manifest)), reusePolicy: 'matching-receipt-only' }, role: 'verification', objective: 'Author-defined deterministic sum comparison', criteria: manifest.criteria.map(id => ({ id, description: `Observed ${id}` })), revision: 'comparison-fixture', sourcePaths: ['input.json', 'checker.mjs', manifestPath], scope: [{ path: 'checker.mjs', boundary: 'whole deterministic fixture' }], checks: checks.map(check => ({ id: check.id, command: commandIdentity(check), expected: 'Exact fixture assertion; dependents skip after failure' })), allowedActions: ['Execute this manifest within declared effects and resources'], additionalChecks: 'forbidden', resources: [], budget: { timeSeconds: 60, providerCalls: 0 }, stopConditions: ['Stop on first failed check'], returnConditions: ['Return exact criterion coverage'], outputRoot: '.runtime/contracts' }, directory);
    return executeManifest(manifest, assignment, { root: directory, outputRoot: '.runtime/runs', status() {} });
  };
  const candidate = await run(shared);
  assert.equal(baseline.results.length, 2); assert.equal(candidate.results.filter(row => row.status === 'executed').length, 1); assert.equal(candidate.results.filter(row => row.status === 'reused').length, 1);
  assert(baseline.passed && candidate.passed && candidate.criteria.every(row => row.outcome === 'pass'));
  const retained = candidate.results[0].receipt;
  const same = await run(shared.map(check => ({ ...check, retainedReceipt: retained })));
  assert.equal(same.results.filter(row => row.status === 'executed').length, 0); assert(same.passed);
  await writeFile(path.join(directory, 'input.json'), JSON.stringify({ values: [1, 3], expected: 4 }));
  const changed = await run(shared.map(check => ({ ...check, retainedReceipt: retained })));
  assert.equal(changed.results.filter(row => row.status === 'executed').length, 1); assert(changed.passed);
  const failure = node('setup-failure', ['-e', 'process.exit(7)']);
  const dependent = { ...node('dependent', ['checker.mjs']), dependsOn: ['setup-failure'] };
  const failed = await run([failure, dependent]);
  assert.equal(failed.passed, false); assert.equal(failed.results.find(row => row.id === 'dependent').status, 'skipped'); assert(failed.criteria.every(row => row.outcome === 'unverified'));
  const projected = boundedJson({ privateDetail: 'oversized fixture'.repeat(10000) }); assert(Buffer.byteLength(projected) <= 4096);
  const summary = { passed: true, providerCalls: 0, modelSavings: 'unmeasured', baseline: { executions: baseline.results.length, criteria: shared.map(row => row.id) }, candidate: { executions: 1, reuse: 1, criteria: candidate.criteria }, unchanged: { executions: 0, reuse: 2 }, dependencyChange: { executions: 1, reuse: 1 }, setupFailure: { exit: 7, dependent: 'skipped', criteria: 'unverified' }, boundedOutputBytes: Buffer.byteLength(projected), evidence: path.relative(root, directory).split(path.sep).join('/') };
  await writeNewJson(path.join(directory, 'comparison.json'), summary);
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const index = process.argv.indexOf('--output-root');
  compareVerification({ outputRoot: index >= 0 ? process.argv[index + 1] : undefined }).then(result => console.log(boundedJson(result))).catch(error => { console.error(boundedJson({ error: error.message })); process.exitCode = 1; });
}
