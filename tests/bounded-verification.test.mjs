import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commandIdentity, executeManifest, validateManifest } from '../scripts/dev/verification.mjs';
import { assessReuse, checkIdentity, fingerprintInputs, fingerprintOutputs, writeReceipt } from '../scripts/dev/receipts.mjs';
import { acquireResource, availablePort, probePreflight, releaseResource, waitObservation } from '../scripts/dev/resources.mjs';
import { admitWork, assertionSummary } from '../scripts/dev/admission.mjs';
import { prepareContract, summarizeContract } from '../scripts/dev/contract.mjs';
import { checkResultEvidence, validateContract } from '../scripts/check-agent-contract.mjs';
import { assessChangeReadiness } from '../scripts/dev/change-readiness.mjs';
import { selectTask } from '../scripts/dev/task.mjs';
import { readEvents } from '../scripts/dev/events.mjs';
import { selectOwnedProcesses, stopOwnedRoot } from '../scripts/dev/game-processes.ts';
import { sha256 } from '../scripts/dev/safe-artifacts.mjs';

const roots = [];
const execute = promisify(execFile);
const zero = { input: 0, cachedInput: 0, output: 0, reasoning: 0 };
const processOwner = { pid: 12345, startedAt: 'fixture-start-one' };
const tools = { node: 'fixture-node-24', assertion: 'fixture-assertion-v1' };
const inputPaths = [{ path: 'source.txt', kind: 'source' }];
const plan = () => ({ version: 1, objective: 'bounded verification fixture', sessions: { author: 'fixture-author', workers: [], runs: [] }, startTime: new Date().toISOString(), checkpointCadenceMs: 100000, limits: [{ unit: 'tokens', value: 1000, closeoutReserve: 100 }] });
const usageReport = () => ({ sessions: [{ sessionId: 'fixture-author' }], usage: { ...zero }, coverage: { complete: true, aggregate: true } });
const check = (id, extra = {}) => ({ id, assignmentCheckId: `assigned-${id}`, command: 'fixture-executable', args: ['--fixture', id], dependsOn: [], criteria: ['C1'], resources: [], effects: 'none', timeoutMs: 1000, freshRequired: false, inputs: inputPaths, observation: 'exit', observationVersion: 'fixture-observation-v1', configIdentity: 'fixture-config-v1', ...extra });
async function temporary() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'af-bounded-verification-'));
  roots.push(root);
  await writeFile(path.join(root, 'source.txt'), 'source-original', 'utf8');
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function packet(checks = [check('one')], extra = {}) {
  const root = await temporary();
  const manifest = { version: 1, change: 'fixture-change', slice: 'B', candidate: 'fixture-candidate', owner: 'fixture-worker', criteria: [...new Set(checks.flatMap(row => row.criteria))], checks, resources: [], plan: plan(), usageReport: usageReport(), cleanupReserveMs: 1000, tools, ...extra };
  const assignedChecks = checks.map(row => ({ id: row.assignmentCheckId, command: commandIdentity(row), expected: 'Successful declared fixture observation' }));
  for (const resource of manifest.resources) for (const [index, cleanup] of resource.cleanup.entries()) assignedChecks.push({ id: `cleanup-${resource.id}-${index}`, command: commandIdentity(cleanup), expected: 'Exact owned cleanup complete' });
  const { assignment } = await prepareContract({ role: 'verification', objective: 'Verify fake runner behavior without game/provider', criteria: manifest.criteria.map(id => ({ id, description: `Required criterion ${id}` })), revision: 'fixture-revision', sourcePaths: ['source.txt'], scope: [{ path: 'source.txt', boundary: 'whole fixture' }], checks: assignedChecks, allowedActions: ['Execute this manifest within declared effects and resources'], additionalChecks: 'forbidden', resources: manifest.resources.map(resource => ({ id: resource.id, owner: manifest.owner, cleanup: 'Exact fixture cleanup' })), budget: { timeSeconds: 60, providerCalls: 0 }, stopConditions: ['Stop on unknown effects or source changes'], returnConditions: ['Return all criterion outcomes'], outputRoot: '.runtime/contracts' }, root);
  return { root, manifest, assignment };
}
function fakeExecution({ fail = [], interrupt = [], observe, onExecute } = {}) {
  const calls = [];
  return { calls, dependencies: {
    execute: async (step, evidence, cleanupMode) => {
      calls.push({ step, cleanupMode });
      await mkdir(evidence, { recursive: true });
      const log = path.join(evidence, 'output.log');
      await writeFile(log, 'sanitized fixture execution evidence', 'utf8');
      await onExecute?.(step);
      const interrupted = interrupt.includes(step.name);
      const exit = interrupted ? null : fail.includes(step.name) ? 4 : 0;
      return { passed: exit === 0, results: [{ exit, interrupted, log }] };
    },
    ...(observe ? { observe } : {}),
  } };
}
const run = (input, fake, extra = {}) => executeManifest(input.manifest, input.assignment, { root: input.root, status() {}, dependencies: fake.dependencies, ...extra });

