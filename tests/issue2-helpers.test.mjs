import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scaffoldResult, validateReturn } from '../scripts/dev/contract.mjs';
import { classifyMutation, mutationProof } from '../scripts/dev/mutation.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const TEST = 'tests/worker.test.mjs';
const CHECK = 'node focused check';

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'af-issue2-'));
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(root, 'tests'), { recursive: true });
  await writeFile(path.join(root, 'scripts', 'subject.mjs'), Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('const x = 1;\r\n')]));
  const bytes = await readFile(path.join(root, 'scripts', 'subject.mjs'));
  return { root, bytes, digest: hash(bytes), cleanup: () => rm(root, { recursive: true, force: true }) };
}

function assignment(version = 1, role = 'verification', digest) {
  const files = [{ path: 'scripts/subject.mjs', sha256: digest ?? hash('subject') }];
  return {
    version, ...(version === 2 ? { execution: null } : {}), assignmentId: `issue2-${version}-${role}`,
    role, objective: 'Exercise the bounded helper interfaces',
    criteria: [{ id: 'C1', description: 'The helper preserves the required contract' }],
    source: { revision: 'test-revision', files },
    scope: [{ path: files[0].path, boundary: 'The complete assigned file' }],
    checks: role === 'review' ? [] : [{ id: 'T1', command: CHECK, expected: 'Focused check passes' }],
    allowedActions: ['Run the assigned local check'], additionalChecks: role === 'review' ? 'forbidden' : 'within-scope',
    resources: [{ id: 'fixture', owner: 'worker', cleanup: 'Remove temporary workspace' }],
    evidenceDirectory: '.runtime/contracts/issue2-test', budget: { timeSeconds: 60, providerCalls: 0 },
    stopConditions: ['Stop if source changes'], returnConditions: ['Return exact observations']
  };
}

function completed(assignmentValue) {
  const a = assignmentValue;
  const common = {
    version: a.version, assignmentId: a.assignmentId, role: a.role,
    summary: 'Completed the assigned work', disposition: 'returned',
    source: { ...structuredClone(a.source), stable: true }, limits: [],
    model: { requested: 'assigned model', observed: 'assigned model', usage: { providerCalls: 0, totalTokens: 0 } },
    cleanup: [{ id: 'fixture', status: 'completed', observation: 'Removed temporary workspace', evidence: ['.runtime/contracts/issue2-test/cleanup.txt'] }]
  };
  if (a.role === 'review') return {
    ...common, scope: a.scope.map(item => ({ path: item.path, status: 'reviewed', observation: 'Read the assigned source and checked the stated invariant' })), findings: []
  };
  return {
    ...common,
    criteria: a.criteria.map(item => ({ id: item.id, status: 'pass', observation: 'The focused assertion passed', evidence: ['.runtime/contracts/issue2-test/check.log'], checks: ['T1'] })),
    checks: a.checks.map(item => ({ id: item.id, command: item.command, authorization: null, status: 'executed', exit: 0,
      outcome: 'pass', observation: 'Focused check passed', evidence: ['.runtime/contracts/issue2-test/check.log'], ...(a.version === 2 ? { reuse: null } : {}) }))
  };
}

