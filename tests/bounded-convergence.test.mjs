import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareContract } from '../scripts/dev/contract.mjs';
import { validateContract } from '../scripts/check-agent-contract.mjs';
import { acceptanceDefinition, assessSliceReadiness, SLICE_LIFECYCLE } from '../scripts/dev/slice-readiness.mjs';
import { assessChangeReadiness } from '../scripts/dev/change-readiness.mjs';
import { assessReviewLedger, assessCorrectionAdmission, checkCorrectionAdmission, recordCorrectionAdmission, writeLedgerRecord } from '../scripts/dev/review-ledger.mjs';
import { assessReceiptIntegrity, checkIdentity, fingerprintInputs, writeReceipt } from '../scripts/dev/receipts.mjs';
import { sha256 } from '../scripts/dev/safe-artifacts.mjs';
import { selectTask } from '../scripts/dev/task.mjs';
import { executeManifest } from '../scripts/dev/verification.mjs';
import { createSliceHandoff } from '../scripts/dev/handoff.mjs';

const execute = promisify(execFile);
const roots = [];
const now = '2026-10-01T18:00:00.000Z';
async function temporary() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'af-bounded-convergence-'));
  roots.push(root);
  await mkdir(path.join(root, 'src'));
  for (const id of ['A', 'B', 'C', 'unchanged']) await writeFile(path.join(root, `src/${id}.mjs`), `export const identity = '${id}';\n`);
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function json(root, relative, value) {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  const bytes = JSON.stringify(value);
  await writeFile(path.join(root, relative), bytes, 'utf8');
  return { path: relative, sha256: sha256(bytes) };
}
const commonResult = assignment => ({ version: assignment.version, assignmentId: assignment.assignmentId, role: assignment.role, summary: 'Deterministic sanitized acceptance fixture', disposition: 'returned', source: { ...assignment.source, stable: true }, limits: [], model: { requested: 'fixture / no inference', observed: null, usage: { providerCalls: 0, totalTokens: 0 } }, cleanup: [] });
const authorInput = (role, criterion, paths) => ({ role, objective: 'Exercise authoritative local acceptance fixtures', criteria: [{ id: criterion, description: `Required ${criterion}` }], revision: 'fixture-revision', sourcePaths: paths, scope: paths.map(filename => ({ path: filename, boundary: 'whole source fixture' })), checks: [], allowedActions: ['Read retained local fixture proof'], additionalChecks: 'forbidden', resources: [], budget: { timeSeconds: 60, providerCalls: 0 }, stopConditions: ['Stop if proof changes'], returnConditions: ['Return criterion-level evidence'] });
async function reviewPair(root, label, { paths = ['src/A.mjs'], findings = [] } = {}) {
  const { assignment } = await prepareContract(authorInput('review', `S${label}`, paths), root);
  const result = { ...commonResult(assignment), scope: paths.map(filename => ({ path: filename, status: 'reviewed', observation: 'Independently reviewed source fixture' })), findings: findings.map(id => ({ id, severity: 'P2', confidence: 'high', path: paths[0], line: 1, description: 'Ownership invariant remains violated', evidence: ['.runtime/reviewer-proof.json'], fix: 'Reconcile exact ownership before another attempt' })) };
  expect(validateContract(assignment, result).valid).toBe(true);
  const pair = { assignment: await json(root, `.runtime/${label}/review-assignment.json`, assignment), result: await json(root, `.runtime/${label}/review-result.json`, result) };
  return { assignment, result, pair };
}
async function passingReceipt(root, label, source = 'src/A.mjs', criterion = `S${label}`) {
  const evidence = `.runtime/${label}/observation.json`;
  await json(root, evidence, { passed: true, measured: 1 });
  const check = { command: 'fixture-check', args: [label], criteria: [criterion], observation: { path: evidence, truthyFields: ['passed'] }, observationVersion: 'fixture-v1', configIdentity: 'fixture-v1' };
  const identity = checkIdentity(check, await fingerprintInputs(root, [{ path: source, kind: 'source' }]), { node: 'fixture-node', assertion: 'fixture-assertion' });
  const written = await writeReceipt(`.runtime/${label}/receipt.json`, { identity, outcome: 'pass', observed: true, sourceStable: true, cleanup: 'completed', evidence: [evidence] }, { root });
  return { reference: { path: written.path, sha256: written.sha256 }, identity, command: JSON.stringify([check.command, ...check.args]), evidence };
}
async function sliceProof(root, id, label = id) {
  const source = `src/${id}.mjs`;
  const receipt = await passingReceipt(root, label, source, `S${id}`);
  const input = { ...authorInput('verification', `S${id}`, [source]), version: 2, execution: null, sourcePaths: [source, receipt.reference.path], checks: [{ id: `T${id}`, command: receipt.command, expected: 'Observed fixture passed' }] };
  const { assignment } = await prepareContract(input, root);
  const result = { ...commonResult(assignment), criteria: [{ id: `S${id}`, status: 'pass', observation: 'Observed fixture satisfied the criterion', evidence: [receipt.evidence], checks: [`T${id}`] }], checks: [{ id: `T${id}`, command: receipt.command, authorization: null, status: 'reused', exit: null, outcome: 'pass', observation: 'Original immutable fixture receipt validated', evidence: [receipt.evidence], reuse: { receipt: receipt.reference, identity: receipt.identity, criteria: [`S${id}`], freshRequired: false } }] };
  expect(validateContract(assignment, result)).toMatchObject({ valid: true, ready: true });
  const verification = { assignment: (await json(root, `.runtime/${label}/assignment.json`, assignment)).path, result: (await json(root, `.runtime/${label}/result.json`, result)).path };
  const review = await reviewPair(root, label, { paths: [source] });
  return { assignment, result, receipt, review, acceptance: { verification, review: { assignment: review.pair.assignment.path, result: review.pair.result.path } } };
}
async function changeFixture() {
  const root = await temporary();
  const proofs = {};
  for (const id of ['A', 'B', 'C']) proofs[id] = await sliceProof(root, id);
  await writeFile(path.join(root, 'tasks.md'), '- [x] 1.1 Fixture acceptance\n');
  await writeFile(path.join(root, 'handoff.md'), 'fixture-change acceptance-verified');
  const manifest = { version: 2, change: 'fixture-change', lifecycle: 'acceptance-verified', capabilities: ['fixture'], integrationBoundaries: ['local-evidence'], slices: ['A', 'B', 'C'].map((id, index) => ({ id, prerequisites: index ? [index === 1 ? 'A' : 'B'] : [], capabilities: ['fixture'], integrationBoundaries: ['local-evidence'], scenarios: [`S${id}`], acceptance: proofs[id].acceptance })), scenarios: ['A', 'B', 'C'].map(id => ({ id: `S${id}`, requirement: 'Authoritative accepted predecessor', entrypoint: { kind: 'production', path: `src/${id}.mjs` }, checks: [{ command: proofs[id].receipt.command, evidence: [proofs[id].receipt.evidence] }] })), closeout: { taskFile: 'tasks.md', handoffFile: 'handoff.md', requiredHandoffMarkers: ['fixture-change', 'acceptance-verified'] } };
  return { root, manifest, proofs };
}

