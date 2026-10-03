import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { consumerReadiness, interactiveEvidence } from '../scripts/dev/consumer-readiness.mjs';
import { recordReturnAttempt } from '../scripts/dev/contract.mjs';
import { diagnoseSandbox, inspectSandboxLog } from '../scripts/dev/environment-diagnosis.mjs';
import { appendEvent, readEvents, reportEvents } from '../scripts/dev/events.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
async function tempRoot() { return mkdtemp(path.join(os.tmpdir(), 'af-issue2-ready-')); }

async function fakeKit(root, version = '0.13.0', name = 'kit') {
  const kit = path.join(root, name);
  await mkdir(path.join(kit, '.claude-plugin'), { recursive: true });
  await mkdir(path.join(kit, 'skills', 'learnings', 'scripts'), { recursive: true });
  await mkdir(path.join(kit, 'lib'), { recursive: true });
  await writeFile(path.join(kit, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'agent-graph-kit', version }));
  // Small test double for the resolver interface: its line parser handles LF and CRLF explicitly.
  await writeFile(path.join(kit, 'skills', 'learnings', 'scripts', 'resolve-scopes.mjs'), [
    "import { readFile } from 'node:fs/promises';",
    "import { readFileSync } from 'node:fs';",
    "export async function parseRegistryMeta(file) { return { repoName: 'auto-factorio', text: await readFile(file, 'utf8') }; }",
    'export function parseRegistry(file) { return readFileSync(file, \'utf8\'); }',
    "export function resolve({ registry }) { const lines = registry.split(/\\r?\\n/); return { scopes: ['development', 'game'].filter(name => lines.some(line => line.trim() === name + ':')) }; }", ''
  ].join('\n'));
  await writeFile(path.join(kit, 'lib', 'check-stack-sections.mjs'), 'process.exit(0);\n');
  return kit;
}

async function readinessRoot(root, { registry = 'repo-name: auto-factorio\nscopes:\n  development:\n  game:\n', profile = true } = {}) {
  await mkdir(path.join(root, '.claude', 'learnings'), { recursive: true });
  await writeFile(path.join(root, '.claude', 'learnings', 'scopes.yaml'), registry);
  if (profile) await writeFile(path.join(root, '.claude', 'stack.md'), '# real profile configuration\nCommands: node test\n');
}

