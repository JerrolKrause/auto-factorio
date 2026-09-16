import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { validateContract, main, checkSource } from '../scripts/check-agent-contract.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
function fixture(role = 'verification') {
  const source = { revision: 'abc123', files: [{ path: 'sample.mjs', sha256: hash('original') }] };
  const assignment = {
    version: 1, assignmentId: 'contract-trial-001', role, objective: 'Validate the selected helper',
    criteria: [{ id: 'C1', description: 'Helper preserves bytes' }], source,
    scope: [{ path: 'sample.mjs', boundary: 'Full file at supplied SHA-256' }],
    checks: role === 'review' ? [] : [{ id: 'T1', command: 'node test.mjs', expected: 'One passing case' }],
    allowedActions: ['Read scoped source', 'Run local scoped tests'], additionalChecks: role === 'review' ? 'forbidden' : 'within-scope',
    resources: [], evidenceDirectory: '.runtime/contract-trial-001', budget: { timeSeconds: 120, providerCalls: 0 },
    stopConditions: ['Stop before budget expiry'], returnConditions: ['Return blocked if required checks cannot run']
  };
  const result = {
    version: 1, assignmentId: assignment.assignmentId, role, summary: 'Assigned work completed', disposition: 'returned',
    source: { ...structuredClone(source), stable: true }, limits: [],
    model: { requested: 'assigned-model', observed: null, usage: null }, cleanup: [],
    ...(role === 'review' ? {
      scope: [{ path: 'sample.mjs', status: 'reviewed', observation: 'Read full snapshot and byte preservation path' }], findings: []
    } : {
      criteria: [{ id: 'C1', status: 'pass', observation: 'Bytes preserved', evidence: ['.runtime/contract-trial-001/test.log'], checks: ['T1'] }],
      checks: [{ id: 'T1', command: 'node test.mjs', authorization: null, status: 'executed', exit: 0,
        outcome: 'pass', observation: 'One case passed', evidence: ['.runtime/contract-trial-001/test.log'] }]
    })
  };
  return { assignment, result };
}