describe('issue 2 contract helper interfaces', () => {
  it.each([1, 2])('scaffolds v%s verifier and review drafts without claiming readiness', async version => {
    const env = await workspace();
    try {
      for (const role of ['verification', 'review']) {
        const a = assignment(version, role, env.digest);
        const before = structuredClone(a);
        const draft = await scaffoldResult(a, env.root);
        expect(a).toEqual(before);
        expect(draft).toMatchObject({ version, assignmentId: a.assignmentId, role, disposition: 'blocked', source: { stable: false } });
        expect(draft.source).not.toBe(a.source);
        expect(draft.limits).toEqual([{ description: expect.any(String), affectsCoverage: true }]);
        expect(draft.cleanup).toEqual([{ id: 'fixture', status: 'unresolved', observation: expect.any(String), evidence: [] }]);
        if (role === 'review') expect(draft.scope).toEqual([{ path: 'scripts/subject.mjs', status: 'unreviewed', observation: expect.any(String) }]);
        else {
          expect(draft.checks[0]).toMatchObject({ status: 'blocked', exit: null, outcome: 'unverified' });
          if (version === 2) expect(draft.checks[0].reuse).toBeNull();
          else expect(draft.checks[0]).not.toHaveProperty('reuse');
        }
        const validated = await validateReturn(a, draft, env.root);
        expect(validated).toMatchObject({ structurallyValid: true, ready: false, semanticAcceptanceByAuthorRequired: true });
      }
    } finally { await env.cleanup(); }
  });

  it.each([1, 2])('accepts complete source-matched v%s worker reports and preserves their typed observations', async version => {
    const env = await workspace();
    try {
      for (const role of ['verification', 'review']) {
        const a = assignment(version, role, env.digest);
        const report = completed(a);
        const summary = await validateReturn(a, report, env.root);
        expect(summary).toMatchObject({ structurallyValid: true, ready: true, sourceStable: true });
        expect(summary.readinessGaps).toEqual([]);
        expect(report.limits).toEqual([]);
        if (role === 'review') expect(report.scope[0].status).toBe('reviewed');
        else {
          expect(report.checks[0]).toMatchObject({ status: 'executed', outcome: 'pass', exit: 0 });
          if (version === 2) expect(report.checks[0].reuse).toBeNull();
          else expect(report.checks[0]).not.toHaveProperty('reuse');
        }
      }
    } finally { await env.cleanup(); }
  });

  it('rejects invalid result shape and changed current source bytes', async () => {
    const env = await workspace();
    try {
      const a = assignment(1, 'verification', env.digest);
      const bad = completed(a); bad.limits = [{ description: 'bad type', affectsCoverage: 'yes' }];
      await expect(validateReturn(a, bad, env.root)).rejects.toThrow(/invalid result/);
      await writeFile(path.join(env.root, 'scripts', 'subject.mjs'), 'user edit');
      await expect(validateReturn(a, completed(a), env.root)).rejects.toThrow(/source check failed/);
    } finally { await env.cleanup(); }
  });
});