describe('interactive local evidence consumer', () => {
  it('distinguishes unconfigured, empty, corrupt, and healthy streams without inventing trends or usage', async () => {
    const root = await tempRoot();
    try {
      expect(await interactiveEvidence([], root)).toMatchObject({ state: 'unconfigured' });
      await mkdir(path.join(root, '.runtime'), { recursive: true });
      await writeFile(path.join(root, '.runtime', 'empty.jsonl'), '');
      expect(await interactiveEvidence(['.runtime/empty.jsonl'], root)).toMatchObject({ state: 'empty', metrics: null });
      await writeFile(path.join(root, '.runtime', 'corrupt.jsonl'), '{truncated');
      expect(await interactiveEvidence(['.runtime/corrupt.jsonl'], root)).toMatchObject({ state: 'failed', metrics: null, gaps: [{ code: 'incomplete-tail' }] });
      const stream = '.runtime/producer.jsonl';
      await appendEvent(stream, { version: 1, eventId: 'e1', runId: 'run1', workerId: 'worker1', sequence: 0,
        at: new Date().toISOString(), kind: 'start', phase: 'verification', role: 'verification', provenance: 'rule' }, { root });
      const result = await interactiveEvidence([stream], root);
      expect(result).toMatchObject({ state: 'healthy', population: 'selected local events only', trends: null, summary: { eventCount: 1 } });
      expect(result.summary.sessionUsage).toEqual({});
      expect(result.summary.attributedUsage).toBeNull();
      expect(await readEvents([stream], { root })).toMatchObject({ gaps: [], events: [{ eventId: 'e1', provenance: 'rule' }] });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('consumer readiness routing and profile prerequisites', () => {
  it('honors the loaded explicit kit root even when another candidate is coinstalled', async () => {
    const root = await tempRoot();
    try {
      await readinessRoot(root);
      const loaded = await fakeKit(root, '0.13.0', 'loaded-kit');
      const coinstalled = await fakeKit(root, '0.12.0', 'coinstalled-kit');
      const called = [];
      const report = await consumerReadiness({ loadedRoot: loaded, loadedVersion: '0.13.0', capability: true }, {
        root,
        execute: async (_command, args, options) => {
          called.push({ args, configuredRoot: options.env.AGENT_GRAPH_KIT_ROOT });
          if (args.at(-1) === '--where') return { stdout: options.env.AGENT_GRAPH_KIT_ROOT };
          return { stdout: '' };
        },
        discover: async () => ({ state: 'ready', discovery: { authentication: 'chatgpt' } })
      });
      expect(report.checks.resolution).toMatchObject({ state: 'healthy', version: '0.13.0', strategy: 'explicit-loaded-root', coinstalledProviderIndependent: true });
      expect(report.checks.scopes).toMatchObject({ state: 'healthy', crlfSupported: true, cases: { LF: ['development', 'game'], CRLF: ['development', 'game'] } });
      expect(called[0].configuredRoot).toBe(loaded);
      expect(called[0].configuredRoot).not.toBe(coinstalled);
      expect(report.ready).toBe(true);
      expect(report.telemetry.usage).toBeNull();
      const saved = JSON.parse(await readFile(path.join(report.evidence, 'result.json'), 'utf8'));
      expect(saved).toMatchObject({ ready: true, inference: false, telemetry: { usage: null } });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('marks stale loaded version and stale resolved root as failures', async () => {
    const root = await tempRoot();
    try {
      await readinessRoot(root);
      const loaded = await fakeKit(root, '0.13.0', 'loaded-kit');
      const other = await fakeKit(root, '0.12.0', 'other-kit');
      const report = await consumerReadiness({ loadedRoot: loaded, loadedVersion: '0.12.0', capability: false }, {
        root, execute: async (_command, args) => ({ stdout: args.at(-1) === '--where' ? other : '' }),
        discover: async () => ({ state: 'ready' })
      });
      expect(report.checks.resolution).toMatchObject({ state: 'failed' });
      expect(report.ready).toBe(false);
      expect(report.checks.agents.state).toBe('unconfigured');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each([
    ['missing profile', { profile: false, registry: undefined }, 'profile'],
    ['empty scope registry', { profile: true, registry: 'repo-name: auto-factorio\nscopes:\n' }, 'scopes']
  ])('reports %s as an actionable prerequisite gap', async (_name, options, target) => {
    const root = await tempRoot();
    try {
      await readinessRoot(root, options);
      const loaded = await fakeKit(root);
      const report = await consumerReadiness({ loadedRoot: loaded, loadedVersion: '0.13.0', capability: true }, {
        root, execute: async (_command, args, opts) => ({ stdout: args.at(-1) === '--where' ? opts.env.AGENT_GRAPH_KIT_ROOT : '' }),
        discover: async () => ({ state: 'ready' })
      });
      expect(report.ready).toBe(false);
      expect(report.checks[target].state).toBe('failed');
      expect(report.checks[target].remediation ?? report.checks[target].workaround).toEqual(expect.any(String));
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('requires managed capability readiness even when other checks pass', async () => {
    const root = await tempRoot();
    try {
      await readinessRoot(root);
      const loaded = await fakeKit(root);
      const report = await consumerReadiness({ loadedRoot: loaded, loadedVersion: '0.13.0' }, {
        root, execute: async (_command, args, opts) => ({ stdout: args.at(-1) === '--where' ? opts.env.AGENT_GRAPH_KIT_ROOT : '' }),
        discover: async () => ({ state: 'blocked', reason: 'managed capability unavailable' })
      });
      expect(report.checks.agents).toMatchObject({ state: 'blocked', reason: 'managed capability unavailable' });
      expect(report.ready).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('contract return attempt event producer', () => {
  it('records malformed attempts as report-format failures with immutable source and guard provenance', async () => {
    const root = await tempRoot();
    try {
      await mkdir(path.join(root, 'scripts'), { recursive: true });
      await writeFile(path.join(root, 'scripts', 'subject.mjs'), 'export const value = 1;');
      const source = { revision: 'base-1', files: [{ path: 'scripts/subject.mjs', sha256: hash('export const value = 1;') }] };
      const assignment = { version: 1, assignmentId: 'return-attempt-1', role: 'verification', objective: 'Validate report shape', criteria: [{ id: 'C1', description: 'Valid return' }], source,
        scope: [{ path: 'scripts/subject.mjs', boundary: 'Whole file' }], checks: [{ id: 'T1', command: 'node check', expected: 'pass' }],
        allowedActions: ['Run check'], additionalChecks: 'forbidden', resources: [], evidenceDirectory: '.runtime/contracts/return-attempt-1',
        budget: { timeSeconds: 30, providerCalls: 0 }, stopConditions: ['Stop on drift'], returnConditions: ['Return JSON'] };
      const result = { version: 1, assignmentId: assignment.assignmentId, role: 'verification', summary: 'Malformed report', disposition: 'returned',
        source: { ...structuredClone(source), stable: true }, limits: [{ description: 'bad type', affectsCoverage: 'yes' }],
        model: { requested: 'test-model', observed: null, usage: null }, cleanup: [],
        criteria: [{ id: 'C1', status: 'pass', observation: 'pass', evidence: ['.runtime/evidence.log'], checks: ['T1'] }],
        checks: [{ id: 'T1', command: 'node check', authorization: null, status: 'executed', exit: 0, outcome: 'pass', observation: 'pass', evidence: ['.runtime/evidence.log'] }] };
      const before = structuredClone({ assignment, result });
      const summary = await recordReturnAttempt(assignment, result, '.runtime/attempts.jsonl', root);
      expect(summary).toMatchObject({ structurallyValid: false, ready: false });
      expect({ assignment, result }).toEqual(before);
      const attempt = await readEvents(['.runtime/attempts.jsonl'], { root });
      expect(attempt.gaps).toEqual([]);
      expect(attempt.events).toHaveLength(1);
      expect(attempt.events[0]).toMatchObject({ kind: 'failure', failureClass: 'report-format', provenance: 'rule', sourceId: hash(JSON.stringify(source)), assignmentId: assignment.assignmentId });
      expect(attempt.events[0].evidence).toHaveLength(1);
      const recordPath = attempt.events[0].evidence[0];
      const stored = JSON.parse(await readFile(path.join(root, recordPath), 'utf8'));
      expect(stored).toMatchObject({ assignmentId: assignment.assignmentId, source, resultSha256: hash(JSON.stringify(result)), guard: 'scripts/check-agent-contract.mjs', verificationLayer: 'agent-contract' });
      const report = await reportEvents(['.runtime/attempts.jsonl'], '.runtime/reports', { root });
      expect(report).toMatchObject({ counts: { failures: 1 }, failureClasses: { 'report-format': 1 }, eventCount: 1 });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('records truncated result-file bytes through the CLI before returning failure', async () => {
    const root = await tempRoot();
    try {
      await mkdir(path.join(root, 'scripts'), { recursive: true });
      await mkdir(path.join(root, '.runtime'), { recursive: true });
      const sourceBytes = Buffer.from('export const value = 1;');
      await writeFile(path.join(root, 'scripts', 'subject.mjs'), sourceBytes);
      const assignment = { version: 1, assignmentId: 'truncated-return-1', role: 'verification', objective: 'Validate truncated bytes',
        criteria: [{ id: 'C1', description: 'Valid return' }], source: { revision: 'base-1', files: [{ path: 'scripts/subject.mjs', sha256: hash(sourceBytes) }] },
        scope: [{ path: 'scripts/subject.mjs', boundary: 'Whole file' }], checks: [{ id: 'T1', command: 'node check', expected: 'pass' }],
        allowedActions: ['Run check'], additionalChecks: 'forbidden', resources: [], evidenceDirectory: '.runtime/contracts/truncated-return-1',
        budget: { timeSeconds: 30, providerCalls: 0 }, stopConditions: ['Stop on drift'], returnConditions: ['Return JSON'] };
      await writeFile(path.join(root, 'assignment.json'), JSON.stringify(assignment));
      const badBytes = Buffer.from('{"version":1,"checks":[', 'utf8');
      await writeFile(path.join(root, 'bad-result.json'), badBytes);
      const command = spawnSync(process.execPath, [path.resolve('scripts/dev/contract.mjs'), 'validate-return', '--assignment', 'assignment.json',
        '--result', 'bad-result.json', '--events', '.runtime/attempts.jsonl'], { cwd: root, encoding: 'utf8' });
      expect(command.status).toBe(1);
      expect(command.stderr).toContain('Worker return is not valid JSON');
      expect(await readFile(path.join(root, 'bad-result.json'))).toEqual(badBytes);
      const parsed = await readEvents(['.runtime/attempts.jsonl'], { root });
      expect(parsed.gaps).toEqual([]);
      expect(parsed.events).toHaveLength(1);
      expect(parsed.events[0]).toMatchObject({ kind: 'failure', failureClass: 'report-format', outcome: 'fail', assignmentId: assignment.assignmentId });
      const evidence = JSON.parse(await readFile(path.join(root, parsed.events[0].evidence[0]), 'utf8'));
      expect(evidence.resultSha256).toBe(hash(badBytes));
      expect(evidence.summary.errors).toEqual(['Worker return is not valid JSON']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('refuses to append validation evidence to a corrupt existing attempt stream', async () => {
    const root = await tempRoot();
    try {
      await mkdir(path.join(root, 'scripts'), { recursive: true });
      await mkdir(path.join(root, '.runtime'), { recursive: true });
      const bytes = Buffer.from('export const value = 1;');
      await writeFile(path.join(root, 'scripts', 'subject.mjs'), bytes);
      const assignment = { version: 1, assignmentId: 'corrupt-stream-return', role: 'verification', objective: 'Do not overwrite corrupt producer evidence',
        criteria: [{ id: 'C1', description: 'Valid return' }], source: { revision: 'base-1', files: [{ path: 'scripts/subject.mjs', sha256: hash(bytes) }] },
        scope: [{ path: 'scripts/subject.mjs', boundary: 'Whole file' }], checks: [{ id: 'T1', command: 'node check', expected: 'pass' }],
        allowedActions: ['Run check'], additionalChecks: 'forbidden', resources: [], evidenceDirectory: '.runtime/contracts/corrupt-stream-return',
        budget: { timeSeconds: 30, providerCalls: 0 }, stopConditions: ['Stop on drift'], returnConditions: ['Return JSON'] };
      await writeFile(path.join(root, 'assignment.json'), JSON.stringify(assignment));
      const corrupt = Buffer.from('{not-an-event}\n');
      await writeFile(path.join(root, '.runtime', 'attempts.jsonl'), corrupt);
      await writeFile(path.join(root, 'bad-result.json'), '{broken');
      const command = spawnSync(process.execPath, [path.resolve('scripts/dev/contract.mjs'), 'validate-return', '--assignment', 'assignment.json',
        '--result', 'bad-result.json', '--events', '.runtime/attempts.jsonl'], { cwd: root, encoding: 'utf8' });
      expect(command.status).toBe(1);
      expect(command.stderr).toContain('Existing return stream is corrupt');
      expect(await readFile(path.join(root, '.runtime', 'attempts.jsonl'))).toEqual(corrupt);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('sandbox diagnosis privacy and evidence boundaries', () => {
  it('summarizes current signatures and never assigns the historical owner failure as current cause', () => {
    const result = diagnoseSandbox('setup refresh had errors: write ACE grant failed on private path; SetNamedSecurityInfoW in an old note');
    expect(result).toMatchObject({ state: 'failed', signatures: { refreshFailure: 1, writeAclFailure: 1, historicalOwnerFailure: 1 }, rootCause: 'unresolved' });
    expect(result.diagnosis).toContain('application execution has not started');
    expect(JSON.stringify(result)).not.toContain('private path');
    expect(result.exclusions).toContain('Historical ACL ownership is not evidence of the current cause');
  });

  it('reads only a bounded log tail and excludes raw log text from its returned summary', async () => {
    const root = await tempRoot();
    try {
      const file = path.join(root, 'sandbox.log');
      await writeFile(file, `${'private credential and old unrelated data\n'.repeat(40000)}setup refresh had errors: deny ACE failed on C:/private/user\n`);
      const result = await inspectSandboxLog(file);
      expect(result).toMatchObject({ state: 'failed', signatures: { refreshFailure: 1, denyAclFailure: 1 }, truncated: true });
      expect(result.tailBytes).toBeLessThanOrEqual(1024 * 1024);
      expect(JSON.stringify(result)).not.toContain('private credential');
      expect(JSON.stringify(result)).not.toContain('C:/private/user');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