describe('developer worker contract boundaries', () => {
  it('validates assignments independently, and complete verification and empty-finding reviews', () => {
    for (const role of ['verification', 'review']) {
      const { assignment, result } = fixture(role);
      expect(validateContract(assignment)).toMatchObject({ valid: true, ready: null });
      expect(validateContract(assignment, result)).toEqual({ valid: true, ready: true, errors: [], readinessErrors: [] });
    }
  });

  it('reports malformed nested values without throwing', () => {
    for (const malformed of [null, [], {}, { version: 1, criteria: [null], scope: [{}], source: { files: [null] } }]) {
      expect(validateContract(malformed, null).valid).toBe(false);
    }
    const { assignment, result } = fixture();
    result.model = []; result.criteria = [null]; result.cleanup = [null]; result.checks = [null];
    expect(validateContract(assignment, result).valid).toBe(false);
  });

  it.each([
    ['missing criterion', r => { r.criteria = []; }],
    ['duplicate criterion', r => { r.criteria.push({ ...r.criteria[0] }); }],
    ['unknown criterion', r => { r.criteria[0].id = 'C2'; }],
    ['unknown check reference', r => { r.criteria[0].checks = ['missing']; }],
    ['missing prescribed check', r => { r.checks = []; }],
    ['changed prescribed command', r => { r.checks[0].command = 'node unrelated.mjs'; }],
    ['assignment mismatch', r => { r.assignmentId = 'another-task'; }],
    ['role mismatch', r => { r.role = 'review'; }],
    ['revision mismatch', r => { r.source.revision = 'another-commit'; }],
    ['source omission', r => { r.source.files = []; }],
    ['case-only source substitution', r => { r.source.files[0].path = 'Sample.mjs'; }],
    ['illegal criterion status', r => { r.criteria[0].status = 'done'; }],
    ['passing nonzero exit', r => { r.checks[0].exit = 1; }],
    ['passing null exit', r => { r.checks[0].exit = null; }],
    ['passing without evidence', r => { r.checks[0].evidence = []; }],
    ['passing criterion without evidence', r => { r.criteria[0].evidence = []; }],
    ['passing criterion with skipped check', r => { Object.assign(r.checks[0], { status: 'skipped', exit: null, outcome: 'unverified' }); }],
    ['passing criterion with failed check', r => { Object.assign(r.checks[0], { exit: 1, outcome: 'fail' }); }]
  ])('rejects %s', (_name, mutate) => {
    const { assignment, result } = fixture(); mutate(result);
    expect(validateContract(assignment, result)).toMatchObject({ valid: false, ready: false });
  });

  it('keeps failures, blocked checks, stale hashes, coverage limits and unstable source valid but not ready', () => {
    const mutations = [
      r => { r.disposition = 'blocked'; },
      r => { r.source.files[0].sha256 = hash('changed'); },
      r => { r.source.stable = false; },
      r => { r.limits = [{ description: 'Game unavailable', affectsCoverage: true }]; },
      r => { r.criteria[0].status = 'fail'; r.checks[0].outcome = 'fail'; r.checks[0].exit = 7; },
      r => { r.criteria[0].status = 'unverified'; Object.assign(r.checks[0], { status: 'blocked', outcome: 'unverified', exit: null, evidence: [] }); }
    ];
    for (const mutate of mutations) {
      const { assignment, result } = fixture(); mutate(result);
      expect(validateContract(assignment, result)).toMatchObject({ valid: true, ready: false });
    }
  });

  it('requires policy and assigned action authorization for additional checks', () => {
    const { assignment, result } = fixture();
    result.checks.push({ ...result.checks[0], id: 'extra', command: 'node focused.mjs', authorization: 'Run local scoped tests' });
    expect(validateContract(assignment, result).ready).toBe(true);
    assignment.additionalChecks = 'forbidden';
    expect(validateContract(assignment, result).valid).toBe(false);
    assignment.additionalChecks = 'within-scope'; result.checks[1].authorization = 'Start paid provider';
    expect(validateContract(assignment, result).valid).toBe(false);
  });

  it('accounts for assigned cleanup and requires evidence of completion', () => {
    const { assignment, result } = fixture();
    assignment.resources.push({ id: 'profile', owner: 'worker', cleanup: 'Stop exact process identity' });
    expect(validateContract(assignment, result).valid).toBe(false);
    result.cleanup.push({ id: 'profile', status: 'unresolved', observation: 'Identity check unavailable', evidence: [] });
    expect(validateContract(assignment, result)).toMatchObject({ valid: true, ready: false });
    result.cleanup[0].status = 'completed';
    expect(validateContract(assignment, result).valid).toBe(false);
    result.cleanup[0].evidence = ['.runtime/contract-trial-001/processes.json'];
    expect(validateContract(assignment, result).ready).toBe(true);
    result.cleanup[0].status = 'not-needed';
    expect(validateContract(assignment, result).valid).toBe(false);
    assignment.resources[0].cleanup = 'none';
    expect(validateContract(assignment, result).ready).toBe(true);
  });

  it('requires full review coverage and validates scoped findings without treating findings as success', () => {
    const { assignment, result } = fixture('review');
    result.scope = [];
    expect(validateContract(assignment, result).valid).toBe(false);
    result.scope = [{ path: 'sample.mjs', status: 'unreviewed', observation: 'Time limit' }];
    expect(validateContract(assignment, result)).toMatchObject({ valid: true, ready: false });
    result.scope[0].status = 'reviewed';
    result.findings = [{ id: 'R1', severity: 'P1', confidence: 'high', path: 'sample.mjs', line: 4,
      description: 'Decoded text loses BOM', evidence: ['sample.mjs:4'], fix: 'Preserve original BOM bytes' }];
    expect(validateContract(assignment, result)).toMatchObject({ valid: true, ready: false });
    for (const change of [{ severity: 'P4' }, { confidence: 'low' }, { path: 'unassigned.mjs' }, { line: 0 }, { evidence: [] }]) {
      const changed = structuredClone(result); Object.assign(changed.findings[0], change);
      expect(validateContract(assignment, changed).valid).toBe(false);
    }
    result.findings.push({ ...result.findings[0] });
    expect(validateContract(assignment, result).valid).toBe(false);
    assignment.checks = [{ id: 'T1', command: 'node test.mjs', expected: 'Pass' }];
    expect(validateContract(assignment).valid).toBe(false);
  });

  it('rejects unsafe paths, duplicate paths, malformed hashes and unbounded budgets', () => {
    for (const sourcePath of ['../outside', '/absolute', 'C:/outside', 'folder\\file', 'folder/../file']) {
      const { assignment } = fixture(); assignment.source.files[0].path = sourcePath;
      expect(validateContract(assignment).valid).toBe(false);
    }
    const { assignment } = fixture();
    assignment.source.files.push({ path: 'SAMPLE.mjs', sha256: hash('other') });
    expect(validateContract(assignment).valid).toBe(false);
    assignment.source.files.pop(); assignment.source.files[0].sha256 = 'bad';
    expect(validateContract(assignment).valid).toBe(false);
    assignment.source.files[0].sha256 = hash('original'); assignment.budget.timeSeconds = null;
    expect(validateContract(assignment).valid).toBe(false);
  });
});