describe('issue 2 mutation helper interface', () => {
  it.each([
    ['zero selection', { exit: 1, report: { success: false, numRuntimeErrorTestSuites: 0, testResults: [] } }, 'zero-selection'],
    ['wrong assertion', { exit: 1, report: { success: false, numRuntimeErrorTestSuites: 0, testResults: [{ assertionResults: [{ status: 'failed', failureMessages: ['Expected 2 to equal 3'] }] }] } }, 'wrong-failure'],
    ['Unicode expected assertion', { exit: 1, report: { success: false, numRuntimeErrorTestSuites: 0, testResults: [{ assertionResults: [{ status: 'failed', failureMessages: ['AssertionError: expected "café 🏭" to match /blue/'] }] }] } }, 'expected-regression'],
    ['import error', { exit: 1, report: { success: false, numRuntimeErrorTestSuites: 1, testResults: [{ message: 'Cannot load module' }] } }, 'harness-error'],
    ['timeout', { exit: null, timedOut: true, report: null }, 'timeout']
  ])('classifies %s', (_name, run, expected) => {
    expect(classifyMutation(run, 'expected ".*blue')).toBe(expected);
  });

  it('classifies a restored passing check only when an assertion actually ran', () => {
    expect(classifyMutation({ exit: 0, report: { success: true, numRuntimeErrorTestSuites: 0, testResults: [{ assertionResults: [{ status: 'passed' }] }] } }, 'failure')).toBe('pass');
    expect(classifyMutation({ exit: 0, report: { success: true, numRuntimeErrorTestSuites: 0, testResults: [] } }, 'failure')).toBe('zero-selection');
  });

  async function mutationFixture(run) {
    const env = await workspace();
    await mkdir(path.join(env.root, '.runtime', 'mutations'), { recursive: true });
    const mutation = path.join(env.root, '.runtime', 'mutations', 'mutant.bin');
    await writeFile(mutation, Buffer.from('const x = 2;\r\n'));
    const calls = [];
    const input = { exclusiveSourceAccess: true, tests: [TEST], testName: 'focused assertion', diagnostic: 'broken', timeoutMs: 1000,
      source: 'scripts/subject.mjs', sha256: env.digest, mutationFile: '.runtime/mutations/mutant.bin' };
    const proof = () => mutationProof(input, { root: env.root, run: async options => { calls.push(options.phase); return run(options, calls); },
      lock: async () => ({ id: 'fake-lease' }), unlock: async lease => expect(lease).toEqual({ id: 'fake-lease' }) });
    return { ...env, input, calls, proof };
  }

  it('restores exact UTF-8/BOM/CRLF source bytes after expected failure and reports focused pass', async () => {
    const env = await mutationFixture((_options, calls) => calls.length === 1
      ? { exit: 1, report: { success: false, numRuntimeErrorTestSuites: 0, testResults: [{ assertionResults: [{ status: 'failed', failureMessages: ['broken: expected value'] }] }] } }
      : { exit: 0, report: { success: true, numRuntimeErrorTestSuites: 0, testResults: [{ assertionResults: [{ status: 'passed' }] }] } });
    try {
      const result = await env.proof();
      expect(result).toMatchObject({ mutation: 'expected-regression', focused: 'pass', restored: true, passed: true });
      expect(await readFile(path.join(env.root, env.input.source))).toEqual(env.bytes);
      expect(env.calls).toEqual(['mutant', 'restored']);
    } finally { await env.cleanup(); }
  });

  it('restores bytes even when the mutation runner throws', async () => {
    const env = await mutationFixture(() => { throw new Error('runner exploded'); });
    try {
      await expect(env.proof()).rejects.toThrow('runner exploded');
      expect(await readFile(path.join(env.root, env.input.source))).toEqual(env.bytes);
    } finally { await env.cleanup(); }
  });

  it('refuses to overwrite concurrent source drift and preserves the user bytes', async () => {
    const env = await mutationFixture(async (_options, calls) => {
      if (calls.length === 1) await writeFile(path.join(env.root, env.input.source), 'user concurrent edit');
      return { exit: 1, report: { success: false, numRuntimeErrorTestSuites: 0, testResults: [{ assertionResults: [{ status: 'failed', failureMessages: ['broken'] }] }] } };
    });
    try {
      await expect(env.proof()).rejects.toThrow(/Concurrent source drift: restoration refused/);
      expect(await readFile(path.join(env.root, env.input.source), 'utf8')).toBe('user concurrent edit');
    } finally { await env.cleanup(); }
  });

  it('marks source drift introduced by the restored check as failed and preserves the changed bytes', async () => {
    const env = await mutationFixture(async (_options, calls) => {
      if (calls.length === 2) await writeFile(path.join(env.root, env.input.source), 'new user bytes after restored check');
      return calls.length === 1
        ? { exit: 1, report: { success: false, numRuntimeErrorTestSuites: 0, testResults: [{ assertionResults: [{ status: 'failed', failureMessages: ['broken assertion'] }] }] } }
        : { exit: 0, report: { success: true, numRuntimeErrorTestSuites: 0, testResults: [{ assertionResults: [{ status: 'passed' }] }] } };
    });
    try {
      const result = await env.proof();
      expect(result).toMatchObject({ mutation: 'expected-regression', focused: 'source-drift', restored: false, passed: false });
      expect(result.finalSha256).toBe(hash('new user bytes after restored check'));
      expect(await readFile(path.join(env.root, env.input.source), 'utf8')).toBe('new user bytes after restored check');
      expect(await readFile(path.join(result.directory, 'original.bin'))).toEqual(env.bytes);
    } finally { await env.cleanup(); }
  });

  it('runs a real focused Vitest subprocess with Unicode selection and verifies assertion counts', async () => {
    const env = await workspace();
    try {
      await mkdir(path.join(env.root, '.runtime', 'mutations'), { recursive: true });
      await writeFile(path.join(env.root, '.runtime', 'mutations', 'mutant.bin'), 'const x = 2;\r\n');
      await writeFile(path.join(env.root, TEST), [
        "import { readFileSync } from 'node:fs';",
        "import { expect, it } from 'vitest';",
        "it('Unicode regression café 🏭', () => {",
        "  expect(readFileSync('scripts/subject.mjs', 'utf8')).toContain('const x = 1');",
        '});', ''
      ].join('\n'));
      await import('node:fs/promises').then(({ symlink }) => symlink(path.resolve('node_modules'), path.join(env.root, 'node_modules'), 'junction'));
      const input = { exclusiveSourceAccess: true, tests: [TEST], testName: 'Unicode regression café 🏭',
        diagnostic: 'const x = 1', timeoutMs: 30000, source: 'scripts/subject.mjs', sha256: env.digest,
        mutationFile: '.runtime/mutations/mutant.bin' };
      const result = await mutationProof(input, { root: env.root, lock: async () => 'real-vitest-lease', unlock: async () => {} });
      expect(result).toMatchObject({ mutation: 'expected-regression', focused: 'pass', restored: true, passed: true });
      const mutantReport = JSON.parse(await readFile(path.join(result.directory, 'mutant.json'), 'utf8'));
      expect(mutantReport.numTotalTests).toBe(1);
      expect(mutantReport.numFailedTests).toBe(1);
      const restoredReport = JSON.parse(await readFile(path.join(result.directory, 'restored.json'), 'utf8'));
      expect(restoredReport.numTotalTests).toBe(1);
      expect(restoredReport.numPassedTests).toBe(1);
      expect(await readFile(path.join(env.root, input.source))).toEqual(env.bytes);
    } finally { await env.cleanup(); }
  });

  it('treats an expected assertion failure plus afterAll failure as harness-error in real Vitest output', async () => {
    const env = await workspace();
    try {
      await mkdir(path.join(env.root, '.runtime', 'mutations'), { recursive: true });
      await writeFile(path.join(env.root, '.runtime', 'mutations', 'mutant.bin'), 'const x = 2;\r\n');
      await writeFile(path.join(env.root, TEST), [
        "import { afterAll, expect, it } from 'vitest';",
        "it('assertion plus teardown failure', () => {",
        "  expect(readFileSync('scripts/subject.mjs', 'utf8')).toContain('const x = 1');",
        '});',
        "import { readFileSync } from 'node:fs';",
        "afterAll(() => { throw new Error('teardown exploded'); });", ''
      ].join('\n'));
      await import('node:fs/promises').then(({ symlink }) => symlink(path.resolve('node_modules'), path.join(env.root, 'node_modules'), 'junction'));
      const input = { exclusiveSourceAccess: true, tests: [TEST], testName: 'assertion plus teardown failure',
        diagnostic: 'const x = 1', timeoutMs: 30000, source: 'scripts/subject.mjs', sha256: env.digest,
        mutationFile: '.runtime/mutations/mutant.bin' };
      const result = await mutationProof(input, { root: env.root, lock: async () => 'teardown-lease', unlock: async () => {} });
      expect(result).toMatchObject({ mutation: 'harness-error', focused: 'harness-error', restored: true, passed: false });
      expect(await readFile(path.join(env.root, input.source))).toEqual(env.bytes);
      const runtime = JSON.parse(await readFile(path.join(result.directory, 'mutant-runtime.json'), 'utf8'));
      expect(runtime).toMatchObject({ runtimeErrors: expect.any(Number), reason: 'failed' });
      expect(runtime.runtimeErrors).toBeGreaterThan(0);
    } finally { await env.cleanup(); }
  });

  it('times out a real stalled Vitest subprocess and still restores the original source bytes', async () => {
    const env = await workspace();
    try {
      await mkdir(path.join(env.root, '.runtime', 'mutations'), { recursive: true });
      await writeFile(path.join(env.root, '.runtime', 'mutations', 'mutant.bin'), 'const x = 2;\r\n');
      await writeFile(path.join(env.root, TEST), [
        "import { expect, it } from 'vitest';",
        "it('stalled selection', async () => {",
        '  await new Promise(resolve => setTimeout(resolve, 10000));',
        '  expect(true).toBe(true);',
        '});', ''
      ].join('\n'));
      await import('node:fs/promises').then(({ symlink }) => symlink(path.resolve('node_modules'), path.join(env.root, 'node_modules'), 'junction'));
      const input = { exclusiveSourceAccess: true, tests: [TEST], testName: 'stalled selection', diagnostic: 'unused',
        timeoutMs: 500, source: 'scripts/subject.mjs', sha256: env.digest, mutationFile: '.runtime/mutations/mutant.bin' };
      const result = await mutationProof(input, { root: env.root, lock: async () => 'timeout-lease', unlock: async () => {} });
      expect(result).toMatchObject({ mutation: 'timeout', focused: 'timeout', restored: true, passed: false });
      expect(await readFile(path.join(env.root, input.source))).toEqual(env.bytes);
    } finally { await env.cleanup(); }
  });
});
