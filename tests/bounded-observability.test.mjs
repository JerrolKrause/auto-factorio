import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { reportUsage } from '../scripts/dev/usage.mjs';
import { appendEvent, projectEvent, readEvents, reportEvents, summarizeEvents } from '../scripts/dev/events.mjs';
import { boundedJson } from '../scripts/dev/safe-artifacts.mjs';
import { discoverCodex, escalationPacket, parseRouting, selectTask, validateVerificationRoute } from '../scripts/dev/task.mjs';

const execute = promisify(execFile);
const roots = [];
const activeChangeDirectory = path.resolve('openspec/changes/af-bounded-verification-observability');
const changeDirectory = existsSync(path.join(activeChangeDirectory, 'tasks.md'))
  ? activeChangeDirectory
  : path.resolve('openspec/changes/archive/2026-10-01-af-bounded-verification-observability');
const privacySentinel = 'PRIVATE_SENTINEL_credential_prompt_fixture_reasoning';
const at = seconds => new Date(Date.UTC(2026, 9, 1, 12, 0, seconds)).toISOString();
const usage = (input, cachedInput = 0, output = 0, reasoning = 0) => ({ input, cachedInput, output, reasoning });
const currentUsage = value => ({ input_tokens: value.input, cached_input_tokens: value.cachedInput, output_tokens: value.output, reasoning_output_tokens: value.reasoning });
const metadata = (id, parent) => ({ type: 'session_meta', payload: { id, source: parent ? { subagent: { thread_spawn: { parent_thread_id: parent } } } : 'cli' } });
const context = (model = 'gpt-6.1-sol', effort = 'high') => ({ type: 'turn_context', payload: { model, effort } });
const checkpoint = (seconds, total, last = total) => ({ type: 'event_msg', timestamp: at(seconds), payload: { type: 'token_count', info: { total_token_usage: currentUsage(total), last_token_usage: currentUsage(last) } } });
const event = (id, sequence, seconds, extra = {}) => ({ version: 1, eventId: id, runId: 'run-1', workerId: 'worker-1', at: at(seconds), sequence, kind: 'budget', phase: 'verification', ...extra });
async function temporary() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'af-bounded-observability-'));
  roots.push(root);
  return root;
}
async function lines(file, records, tail = '') {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${records.map(record => JSON.stringify(record)).join('\n')}\n${tail}`, 'utf8');
}
async function rollout(records) {
  const directory = await temporary();
  await lines(path.join(directory, '2026/10/01/root.jsonl'), [metadata('root'), ...records]);
  return directory;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('bounded usage with sanitized current rollout shapes', () => {
  it('discovers nested proven descendants and counts explicitly mapped descendants once', async () => {
    const directory = await rollout([context(), checkpoint(1, usage(100, 30, 20, 8)), checkpoint(2, usage(140, 40, 35, 12)), checkpoint(3, usage(140, 40, 35, 12))]);
    await lines(path.join(directory, '2026/10/02/child.jsonl'), [metadata('child', 'root'), context('gpt-6-luna', 'medium'), checkpoint(4, usage(15, 3, 8, 2))]);
    await lines(path.join(directory, '2026/10/02/grandchild.jsonl'), [metadata('grandchild', 'child'), context('gpt-6-luna', 'high'), checkpoint(5, usage(5, 1, 2, 1))]);
    await lines(path.join(directory, '2026/10/02/unrelated.jsonl'), [metadata('unrelated'), { type: 'response_item', payload: { content: privacySentinel } }, checkpoint(6, usage(99999, 0, 99999))], '{malformed-unrelated');
    const report = await reportUsage({ rolloutDirectory: directory, rootSessionId: 'root', mappings: [{ runId: 'mapped-child', sessionId: 'child' }] });
    expect(report.sessions.map(row => row.sessionId).sort()).toEqual(['child', 'grandchild', 'root']);
    expect(report.usage).toEqual(usage(160, 44, 45, 15));
    expect(report.uncachedInput).toBe(116);
    expect(report.unrelatedSessionCount).toBe(1);
    expect(report.coverage).toMatchObject({ aggregate: true, complete: true, response: false, model: true, phase: false });
    expect(report.coverage.gaps).toEqual([]);
    expect(report.coverage.attributionGaps.map(row => row.code)).toContain('missing-response-identity');
    expect(report.sessions.find(row => row.sessionId === 'root')).toMatchObject({ model: 'gpt-6.1-sol', effort: 'high', representation: 'cumulative', aggregateComplete: true });
    expect(JSON.stringify(report)).not.toContain(privacySentinel);
    expect(JSON.stringify(report)).not.toContain('99999');
  });

  it('retains known aggregate while a model switch without boundary samples stays unallocated', async () => {
    const directory = await rollout([context('gpt-6.1-sol'), checkpoint(1, usage(20, 4, 5, 2)), context('gpt-6-astra', 'medium'), checkpoint(4, usage(80, 20, 30, 10))]);
    const report = await reportUsage({ rolloutDirectory: directory, rootSessionId: 'root' });
    expect(report.usage).toEqual(usage(80, 20, 30, 10));
    expect(report.coverage).toMatchObject({ aggregate: true, model: false, phase: false });
    expect(report.sessions[0].breakdown).toEqual([
      { model: 'gpt-6.1-sol', effort: 'high', tier: null, usage: usage(20, 4, 5, 2) },
      { model: null, effort: null, tier: null, usage: usage(60, 16, 25, 8) },
    ]);
    expect(report.coverage.attributionGaps.map(row => row.code)).toContain('model-allocation-unknown');
  });

  it('marks a reset unknown rather than treating the smaller final endpoint as a complete total', async () => {
    const directory = await rollout([context(), checkpoint(1, usage(50, 10, 20, 5)), checkpoint(2, usage(7, 1, 3, 1))]);
    const report = await reportUsage({ rolloutDirectory: directory, rootSessionId: 'root' });
    expect(report.coverage.aggregate).toBe(false);
    expect(report.sessions[0].aggregateComplete).toBe(false);
    expect(report.coverage.gaps.map(row => row.code)).toContain('cumulative-counter-reset');
  });

  it('deduplicates stable responses and compaction while preserving conflicting response evidence', async () => {
    const response = { type: 'response_usage', timestamp: at(1), responseId: 'response-1', usage: usage(10, 2, 6, 3) };
    const compact = { type: 'compaction', timestamp: at(2), responseId: 'compact-1', compactionUsage: usage(3, 0, 2, 1) };
    const directory = await rollout([context(), response, response, compact, compact]);
    const report = await reportUsage({ rolloutDirectory: directory, rootSessionId: 'root' });
    expect(report.usage).toEqual(usage(13, 2, 8, 4));
    expect(report.coverage.aggregate).toBe(true);
    await lines(path.join(directory, '2026/10/01/root.jsonl'), [metadata('root'), context(), response, { ...response, usage: usage(11, 2, 6, 3) }, compact]);
    const conflict = await reportUsage({ rolloutDirectory: directory, rootSessionId: 'root' });
    expect(conflict.usage).toEqual(usage(13, 2, 8, 4));
    expect(conflict.coverage.aggregate).toBe(false);
    expect(conflict.coverage.gaps.map(row => row.code)).toContain('conflicting-response-usage');
  });

  it.each([
    ['usage', { compactionUsage: usage(9, 0, 2, 1) }, ['conflicting-compaction-usage']],
    ['inclusion', { compactionIncludedInCumulative: false }, ['conflicting-compaction-usage', 'conflicting-compaction-inclusion']],
  ])('rejects conflicting duplicate compaction %s rather than silently accepting the first charge', async (_name, changed, gaps) => {
    const compact = { type: 'compaction', timestamp: at(1), responseId: 'compact-identity', compactionUsage: usage(3, 0, 2, 1), compactionIncludedInCumulative: true };
    const directory = await rollout([context(), compact, { ...compact, ...changed }, checkpoint(2, usage(20, 5, 10, 2))]);
    const report = await reportUsage({ rolloutDirectory: directory, rootSessionId: 'root' });
    expect(report.usage).toEqual(usage(20, 5, 10, 2));
    expect(report.coverage).toMatchObject({ aggregate: false, compaction: false });
    expect(report.coverage.gaps.map(row => row.code)).toEqual(expect.arrayContaining(gaps));
  });

  it.each([[50, false], [200, true]])('reconciles known response subset against cumulative input %i despite missing response identities', async (input, complete) => {
    const directory = await rollout([
      context(),
      { type: 'response_usage', timestamp: at(1), responseId: 'known-response', usage: usage(100, 20, 10, 3) },
      { type: 'response_usage', timestamp: at(2), usage: usage(20, 5, 4, 1) },
      checkpoint(3, usage(input, 30, 20, 5)),
    ]);
    const report = await reportUsage({ rolloutDirectory: directory, rootSessionId: 'root' });
    expect(report.usage).toEqual(usage(input, 30, 20, 5));
    expect(report.coverage).toMatchObject({ aggregate: complete, response: false });
    expect(report.sessions[0].aggregateComplete).toBe(complete);
    expect(report.coverage.attributionGaps.map(row => row.code)).toContain('missing-response-identity');
    expect(report.coverage.gaps.some(row => row.code === 'representation-disagreement')).toBe(!complete);
  });

  it.each([[50, false], [200, true]])('does not let excluded compaction mask a known response subset exceeding cumulative input %i', async (input, complete) => {
    const directory = await rollout([
      context(),
      { type: 'response_usage', timestamp: at(1), responseId: 'known-response', usage: usage(100) },
      { type: 'response_usage', timestamp: at(2), usage: usage(1) },
      { type: 'compaction', timestamp: at(3), responseId: 'excluded-compaction', compactionUsage: usage(60), compactionIncludedInCumulative: false },
      checkpoint(4, usage(input)),
    ]);
    const report = await reportUsage({ rolloutDirectory: directory, rootSessionId: 'root' });
    expect(report.usage).toEqual(usage(input + 60));
    expect(report.coverage).toMatchObject({ aggregate: complete, response: false, compaction: true });
    expect(report.sessions[0].aggregateComplete).toBe(complete);
    expect(report.coverage.attributionGaps.map(row => row.code)).toContain('missing-response-identity');
    const disagreements = report.coverage.gaps.filter(row => row.code === 'representation-disagreement');
    expect(disagreements).toHaveLength(complete ? 0 : 1);
    if (!complete) expect(disagreements[0]).toMatchObject({ responseSubset: usage(100), cumulative: usage(50) });
  });

  it.each([[false, true], [true, false]])('reconciles included/excluded compactions per identity with unknown metadata %s', async (missingMetadata, complete) => {
    const included = { type: 'compaction', timestamp: at(1), responseId: 'included', compactionUsage: usage(3, 0, 1), compactionIncludedInCumulative: true };
    const excluded = { type: 'compaction', timestamp: at(2), responseId: 'excluded', compactionUsage: usage(4, 1, 2, 1), compactionIncludedInCumulative: false };
    const records = [context(), included, excluded, included, excluded];
    if (missingMetadata) records.push({ type: 'compaction', timestamp: at(3), responseId: 'unresolved', compactionUsage: usage(5, 0, 2) });
    records.push(checkpoint(4, usage(100, 20, 10, 3)));
    const directory = await rollout(records);
    const report = await reportUsage({ rolloutDirectory: directory, rootSessionId: 'root' });
    expect(report.usage).toEqual(usage(104, 21, 12, 4));
    expect(report.coverage).toMatchObject({ aggregate: complete, compaction: complete });
    expect(report.coverage.gaps.some(row => row.code === 'compaction-inclusion-unknown')).toBe(missingMetadata);
    expect(report.coverage.gaps.some(row => row.code === 'conflicting-compaction-inclusion')).toBe(false);
  });

  it.each([[true, 20], [false, 23], [undefined, 20]])('uses cumulative compaction inclusion %s without double charging', async (included, input) => {
    const compact = { type: 'compaction', timestamp: at(1), responseId: 'compact-1', compactionUsage: usage(3, 0, 1), compactionIncludedInCumulative: included };
    const directory = await rollout([context(), compact, compact, checkpoint(2, usage(20, 5, 10, 2))]);
    const report = await reportUsage({ rolloutDirectory: directory, rootSessionId: 'root' });
    expect(report.usage.input).toBe(input);
    expect(report.coverage.compaction).toBe(included !== undefined);
    expect(report.coverage.aggregate).toBe(included !== undefined);
  });

  it('establishes interval deltas with a baseline and excludes later checkpoints', async () => {
    const directory = await rollout([context(), checkpoint(0, usage(10, 2, 4, 1)), checkpoint(3, usage(40, 8, 12, 4)), checkpoint(9, usage(999, 10, 200, 5))]);
    const report = await reportUsage({ rolloutDirectory: directory, rootSessionId: 'root', start: at(1), cutoff: at(5) });
    expect(report.usage).toEqual(usage(30, 6, 8, 3));
    expect(report.coverage.aggregate).toBe(true);
  });

  it('runs the production usage CLI with a bounded private-field-free projection', async () => {
    const directory = await rollout([context(), { type: 'response_item', payload: { content: privacySentinel } }, checkpoint(1, usage(20, 5, 10, 3))]);
    const root = await temporary();
    const result = await execute(process.execPath, [path.resolve('scripts/dev/usage.mjs'), '--rollouts', directory, '--root', 'root', '--output', '.runtime/usage.json'], { cwd: root });
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(4096);
    const report = JSON.parse(await readFile(path.join(root, '.runtime/usage.json'), 'utf8'));
    expect(report.usage).toEqual(usage(20, 5, 10, 3));
    expect(report.coverage.aggregate).toBe(true);
    expect(result.stdout + JSON.stringify(report)).not.toContain(privacySentinel);
  });
});

describe('correlated event streams and bounded projections', () => {
  it('deduplicates identities, retains repair lineage and reports conflicting/tail gaps', async () => {
    const root = await temporary();
    const first = event('failure-1', 1, 1, { kind: 'failure', invariantId: 'ownership', findingId: 'finding-1', failureClass: 'infrastructure', provenance: 'rule', evidence: ['.runtime/evidence/result.json'] });
    const replacement = event('admission-2', 1, 2, { kind: 'admission', workerId: 'worker-2', predecessorId: 'worker-1', parentEventId: first.eventId, invariantId: 'ownership', rerunReason: 'environment-repair' });
    await lines(path.join(root, '.runtime/a.jsonl'), [first, first]);
    await lines(path.join(root, '.runtime/b.jsonl'), [replacement, { ...first, failureClass: 'product' }], '{"version":');
    const parsed = await readEvents(['.runtime/b.jsonl', '.runtime/a.jsonl'], { root });
    expect(parsed.events).toHaveLength(2);
    expect(parsed.gaps.map(row => row.code)).toEqual(expect.arrayContaining(['conflicting-event', 'incomplete-tail']));
    expect(parsed.events.find(row => row.eventId === 'admission-2')).toMatchObject({ parentEventId: 'failure-1', predecessorId: 'worker-1', invariantId: 'ownership', rerunReason: 'environment-repair' });
    const summary = summarizeEvents(parsed);
    expect(summary.counts).toMatchObject({ failures: 1, correctiveRounds: 1, executed: 0 });
    expect(summary.realSavingsMeasured).toBe(false);
  });

  it('distinguishes summed process duration, overlap union, elapsed wall time and incomplete attempts', () => {
    const records = [
      event('a-start', 1, 0, { kind: 'start', checkId: 'a', attemptId: 'one' }),
      event('b-start', 2, 5, { kind: 'start', checkId: 'b', attemptId: 'one' }),
      event('a-end', 3, 10, { kind: 'end', checkId: 'a', attemptId: 'one' }),
      event('b-end', 4, 15, { kind: 'end', checkId: 'b', attemptId: 'one' }),
      event('c-start', 5, 30, { kind: 'start', checkId: 'c', attemptId: 'one' }),
      event('c-end', 6, 35, { kind: 'end', checkId: 'c', attemptId: 'one' }),
      event('interrupted', 7, 36, { kind: 'start', checkId: 'd', attemptId: 'one' }),
    ].map(projectEvent);
    const summary = summarizeEvents({ events: records, gaps: [] });
    expect(summary.durations).toEqual({ summedDurationMs: 25000, activeDurationMs: 20000, elapsedRunMs: 35000 });
    expect(summary.incompleteAttempts).toBe(1);
    expect(summary.counts.executed).toBe(3);
  });

  it('orders by causal parent across workers even when timestamps and input order disagree', async () => {
    const root = await temporary();
    const parent = event('parent', 10, 10, { workerId: 'z-worker', kind: 'start', sessionId: 'session-1', usage: usage(10, 2, 3, 1) });
    const child = event('child', 0, 5, { workerId: 'a-worker', parentEventId: 'parent', sessionId: 'session-1', usage: usage(20, 4, 6, 2) });
    await lines(path.join(root, '.runtime/child.jsonl'), [child]);
    await lines(path.join(root, '.runtime/parent.jsonl'), [parent]);
    const parsed = await readEvents(['.runtime/child.jsonl', '.runtime/parent.jsonl'], { root });
    expect(parsed.events.map(row => row.eventId)).toEqual(['parent', 'child']);
    expect(parsed.gaps).toEqual([]);
    expect(summarizeEvents(parsed).sessionUsage['session-1'].usage).toEqual(usage(20, 4, 6, 2));
  });

  it('preserves every writer predecessor when a replacement depends on a later parent checkpoint', async () => {
    const root = await temporary();
    const prior = event('z-prior', 0, 0, { workerId: 'z-worker', kind: 'start', checkId: 'check-one', attemptId: 'attempt-one', sessionId: 'session-one', usage: usage(20, 2, 4, 1) });
    const parent = event('z-parent', 1, 10, { workerId: 'z-worker', kind: 'end', checkId: 'check-one', attemptId: 'attempt-one', sessionId: 'session-one', usage: usage(40, 4, 8, 2) });
    const child = event('a-child', 0, 11, { workerId: 'a-worker', parentEventId: parent.eventId, predecessorId: 'z-worker', sessionId: 'session-one', usage: usage(60, 6, 12, 3) });
    await lines(path.join(root, '.runtime/z.jsonl'), [prior, parent]);
    await lines(path.join(root, '.runtime/a.jsonl'), [child]);
    const parsed = await readEvents(['.runtime/a.jsonl', '.runtime/z.jsonl'], { root });
    expect(parsed.events.map(row => row.eventId)).toEqual(['z-prior', 'z-parent', 'a-child']);
    expect(parsed.gaps).toEqual([]);
    const summary = summarizeEvents(parsed);
    expect(summary.sessionUsage['session-one']).toMatchObject({ usage: usage(60, 6, 12, 3), eventId: 'a-child' });
    expect(summary.durations).toEqual({ summedDurationMs: 10000, activeDurationMs: 10000, elapsedRunMs: 10000 });
    expect(summary.incompleteAttempts).toBe(0);
    expect(summary.counts.executed).toBe(1);
  });

  it('exposes missing parents, reused writer sequence and causal cycles without synthesizing completion', async () => {
    const root = await temporary();
    await lines(path.join(root, '.runtime/gaps.jsonl'), [
      event('missing-parent', 0, 0, { kind: 'start', checkId: 'incomplete', parentEventId: 'absent' }),
      event('same-sequence', 0, 1),
      event('cycle-a', 2, 2, { parentEventId: 'cycle-b' }),
      event('cycle-b', 3, 3, { parentEventId: 'cycle-a' }),
    ]);
    const parsed = await readEvents(['.runtime/gaps.jsonl'], { root });
    expect(parsed.events).toHaveLength(4);
    expect(parsed.gaps.map(row => row.code)).toEqual(expect.arrayContaining(['missing-parent-event', 'conflicting-sequence', 'causal-cycle']));
    const summary = summarizeEvents(parsed);
    expect(summary.counts.executed).toBe(0);
    expect(summary.incompleteAttempts).toBe(1);
    expect(summary.durations.elapsedRunMs).toBeNull();
  });

  it('counts a failure and end on the same attempt as one process interval', () => {
    const records = [event('start', 0, 0, { kind: 'start', checkId: 'test', attemptId: 'one' }), event('failure', 1, 10, { kind: 'failure', checkId: 'test', attemptId: 'one', outcome: 'fail' }), event('end', 2, 10, { kind: 'end', checkId: 'test', attemptId: 'one', outcome: 'fail', exit: 1 })].map(projectEvent);
    const summary = summarizeEvents({ events: records, gaps: [] });
    expect(summary.durations.summedDurationMs).toBe(10000);
    expect(summary.incompleteAttempts).toBe(0);
  });

  it('retains the latest cumulative usage once across replacement and preserves unknown phase allocation', () => {
    const records = [event('checkpoint-1', 0, 0, { sessionId: 'session-1', phase: 'authoring', usage: usage(20, 5, 4, 2) }), event('checkpoint-2', 1, 1, { sessionId: 'session-1', workerId: 'worker-2', predecessorId: 'worker-1', phase: 'unknown', usage: usage(40, 10, 8, 3) })].map(projectEvent);
    const summary = summarizeEvents({ events: records, gaps: [] });
    expect(summary.sessionUsage['session-1']).toMatchObject({ usage: usage(40, 10, 8, 3), phase: 'unknown', model: null });
    expect(summary.attributedUsage).toBeNull();
  });

  it('drops private unknown fields at both writer and raw reader boundaries and labels omitted detail', async () => {
    const root = await temporary();
    const raw = event('private-1', 1, 1, { prompt: privacySentinel, hiddenReasoning: privacySentinel, environment: { SECRET: privacySentinel }, snapshot: { evaluator: privacySentinel }, evidence: ['.runtime/safe.json', '../escape', privacySentinel], expected: privacySentinel, actual: true });
    const projected = await appendEvent('.runtime/writer.jsonl', raw, { root });
    await lines(path.join(root, '.runtime/raw.jsonl'), [{ ...raw, eventId: 'private-2' }]);
    expect(projected.omittedFields).toBeGreaterThan(0);
    expect(projected.evidence).toEqual(['.runtime/safe.json']);
    const summary = await reportEvents(['.runtime/writer.jsonl', '.runtime/raw.jsonl'], '.runtime/report', { root });
    const exported = (await readFile(path.join(root, '.runtime/report/summary.json'), 'utf8')) + (await readFile(path.join(root, '.runtime/report/report.md'), 'utf8'));
    expect(summary.eventCount).toBe(2);
    expect(exported).not.toContain(privacySentinel);
    expect(await readFile(path.join(root, '.runtime/writer.jsonl'), 'utf8')).not.toContain(privacySentinel);
  });

  it('does not include unknown fields from externally supplied usage in shared reports', async () => {
    const root = await temporary();
    await lines(path.join(root, '.runtime/events.jsonl'), [event('one', 1, 1)]);
    await reportEvents(['.runtime/events.jsonl'], '.runtime/report', { root, usageReport: { version: 2, usage: usage(10, 2, 3, 1), coverage: { aggregate: true, phase: false }, prompt: privacySentinel, environment: { SECRET: privacySentinel } } });
    for (const file of ['summary.json', 'report.md']) expect(await readFile(path.join(root, '.runtime/report', file), 'utf8')).not.toContain(privacySentinel);
  });

  it('caps UTF-8 Unicode JSON at 4 KiB and 64 KiB and labels truncation', () => {
    const source = { detail: '🛠️漢字'.repeat(30000), count: 30000 };
    for (const cap of [4096, 65536]) {
      const output = boundedJson(source, cap);
      expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(cap);
      const parsed = JSON.parse(output);
      expect(parsed.truncated).toBe(true);
      expect(parsed.originalBytes).toBe(Buffer.byteLength(JSON.stringify(source), 'utf8'));
    }
  });

  it('caps production JSON, Markdown and console for oversized correlated streams', async () => {
    const root = await temporary();
    await lines(path.join(root, '.runtime/events.jsonl'), Array.from({ length: 1800 }, (_, index) => event(`event-${String(index).padStart(5, '0')}-${'x'.repeat(100)}`, index, index, { checkId: `check-${index}`, kind: 'failure', failureClass: 'unknown' })));
    await reportEvents(['.runtime/events.jsonl'], '.runtime/report', { root });
    const json = await readFile(path.join(root, '.runtime/report/summary.json'), 'utf8');
    expect(Buffer.byteLength(json, 'utf8')).toBeLessThanOrEqual(65536);
    expect(JSON.parse(json).truncated).toBe(true);
    expect(Buffer.byteLength(await readFile(path.join(root, '.runtime/report/report.md'), 'utf8'), 'utf8')).toBeLessThanOrEqual(65536);
    const result = await execute(process.execPath, [path.resolve('scripts/dev/events.mjs'), '.runtime/events.jsonl', '--output', '.runtime/cli-report'], { cwd: root });
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(4096);
    expect(JSON.parse(result.stdout).eventCount).toBe(1800);
  });
});

describe('task-owned scenario and routing boundaries', () => {
  it('returns a bounded unfamiliar-race diagnosis packet through the production CLI without inference or private fields', async () => {
    const root = await temporary();
    const input = { assignmentId: 'assignment-race', invariantId: 'ownership-race', evidence: ['.runtime/evidence/race.json'], nextCheckId: 'check-owner-start-time', currentModel: 'gpt-6-luna', transcript: privacySentinel, secret: privacySentinel, hiddenReasoning: privacySentinel };
    const expected = { version: 1, state: 'blocked', assignmentId: input.assignmentId, invariantId: input.invariantId, evidence: input.evidence, nextCheckId: input.nextCheckId, recommended: { model: 'gpt-6.1-sol', effort: 'high' }, admissionRequiresCapabilityCheck: true, sharedBudgetPreserved: true, automaticLaunch: false, authorizesInference: false };
    expect(escalationPacket(input)).toEqual(expected);
    const file = path.join(root, 'diagnosis.json');
    await writeFile(file, JSON.stringify(input), 'utf8');
    const result = await execute(process.execPath, [path.resolve('scripts/dev/task.mjs'), '--escalation', file, '--codex', 'fixture-nonexistent-codex.exe'], { cwd: root });
    expect(JSON.parse(result.stdout)).toEqual(expected);
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(4096);
    expect(result.stdout).not.toContain(privacySentinel);
    await expect(readFile(path.join(root, '.runtime'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['../private.json', '.runtime/../private.json', '.runtime\\private.json'])('refuses diagnosis evidence outside the confined packet boundary: %s', evidence => {
    expect(() => escalationPacket({ assignmentId: 'assignment-race', invariantId: 'ownership-race', evidence: [evidence], nextCheckId: 'check-owner', currentModel: 'gpt-6-luna' })).toThrow('invalid diagnosis identity/evidence');
  });

  function fakeManagedDiscovery(overrides = {}) {
    const calls = [];
    const replies = {
      initialize: {},
      'account/read': { account: { type: 'chatgpt', planType: 'fixture' } },
      getAuthStatus: { authMethod: 'chatgpt' },
      'model/list': { data: [
        { model: 'gpt-6-luna', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'high' }] },
        { model: 'gpt-6.1-sol', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] },
      ], nextCursor: null },
      'account/rateLimits/read': { ordinaryUsageAllowed: true },
      ...overrides,
    };
    const spawnProcess = (_executable, args, options) => {
      calls.push({ args, options });
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stdin = new PassThrough();
      child.stdin.setEncoding('utf8');
      child.kill = () => { child.emit('exit', 0); };
      let buffer = '';
      child.stdin.on('data', chunk => {
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const request = JSON.parse(line);
          calls.push({ method: request.method, params: request.params });
          if (request.id !== undefined) queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: request.id, result: replies[request.method] })}\n`));
        }
      });
      return child;
    };
    return { calls, discover: (executable, model, effort, options) => discoverCodex(executable, model, effort, { ...options, spawnProcess }) };
  }

  it.each([['gpt-6-luna', 'medium'], ['gpt-6-luna', 'high'], ['gpt-6.1-sol', 'high']])('admits supported managed verification %s/%s using read-only fake discovery', async (model, effort) => {
    const fake = fakeManagedDiscovery();
    const result = await validateVerificationRoute({ model, effort, executable: 'fixture-codex' }, { discover: fake.discover });
    expect(result).toMatchObject({ state: 'ready', model, effort, authorizesInference: false, discovery: { authentication: 'chatgpt' } });
    expect(fake.calls[0].args).toContain('forced_login_method="chatgpt"');
    const methods = fake.calls.map(call => call.method).filter(Boolean);
    expect(methods).toEqual(['initialize', 'initialized', 'account/read', 'getAuthStatus', 'model/list', 'account/rateLimits/read']);
    expect(methods.some(method => /thread|turn|response/.test(method))).toBe(false);
  });

  it.each([
    [{ 'account/read': { account: { type: 'api' } } }, 'ChatGPT'],
    [{ getAuthStatus: { authMethod: 'api' } }, 'ChatGPT'],
    [{ 'model/list': { data: [{ model: 'gpt-6-sol', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }], nextCursor: null } }, 'model unavailable'],
    [{ 'model/list': { data: [{ model: 'gpt-6-luna', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }], nextCursor: null } }, 'effort unavailable'],
    [{ 'account/rateLimits/read': { ordinaryUsageAllowed: false } }, 'allowance exhausted'],
  ])('blocks unavailable authentication, model, effort or included allowance with no fallback', async (overrides, reason) => {
    const fake = fakeManagedDiscovery(overrides);
    const result = await validateVerificationRoute({ model: 'gpt-6-luna', effort: 'medium', executable: 'fixture-codex' }, { discover: fake.discover });
    expect(result).toMatchObject({ state: 'blocked', model: 'gpt-6-luna', effort: 'medium', authorizesInference: false });
    expect(result.reason).toContain(reason);
    expect(fake.calls.filter(call => call.args)).toHaveLength(1);
    expect(fake.calls.map(call => call.method).filter(Boolean).some(method => /thread|turn|response/.test(method))).toBe(false);
  });

  it.each([['gpt-6-sol', 'high'], ['gpt-6.1-sol', 'medium'], ['gpt-6-astra', 'medium']])('rejects unsupported verification route %s/%s before discovery', async (model, effort) => {
    let calls = 0;
    const result = await validateVerificationRoute({ model, effort }, { discover: () => { calls++; throw new Error('must not discover'); } });
    expect(result).toMatchObject({ state: 'blocked', model, effort });
    expect(result.reason).toContain('no fallback');
    expect(calls).toBe(0);
  });

  it('owns all 30 delta scenarios exactly once with A11/B13/C6 and A -> B -> C prerequisites', async () => {
    const manifest = JSON.parse(await readFile(path.join(changeDirectory, 'acceptance.json'), 'utf8'));
    const scenarios = [];
    for (const capability of ['development-efficiency', 'verification-orchestration']) {
      const specification = await readFile(path.join(changeDirectory, 'specs', capability, 'spec.md'), 'utf8');
      for (const match of specification.matchAll(/^#### Scenario: (.+)$/gm)) scenarios.push({ capability, name: match[1].trim() });
    }
    expect(scenarios).toHaveLength(30);
    expect(manifest.scenarios).toHaveLength(30);
    expect(new Set(manifest.scenarios.map(row => row.id)).size).toBe(30);
    expect(manifest.scenarios.map(row => `${row.capability}/${row.name}`).sort()).toEqual(scenarios.map(row => `${row.capability}/${row.name}`).sort());
    expect(manifest.slices.map(slice => [slice.id, slice.scenarios.length, slice.prerequisites])).toEqual([['A', 11, []], ['B', 13, ['A']], ['C', 6, ['A', 'B']]]);
    const ownership = manifest.slices.flatMap(slice => slice.scenarios);
    expect(ownership).toHaveLength(30);
    expect(new Set(ownership).size).toBe(30);
    expect(ownership.sort()).toEqual(manifest.scenarios.map(row => row.id).sort());
    expect(manifest.sessionPlan.live).toMatchObject({ maxLaunches: 2, maxWallMs: 900000 });
    expect(manifest.sessionPlan.limits.some(limit => limit.closeoutReserve > 0)).toBe(true);
  });

  it('preserves current-generation author routing, dedicated verification and reviewer inheritance without starting', async () => {
    const root = await temporary();
    const markdown = (await readFile(path.join(changeDirectory, 'tasks.md'), 'utf8')).replace(/^- \[[xX]\]/gm, '- [ ]');
    const tasksFile = path.join(root, 'tasks.md');
    await writeFile(tasksFile, markdown, 'utf8');
    const table = parseRouting(markdown);
    expect(table.size).toBe(17);
    expect(table.get('1.2')).toMatchObject({ model: 'gpt-6.1-sol', effort: 'high', role: 'author' });
    expect(table.get('1.5')).toMatchObject({ model: 'gpt-6-luna', effort: 'medium', role: 'verification' });
    expect(table.get('2.5')).toMatchObject({ model: 'gpt-6.1-sol', effort: 'high', role: 'verification' });
    expect(table.get('1.6')).toMatchObject({ model: 'inherit-author', effort: 'inherit-author', role: 'review' });
    const forbidden = () => { throw new Error('fixture must not dispatch discovery or inference'); };
    const dependencies = { discover: forbidden, launch: forbidden };
    const preview = await selectTask({ tasksFile, taskId: '1.2' }, dependencies);
    expect(preview).toMatchObject({ started: false, effective: { model: 'gpt-6.1-sol', effort: 'high' } });
    expect(await selectTask({ tasksFile, taskId: '1.5', start: true }, dependencies)).toMatchObject({ started: false, dedicatedWorkflow: 'verification' });
    expect(await selectTask({ tasksFile, taskId: '1.6', start: true }, dependencies)).toMatchObject({ started: false, dedicatedWorkflow: 'review' });
  });

  it('runs the production task CLI author preview without starting managed discovery or inference', async () => {
    const root = await temporary();
    const localChange = path.join(root, 'openspec/changes/af-bounded-verification-observability');
    await mkdir(localChange, { recursive: true });
    const markdown = (await readFile(path.join(changeDirectory, 'tasks.md'), 'utf8')).replace(/^- \[[xX]\]/gm, '- [ ]');
    await writeFile(path.join(localChange, 'tasks.md'), markdown, 'utf8');
    // An absent executable makes any accidental discovery fail instead of reaching a provider.
    const result = await execute(process.execPath, [path.resolve('scripts/dev/task.mjs'), '--change', 'af-bounded-verification-observability', '--task', '1.2', '--codex', 'fixture-nonexistent-codex.exe'], { cwd: root });
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(4096);
    expect(JSON.parse(result.stdout)).toMatchObject({ started: false, task: { id: '1.2', role: 'author' }, recommendation: { model: 'gpt-6.1-sol', effort: 'high' }, effective: { model: 'gpt-6.1-sol', effort: 'high' } });
    await expect(readFile(path.join(root, '.runtime'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