describe('contract CLI and current source inspection', () => {
  it('parses JSON, distinguishes incomplete exit codes and detects changed or missing bytes without executing checks', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'af-contract-'));
    try {
      const { assignment, result } = fixture();
      assignment.checks[0].command = 'THIS COMMAND MUST NEVER EXECUTE'; result.checks[0].command = assignment.checks[0].command;
      await writeFile(path.join(dir, 'sample.mjs'), 'original');
      await writeFile(path.join(dir, 'assignment.json'), JSON.stringify(assignment));
      await writeFile(path.join(dir, 'result.json'), JSON.stringify(result));
      expect((await main(['assignment.json', 'result.json', '--check-source', '--require-ready'], dir)).exitCode).toBe(0);
      const cli = path.resolve('scripts/check-agent-contract.mjs');
      const stdout = execFileSync(process.execPath, [cli, 'assignment.json', 'result.json', '--check-source'], { cwd: dir, encoding: 'utf8' });
      expect(JSON.parse(stdout)).toMatchObject({ valid: true, ready: true, sourceMatches: true });
      await writeFile(path.join(dir, 'sample.mjs'), 'changed');
      expect(await main(['assignment.json', 'result.json', '--check-source', '--require-ready'], dir)).toMatchObject({
        exitCode: 2, report: { valid: true, ready: false, sourceMatches: false }
      });
      expect((await main(['assignment.json', 'result.json', '--check-source'], dir)).exitCode).toBe(0);
      expect((await readFile(path.join(dir, 'sample.mjs'), 'utf8'))).toBe('changed');
      await rm(path.join(dir, 'sample.mjs'));
      expect((await checkSource(assignment, dir))[0]).toContain('cannot read source');
      assignment.source.files[0].sha256 = null; result.source.files[0].sha256 = null;
      expect(validateContract(assignment, result).ready).toBe(true);
      expect(await checkSource(assignment, dir)).toEqual([]);
      await writeFile(path.join(dir, 'sample.mjs'), 'reappeared');
      expect(await checkSource(assignment, dir)).toEqual(['source expected absent but exists: sample.mjs']);
      await writeFile(path.join(dir, 'result.json'), '{invalid');
      expect((await main(['assignment.json', 'result.json'], dir)).exitCode).toBe(1);
      expect((await main(['assignment.json', '--require-ready'], dir)).exitCode).toBe(1);
      expect((await main(['assignment.json', '--unknown'], dir)).exitCode).toBe(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('confines junction and symlink targets before reading source', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'af-contract-link-'));
    try {
      const inside = path.join(dir, 'workspace'); const outside = path.join(dir, 'outside');
      // Directory junctions are available without Windows developer-mode symlink privileges.
      const { mkdir } = await import('node:fs/promises');
      await mkdir(inside); await mkdir(outside); await writeFile(path.join(outside, 'sample.mjs'), 'original');
      await symlink(outside, path.join(inside, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      const { assignment } = fixture(); assignment.source.files[0].path = 'linked/sample.mjs';
      expect(await checkSource(assignment, inside)).toEqual(['source escapes workspace: linked/sample.mjs']);
      assignment.source.files[0] = { path: 'linked/missing/deleted.mjs', sha256: null };
      expect((await checkSource(assignment, inside))[0]).toContain('ancestor escapes workspace');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