describe('source-matched incremental slice acceptance', () => {
  async function pinDefinition(fixture) {
    fixture.manifest.definition = await json(fixture.root, '.runtime/acceptance-definition.json', acceptanceDefinition(fixture.manifest));
    for (const id of ['A', 'B', 'C']) {
      const proof = fixture.proofs[id];
      for (const role of ['verification', 'review']) {
        const current = role === 'verification' ? proof : proof.review;
        const original = current.assignment;
        const prepared = await prepareContract({ ...authorInput(role, `S${id}`, original.source.files.map(file => file.path)), version: original.version, ...(original.version === 2 ? { execution: original.execution } : {}), criteria: original.criteria, checks: original.checks, sourcePaths: [...original.source.files.map(file => file.path), fixture.manifest.definition.path], scope: [...original.scope, { path: fixture.manifest.definition.path, boundary: 'Immutable acceptance semantics' }] }, fixture.root);
        current.assignment = prepared.assignment;
        current.result.assignmentId = current.assignment.assignmentId;
        current.result.source = { ...current.assignment.source, stable: true };
        if (role === 'review') current.result.scope.push({ path: fixture.manifest.definition.path, status: 'reviewed', observation: 'Acceptance semantics independently reviewed' });
        await json(fixture.root, proof.acceptance[role].assignment, current.assignment);
        await json(fixture.root, proof.acceptance[role].result, current.result);
      }
    }
  }

  it.each(['matching', 'changed-check', 'changed-plan', 'corrupt-file', 'unpinned-review'])('binds mutable status indexes to independently pinned acceptance semantics: %s', async changed => {
    const fixture = await changeFixture();
    fixture.manifest.sessionPlan = { version: 1, objective: 'Pinned plan', sessions: { author: 'fixture-author', workers: [], runs: [] }, startTime: now, checkpointCadenceMs: 30000, limits: [{ unit: 'wallMs', value: 60000, closeoutReserve: 5000 }] };
    await pinDefinition(fixture);
    expect((await assessSliceReadiness(fixture.manifest, { root: fixture.root })).ready).toBe(true);
    if (changed === 'changed-check') fixture.manifest.scenarios[0].checks[0].command = 'unreviewed altered command';
    else if (changed === 'changed-plan') fixture.manifest.sessionPlan.limits[0].value = 120000;
    else if (changed === 'corrupt-file') await writeFile(path.join(fixture.root, fixture.manifest.definition.path), '{}');
    else if (changed === 'unpinned-review') {
      const review = fixture.proofs.A.review;
      review.assignment.source.files = review.assignment.source.files.filter(file => file.path !== fixture.manifest.definition.path);
      review.assignment.scope = review.assignment.scope.filter(file => file.path !== fixture.manifest.definition.path);
      review.result.source.files = review.assignment.source.files;
      review.result.scope = review.result.scope.filter(file => file.path !== fixture.manifest.definition.path);
      await json(fixture.root, fixture.proofs.A.acceptance.review.assignment, review.assignment);
      await json(fixture.root, fixture.proofs.A.acceptance.review.result, review.result);
    } else {
      fixture.manifest.lifecycle = 'closable';
      fixture.manifest.slices[0].historicalAcceptance = { verification: 'retained-history-pointer' };
    }
    const report = await assessSliceReadiness(fixture.manifest, { root: fixture.root });
    expect(report.ready).toBe(changed === 'matching');
    if (changed !== 'matching') expect(report.errors.join(' ')).toContain('acceptance definition');
  });

  it('refuses deleting one formerly accepted scenario even when the remaining map has unique complete ownership', async () => {
    const fixture = await changeFixture();
    const proof = fixture.proofs.C;
    const identity = { ...proof.receipt.identity, criteria: ['SC', 'SD'] };
    const receipt = await writeReceipt('.runtime/C/two-criteria-receipt.json', { identity, outcome: 'pass', observed: true, sourceStable: true, cleanup: 'completed', evidence: [proof.receipt.evidence] }, { root: fixture.root });
    const { assignment } = await prepareContract({ ...authorInput('verification', 'SC', ['src/C.mjs']), version: 2, execution: null, criteria: [{ id: 'SC', description: 'Criterion C' }, { id: 'SD', description: 'Second C criterion' }], sourcePaths: ['src/C.mjs', receipt.path], checks: proof.assignment.checks }, fixture.root);
    proof.assignment = assignment;
    proof.result.assignmentId = assignment.assignmentId;
    proof.result.source = { ...assignment.source, stable: true };
    proof.result.checks[0].reuse = { receipt: { path: receipt.path, sha256: receipt.sha256 }, identity, criteria: ['SC', 'SD'], freshRequired: false };
    proof.result.criteria.push({ ...proof.result.criteria[0], id: 'SD' });
    await json(fixture.root, proof.acceptance.verification.assignment, proof.assignment);
    await json(fixture.root, proof.acceptance.verification.result, proof.result);
    fixture.manifest.scenarios.push({ ...fixture.manifest.scenarios[2], id: 'SD' });
    fixture.manifest.slices[2].scenarios.push('SD');
    expect((await assessSliceReadiness(fixture.manifest, { root: fixture.root })).ready).toBe(true);
    fixture.manifest.scenarios = fixture.manifest.scenarios.filter(scenario => scenario.id !== 'SC');
    fixture.manifest.slices[2].scenarios = ['SD'];
    const result = await assessSliceReadiness(fixture.manifest, { root: fixture.root });
    expect(result.ready).toBe(false);
    expect(result.errors).toContain('accepted criterion SC: absent from scenario ownership');
  });

  it('admits actual A -> B -> C predecessor proofs through production CLI and closes only with all contracts', async () => {
    const fixture = await changeFixture();
    const filename = '.runtime/readiness.json';
    await json(fixture.root, filename, fixture.manifest);
    for (const [slice, required] of [['A', []], ['B', ['A']], ['C', ['B', 'A']]]) {
      const result = await execute(process.execPath, [path.resolve('scripts/dev/change-readiness.mjs'), '--input', filename, '--start-slice', slice], { cwd: fixture.root });
      expect(JSON.parse(result.stdout)).toMatchObject({ ready: true, mode: 'admission', requiredSlices: required });
    }
    expect(await assessChangeReadiness(fixture.manifest, { root: fixture.root })).toMatchObject({ ready: true, requiredSlices: ['A', 'B', 'C'] });
    const final = await execute(process.execPath, [path.resolve('scripts/dev/change-readiness.mjs'), '--input', filename], { cwd: fixture.root });
    expect(JSON.parse(final.stdout)).toMatchObject({ ready: true, mode: 'closeout' });
  });

  it('refuses counts-only acceptance and validates transitive predecessors rather than just the direct parent', async () => {
    const fixture = await changeFixture();
    delete fixture.manifest.slices[0].acceptance;
    const result = await assessSliceReadiness(fixture.manifest, { root: fixture.root, startSlice: 'C' });
    expect(result.ready).toBe(false);
    expect(result.requiredSlices).toEqual(['B', 'A']);
    expect(result.errors.join(' ')).toContain('slice A');
  });

  it.each(['source', 'receipt', 'evidence', 'criterion', 'unreviewed', 'entrypoint', 'cleanup'])('refuses stale/incomplete %s predecessor coverage', async changed => {
    const fixture = await changeFixture();
    const proof = fixture.proofs.A;
    if (changed === 'source') await writeFile(path.join(fixture.root, 'src/A.mjs'), 'changed source');
    else if (changed === 'receipt') await writeFile(path.join(fixture.root, proof.receipt.reference.path), 'corrupt receipt');
    else if (changed === 'evidence') await writeFile(path.join(fixture.root, proof.receipt.evidence), 'corrupt observation');
    else if (changed === 'criterion') { proof.result.criteria[0].status = 'unverified'; await json(fixture.root, proof.acceptance.verification.result, proof.result); }
    else if (changed === 'unreviewed') { proof.review.result.scope[0].status = 'unreviewed'; await json(fixture.root, proof.acceptance.review.result, proof.review.result); }
    else if (changed === 'entrypoint') fixture.manifest.scenarios[0].entrypoint.path = 'src/unchanged.mjs';
    else {
      proof.assignment.resources = [{ id: 'owned-profile', owner: 'fixture-worker', cleanup: 'Exact owned cleanup' }];
      proof.result.cleanup = [{ id: 'owned-profile', status: 'unresolved', observation: 'Cleanup cannot be reconciled', evidence: [] }];
      await json(fixture.root, proof.acceptance.verification.assignment, proof.assignment);
      await json(fixture.root, proof.acceptance.verification.result, proof.result);
    }
    expect((await assessSliceReadiness(fixture.manifest, { root: fixture.root, startSlice: 'B' })).ready).toBe(false);
  });

  it('refuses a ready review that omits the actual production entrypoint', async () => {
    const fixture = await changeFixture();
    const unrelatedReview = await reviewPair(fixture.root, 'unrelated-review', { paths: ['src/unchanged.mjs'] });
    fixture.manifest.slices[0].acceptance.review = { assignment: unrelatedReview.pair.assignment.path, result: unrelatedReview.pair.result.path };
    const report = await assessSliceReadiness(fixture.manifest, { root: fixture.root, startSlice: 'B' });
    expect(report.ready).toBe(false);
    expect(report.errors.join(' ')).toContain('entrypoint outside independent review');
  });

  it.each(['duplicate-owner', 'cycle', 'missing-predecessor', 'missing-command', 'escaped-path'])('refuses malformed slice boundary %s before acceptance', async invalid => {
    const fixture = await changeFixture();
    if (invalid === 'duplicate-owner') fixture.manifest.slices[1].scenarios.push('SA');
    else if (invalid === 'cycle') fixture.manifest.slices[0].prerequisites = ['C'];
    else if (invalid === 'missing-predecessor') fixture.manifest.slices[1].prerequisites = ['absent'];
    else if (invalid === 'missing-command') fixture.manifest.scenarios[0].checks[0].command = 'different-check';
    else fixture.manifest.scenarios[0].entrypoint.path = '../outside.mjs';
    const result = await assessSliceReadiness(fixture.manifest, { root: fixture.root, startSlice: 'C' });
    expect(result.ready).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('preserves lifecycle v1 semantics while refusing promotion to pre-expansion acceptance', async () => {
    const fixture = await changeFixture();
    expect(SLICE_LIFECYCLE).toEqual(['candidate', 'smoke-verified', 'reviewed-with-findings', 'corrected', 'reviewed-clean', 'acceptance-verified', 'closable']);
    const legacy = { ...fixture.manifest, version: 1, lifecycle: 'reviewed-clean', slices: [fixture.manifest.slices[0]], scenarios: [fixture.manifest.scenarios[0]], contracts: fixture.proofs.A.acceptance };
    expect((await assessChangeReadiness(legacy, { root: fixture.root })).ready).toBe(true);
    expect(await assessChangeReadiness(legacy, { root: fixture.root, startSlice: 'B' })).toMatchObject({ ready: false, errors: ['v1 manifests have no pre-expansion acceptance semantics'] });
  });

  it.each(['candidate', 'corrected', 'reviewed-clean', 'pending-task', 'missing-marker'])('does not grant final acceptance for %s', async state => {
    const fixture = await changeFixture();
    if (state === 'pending-task') await writeFile(path.join(fixture.root, 'tasks.md'), '- [ ] 1.1 Pending acceptance\n');
    else if (state === 'missing-marker') await writeFile(path.join(fixture.root, 'handoff.md'), 'incomplete');
    else fixture.manifest.lifecycle = state;
    expect((await assessSliceReadiness(fixture.manifest, { root: fixture.root })).ready).toBe(false);
  });

  it.each(['active', 'archived', 'archived-pending', 'both', 'missing', 'escaped-alternate'])('reads exactly one confined current closeout checklist: %s', async location => {
    const fixture = await changeFixture();
    const activePath = path.join(fixture.root, fixture.manifest.closeout.taskFile);
    const original = await readFile(activePath);
    fixture.manifest.closeout.archivedTaskFile = 'archive/fixture-change/tasks.md';
    if (['archived', 'archived-pending', 'both'].includes(location)) {
      await mkdir(path.join(fixture.root, 'archive/fixture-change'), { recursive: true });
      await writeFile(path.join(fixture.root, fixture.manifest.closeout.archivedTaskFile), original);
    }
    if (['archived', 'archived-pending', 'missing'].includes(location)) await rm(activePath);
    if (location === 'archived-pending') await writeFile(path.join(fixture.root, fixture.manifest.closeout.archivedTaskFile), '- [ ] 1.1 Acceptance remains pending\n');
    if (location === 'escaped-alternate') fixture.manifest.closeout.archivedTaskFile = '../outside-tasks.md';
    const report = await assessSliceReadiness(fixture.manifest, { root: fixture.root });
    expect(report.ready).toBe(['active', 'archived'].includes(location));
    if (location === 'archived') expect(await readFile(path.join(fixture.root, fixture.manifest.closeout.archivedTaskFile))).toEqual(original);
    if (['both', 'missing'].includes(location)) expect(report.errors.join(' ')).toContain('closeout task location missing or ambiguous');
    if (['archived-pending', 'escaped-alternate'].includes(location)) expect(report.errors.length).toBeGreaterThan(0);
  });
});

describe('stable accepted-slice handoff packets', () => {
  const plan = () => ({ version: 1, objective: 'Original shared change plan', sessions: { author: 'fixture-author', workers: ['fixture-worker'], runs: [] }, startTime: new Date().toISOString(), checkpointCadenceMs: 30000, limits: [{ unit: 'tokens', value: 1000, closeoutReserve: 100 }] });
  const knownUsage = input => ({ sessions: [{ sessionId: 'fixture-author' }, { sessionId: 'fixture-worker' }], usage: { input, cachedInput: 20, output: 10, reasoning: 5 }, coverage: { aggregate: true, complete: true } });
  async function handoffFixture() {
    const fixture = await changeFixture();
    fixture.manifest.sessionPlan = plan();
    const evidence = await json(fixture.root, '.runtime/handoff-cleanup.json', { stoppedExactProfile: true });
    const proof = fixture.proofs.A;
    proof.assignment.resources = [{ id: 'owned-A-profile', owner: 'fixture-worker', cleanup: 'Exact owned child profiles released' }];
    proof.result.cleanup = [{ id: 'owned-A-profile', status: 'completed', observation: 'Exact owned profile cleaned and ownership reconciled', evidence: [evidence.path] }];
    await json(fixture.root, proof.acceptance.verification.assignment, proof.assignment);
    await json(fixture.root, proof.acceptance.verification.result, proof.result);
    const reviewEvidence = await json(fixture.root, '.runtime/reviewer-proof.json', { ownershipViolation: true });
    const review = await reviewPair(fixture.root, 'handoff-original', { findings: ['HANDOFF-R1'] });
    const finding = { version: 1, id: 'handoff-finding', author: 'independent-reviewer', at: now, kind: 'finding', evidence: [reviewEvidence], findingId: 'HANDOFF-R1', invariantId: 'ownership', review: review.pair };
    const reference = await writeLedgerRecord('.runtime/handoff-ledger', finding, { root: fixture.root });
    const adjudication = await writeLedgerRecord('.runtime/handoff-ledger', { version: 1, id: 'handoff-fixed', author: 'fixture-author', at: now, kind: 'adjudication', evidence: [evidence], originalId: finding.id, invariantId: 'ownership', disposition: 'fixed', reason: 'Exact cleanup evidence resolves the retained ownership finding' }, { root: fixture.root, records: [reference] });
    return { ...fixture, records: [reference, adjudication], evidence };
  }

  it('preserves immutable actual proof, source, findings, resources and original plan across API and production CLI', async () => {
    const fixture = await handoffFixture();
    const usageReport = knownUsage(300);
    const options = { startSlice: 'B', records: fixture.records, usageReport, decisions: ['A independently accepted', 'B retains the original plan'], nextAction: 'Implement bounded B verification using accepted A proof' };
    const first = await createSliceHandoff(fixture.manifest, { root: fixture.root, ...options });
    expect(first.packet).toMatchObject({ nextSlice: 'B', replacementResetsBudget: false, compaction: 'automatic-defaults', sharedPlan: fixture.manifest.sessionPlan, usage: { aggregateComplete: true, totals: usageReport.usage }, nextAction: options.nextAction });
    expect(first.packet.ledger).toEqual(fixture.records);
    expect(first.packet.budget.balance).toEqual([{ unit: 'tokens', limit: 1000, reserve: 100, spent: 310, remaining: 690 }]);
    expect(first.packet.findings).toMatchObject([{ id: 'handoff-finding', invariantId: 'ownership', disposition: 'fixed' }]);
    expect(first.packet.resources).toMatchObject([{ id: 'owned-A-profile', owner: 'fixture-worker', cleanup: { status: 'completed', evidence: [fixture.evidence.path] } }]);
    expect(first.packet.proof).toHaveLength(2);
    for (const proof of first.packet.proof) {
      const original = proof.role === 'verification' ? fixture.proofs.A.assignment : fixture.proofs.A.review.assignment;
      expect(proof.sourceFingerprint).toBe(sha256(JSON.stringify(original.source)));
      expect(proof.revision).toBe(original.source.revision);
      for (const reference of Object.values(proof.references)) expect(sha256(await readFile(path.join(fixture.root, reference.path)))).toBe(reference.sha256);
    }
    const packetBytes = await readFile(path.join(fixture.root, first.path), 'utf8');
    expect(sha256(packetBytes)).toBe(first.sha256);
    await json(fixture.root, '.runtime/handoff-input.json', { manifest: fixture.manifest, ...options });
    const result = await execute(process.execPath, [path.resolve('scripts/dev/handoff.mjs'), '--input', '.runtime/handoff-input.json'], { cwd: fixture.root });
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(4096);
    const reference = JSON.parse(result.stdout);
    expect(reference).toMatchObject({ nextSlice: 'B', replacementResetsBudget: false });
    expect(reference.path).not.toBe(first.path);
    const second = JSON.parse(await readFile(path.join(fixture.root, reference.path), 'utf8'));
    expect(second.sharedPlan).toEqual(first.packet.sharedPlan);
    expect(second.usage).toEqual(first.packet.usage);
    expect(second.proof).toEqual(first.packet.proof);
    expect(await readFile(path.join(fixture.root, first.path), 'utf8')).toBe(packetBytes);
  });

  it.each(['stop', 'unknown'])('preserves truthful %s budget in a handoff without replenishing the plan or granting admission', async decision => {
    const fixture = await handoffFixture();
    const usageReport = decision === 'stop' ? knownUsage(950) : { ...knownUsage(300), coverage: { aggregate: false, complete: false } };
    const result = await createSliceHandoff(fixture.manifest, { root: fixture.root, startSlice: 'B', records: fixture.records, usageReport, nextAction: decision === 'stop' ? 'Return remaining work; preserve reserve and cleanup evidence' : 'Return unknown usage and require a bounded admission decision' });
    expect(result.packet.budget).toMatchObject({ decision, authorizesInference: false });
    expect(result.packet.sharedPlan).toEqual(fixture.manifest.sessionPlan);
    expect(result.packet.replacementResetsBudget).toBe(false);
    expect(result.packet.usage).toEqual(decision === 'stop' ? { aggregateComplete: true, totals: usageReport.usage } : { aggregateComplete: false, totals: null });
    expect(result.packet.budget.admitted).toBeUndefined();
    expect(result.packet.budget.balance).toEqual([{ unit: 'tokens', limit: 1000, reserve: 100, spent: decision === 'stop' ? 960 : null, remaining: decision === 'stop' ? 40 : null }]);
  });

  it('refuses stale prerequisite and pending finding handoffs rather than inventing accepted lineage', async () => {
    const fixture = await handoffFixture();
    const options = { root: fixture.root, startSlice: 'B', records: fixture.records.slice(0, 1), usageReport: knownUsage(300), nextAction: 'Continue only after evidence is ready' };
    await expect(createSliceHandoff(fixture.manifest, options)).rejects.toThrow('lineage is incomplete');
    await writeFile(path.join(fixture.root, 'src/A.mjs'), 'changed after acceptance');
    await expect(createSliceHandoff(fixture.manifest, { ...options, records: fixture.records })).rejects.toThrow('prerequisites are incomplete');
  });
});

describe('immutable review lineage and bounded correction admission', () => {
  async function ledgerFixture(root) {
    root ??= await temporary();
    const evidence = await json(root, '.runtime/reviewer-proof.json', { failed: true, scope: 'ownership' });
    const review = await reviewPair(root, 'original', { findings: ['R1'] });
    const finding = { version: 1, id: 'finding-original', author: 'independent-reviewer', at: now, kind: 'finding', evidence: [evidence], findingId: 'R1', invariantId: 'ownership', review: review.pair };
    const reference = await writeLedgerRecord('.runtime/ledger', finding, { root });
    return { root, evidence, review, finding, records: [reference] };
  }
  const correction = (fixture, id, predecessorId, outcome = 'unsatisfied', signature = 'failure-one') => ({ version: 1, id, kind: 'correction', author: 'fixture-author', at: now, evidence: [fixture.evidence], originalId: fixture.finding.id, invariantId: 'ownership', predecessorId, outcome, failureSignature: signature, command: 'fixture-check ownership', sourceId: sha256('current-source'), rerunReason: 'incomplete-fix' });
  async function append(fixture, row) {
    if (row.kind === 'correction' && !row.admission) {
      const admission = await recordCorrectionAdmission({ records: fixture.records, invariantId: row.invariantId, command: row.command, inputs: [{ path: 'src/A.mjs', kind: 'source' }] }, { root: fixture.root });
      if (!admission.allowed) throw new Error(admission.reason);
      row.admission = admission.admission;
      row.sourceId = admission.sourceId;
    }
    const reference = await writeLedgerRecord('.runtime/ledger', row, { root: fixture.root, records: fixture.records });
    fixture.records.push(reference);
    return reference;
  }
  async function adjudicate(fixture, disposition) {
    return append(fixture, { version: 1, id: `adjudication-${fixture.records.length}`, kind: 'adjudication', author: 'fixture-author', at: now, evidence: [fixture.evidence], originalId: fixture.finding.id, invariantId: 'ownership', disposition, reason: 'Retained scoped evidence supports this disposition' });
  }
  async function diagnose(fixture, label = 'diagnosis') {
    const proof = await passingReceipt(fixture.root, label);
    const row = { version: 1, id: label, kind: 'diagnosis', author: 'fixture-author', at: now, evidence: [fixture.evidence], invariantId: 'ownership', command: 'fixture-check ownership', failureSignature: 'changed-symptom', hypothesis: 'Ownership record races process replacement', predecessors: ['correction-one', 'correction-two'], discriminatingCheck: { command: proof.command, receipt: proof.reference } };
    await append(fixture, row);
    return { proof, row };
  }
  const admissionInput = fixture => ({ records: fixture.records, invariantId: 'ownership', command: 'fixture-check ownership', inputs: [{ path: 'src/A.mjs', kind: 'source' }] });

  it('retains diagnosis and pre-edit third admission as immutable history after a successful fix and current-contract handoff', async () => {
    const change = await changeFixture();
    const fixture = await ledgerFixture(change.root);
    await append(fixture, correction(fixture, 'correction-one', null));
    await append(fixture, correction(fixture, 'correction-two', 'correction-one', 'unknown', 'changed-symptom'));
    const { proof } = await diagnose(fixture);
    const original = await readFile(path.join(fixture.root, proof.reference.path), 'utf8');
    const admitted = await recordCorrectionAdmission(admissionInput(fixture), { root: fixture.root });
    expect(admitted).toMatchObject({ allowed: true, diagnosisId: 'diagnosis' });
    const candidate = await checkCorrectionAdmission(admitted.admission, { root: fixture.root });
    expect(candidate).toMatchObject({ records: fixture.records, predecessorId: 'correction-two', originalIds: ['finding-original'], sourceId: admitted.sourceId, diagnosisId: 'diagnosis' });
    await writeFile(path.join(fixture.root, 'src/A.mjs'), 'export const correctedOwnership = true;\n');
    const outcome = await json(fixture.root, '.runtime/fixed-outcome.json', { ownershipReconciled: true });
    await append(fixture, { ...correction(fixture, 'correction-three', 'correction-two', 'satisfied'), admission: admitted.admission, sourceId: admitted.sourceId, evidence: [outcome] });
    await adjudicate(fixture, 'fixed');
    expect(await assessReceiptIntegrity(proof.reference, { root: fixture.root })).toMatchObject({ intact: true });
    expect(await assessReviewLedger(fixture.records, { root: fixture.root })).toMatchObject({ valid: true, ready: true, unresolved: 0 });
    expect(await readFile(path.join(fixture.root, proof.reference.path), 'utf8')).toBe(original);
    const current = await sliceProof(fixture.root, 'A', 'A-current');
    change.manifest.slices[0].acceptance = current.acceptance;
    change.manifest.scenarios[0].checks = [{ command: current.receipt.command, evidence: [current.receipt.evidence] }];
    change.manifest.sessionPlan = { version: 1, objective: 'Preserve correction session plan', sessions: { author: 'fixture-author', workers: [], runs: [] }, startTime: new Date().toISOString(), checkpointCadenceMs: 30000, limits: [{ unit: 'wallMs', value: 60000, closeoutReserve: 5000 }] };
    const handoff = await createSliceHandoff(change.manifest, { root: fixture.root, startSlice: 'B', records: fixture.records, usageReport: { sessions: [{ sessionId: 'fixture-author' }], usage: { input: 0, cachedInput: 0, output: 0, reasoning: 0 }, coverage: { aggregate: true, complete: true } }, nextAction: 'Continue bounded B work with corrected current A contracts' });
    expect(handoff.packet.findings).toMatchObject([{ id: 'finding-original', disposition: 'fixed' }]);
    expect(handoff.packet.ledger).toEqual(fixture.records);
    expect(handoff.packet.proof.find(item => item.role === 'verification').sourceFingerprint).toBe(sha256(JSON.stringify(current.assignment.source)));
    expect(handoff.packet.sharedPlan).toEqual(change.manifest.sessionPlan);
  });

  it('keeps changed-source diagnosis valid historically but refuses new admission and republishing a stale diagnosis', async () => {
    const fixture = await ledgerFixture();
    await append(fixture, correction(fixture, 'correction-one', null));
    await append(fixture, correction(fixture, 'correction-two', 'correction-one'));
    const { row } = await diagnose(fixture);
    await writeFile(path.join(fixture.root, 'src/A.mjs'), 'changed unresolved candidate');
    expect(await assessReviewLedger(fixture.records, { root: fixture.root })).toMatchObject({ valid: true, ready: false, unresolved: 1 });
    expect((await recordCorrectionAdmission(admissionInput(fixture), { root: fixture.root })).allowed).toBe(false);
    await expect(append(fixture, { ...row, id: 'stale-new-diagnosis' })).rejects.toThrow('new diagnosis discriminating check invalid');
  });

  it.each(['command', 'source', 'predecessor', 'corrupt-proof'])('refuses correction outcomes that disagree with actual immutable admission: %s', async changed => {
    const fixture = await ledgerFixture();
    const admitted = await recordCorrectionAdmission(admissionInput(fixture), { root: fixture.root });
    expect(admitted.allowed).toBe(true);
    const row = { ...correction(fixture, 'invalid-proof', null), admission: admitted.admission, sourceId: admitted.sourceId };
    if (changed === 'command') row.command = 'different unchecked command';
    else if (changed === 'source') row.sourceId = '0'.repeat(64);
    else if (changed === 'predecessor') row.predecessorId = 'absent';
    else await writeFile(path.join(fixture.root, admitted.admission.path), '{}');
    await expect(append(fixture, row)).rejects.toThrow();
    expect((await assessReviewLedger(fixture.records, { root: fixture.root })).valid).toBe(true);
  });

  it('rejects corruption of an old admission and historical discriminating evidence during replay', async () => {
    const fixture = await ledgerFixture();
    const first = correction(fixture, 'correction-one', null);
    await append(fixture, first);
    await append(fixture, correction(fixture, 'correction-two', 'correction-one'));
    const { proof } = await diagnose(fixture);
    const bytes = await readFile(path.join(fixture.root, first.admission.path));
    await writeFile(path.join(fixture.root, first.admission.path), '{}');
    expect((await assessReviewLedger(fixture.records, { root: fixture.root })).valid).toBe(false);
    await writeFile(path.join(fixture.root, first.admission.path), bytes);
    await writeFile(path.join(fixture.root, proof.evidence), '{"passed":false}');
    expect(await assessReceiptIntegrity(proof.reference, { root: fixture.root })).toMatchObject({ intact: false });
    expect((await assessReviewLedger(fixture.records, { root: fixture.root })).valid).toBe(false);
  });

  it('replays permission at the captured prefix rather than replacing the admitted diagnosis with a later packet', async () => {
    const fixture = await ledgerFixture();
    await append(fixture, correction(fixture, 'correction-one', null));
    await append(fixture, correction(fixture, 'correction-two', 'correction-one'));
    await diagnose(fixture, 'diagnosis-original');
    const admitted = await recordCorrectionAdmission(admissionInput(fixture), { root: fixture.root });
    expect(admitted).toMatchObject({ allowed: true, diagnosisId: 'diagnosis-original' });
    const originalPrefix = [...fixture.records];
    await diagnose(fixture, 'diagnosis-later');
    await append(fixture, { ...correction(fixture, 'correction-three', 'correction-two', 'satisfied'), admission: admitted.admission, sourceId: admitted.sourceId });
    await adjudicate(fixture, 'fixed');
    expect(await assessReviewLedger(fixture.records, { root: fixture.root })).toMatchObject({ valid: true, ready: true });
    const proof = await checkCorrectionAdmission(admitted.admission, { root: fixture.root });
    expect(proof.records).toEqual(originalPrefix);
    expect(proof.diagnosisId).toBe('diagnosis-original');
  });

  it('refuses an unknown invariant and correction rows without a recorded admission', async () => {
    const fixture = await ledgerFixture();
    expect((await assessCorrectionAdmission({ records: fixture.records, invariantId: 'unretained-invariant' }, { root: fixture.root })).allowed).toBe(false);
    expect((await recordCorrectionAdmission({ ...admissionInput(fixture), invariantId: 'unretained-invariant' }, { root: fixture.root })).allowed).toBe(false);
    await expect(writeLedgerRecord('.runtime/ledger', correction(fixture, 'no-admission', null), { root: fixture.root, records: fixture.records })).rejects.toThrow();
  });

  it.each(['task-discovery', 'runner-preflight'])('refuses a candidate race after recorded admission before effects: %s', async boundary => {
    const fixture = await ledgerFixture();
    const plan = { version: 1, objective: 'Bounded race check', sessions: { author: 'fixture-author', workers: [], runs: [] }, startTime: new Date().toISOString(), checkpointCadenceMs: 30000, limits: [{ unit: 'wallMs', value: 60000, closeoutReserve: 5000 }] };
    const usageReport = { sessions: [{ sessionId: 'fixture-author' }], usage: { input: 0, cachedInput: 0, output: 0, reasoning: 0 }, coverage: { aggregate: true, complete: true } };
    let effects = 0;
    let races = 0;
    const race = async () => { races++; await writeFile(path.join(fixture.root, 'src/A.mjs'), 'changed after admission before effects'); };
    if (boundary === 'task-discovery') {
      const tasksFile = path.join(fixture.root, 'routing.md');
      await writeFile(tasksFile, '- [ ] 1.1 Correct ownership\n\n## Model routing\n\n| Task | Role | Model | Effort | Rationale | Escalate when |\n| --- | --- | --- | --- | --- | --- |\n| 1.1 | author | gpt-6.1-sol | high | Known correction | Candidate changes |\n');
      await expect(selectTask({ root: fixture.root, tasksFile, taskId: '1.1', start: true, plan, usageReport, correction: admissionInput(fixture) }, { discover: async () => { await race(); return {}; }, launch: () => { effects++; throw new Error('must not launch'); } })).rejects.toThrow('correction candidate changed after admission');
    } else {
      const command = JSON.stringify(['fixture-executable', '--ownership']);
      const { assignment } = await prepareContract({ ...authorInput('verification', 'C1', ['src/A.mjs']), checks: [{ id: 'T1', command, expected: 'Scoped fixture succeeded' }], allowedActions: ['Execute this manifest within declared effects and resources'] }, fixture.root);
      const manifest = { version: 1, change: 'fixture-change', slice: 'C', candidate: 'race-correction', owner: 'fixture-worker', criteria: ['C1'], resources: [], plan, usageReport, cleanupReserveMs: 1000, tools: { node: process.version, assertion: 'fixture-correction-v1' }, correction: admissionInput(fixture), checks: [{ id: 'check-one', assignmentCheckId: 'T1', command: 'fixture-executable', args: ['--ownership'], dependsOn: [], criteria: ['C1'], resources: [], effects: 'none', timeoutMs: 1000, freshRequired: true, inputs: [{ path: 'src/A.mjs', kind: 'source' }], observation: 'exit', observationVersion: 'v1', configIdentity: 'v1', preflight: {} }] };
      const report = await executeManifest(manifest, assignment, { root: fixture.root, status() {}, dependencies: { preflight: race, execute: () => { effects++; throw new Error('must not execute'); } } });
      expect(report.passed).toBe(false);
      expect(report.results).toContainEqual(expect.objectContaining({ status: 'blocked', outcome: 'unverified', reason: 'correction candidate changed after admission' }));
    }
    expect(races).toBe(1);
    expect(effects).toBe(0);
  });

  it.each(['changed-during-admission', 'unchanged'])('rechecks recorded correction immediately before task launch and retains reservation evidence: %s', async candidate => {
    const fixture = await ledgerFixture();
    const tasksFile = path.join(fixture.root, 'routing.md');
    await writeFile(tasksFile, '- [ ] 1.1 Correct ownership\n\n## Model routing\n\n| Task | Role | Model | Effort | Rationale | Escalate when |\n| --- | --- | --- | --- | --- | --- |\n| 1.1 | author | gpt-6.1-sol | high | Known correction | Candidate changes |\n');
    const plan = { version: 1, objective: 'Preserve existing correction budget', sessions: { author: 'fixture-author', workers: [], runs: [] }, startTime: new Date().toISOString(), checkpointCadenceMs: 30000, limits: [{ unit: 'wallMs', value: 60000, closeoutReserve: 5000 }] };
    const usageReport = { sessions: [{ sessionId: 'fixture-author' }], usage: { input: 100, cachedInput: 0, output: 20, reasoning: 0 }, coverage: { aggregate: true, complete: true } };
    const reservation = { admitted: true, decision: 'continue', admissions: 1, spent: { input: 100, output: 20 }, sharedPlanStart: plan.startTime };
    let discovery = 0; let admissions = 0; let launches = 0;
    const request = selectTask({ root: fixture.root, tasksFile, taskId: '1.1', start: true, plan, usageReport, correction: admissionInput(fixture) }, {
      discover: async () => { discovery++; return { fixture: 'no provider call' }; },
      admit: async (receivedPlan, receivedUsage) => {
        admissions++;
        expect(receivedPlan).toEqual(plan);
        expect(receivedUsage).toEqual(usageReport);
        if (candidate === 'changed-during-admission') await writeFile(path.join(fixture.root, 'src/A.mjs'), 'candidate changed while reserving the shared budget');
        return reservation;
      },
      launch: () => { launches++; return { pid: 12345, unref() {} }; },
    });
    let result;
    if (candidate === 'changed-during-admission') await expect(request).rejects.toThrow('correction candidate changed after admission');
    else result = await request;
    expect({ discovery, admissions, launches }).toEqual({ discovery: 1, admissions: 1, launches: candidate === 'unchanged' ? 1 : 0 });
    const [directory] = await readdir(path.join(fixture.root, '.runtime/dev-task'));
    const base = path.join(fixture.root, '.runtime/dev-task', directory);
    expect(JSON.parse(await readFile(path.join(base, 'admission.json'), 'utf8'))).toEqual(reservation);
    const initial = JSON.parse(await readFile(path.join(base, 'launch.json'), 'utf8'));
    const final = JSON.parse(await readFile(path.join(base, 'launch-result.json'), 'utf8'));
    expect(initial.launchOutcome).toBe('unknown');
    expect(final.correctionAdmission).toEqual(initial.correctionAdmission);
    expect(sha256(await readFile(path.join(fixture.root, final.correctionAdmission.path)))).toBe(final.correctionAdmission.sha256);
    const proof = JSON.parse(await readFile(path.join(fixture.root, final.correctionAdmission.path), 'utf8'));
    expect(proof).toMatchObject({ invariantId: 'ownership', records: fixture.records, command: 'fixture-check ownership' });
    const events = (await readFile(path.join(base, 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(events[0]).toMatchObject({ kind: 'budget', decision: 'continue', sequence: 1 });
    if (candidate === 'changed-during-admission') {
      expect(final).toMatchObject({ launchOutcome: 'refused', started: null, error: 'correction candidate changed after admission' });
      expect(events[1]).toMatchObject({ kind: 'failure', sequence: 2, failureClass: 'stale-evidence', outcome: 'unverified' });
      expect(events.some(event => event.kind === 'start')).toBe(false);
    } else {
      expect(final).toMatchObject({ launchOutcome: 'requested', pid: 12345 });
      expect(result.correctionAdmission).toEqual(final.correctionAdmission);
      expect(events[1]).toMatchObject({ kind: 'start', sequence: 2 });
      expect((await checkCorrectionAdmission(result.correctionAdmission, { root: fixture.root })).sourceId).toBe(proof.sourceId);
    }
  });

  it('retains rejected original findings and adjudication provenance without changing reviewer bytes', async () => {
    const fixture = await ledgerFixture();
    const original = await readFile(path.join(fixture.root, fixture.review.pair.result.path), 'utf8');
    await adjudicate(fixture, 'rejected');
    const ledger = await assessReviewLedger(fixture.records, { root: fixture.root });
    expect(ledger).toMatchObject({ ready: true, valid: true, uniqueFindings: 1, unresolved: 0 });
    expect(ledger.findings[0]).toMatchObject({ disposition: 'rejected', observations: ['finding-original'] });
    expect(ledger.records[1]).toMatchObject({ author: 'fixture-author', evidence: [fixture.evidence], reason: 'Retained scoped evidence supports this disposition' });
    expect(await readFile(path.join(fixture.root, fixture.review.pair.result.path), 'utf8')).toBe(original);
    await expect(writeLedgerRecord('.runtime/ledger', fixture.finding, { root: fixture.root, records: [] })).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('counts a linked follow-up once and reopens a previously fixed invariant', async () => {
    const fixture = await ledgerFixture();
    await adjudicate(fixture, 'fixed');
    const followup = await reviewPair(fixture.root, 'followup', { findings: ['R2'] });
    await append(fixture, { ...fixture.finding, id: 'finding-followup', findingId: 'R2', originalId: fixture.finding.id, review: followup.pair });
    const ledger = await assessReviewLedger(fixture.records, { root: fixture.root });
    expect(ledger).toMatchObject({ valid: true, ready: false, uniqueFindings: 1, unresolved: 1 });
    expect(ledger.findings[0].observations).toEqual(['finding-original', 'finding-followup']);
  });

  it.each(['different-symptoms', 'same-symptoms', 'unknown'])('requires diagnosis after two unsuccessful corrections with %s', async shape => {
    const fixture = await ledgerFixture();
    await append(fixture, correction(fixture, 'correction-one', null, shape === 'unknown' ? 'unknown' : 'unsatisfied'));
    await append(fixture, correction(fixture, 'correction-two', 'correction-one', 'unsatisfied', shape === 'different-symptoms' ? 'different-error' : 'failure-one'));
    expect(await assessCorrectionAdmission({ records: fixture.records, invariantId: 'ownership' }, { root: fixture.root })).toMatchObject({ allowed: false, reason: 'two unsuccessful corrections require diagnosis and a discriminating check' });
    await expect(append(fixture, correction(fixture, 'correction-three', 'correction-two'))).rejects.toThrow('two unsuccessful corrections');
    expect((await assessReviewLedger(fixture.records, { root: fixture.root })).ready).toBe(false);
  });

  it('admits third correction only with current successful discriminating receipt and refuses it after source change', async () => {
    const fixture = await ledgerFixture();
    await append(fixture, correction(fixture, 'correction-one', null));
    await append(fixture, correction(fixture, 'correction-two', 'correction-one', 'unknown', 'changed-symptom'));
    const proof = await passingReceipt(fixture.root, 'diagnosis');
    await append(fixture, { version: 1, id: 'diagnosis-one', kind: 'diagnosis', author: 'fixture-author', at: now, evidence: [fixture.evidence], invariantId: 'ownership', command: 'fixture-check ownership', failureSignature: 'changed-symptom', hypothesis: 'Ownership record races process replacement', predecessors: ['correction-one', 'correction-two'], discriminatingCheck: { command: proof.command, receipt: proof.reference } });
    expect(await assessCorrectionAdmission({ records: fixture.records, invariantId: 'ownership' }, { root: fixture.root })).toMatchObject({ allowed: true, reason: 'diagnosed-with-current-discriminating-check' });
    await writeFile(path.join(fixture.root, 'src/A.mjs'), 'source-changed-after-diagnosis');
    expect((await assessCorrectionAdmission({ records: fixture.records, invariantId: 'ownership' }, { root: fixture.root })).allowed).toBe(false);
  });

  it('refuses undiagnosed third correction through both managed task and runner without discovery, admission or execution', async () => {
    const fixture = await ledgerFixture();
    await append(fixture, correction(fixture, 'correction-one', null));
    await append(fixture, correction(fixture, 'correction-two', 'correction-one'));
    const correctionContext = { records: fixture.records, invariantId: 'ownership' };
    const tasksFile = path.join(fixture.root, 'task-routing.md');
    await writeFile(tasksFile, '- [ ] 1.1 Correct ownership invariant\n\n## Model routing\n\n| Task | Role | Model | Effort | Rationale | Escalate when |\n| --- | --- | --- | --- | --- | --- |\n| 1.1 | author | gpt-6.1-sol | high | Known correction | Third unsuccessful correction |\n');
    const plan = { version: 1, objective: 'Bounded correction fixture', sessions: { author: 'fixture-author', workers: [], runs: [] }, startTime: new Date().toISOString(), checkpointCadenceMs: 30000, limits: [{ unit: 'wallMs', value: 60000, closeoutReserve: 5000 }] };
    const usageReport = { sessions: [{ sessionId: 'fixture-author' }], usage: { input: 0, cachedInput: 0, output: 0, reasoning: 0 }, coverage: { aggregate: true, complete: true } };
    let discovery = 0; let launch = 0; let admissions = 0; let executions = 0; let preflights = 0;
    await expect(selectTask({ root: fixture.root, tasksFile, taskId: '1.1', start: true, plan, usageReport, correction: correctionContext }, { discover: () => { discovery++; throw new Error('must not discover'); }, launch: () => { launch++; throw new Error('must not launch'); }, admit: () => { admissions++; throw new Error('must not admit'); } })).rejects.toThrow('corrective admission refused');
    const command = JSON.stringify(['fixture-executable', '--ownership']);
    const { assignment } = await prepareContract({ ...authorInput('verification', 'C1', ['src/A.mjs']), checks: [{ id: 'T1', command, expected: 'Scoped fixture succeeded' }], allowedActions: ['Execute this manifest within declared effects and resources'] }, fixture.root);
    const manifest = { version: 1, change: 'fixture-change', slice: 'C', candidate: 'third-correction', owner: 'fixture-worker', criteria: ['C1'], resources: [], plan, usageReport, cleanupReserveMs: 1000, tools: { node: process.version, assertion: 'fixture-correction-v1' }, correction: correctionContext, checks: [{ id: 'check-one', assignmentCheckId: 'T1', command: 'fixture-executable', args: ['--ownership'], dependsOn: [], criteria: ['C1'], resources: [], effects: 'none', timeoutMs: 1000, freshRequired: false, inputs: [{ path: 'src/A.mjs', kind: 'source' }], observation: 'exit', observationVersion: 'v1', configIdentity: 'v1' }] };
    const report = await executeManifest(manifest, assignment, { root: fixture.root, status() {}, dependencies: { execute: () => { executions++; throw new Error('must not execute'); }, preflight: () => { preflights++; throw new Error('must not preflight'); } } });
    expect(report.passed).toBe(false);
    expect(report.admissions).toBe(0);
    expect(report.results[0]).toMatchObject({ status: 'blocked', outcome: 'unverified' });
    expect(report.results[0].reason).toContain('two unsuccessful corrections');
    expect(report.criteria[0].outcome).toBe('unverified');
    expect({ discovery, launch, admissions, executions, preflights }).toEqual({ discovery: 0, launch: 0, admissions: 0, executions: 0, preflights: 0 });
  });

  it.each(['bad-predecessor', 'missing-reason', 'missing-original', 'corrupt-evidence', 'path-escape'])('refuses invalid retained lineage %s', async invalid => {
    const fixture = await ledgerFixture();
    const row = correction(fixture, 'invalid-correction', null);
    if (invalid === 'bad-predecessor') row.predecessorId = 'absent';
    else if (invalid === 'missing-reason') row.rerunReason = null;
    else if (invalid === 'missing-original') row.originalId = 'absent';
    else if (invalid === 'corrupt-evidence') row.evidence = [{ ...fixture.evidence, sha256: '0'.repeat(64) }];
    else row.evidence = [{ path: '../outside.json', sha256: '0'.repeat(64) }];
    await expect(append(fixture, row)).rejects.toThrow();
    expect((await assessReviewLedger(fixture.records, { root: fixture.root })).uniqueFindings).toBe(1);
  });

  it('executes production ledger record/assess/admit CLI with original evidence and no inference', async () => {
    const fixture = await ledgerFixture();
    const row = { version: 1, id: 'cli-adjudication', kind: 'adjudication', author: 'fixture-author', at: now, evidence: [fixture.evidence], originalId: fixture.finding.id, invariantId: 'ownership', disposition: 'rejected', reason: 'Discriminating local evidence rejects the claim' };
    await json(fixture.root, '.runtime/record-input.json', { directory: '.runtime/ledger', record: row, records: fixture.records });
    const script = path.resolve('scripts/dev/review-ledger.mjs');
    const recorded = await execute(process.execPath, [script, 'record', '--input', '.runtime/record-input.json'], { cwd: fixture.root });
    fixture.records.push(JSON.parse(recorded.stdout));
    await json(fixture.root, '.runtime/ledger-input.json', { records: fixture.records, invariantId: 'ownership', command: 'fixture-check ownership', inputs: [{ path: 'src/A.mjs', kind: 'source' }] });
    expect(JSON.parse((await execute(process.execPath, [script, 'assess', '--input', '.runtime/ledger-input.json'], { cwd: fixture.root })).stdout)).toMatchObject({ ready: true, uniqueFindings: 1 });
    expect(JSON.parse((await execute(process.execPath, [script, 'admit', '--input', '.runtime/ledger-input.json'], { cwd: fixture.root })).stdout)).toMatchObject({ allowed: true });
  });

  it.each(['matching', 'different-hash', 'unreviewed-followup', 'changed-after-followup'])('retains fix-only coverage only with exact hashes and independent reviewed follow-up: %s', async state => {
    const root = await temporary();
    const evidence = await json(root, '.runtime/coverage-proof.json', { reviewed: true });
    const original = await reviewPair(root, 'coverage-original', { paths: ['src/A.mjs', 'src/unchanged.mjs'] });
    if (state === 'different-hash') await writeFile(path.join(root, 'src/unchanged.mjs'), 'changed-unaffected-source');
    const followup = await reviewPair(root, 'coverage-followup', { paths: ['src/A.mjs', 'src/unchanged.mjs'] });
    if (state === 'unreviewed-followup') { followup.result.scope[1].status = 'unreviewed'; followup.pair.result = await json(root, '.runtime/coverage-followup/review-result.json', followup.result); }
    if (state === 'changed-after-followup') await writeFile(path.join(root, 'src/unchanged.mjs'), 'new-change-after-both-reviews');
    const row = { version: 1, id: 'coverage-record', kind: 'coverage', author: 'fixture-author', at: now, evidence: [evidence], review: original.pair, followup: followup.pair, unaffectedPaths: ['src/unchanged.mjs'] };
    if (state === 'matching' || state === 'changed-after-followup') {
      const reference = await writeLedgerRecord('.runtime/ledger', row, { root });
      const ledger = await assessReviewLedger([reference], { root });
      expect(ledger.valid).toBe(true);
      expect(ledger.ready).toBe(state === 'matching');
      if (state === 'changed-after-followup') expect(ledger.readinessErrors.length).toBeGreaterThan(0);
    } else await expect(writeLedgerRecord('.runtime/ledger', row, { root })).rejects.toThrow();
  });
});