describe('independently authorized manifest execution', () => {
  it('requires independent valid assignment argv authority before any effects', async () => {
    const input = await packet();
    expect(validateManifest(input.manifest, input.assignment)).toBe(input.manifest);
    const fake = fakeExecution();
    await expect(executeManifest(input.manifest, null, { root: input.root, dependencies: fake.dependencies })).rejects.toThrow('author-approved');
    const changed = structuredClone(input.manifest);
    changed.checks[0].args.push('--unapproved');
    expect(() => validateManifest(changed, input.assignment)).toThrow('unauthorized argv');
    expect(() => validateManifest(input.manifest, { ...input.assignment, assignmentId: null })).toThrow('invalid author assignment');
    expect(fake.calls).toEqual([]);
  });

  it('passes each argument literally to injected execution and strips secret environment variables', async () => {
    const input = await packet([check('literal', { args: ['space separated', '$(not-a-shell)', ';touch-never', '"quoted"'] })]);
    const fake = fakeExecution();
    const report = await run(input, fake);
    expect(report.passed).toBe(true);
    expect(fake.calls[0].step.args).toEqual(input.manifest.checks[0].args);
    expect(Object.keys(fake.calls[0].step.env).some(key => /API_KEY|AUTH_TOKEN|ACCESS_TOKEN/.test(key))).toBe(false);
    expect(report).toMatchObject({ providerCalls: 0, admissions: 1, criteria: [{ id: 'C1', outcome: 'pass' }] });
  });

  it('skips failed prerequisites and leaves shared and dependent criteria unverified', async () => {
    const input = await packet([check('passing'), check('failing', { dependsOn: ['passing'] }), check('dependent', { dependsOn: ['failing'], criteria: ['C1', 'C2'] })]);
    const fake = fakeExecution({ fail: ['failing'] });
    const report = await run(input, fake);
    expect(fake.calls.map(call => call.step.name)).toEqual(['passing', 'failing']);
    expect(report.passed).toBe(false);
    expect(report.results.find(row => row.id === 'dependent')).toMatchObject({ status: 'skipped', outcome: 'unverified' });
    expect(report.criteria).toEqual([{ id: 'C1', outcome: 'unverified' }, { id: 'C2', outcome: 'unverified' }]);
  });

  it('deduplicates identical checks with immutable evidence and identical criterion coverage', async () => {
    const input = await packet([check('first', { args: ['--same'], criteria: ['C1'] }), check('second', { args: ['--same'], criteria: ['C2'], dependsOn: ['first'] })]);
    const fake = fakeExecution();
    const report = await run(input, fake);
    expect(report.passed).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(report.results.map(row => row.status)).toEqual(['executed', 'reused']);
    expect(report.results[1].receipt).toEqual(report.results[0].receipt);
    expect(report.criteria).toEqual([{ id: 'C1', outcome: 'pass' }, { id: 'C2', outcome: 'pass' }]);
  });

  it('executes a declared fresh check even with identical passing retained evidence', async () => {
    const input = await packet([check('first', { args: ['--same'] }), check('fresh', { args: ['--same'], freshRequired: true, dependsOn: ['first'] })]);
    const fake = fakeExecution();
    const report = await run(input, fake);
    expect(report.passed).toBe(true);
    expect(fake.calls).toHaveLength(2);
    expect(report.results.map(row => row.status)).toEqual(['executed', 'executed']);
  });

  it('prefers the new same-run receipt over stale retained hints shared by sibling checks', async () => {
    const input = await packet([check('first', { args: ['--same'], criteria: ['C1'] }), check('second', { args: ['--same'], criteria: ['C2'], dependsOn: ['first'] })]);
    const baseline = await run(input, fakeExecution());
    expect(baseline.passed).toBe(true);
    const stale = baseline.results[0].receipt;
    input.manifest.checks.forEach(row => { row.retainedReceipt = stale; });
    input.manifest.candidate = 'changed-source-candidate';
    await writeFile(path.join(input.root, 'source.txt'), 'changed-once');
    const original = input.assignment;
    const prepared = await prepareContract({ role: original.role, objective: original.objective, criteria: original.criteria, revision: 'changed-source-revision', sourcePaths: ['source.txt'], scope: original.scope, checks: original.checks, allowedActions: original.allowedActions, additionalChecks: original.additionalChecks, resources: original.resources, budget: original.budget, stopConditions: original.stopConditions, returnConditions: original.returnConditions }, input.root);
    input.assignment = prepared.assignment;
    const fake = fakeExecution();
    const candidate = await run(input, fake);
    expect(candidate.passed).toBe(true);
    expect(fake.calls.map(call => call.step.name)).toEqual(['first']);
    expect(candidate.results.map(row => row.status)).toEqual(['executed', 'reused']);
    expect(candidate.results[1].receipt).toEqual(candidate.results[0].receipt);
    expect(candidate.results[0].receipt.path).not.toBe(stale.path);
    expect(candidate.criteria).toEqual([{ id: 'C1', outcome: 'pass' }, { id: 'C2', outcome: 'pass' }]);
  });

  it('does not accept an exit-zero check without its required observation', async () => {
    const input = await packet([check('missing', { observation: { path: '.runtime/absent.json', truthyFields: ['passed'] } })]);
    const fake = fakeExecution();
    const report = await run(input, fake);
    expect(report.passed).toBe(false);
    expect(report.results[0]).toMatchObject({ exit: 0, outcome: 'fail', observed: { passed: false, kind: 'unknown-observation' } });
    expect(report.criteria[0].outcome).toBe('unverified');
  });

  it('blocks a fresh check pointing at an old positive observation before execution or admission', async () => {
    const observationPath = '.runtime/old-positive.json';
    const input = await packet([check('fresh', { freshRequired: true, observation: { path: observationPath, truthyFields: ['passed'] } })]);
    const originalBytes = '{"passed":true,"run":"older-candidate"}\n';
    await writeFile(path.join(input.root, observationPath), originalBytes);
    const fake = fakeExecution();
    let preflights = 0;
    fake.dependencies.preflight = () => { preflights++; };
    const report = await run(input, fake);
    expect(report.passed).toBe(false);
    expect(report.admissions).toBe(0);
    expect(report.results[0]).toMatchObject({ status: 'blocked', outcome: 'unverified', reason: 'fresh-observation-destination-already-exists' });
    expect(report.results[0].receipt).toBeUndefined();
    expect(report.criteria).toEqual([{ id: 'C1', outcome: 'unverified' }]);
    expect(fake.calls).toEqual([]);
    expect(preflights).toBe(0);
    expect(await readFile(path.join(input.root, observationPath), 'utf8')).toBe(originalBytes);
    await expect(readFile(path.join(input.root, report.directory, 'fresh/receipt.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('accepts a new observation destination only after the current writer supplies all required fields', async () => {
    const observationPath = '.runtime/current-observation.json';
    const input = await packet([check('fresh-writer', { freshRequired: true, observation: { path: observationPath, truthyFields: ['passed', 'complete'] } })]);
    const fake = fakeExecution({ onExecute: () => writeFile(path.join(input.root, observationPath), '{"passed":true,"complete":true}') });
    const report = await run(input, fake);
    expect(report.passed).toBe(true);
    expect(fake.calls.map(call => call.step.name)).toEqual(['fresh-writer']);
    expect(report.results[0]).toMatchObject({ status: 'executed', exit: 0, outcome: 'pass', observed: { passed: true, kind: 'recorded-observation', evidence: observationPath } });
    expect(report.results[0].evidence).toContain(observationPath);
    const receipt = JSON.parse(await readFile(path.join(input.root, report.results[0].receipt.path), 'utf8'));
    expect(receipt.identity.observation).toEqual({ path: observationPath, truthyFields: ['complete', 'passed'] });
    expect(receipt.evidence).toContainEqual({ path: observationPath, sha256: sha256('{"passed":true,"complete":true}') });
  });

  it('invalidates source modified during execution and refuses admission on a stale assignment', async () => {
    const input = await packet();
    const fake = fakeExecution({ onExecute: () => writeFile(path.join(input.root, 'source.txt'), 'changed-during-check') });
    const report = await run(input, fake);
    expect(report.passed).toBe(false);
    expect(report.results[0]).toMatchObject({ sourceStable: false, outcome: 'fail' });
    expect(report.results[0].receipt).toBeUndefined();
    await expect(run(input, fake)).rejects.toThrow('assignment source changed');
    expect(fake.calls).toHaveLength(1);
  });

  it('retains interruption as unknown and never retries its dependent effect', async () => {
    const input = await packet([check('interrupted'), check('dependent', { dependsOn: ['interrupted'] })]);
    const fake = fakeExecution({ interrupt: ['interrupted'] });
    const report = await run(input, fake);
    expect(report.passed).toBe(false);
    expect(report.results[0]).toMatchObject({ outcome: 'unknown', exit: null });
    expect(report.results[1].status).toBe('skipped');
    expect(fake.calls).toHaveLength(1);
  });

  it('stops budget admission before execution while preserving unverified criteria', async () => {
    const input = await packet();
    input.manifest.usageReport.usage.input = 950;
    const fake = fakeExecution();
    const report = await run(input, fake);
    expect(report.passed).toBe(false);
    expect(report.results[0]).toMatchObject({ status: 'blocked', outcome: 'unverified' });
    expect(report.criteria[0].outcome).toBe('unverified');
    expect(fake.calls).toHaveLength(0);
  });

  it('requires resource and source-matched fake prerequisite for effectful authority', async () => {
    const input = await packet();
    input.manifest.checks[0].effects = 'game';
    expect(() => validateManifest(input.manifest, input.assignment)).toThrow('owned resources');
    input.manifest.checks[0].effects = 'none';
    input.manifest.checks[0].env = { PRIVATE_SECRET: 'forbidden' };
    expect(() => validateManifest(input.manifest, input.assignment)).toThrow('allowlist');
  });

  async function resourcePacket(extraChecks = []) {
    const resource = { id: 'isolated-profile', cleanup: [{ command: 'fixture-cleanup', args: ['--exact-profile'] }] };
    return packet([
      check('fake-composition'),
      check('effect', { effects: 'game', resources: [resource.id], dependsOn: ['fake-composition'], observation: { path: '.runtime/observed.json', truthyFields: ['passed'] }, preflight: { fakeCheckId: 'fake-composition', timeoutMs: 100, intervalMs: 10, paths: ['.runtime/profile'], ports: [{ number: 12345, protocol: 'tcp' }] } }),
      ...extraChecks,
    ], { resources: [resource] });
  }
  function ownedDependencies(input, fake, release = async () => {}) {
    fake.dependencies.acquire = (resource, owner) => acquireResource(resource, owner, { root: input.root, identify: async () => processOwner });
    fake.dependencies.release = async lease => { await release(lease); await releaseResource(lease, { identify: async () => processOwner }); };
    fake.dependencies.preflight = input => { expect(input.fakeCompositionPassed).toBe(true); expect(input.fakeCompositionSourceMatched).toBe(true); };
    fake.dependencies.observe = async () => ({ passed: true });
  }
  async function expectCleanupEvidence(input, cleanup) {
    expect(cleanup.evidence).toHaveLength(1);
    expect(cleanup.checks).toEqual([{ command: commandIdentity(input.manifest.resources[0].cleanup[0]), exit: 0, passed: true, evidence: cleanup.evidence }]);
    expect(await readFile(path.join(input.root, cleanup.evidence[0]), 'utf8')).toBe('sanitized fixture execution evidence');
  }

  it('uses reserved cleanup after an interrupted owned effect and preserves unknown outcome without replay', async () => {
    const input = await resourcePacket([check('dependent', { dependsOn: ['effect'] })]);
    const fake = fakeExecution({ interrupt: ['effect'] });
    ownedDependencies(input, fake);
    const report = await run(input, fake);
    expect(report.passed).toBe(false);
    expect(report.results.find(row => row.id === 'effect').outcome).toBe('unknown');
    expect(report.results.find(row => row.id === 'dependent').status).toBe('skipped');
    expect(fake.calls.map(call => call.step.name)).toEqual(['fake-composition', 'effect', 'cleanup-0']);
    expect(fake.calls.at(-1)).toMatchObject({ cleanupMode: true, step: { command: 'fixture-cleanup', args: ['--exact-profile'] } });
    expect(fake.calls.at(-1).step.timeoutMs).toBeGreaterThan(0);
    expect(fake.calls.at(-1).step.timeoutMs).toBeLessThanOrEqual(input.manifest.cleanupReserveMs);
    expect(report.cleanup).toMatchObject([{ id: 'isolated-profile', resolved: true }]);
    await expectCleanupEvidence(input, report.cleanup[0]);
    await expect(readFile(path.join(input.root, '.runtime/development/locks/isolated-profile.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reserves cleanup after budget refuses the next admission without authorizing another effect', async () => {
    const input = await resourcePacket([check('later', { dependsOn: ['effect'], args: ['--new'] })]);
    const fake = fakeExecution({ onExecute: step => { if (step.name === 'effect') input.manifest.usageReport.usage.input = 950; } });
    ownedDependencies(input, fake);
    const report = await run(input, fake);
    expect(report.passed).toBe(false);
    expect(report.results.find(row => row.id === 'later')).toMatchObject({ status: 'blocked', outcome: 'unverified' });
    expect(fake.calls.map(call => call.step.name)).toEqual(['fake-composition', 'effect', 'cleanup-0']);
    expect(report.cleanup).toMatchObject([{ id: 'isolated-profile', resolved: true }]);
    await expectCleanupEvidence(input, report.cleanup[0]);
  });

  it.each(['cleanup-exception', 'changed-process'])('retains unresolved %s and writes a truthful report while holding the lease', async failure => {
    const input = await resourcePacket();
    const fake = fakeExecution({ onExecute: step => { if (step.name === 'cleanup-0' && failure === 'cleanup-exception') throw new Error('fixture cleanup failure'); } });
    ownedDependencies(input, fake, async lease => {
      if (failure === 'changed-process') await releaseResource(lease, { identify: async () => ({ ...processOwner, startedAt: 'replacement' }) });
    });
    const report = await run(input, fake);
    expect(report.passed).toBe(false);
    expect(report.cleanup).toMatchObject([{ id: 'isolated-profile', resolved: false }]);
    if (failure === 'cleanup-exception') expect(report.cleanup[0]).toMatchObject({ evidence: [], checks: [] });
    else await expectCleanupEvidence(input, report.cleanup[0]);
    expect(report.results.find(row => row.id === 'effect').receipt).toBeUndefined();
    expect(JSON.parse(await readFile(path.join(input.root, report.directory, 'results.json'), 'utf8')).passed).toBe(false);
    expect(JSON.parse(await readFile(path.join(input.root, '.runtime/development/locks/isolated-profile.json'), 'utf8')).owner).toBe('fixture-worker');
  });

  it.each([false, true])('requires reconciliation for an invalid retained effect receipt unless explicitly freshRequired=%s', async freshRequired => {
    const input = await resourcePacket();
    const effect = input.manifest.checks.find(row => row.id === 'effect');
    effect.retainedReceipt = { path: '.runtime/receipts/invalid.json', sha256: '0'.repeat(64) };
    effect.freshRequired = freshRequired;
    const fake = fakeExecution();
    ownedDependencies(input, fake);
    const report = await run(input, fake);
    if (!freshRequired) {
      expect(report.passed).toBe(false);
      expect(report.results.find(row => row.id === 'effect')).toMatchObject({ status: 'blocked', outcome: 'unverified', reason: 'reuse-refused-reconciliation-required:unknown-or-unreadable-evidence' });
      expect(fake.calls.map(call => call.step.name)).toEqual(['fake-composition']);
      expect(report.cleanup).toMatchObject([{ id: 'isolated-profile', resolved: true, evidence: [], checks: [] }]);
    } else {
      expect(report.passed).toBe(true);
      expect(report.results.find(row => row.id === 'effect')).toMatchObject({ status: 'executed', outcome: 'pass' });
      expect(fake.calls.map(call => call.step.name)).toEqual(['fake-composition', 'effect', 'cleanup-0']);
      await expectCleanupEvidence(input, report.cleanup[0]);
    }
  });

  it('generates a ready v2 result with original reuse evidence and no fabricated current exit', async () => {
    const input = await packet([check('first', { args: ['--same'], criteria: ['C1'] }), check('second', { args: ['--same'], criteria: ['C2'], dependsOn: ['first'] })]);
    const manifestPath = '.runtime/approved-manifest.json';
    await writeFile(path.join(input.root, manifestPath), JSON.stringify(input.manifest));
    const original = input.assignment;
    const prepared = await prepareContract({ version: 2, execution: { manifestSha256: sha256(JSON.stringify(input.manifest)), reusePolicy: 'matching-receipt-only' }, role: original.role, objective: original.objective, criteria: original.criteria, revision: original.source.revision, sourcePaths: ['source.txt', manifestPath], scope: original.scope, checks: original.checks, allowedActions: original.allowedActions, additionalChecks: original.additionalChecks, resources: original.resources, budget: original.budget, stopConditions: original.stopConditions, returnConditions: original.returnConditions }, input.root);
    input.assignment = prepared.assignment;
    const fake = fakeExecution();
    const report = await run(input, fake);
    expect(report.passed).toBe(true);
    expect(fake.calls).toHaveLength(1);
    const result = JSON.parse(await readFile(path.join(input.root, report.directory, 'contract-result.json'), 'utf8'));
    expect(validateContract(input.assignment, result)).toMatchObject({ valid: true, ready: true });
    expect(await checkResultEvidence(input.assignment, result, input.root)).toEqual([]);
    expect(await summarizeContract(input.assignment, result, input.root)).toMatchObject({ structurallyValid: true, ready: true });
    expect(result.checks[0]).toMatchObject({ status: 'executed', exit: 0, reuse: null });
    expect(result.checks[1]).toMatchObject({ status: 'reused', exit: null, outcome: 'pass', evidence: result.checks[0].evidence, reuse: { receipt: report.results[0].receipt, criteria: ['C2'], freshRequired: false } });
  });
});

describe('immutable dependency and evidence receipts', () => {
  async function retained() {
    const root = await temporary();
    await mkdir(path.join(root, '.runtime/evidence'), { recursive: true });
    await writeFile(path.join(root, '.runtime/evidence/result.json'), '{"passed":true}');
    const identity = checkIdentity(check('original'), await fingerprintInputs(root, inputPaths), tools);
    const input = { identity, outcome: 'pass', observed: true, sourceStable: true, cleanup: 'completed', evidence: ['.runtime/evidence/result.json'] };
    const reference = await writeReceipt('.runtime/receipts/check.json', input, { root });
    return { root, identity, input, reference };
  }

  it('keeps receipt bytes immutable and ignores unrelated reporting changes', async () => {
    const input = await retained();
    const before = await readFile(path.join(input.root, input.reference.path), 'utf8');
    await writeFile(path.join(input.root, 'report-renderer.txt'), 'report-only-change');
    expect(await assessReuse(input.reference, input.identity, { root: input.root })).toMatchObject({ reusable: true });
    await expect(writeReceipt(input.reference.path, input.input, { root: input.root })).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(path.join(input.root, input.reference.path), 'utf8')).toBe(before);
  });

  it.each(['source', 'evidence', 'receipt'])('refuses modified %s content without rewriting historical receipts', async target => {
    const input = await retained();
    const file = target === 'source' ? 'source.txt' : target === 'evidence' ? '.runtime/evidence/result.json' : input.reference.path;
    await writeFile(path.join(input.root, file), 'changed');
    const result = await assessReuse(input.reference, input.identity, { root: input.root });
    expect(result.reusable).toBe(false);
    expect(result.reason).toBe(target === 'source' ? 'current-dependency-change' : `${target}-integrity-mismatch`);
  });

  it.each(['args', 'configIdentity', 'tools', 'observationVersion', 'criteria'])('refuses changed %s identity', async field => {
    const input = await retained();
    const identity = structuredClone(input.identity);
    if (field === 'args') identity.args.push('--changed');
    else if (field === 'tools') identity.tools.node = 'changed-tool';
    else if (field === 'criteria') identity.criteria.push('new-criterion');
    else identity[field] = 'changed-identity';
    expect(await assessReuse(input.reference, identity, { root: input.root })).toMatchObject({ reusable: false, reason: 'dependency-command-config-tool-or-observation-change' });
  });

  it('refuses fresh requirements, missing dependency boundaries and unresolved cleanup', async () => {
    const input = await retained();
    expect(await assessReuse(input.reference, input.identity, { root: input.root, freshRequired: true })).toMatchObject({ reusable: false, reason: 'fresh-run-required' });
    await expect(fingerprintInputs(input.root, [])).rejects.toThrow('unknown dependency');
    await expect(writeReceipt('.runtime/receipts/invalid.json', { ...input.input, cleanup: 'unresolved' }, { root: input.root })).rejects.toThrow('incomplete evidence');
    const corrupt = { ...input.reference.receipt, cleanup: 'unresolved' };
    const bytes = JSON.stringify(corrupt);
    await writeFile(path.join(input.root, input.reference.path), bytes);
    expect(await assessReuse({ path: input.reference.path, sha256: sha256(bytes) }, input.identity, { root: input.root })).toMatchObject({ reusable: false, reason: 'incomplete-outcome-or-cleanup' });
  });

  it('refuses legacy receipt identities without an actual observation declaration', async () => {
    const input = await retained();
    const legacyIdentity = structuredClone(input.identity);
    delete legacyIdentity.observation;
    const legacy = await writeReceipt('.runtime/receipts/legacy-observation.json', { ...input.input, identity: legacyIdentity }, { root: input.root });
    expect(await assessReuse(legacy, legacyIdentity, { root: input.root })).toMatchObject({ reusable: false, reason: 'observation-declaration-unknown' });
    expect((await assessReuse(legacy, input.identity, { root: input.root })).reusable).toBe(false);
    expect(() => checkIdentity({ ...check('unknown'), observation: { path: '.runtime/no-fields.json', truthyFields: [] } }, input.identity.dependencies, tools)).toThrow('unknown observation declaration');
  });

  it('confines evidence/dependency paths including a junction escape', async () => {
    const input = await retained();
    await expect(fingerprintInputs(input.root, [{ path: '../source.txt', kind: 'source' }])).rejects.toThrow('invalid dependency');
    await expect(writeReceipt('.runtime/receipts/outside.json', { ...input.input, evidence: ['../private.json'] }, { root: input.root })).rejects.toThrow('beneath .runtime');
    const outside = await temporary();
    await symlink(outside, path.join(input.root, 'outside-link'), 'junction');
    await expect(fingerprintInputs(input.root, [{ path: 'outside-link/source.txt', kind: 'source' }])).rejects.toThrow('escapes workspace');
  });

  it.each(['mutation', 'addition', 'deletion'])('refuses generated output %s under a declared output root', async change => {
    const input = await retained();
    await mkdir(path.join(input.root, 'dist/nested'), { recursive: true });
    await writeFile(path.join(input.root, 'dist/nested/built.js'), 'built-original');
    const outputs = await fingerprintOutputs(input.root, ['dist']);
    expect(outputs).toEqual([{ path: 'dist/nested/built.js', kind: 'build', sha256: sha256('built-original') }]);
    const identity = checkIdentity({ ...check('built'), outputRoots: ['dist'], outputs }, await fingerprintInputs(input.root, inputPaths), tools);
    const reference = await writeReceipt('.runtime/receipts/built.json', { ...input.input, identity }, { root: input.root });
    expect((await assessReuse(reference, identity, { root: input.root })).reusable).toBe(true);
    if (change === 'mutation') await writeFile(path.join(input.root, 'dist/nested/built.js'), 'built-modified');
    else if (change === 'addition') await writeFile(path.join(input.root, 'dist/new.js'), 'new-file');
    else await rm(path.join(input.root, 'dist/nested/built.js'));
    expect(await assessReuse(reference, identity, { root: input.root })).toMatchObject({ reusable: false, reason: 'build-output-change-or-unknown' });
  });

  it('rehashes an explicitly declared installed game file before reusing its receipt', async () => {
    const input = await retained();
    const installedRoot = await temporary();
    const installedGameFile = path.join(installedRoot, 'installed-game.dat');
    await writeFile(installedGameFile, 'installed-game-original');
    const declaredTools = { ...tools, files: [{ path: installedGameFile, sha256: sha256('installed-game-original') }] };
    const identity = checkIdentity(check('installed-game'), await fingerprintInputs(input.root, inputPaths), declaredTools);
    const reference = await writeReceipt('.runtime/receipts/installed-game.json', { ...input.input, identity }, { root: input.root });
    expect((await assessReuse(reference, identity, { root: input.root })).reusable).toBe(true);
    await writeFile(installedGameFile, 'installed-game-modified');
    expect((await assessReuse(reference, identity, { root: input.root })).reusable).toBe(false);
  });
});

describe('v2 reused evidence through contract consumers', () => {
  const resultFor = (assignment, checks) => ({ version: assignment.version, assignmentId: assignment.assignmentId, role: 'verification', summary: 'Original fixture evidence reused with integrity proof', disposition: 'returned', source: { ...assignment.source, stable: true }, limits: [], model: { requested: 'fixture / no-inference', observed: null, usage: { providerCalls: 0, totalTokens: 0 } }, cleanup: [], criteria: [{ id: 'C1', status: 'pass', observation: 'Original scoped fixture criterion passed', evidence: ['.runtime/evidence/result.json'], checks: ['assigned-one'] }], checks });
  async function contractFixture(observation = 'exit') {
    const input = await packet();
    await mkdir(path.join(input.root, '.runtime/evidence'), { recursive: true });
    await writeFile(path.join(input.root, '.runtime/evidence/result.json'), '{"passed":true}');
    const identity = checkIdentity({ ...check('one'), observation }, await fingerprintInputs(input.root, inputPaths), tools);
    const reference = await writeReceipt('.runtime/receipts/original.json', { identity, outcome: 'pass', observed: true, sourceStable: true, cleanup: 'completed', evidence: ['.runtime/evidence/result.json'] }, { root: input.root });
    const { assignment } = await prepareContract({ version: 2, execution: null, role: 'verification', objective: 'Validate immutable reused evidence', criteria: input.assignment.criteria, revision: 'fixture-revision', sourcePaths: ['source.txt', reference.path], scope: input.assignment.scope, checks: input.assignment.checks, allowedActions: input.assignment.allowedActions, additionalChecks: 'forbidden', resources: [], budget: input.assignment.budget, stopConditions: input.assignment.stopConditions, returnConditions: input.assignment.returnConditions }, input.root);
    const reused = { id: 'assigned-one', command: commandIdentity(check('one')), authorization: null, status: 'reused', exit: null, outcome: 'pass', observation: 'Validated original fixture receipt', evidence: ['.runtime/evidence/result.json'], reuse: { receipt: { path: reference.path, sha256: reference.sha256 }, identity, criteria: ['C1'], freshRequired: false } };
    const result = resultFor(assignment, [reused]);
    await writeFile(path.join(input.root, '.runtime/assignment.json'), JSON.stringify(assignment));
    await writeFile(path.join(input.root, '.runtime/result.json'), JSON.stringify(result));
    return { ...input, assignment, result, reference, identity };
  }

  async function readinessManifest(fixture) {
    const { assignment: review } = await prepareContract({ role: 'review', objective: 'Independent fixture review', criteria: fixture.assignment.criteria, revision: 'fixture-revision', sourcePaths: ['source.txt'], scope: fixture.assignment.scope, checks: [], allowedActions: ['Read source and original evidence'], additionalChecks: 'forbidden', resources: [], budget: { timeSeconds: 60, providerCalls: 0 }, stopConditions: ['Stop if source changes'], returnConditions: ['Return findings'] }, fixture.root);
    const reviewResult = { version: 1, assignmentId: review.assignmentId, role: 'review', summary: 'Fixture independently reviewed', disposition: 'returned', source: { ...review.source, stable: true }, limits: [], model: { requested: 'fixture / no-inference', observed: null, usage: null }, cleanup: [], scope: [{ path: 'source.txt', status: 'reviewed', observation: 'Reviewed fixture boundary' }], findings: [] };
    await writeFile(path.join(fixture.root, '.runtime/review-assignment.json'), JSON.stringify(review));
    await writeFile(path.join(fixture.root, '.runtime/review-result.json'), JSON.stringify(reviewResult));
    await writeFile(path.join(fixture.root, 'tasks.md'), '- [x] 1.1 Complete fixture\n');
    await writeFile(path.join(fixture.root, 'handoff.md'), 'fixture-change reviewed-clean');
    return { version: 1, change: 'fixture-change', lifecycle: 'reviewed-clean', capabilities: ['fixture'], integrationBoundaries: ['fixture-boundary'], slices: [{ id: 'B', capabilities: ['fixture'], integrationBoundaries: ['fixture-boundary'], scenarios: ['S1'] }], scenarios: [{ id: 'S1', requirement: 'Retained evidence', entrypoint: { kind: 'production', path: 'source.txt' }, checks: [{ command: fixture.result.checks[0].command, evidence: fixture.result.checks[0].evidence }] }], contracts: { verification: { assignment: '.runtime/assignment.json', result: '.runtime/result.json' }, review: { assignment: '.runtime/review-assignment.json', result: '.runtime/review-result.json' } }, closeout: { taskFile: 'tasks.md', handoffFile: 'handoff.md', requiredHandoffMarkers: ['fixture-change', 'reviewed-clean'] } };
  }

  it('preserves v1 executed evidence and explicitly distinguishes v2 reuse without a current exit', async () => {
    const fixture = await contractFixture();
    expect(fixture.assignment).toMatchObject({ version: 2, execution: null });
    expect(validateContract(fixture.assignment, fixture.result)).toMatchObject({ valid: true, ready: true });
    expect(await checkResultEvidence(fixture.assignment, fixture.result, fixture.root)).toEqual([]);
    expect(await summarizeContract(fixture.assignment, fixture.result, fixture.root)).toMatchObject({ structurallyValid: true, ready: true });
    const legacy = structuredClone(fixture.assignment); legacy.version = 1; delete legacy.execution;
    const checkResult = { ...fixture.result.checks[0], status: 'executed', exit: 0 }; delete checkResult.reuse;
    const legacyResult = resultFor(legacy, [checkResult]);
    expect(validateContract(legacy, legacyResult)).toMatchObject({ valid: true, ready: true });
    expect(await summarizeContract(legacy, legacyResult, fixture.root)).toMatchObject({ structurallyValid: true, ready: true });
  });

  it.each(['fresh', 'current-exit', 'missing-coverage', 'command'])('rejects structurally invalid reused %s claims', async invalid => {
    const fixture = await contractFixture();
    const result = structuredClone(fixture.result);
    const row = result.checks[0];
    if (invalid === 'fresh') row.reuse.freshRequired = true;
    else if (invalid === 'current-exit') row.exit = 0;
    else if (invalid === 'missing-coverage') row.reuse.criteria = ['other-criterion'];
    else row.reuse.identity.args = ['unauthorized'];
    expect(validateContract(fixture.assignment, result).valid).toBe(false);
  });

  it('refuses a structurally valid arbitrary receipt absent its exact author-pinned source identity', async () => {
    const fixture = await contractFixture();
    const assignment = structuredClone(fixture.assignment);
    assignment.source.files = assignment.source.files.filter(file => file.path !== fixture.reference.path);
    const result = structuredClone(fixture.result);
    result.source.files = assignment.source.files;
    expect(validateContract(assignment, result).valid).toBe(true);
    expect((await checkResultEvidence(assignment, result, fixture.root)).length).toBeGreaterThan(0);
    expect(await summarizeContract(assignment, result, fixture.root)).toMatchObject({ structurallyValid: true, ready: false });
  });

  it.each(['matching', 'different-path', 'different-kind', 'fresh-required'])('binds receipt dependencies and freshness to the pinned author manifest: %s', async boundary => {
    const fixture = await contractFixture();
    await writeFile(path.join(fixture.root, 'other-source.txt'), 'other-author-dependency');
    const intended = check('one');
    if (boundary === 'different-path') intended.inputs = [{ path: 'other-source.txt', kind: 'source' }];
    else if (boundary === 'different-kind') intended.inputs = [{ path: 'source.txt', kind: 'fixture' }];
    else if (boundary === 'fresh-required') intended.freshRequired = true;
    const manifest = { checks: [intended], tools };
    const bytes = JSON.stringify(manifest);
    const manifestPath = '.runtime/author-manifest.json';
    await writeFile(path.join(fixture.root, manifestPath), bytes);
    const { assignment } = await prepareContract({ version: 2, execution: { manifestSha256: sha256(bytes), reusePolicy: 'matching-receipt-only' }, role: 'verification', objective: 'Verify author manifest dependency authority', criteria: fixture.assignment.criteria, revision: 'fixture-revision', sourcePaths: ['source.txt', manifestPath], scope: fixture.assignment.scope, checks: fixture.assignment.checks, allowedActions: fixture.assignment.allowedActions, additionalChecks: 'forbidden', resources: [], budget: fixture.assignment.budget, stopConditions: fixture.assignment.stopConditions, returnConditions: fixture.assignment.returnConditions }, fixture.root);
    expect(assignment.source.files.find(file => file.path === manifestPath).sha256).toBe(sha256(bytes));
    const result = resultFor(assignment, fixture.result.checks);
    expect(validateContract(assignment, result)).toMatchObject({ valid: true, ready: true });
    const errors = await checkResultEvidence(assignment, result, fixture.root);
    const summary = await summarizeContract(assignment, result, fixture.root);
    if (boundary === 'matching') {
      expect(errors).toEqual([]);
      expect(summary.ready).toBe(true);
    } else {
      expect(errors.join(' ')).toContain('identity outside author-approved manifest');
      expect(summary).toMatchObject({ structurallyValid: true, ready: false });
    }
  });

  it.each(['receipt', 'source', 'config', 'evidence'])('refuses reused %s changes through evidence validation, summary and production CLI', async changed => {
    const fixture = await contractFixture();
    if (changed === 'receipt') await writeFile(path.join(fixture.root, fixture.reference.path), '{"tampered":true}');
    else if (changed === 'source') await writeFile(path.join(fixture.root, 'source.txt'), 'new-source');
    else if (changed === 'evidence') await writeFile(path.join(fixture.root, '.runtime/evidence/result.json'), '{"passed":false}');
    else fixture.result.checks[0].reuse.identity.configIdentity = 'changed-config';
    await writeFile(path.join(fixture.root, '.runtime/result.json'), JSON.stringify(fixture.result));
    expect(validateContract(fixture.assignment, fixture.result).valid).toBe(true);
    expect((await checkResultEvidence(fixture.assignment, fixture.result, fixture.root)).length).toBeGreaterThan(0);
    expect(await summarizeContract(fixture.assignment, fixture.result, fixture.root)).toMatchObject({ structurallyValid: true, ready: false });
    await expect(execute(process.execPath, [path.resolve('scripts/check-agent-contract.mjs'), '.runtime/assignment.json', '.runtime/result.json', '--check-source', '--require-ready'], { cwd: fixture.root })).rejects.toMatchObject({ code: 2 });
  });

  it('passes the production v2 contract CLI only for intact original evidence', async () => {
    const fixture = await contractFixture();
    const run = await execute(process.execPath, [path.resolve('scripts/check-agent-contract.mjs'), '.runtime/assignment.json', '.runtime/result.json', '--check-source', '--require-ready'], { cwd: fixture.root });
    expect(JSON.parse(run.stdout)).toMatchObject({ valid: true, ready: true, sourceMatches: true });
  });

  it.each(['same', 'changed-path', 'changed-fields'])('binds the actual observation declaration across summary, CLI and readiness with unchanged manual versions: %s', async change => {
    const originalObservation = { path: '.runtime/evidence/result.json', truthyFields: ['passed'] };
    const fixture = await contractFixture(originalObservation);
    const observation = change === 'changed-path' ? { ...originalObservation, path: '.runtime/evidence/other.json' } : change === 'changed-fields' ? { ...originalObservation, truthyFields: ['complete'] } : originalObservation;
    const intended = check('one', { observation });
    expect(intended.configIdentity).toBe(fixture.identity.configIdentity);
    expect(intended.observationVersion).toBe(fixture.identity.observationVersion);
    const manifest = { checks: [intended], tools };
    const bytes = JSON.stringify(manifest);
    const manifestPath = '.runtime/observation-manifest.json';
    await writeFile(path.join(fixture.root, manifestPath), bytes);
    const prepared = await prepareContract({ version: 2, execution: { manifestSha256: sha256(bytes), reusePolicy: 'matching-receipt-only' }, role: 'verification', objective: 'Validate actual observation authority', criteria: fixture.assignment.criteria, revision: 'fixture-revision', sourcePaths: ['source.txt', manifestPath], scope: fixture.assignment.scope, checks: fixture.assignment.checks, allowedActions: fixture.assignment.allowedActions, additionalChecks: 'forbidden', resources: [], budget: fixture.assignment.budget, stopConditions: fixture.assignment.stopConditions, returnConditions: fixture.assignment.returnConditions }, fixture.root);
    fixture.assignment = prepared.assignment;
    fixture.result = resultFor(fixture.assignment, fixture.result.checks);
    await writeFile(path.join(fixture.root, '.runtime/assignment.json'), JSON.stringify(fixture.assignment));
    await writeFile(path.join(fixture.root, '.runtime/result.json'), JSON.stringify(fixture.result));
    expect(validateContract(fixture.assignment, fixture.result).valid).toBe(true);
    const expectedReady = change === 'same';
    expect((await summarizeContract(fixture.assignment, fixture.result, fixture.root)).ready).toBe(expectedReady);
    const readiness = await assessChangeReadiness(await readinessManifest(fixture), { root: fixture.root });
    expect(readiness.ready).toBe(expectedReady);
    const args = [path.resolve('scripts/check-agent-contract.mjs'), '.runtime/assignment.json', '.runtime/result.json', '--check-source', '--require-ready'];
    if (expectedReady) expect(JSON.parse((await execute(process.execPath, args, { cwd: fixture.root })).stdout).ready).toBe(true);
    else {
      expect((await checkResultEvidence(fixture.assignment, fixture.result, fixture.root)).join(' ')).toContain('identity outside author-approved manifest');
      await expect(execute(process.execPath, args, { cwd: fixture.root })).rejects.toMatchObject({ code: 2 });
    }
  });

  it.each(['evidence', 'receipt', 'source', 'config'])('readiness accepts v2 reuse then refuses changed %s without relabeling it executed', async changed => {
    const fixture = await contractFixture();
    const { assignment: review } = await prepareContract({ role: 'review', objective: 'Independent fixture review', criteria: fixture.assignment.criteria, revision: 'fixture-revision', sourcePaths: ['source.txt'], scope: fixture.assignment.scope, checks: [], allowedActions: ['Read source and original evidence'], additionalChecks: 'forbidden', resources: [], budget: { timeSeconds: 60, providerCalls: 0 }, stopConditions: ['Stop if source changes'], returnConditions: ['Return findings'] }, fixture.root);
    const reviewResult = { version: 1, assignmentId: review.assignmentId, role: 'review', summary: 'Fixture independently reviewed', disposition: 'returned', source: { ...review.source, stable: true }, limits: [], model: { requested: 'fixture / no-inference', observed: null, usage: null }, cleanup: [], scope: [{ path: 'source.txt', status: 'reviewed', observation: 'Reviewed fixture boundary' }], findings: [] };
    await writeFile(path.join(fixture.root, '.runtime/review-assignment.json'), JSON.stringify(review));
    await writeFile(path.join(fixture.root, '.runtime/review-result.json'), JSON.stringify(reviewResult));
    await writeFile(path.join(fixture.root, 'tasks.md'), '- [x] 1.1 Complete fixture\n');
    await writeFile(path.join(fixture.root, 'handoff.md'), 'fixture-change reviewed-clean');
    const manifest = { version: 1, change: 'fixture-change', lifecycle: 'reviewed-clean', capabilities: ['fixture'], integrationBoundaries: ['fixture-boundary'], slices: [{ id: 'B', capabilities: ['fixture'], integrationBoundaries: ['fixture-boundary'], scenarios: ['S1'] }], scenarios: [{ id: 'S1', requirement: 'Retained evidence', entrypoint: { kind: 'production', path: 'source.txt' }, checks: [{ command: fixture.result.checks[0].command, evidence: fixture.result.checks[0].evidence }] }], contracts: { verification: { assignment: '.runtime/assignment.json', result: '.runtime/result.json' }, review: { assignment: '.runtime/review-assignment.json', result: '.runtime/review-result.json' } }, closeout: { taskFile: 'tasks.md', handoffFile: 'handoff.md', requiredHandoffMarkers: ['fixture-change', 'reviewed-clean'] } };
    expect(await assessChangeReadiness(manifest, { root: fixture.root })).toMatchObject({ ready: true });
    if (changed === 'evidence') await writeFile(path.join(fixture.root, '.runtime/evidence/result.json'), 'modified-evidence');
    else if (changed === 'receipt') await writeFile(path.join(fixture.root, fixture.reference.path), 'modified-receipt');
    else if (changed === 'source') await writeFile(path.join(fixture.root, 'source.txt'), 'modified-source');
    else {
      fixture.result.checks[0].reuse.identity.configIdentity = 'modified-config';
      await writeFile(path.join(fixture.root, '.runtime/result.json'), JSON.stringify(fixture.result));
    }
    const readiness = await assessChangeReadiness(manifest, { root: fixture.root });
    expect(readiness.ready).toBe(false);
    expect(readiness.contracts.verification.ready).toBe(false);
    expect(fixture.result.checks[0]).toMatchObject({ status: 'reused', exit: null });
  });
});

describe('probe resources and bounded observation waits', () => {
  const preflight = () => ({ timeoutMs: 100, intervalMs: 10, fakeCompositionPassed: true, fakeCompositionSourceMatched: true, paths: ['.runtime/probe/profile'], ports: [{ number: 12345, protocol: 'tcp' }] });
  it('rejects deadline arithmetic, missing fake proof and path escapes before checking ports', async () => {
    const root = await temporary();
    let checks = 0;
    const portCheck = async () => { checks++; };
    await expect(probePreflight({ ...preflight(), intervalMs: 101 }, { root, portCheck })).rejects.toThrow('deadline');
    await expect(probePreflight({ ...preflight(), fakeCompositionSourceMatched: false }, { root, portCheck })).rejects.toThrow('source-matched');
    await expect(probePreflight({ ...preflight(), paths: ['../personal-save'] }, { root, portCheck })).rejects.toThrow('beneath .runtime');
    expect(checks).toBe(0);
    expect(await probePreflight(preflight(), { root, portCheck })).toMatchObject({ ready: true, actorReadiness: 'required-after-owned-launch', providerCalls: 0 });
    expect(checks).toBe(1);
  });

  it('refuses occupied graphical Factorio before any port checks or launch effects', async () => {
    const root = await temporary();
    let ports = 0; let gui = 0;
    await expect(probePreflight({ ...preflight(), gui: true }, { root, portCheck: async () => { ports++; }, guiCheck: async () => { gui++; throw new Error('Graphical Factorio already in use'); } })).rejects.toThrow('Graphical Factorio already in use');
    expect(gui).toBe(1);
    expect(ports).toBe(0);
  });

  it('admits an existing authorized owned observer without global GUI or port refusal', async () => {
    const root = await temporary();
    await mkdir(path.join(root, '.runtime/probe/profile'), { recursive: true });
    let gui = 0; let ports = 0;
    const result = await probePreflight({ ...preflight(), gui: true, mode: 'owned-observation', ports: [] }, { root, portCheck: async () => { ports++; throw new Error('must not inspect other ports'); }, guiCheck: async () => { gui++; throw new Error('must not refuse owned observer'); } });
    expect(result).toMatchObject({ ready: true, providerCalls: 0 });
    expect(gui).toBe(0); expect(ports).toBe(0);
  });

  it('cleans initial and restored owned servers/observers while preserving sibling-prefix and unrelated profiles', async () => {
    const workspace = await temporary();
    const root = path.join(workspace, '.runtime/assignment-unique');
    const process = (pid, config, kind) => ({ pid, config, kind, startedAt: `fixture-${pid}`, rconPort: null, gamePort: null });
    let processes = [
      process(101, path.join(root, 'initial/config.ini'), 'server'),
      process(102, path.join(root, 'initial/observer-config.ini'), 'observer'),
      process(103, path.join(root, 'restored/child/config.ini'), 'server'),
      process(104, path.join(root, 'restored/child/observer-config.ini'), 'observer'),
      process(201, path.join(workspace, '.runtime/assignment-unique-sibling/config.ini'), 'server'),
      process(202, path.join(workspace, '.runtime/unrelated/observer-config.ini'), 'observer'),
    ];
    expect(selectOwnedProcesses(root, processes).map(row => row.pid)).toEqual([101, 102, 103, 104]);
    const stoppedConfigs = [];
    const stopped = await stopOwnedRoot(root, { resolve: async requested => { expect(requested).toBe(root); return root; }, list: async () => processes, stop: async config => { stoppedConfigs.push(config); const selected = processes.filter(row => row.config === config); processes = processes.filter(row => row.config !== config); return selected.map(row => row.pid); } });
    expect(stopped).toEqual([101, 102, 103, 104]);
    expect(stoppedConfigs).toHaveLength(4);
    expect(processes.map(row => row.pid)).toEqual([201, 202]);
  });

  it('refuses completion when an owned child remains after exact cleanup attempts', async () => {
    const workspace = await temporary();
    const root = path.join(workspace, '.runtime/assignment-unique');
    const remaining = { pid: 103, config: path.join(root, 'restored/child/config.ini'), kind: 'server', startedAt: 'fixture-child', rconPort: null, gamePort: null };
    let attempts = 0;
    await expect(stopOwnedRoot(root, { resolve: async () => root, list: async () => [remaining], stop: async config => { expect(config).toBe(remaining.config); attempts++; return []; } })).rejects.toThrow('Assignment root cleanup unresolved');
    expect(attempts).toBe(1);
  });

  it('refuses global runtime-root cleanup before inspecting or stopping processes', async () => {
    const globalRoot = path.resolve('.runtime');
    let inspected = 0; let stopped = 0;
    await expect(stopOwnedRoot(globalRoot, { resolve: async () => globalRoot, list: async () => { inspected++; return []; }, stop: async () => { stopped++; return []; } })).rejects.toThrow('unique assignment root');
    expect(inspected).toBe(0); expect(stopped).toBe(0);
  });

  it('refuses an occupied port without touching its owner', async () => {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = server.address().port;
      await expect(availablePort(port)).rejects.toThrow('unavailable');
      expect(server.listening).toBe(true);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });

  it('refuses ownership stealing and changed process identity cleanup', async () => {
    const root = await temporary();
    const resource = { id: 'fixture-profile' };
    const lease = await acquireResource(resource, 'fixture-worker', { root, identify: async () => processOwner });
    await expect(acquireResource(resource, 'replacement', { root, identify: async () => ({ ...processOwner, startedAt: 'later' }) })).rejects.toThrow('already owned');
    await expect(releaseResource(lease, { identify: async () => ({ ...processOwner, startedAt: 'changed-process' }) })).rejects.toThrow('identity changed');
    expect(JSON.parse(await readFile(lease.target, 'utf8')).owner).toBe('fixture-worker');
    await releaseResource(lease, { identify: async () => processOwner });
    await expect(readFile(lease.target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses cleanup when the on-disk lease identity changes', async () => {
    const root = await temporary();
    const lease = await acquireResource({ id: 'fixture-profile' }, 'fixture-worker', { root, identify: async () => processOwner });
    await writeFile(lease.target, JSON.stringify({ ...lease.record, owner: 'other-worker' }));
    await expect(releaseResource(lease, { identify: async () => processOwner })).rejects.toThrow('ownership/process identity changed');
    expect(JSON.parse(await readFile(lease.target, 'utf8')).owner).toBe('other-worker');
  });

  it('returns terminal error before success and deadline without retries', async () => {
    let time = 0; let inspections = 0; let sleeps = 0;
    const result = await waitObservation(async () => { inspections++; return { terminalError: 'actor-unavailable', ready: true }; }, { timeoutMs: 1000, intervalMs: 10, now: () => time, sleep: async ms => { sleeps++; time += ms; } });
    expect(result).toEqual({ outcome: 'terminal-error', error: 'actor-unavailable' });
    expect(inspections).toBe(1); expect(sleeps).toBe(0);
  });

  it('distinguishes interruption and timeout as unknown effects with bounded polling', async () => {
    let time = 0; let inspections = 0;
    const inspect = async () => { inspections++; return {}; };
    const options = { timeoutMs: 25, intervalMs: 10, now: () => time, sleep: async ms => { time += ms; } };
    expect(await waitObservation(inspect, { ...options, signal: { aborted: true } })).toEqual({ outcome: 'interrupted', effects: 'unknown' });
    expect(inspections).toBe(0);
    expect(await waitObservation(inspect, options)).toEqual({ outcome: 'timeout', effects: 'unknown' });
    expect(time).toBe(25); expect(inspections).toBe(3);
  });
});

describe('bounded budget admission and structured assertions', () => {
  it('makes reserve exhaustion override unknowns while retaining cleanup permission', () => {
    const report = usageReport(); report.usage.input = 950;
    const outcome = admitWork(plan(), report);
    expect(outcome).toMatchObject({ decision: 'stop', admitted: false, advisory: false, cleanupAllowed: true, directCommandsCovered: false, alreadyRunningReasoningCovered: false });
    expect(outcome.reasons.some(row => row.reason === 'closeout-reserve-reached')).toBe(true);
  });

  it('requires a recorded finite alternative for unknown usage and shares its admission limit across replacements', () => {
    const report = usageReport(); report.coverage = { aggregate: false, complete: false };
    const now = Date.now();
    const alternative = { reason: 'Unknown tokens; bounded fixture count and deadline', maxAdmissions: 2, deadlineMs: now + 1000 };
    expect(admitWork(plan(), report, { now })).toMatchObject({ decision: 'unknown', admitted: false, cleanupAllowed: true });
    expect(admitWork(plan(), report, { now, admissions: 1, alternative })).toMatchObject({ decision: 'unknown', admitted: true, alternative });
    expect(admitWork(plan(), report, { now, admissions: 2, alternative }).admitted).toBe(false);
    expect(admitWork(plan(), report, { now: now + 1001, alternative }).admitted).toBe(false);
    expect(admitWork(plan(), report, { now, alternative: { ...alternative, reason: '' } }).admitted).toBe(false);
  });

  it('preserves absent state as unknown rather than a passing zero measurement', () => {
    const observed = { id: 'plates', surface: 'isolated-test', scope: 'inventory', tick: 100, window: [90, 100], units: 'items', expected: 0, fresh: true, windowComplete: true };
    expect(assertionSummary(observed)).toMatchObject({ actual: null, expected: 0, outcome: 'unknown', coverage: 'unknown' });
    expect(assertionSummary({ ...observed, actual: 0 })).toMatchObject({ actual: 0, outcome: 'pass', coverage: 'complete' });
    expect(assertionSummary({ ...observed, actual: 0, windowComplete: false })).toMatchObject({ outcome: 'unknown', coverage: 'unknown' });
    expect(assertionSummary({ ...observed, actual: 1 })).toMatchObject({ outcome: 'fail', coverage: 'complete' });
  });
});

describe('managed author task admission events and shared reservations', () => {
  async function authorTask() {
    const root = await temporary();
    const tasksFile = path.join(root, 'tasks.md');
    await writeFile(tasksFile, '- [ ] 1.1 Implement bounded fixture\n\n## Model routing\n\n| Task | Role | Model | Effort | Rationale | Escalate when |\n| --- | --- | --- | --- | --- | --- |\n| 1.1 | author | gpt-6.1-sol | medium | Explicit fixture boundary | Unknown recovery invariant |\n');
    return { root, tasksFile, taskId: '1.1', start: true };
  }

  it('refuses missing managed plan/coverage before discovery and launch', async () => {
    const input = await authorTask();
    let calls = 0;
    const forbidden = () => { calls++; throw new Error('must not dispatch'); };
    await expect(selectTask(input, { discover: forbidden, launch: forbidden })).rejects.toThrow('shared session plan and usage coverage');
    await expect(selectTask({ ...input, plan: plan() }, { discover: forbidden, launch: forbidden })).rejects.toThrow('shared session plan and usage coverage');
    expect(calls).toBe(0);
  });

  it.each(['stop', 'unknown'])('records %s refusal without dispatching an author or creating a prompt', async decision => {
    const input = await authorTask();
    const report = usageReport();
    if (decision === 'stop') report.usage.input = 950;
    else report.coverage = { aggregate: false, complete: false };
    let launches = 0;
    const result = await selectTask({ ...input, plan: plan(), usageReport: report }, { discover: async () => ({ authentication: 'chatgpt', model: 'gpt-6.1-sol', effort: 'medium' }), admit: (plan, report, options) => admitWork(plan, report, options), launch: () => { launches++; return { pid: 999 }; } });
    expect(result).toMatchObject({ started: false, blocked: true, admission: { decision, admitted: false, cleanupAllowed: true } });
    expect(launches).toBe(0);
    const parsed = await readEvents([`${result.evidence}/events.jsonl`], { root: input.root });
    expect(parsed.gaps).toEqual([]);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({ kind: 'budget', decision, requestedModel: 'gpt-6.1-sol', requestedEffort: 'medium', phase: 'authoring', role: 'author' });
    expect(JSON.parse(await readFile(path.join(input.root, result.evidence, 'admission.json'), 'utf8'))).toMatchObject({ admitted: false, decision });
    await expect(readFile(path.join(input.root, result.evidence, 'prompt.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('persists one bounded unknown admission across replacement starts and emits launch observation once', async () => {
    const input = await authorTask();
    const sharedPlan = plan(); sharedPlan.limits = [{ unit: 'wallMs', value: 60000, closeoutReserve: 5000 }];
    const report = usageReport(); report.coverage = { aggregate: false, complete: false };
    const unknownAlternative = { reason: 'No fixture model tokens; one local fake launch within wall bound', maxAdmissions: 1, deadlineMs: Date.now() + 60000 };
    let launches = 0;
    const dependencies = { discover: async () => ({ authentication: 'chatgpt', model: 'gpt-6.1-sol', effort: 'medium' }), launch: () => { launches++; return { pid: null, unref() {} }; } };
    const request = { ...input, plan: sharedPlan, usageReport: report, unknownAlternative };
    const first = await selectTask(request, dependencies);
    expect(first.launchOutcome).toBe('unknown');
    const firstEvents = await readEvents([`${first.evidence}/events.jsonl`], { root: input.root });
    expect(firstEvents.events.map(event => event.kind)).toEqual(['budget', 'start']);
    expect(firstEvents.events[0].decision).toBe('unknown');
    expect(firstEvents.events[1].outcome).toBe('unknown');
    const persisted = JSON.parse(await readFile(path.join(input.root, '.runtime/development/budgets', sha256(JSON.stringify(sharedPlan)), 'admission-1.json'), 'utf8'));
    expect(persisted.decision).toMatchObject({ admitted: true, decision: 'unknown', alternative: unknownAlternative });
    const replacement = await selectTask(request, dependencies);
    expect(replacement).toMatchObject({ blocked: true, started: false, admission: { admitted: false, admissions: 1 } });
    expect(launches).toBe(1);
    await expect(readFile(path.join(input.root, '.runtime/development/budgets', sha256(JSON.stringify(sharedPlan)), 'admission-2.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
