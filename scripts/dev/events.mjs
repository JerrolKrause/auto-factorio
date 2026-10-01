import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundedJson, safeRuntimePath } from './safe-artifacts.mjs';

const kinds = new Set(['admission', 'start', 'end', 'failure', 'reuse', 'cleanup', 'budget', 'finding', 'disposition', 'escalation', 'handoff']);
const phases = new Set(['authoring', 'diagnosis', 'verification', 'review', 'gameplay', 'unknown']);
const failureClasses = new Set(['product', 'harness/setup', 'infrastructure', 'coverage-gap', 'stale-evidence', 'report-format', 'unknown']);
const reasons = new Set(['new-defect', 'incomplete-fix', 'introduced-regression', 'environment-repair', 'coverage-expansion', 'justified-repeat', 'unknown']);
const identifiers = ['eventId', 'runId', 'workerId', 'parentEventId', 'change', 'slice', 'candidate', 'sessionId', 'assignmentId', 'checkId', 'attemptId', 'invariantId', 'findingId', 'predecessorId', 'sourceId'];
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_.:/-]{1,180}$/.test(value) && !value.includes('..');
const count = value => Number.isFinite(value) && value >= 0;

/** Allowlist metadata at the write AND read boundary. No prompts, environments or snapshots. */
export function projectEvent(input) {
  if (input?.version !== 1 || !kinds.has(input.kind) || !identifier(input.eventId) || !identifier(input.runId) || !Number.isInteger(input.sequence) || input.sequence < 0 || !Number.isFinite(Date.parse(input.at))) throw new Error('invalid event envelope');
  const event = { version: 1, kind: input.kind, at: new Date(input.at).toISOString(), sequence: input.sequence };
  for (const field of identifiers) if (input[field] !== undefined && input[field] !== null) {
    if (!identifier(input[field])) throw new Error(`invalid event ${field}`);
    event[field] = input[field];
  }
  event.phase = phases.has(input.phase) ? input.phase : 'unknown';
  event.role = ['author', 'verification', 'review', 'gameplay'].includes(input.role) ? input.role : 'unknown';
  for (const field of ['requestedModel', 'observedModel']) if (input[field] !== undefined) event[field] = /^gpt-[a-z0-9.-]+$/.test(input[field]) ? input[field] : null;
  for (const field of ['requestedEffort', 'observedEffort']) if (input[field] !== undefined) event[field] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(input[field]) ? input[field] : null;
  for (const field of ['durationMs', 'outputBytes', 'toolCalls', 'compactions']) if (count(input[field])) event[field] = input[field];
  if (Number.isInteger(input.exit) && input.exit >= 0) event.exit = input.exit;
  if (['pass', 'fail', 'unknown', 'unverified'].includes(input.outcome)) event.outcome = input.outcome;
  if (['continue', 'checkpoint', 'stop', 'unknown'].includes(input.decision)) event.decision = input.decision;
  if (['author', 'worker', 'rule'].includes(input.provenance)) event.provenance = input.provenance;
  if (input.failureClass !== undefined) event.failureClass = failureClasses.has(input.failureClass) ? input.failureClass : 'unknown';
  if (input.rerunReason !== undefined) event.rerunReason = reasons.has(input.rerunReason) ? input.rerunReason : 'unknown';
  if (Array.isArray(input.evidence)) event.evidence = input.evidence.filter(value => identifier(value) && value.startsWith('.runtime/')).slice(0, 20);
  if (input.usage) {
    const keys = ['input', 'cachedInput', 'output', 'reasoning'];
    if (keys.every(key => count(input.usage[key])) && input.usage.cachedInput <= input.usage.input && input.usage.reasoning <= input.usage.output) event.usage = Object.fromEntries(keys.map(key => [key, input.usage[key]]));
  }
  // Expected/actual observations are numeric or boolean; detailed strings stay local.
  for (const field of ['expected', 'actual']) if (typeof input[field] === 'boolean' || (typeof input[field] === 'number' && Number.isFinite(input[field]))) event[field] = input[field];
  event.omittedFields = (Number.isInteger(input.omittedFields) ? input.omittedFields : 0) + Object.keys(input).filter(key => key !== 'omittedFields' && !Object.hasOwn(event, key)).length;
  return event;
}

export async function appendEvent(file, input, { root = process.cwd() } = {}) {
  const target = await safeRuntimePath(root, file);
  const event = projectEvent(input);
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

export async function readEvents(files, { root = process.cwd() } = {}) {
  const seen = new Map(); const gaps = [];
  for (const file of files) {
    const target = await safeRuntimePath(root, file, { mustExist: true });
    const lines = (await readFile(target, 'utf8')).split('\n');
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      try {
        const event = projectEvent(JSON.parse(line));
        const prior = seen.get(event.eventId);
        if (prior && JSON.stringify(prior) !== JSON.stringify(event)) gaps.push({ code: 'conflicting-event', file, line: index + 1 });
        else seen.set(event.eventId, event);
      } catch { gaps.push({ code: index === lines.length - 1 ? 'incomplete-tail' : 'invalid-event', file, line: index + 1 }); }
    }
  }
  const events = [...seen.values()].sort((a, b) => a.runId.localeCompare(b.runId) || (a.workerId ?? '').localeCompare(b.workerId ?? '') || a.sequence - b.sequence || a.eventId.localeCompare(b.eventId));
  const sequences = new Set(); const ordered = []; const visiting = new Set(); const visited = new Set();
  const writerPredecessors = new Map(); const writers = new Map();
  for (const event of events) {
    const writer = JSON.stringify([event.runId, event.workerId]);
    const prior = writers.get(writer);
    if (prior) writerPredecessors.set(event.eventId, prior);
    writers.set(writer, event);
  }
  const visit = event => {
    if (visited.has(event.eventId)) return;
    if (visiting.has(event.eventId)) { gaps.push({ code: 'causal-cycle', eventId: event.eventId }); return; }
    visiting.add(event.eventId);
    // A cross-worker parent cannot leap over that writer's earlier events.
    const predecessor = writerPredecessors.get(event.eventId);
    if (predecessor) visit(predecessor);
    const parent = seen.get(event.parentEventId);
    if (parent) visit(parent);
    else if (event.parentEventId) gaps.push({ code: 'missing-parent-event', eventId: event.eventId });
    visiting.delete(event.eventId); visited.add(event.eventId); ordered.push(event);
  };
  for (const event of events) {
    const key = JSON.stringify([event.runId, event.workerId, event.sequence]);
    if (sequences.has(key)) gaps.push({ code: 'conflicting-sequence', eventId: event.eventId });
    sequences.add(key); visit(event);
  }
  return { events: ordered, gaps };
}

export function summarizeEvents({ events, gaps }, usageReport) {
  const intervals = []; const starts = new Map(); const completed = new Set();
  let summedDurationMs = 0;
  const counts = { executed: 0, reused: 0, failures: 0, cleanup: 0, correctiveRounds: 0, toolCalls: 0, outputBytes: 0, compactions: 0 };
  const findings = new Set(); const classes = {}; const usage = Object.create(null); const observations = {};
  for (const event of events) {
    const group = JSON.stringify([event.phase, event.role, event.observedModel ?? null, event.observedEffort ?? null]);
    const observed = observations[group] ??= { phase: event.phase, role: event.role, model: event.observedModel ?? null, effort: event.observedEffort ?? null, eventIds: [], toolCalls: 0, outputBytes: 0 };
    observed.eventIds.push(event.eventId); observed.toolCalls += event.toolCalls ?? 0; observed.outputBytes += event.outputBytes ?? 0;
    const identity = JSON.stringify([event.runId, event.workerId, event.assignmentId, event.checkId, event.attemptId]);
    if (event.kind === 'start') starts.set(identity, event);
    if (['end', 'failure'].includes(event.kind) && starts.has(identity) && !completed.has(identity)) {
      const start = starts.get(identity); const duration = Date.parse(event.at) - Date.parse(start.at);
      if (duration >= 0) { summedDurationMs += duration; intervals.push([Date.parse(start.at), Date.parse(event.at)]); completed.add(identity); }
    }
    if (event.kind === 'end' && event.checkId) counts.executed++;
    if (event.kind === 'reuse') counts.reused++;
    if (event.kind === 'failure') { counts.failures++; classes[event.failureClass ?? 'unknown'] = (classes[event.failureClass ?? 'unknown'] ?? 0) + 1; }
    if (event.kind === 'cleanup') counts.cleanup++;
    if (event.kind === 'admission' && event.predecessorId) counts.correctiveRounds++;
    if (event.findingId && event.kind === 'finding') findings.add(event.findingId);
    for (const field of ['toolCalls', 'outputBytes', 'compactions']) counts[field] += event[field] ?? 0;
    // Usage samples are cumulative checkpoints; never sum them as separate charges.
    if (event.usage && event.sessionId) usage[event.sessionId] = { usage: event.usage, phase: 'unknown', model: null, effort: null, eventId: event.eventId, allocation: 'cumulative-checkpoint-only' };
  }
  intervals.sort((a, b) => a[0] - b[0]); let activeDurationMs = 0; let end = -Infinity;
  for (const [from, to] of intervals) { activeDurationMs += Math.max(0, to - Math.max(from, end)); end = Math.max(end, to); }
  return { version: 1, eventCount: events.length, counts, uniqueFindings: findings.size, failureClasses: classes, durations: { summedDurationMs, activeDurationMs, elapsedRunMs: intervals.length ? Math.max(...intervals.map(i => i[1])) - intervals[0][0] : null }, incompleteAttempts: [...starts.keys()].filter(key => !completed.has(key)).length, gaps, observations: Object.values(observations), sessionUsage: usage, attributedUsage: usageReport ? { usage: usageReport.usage && Object.fromEntries(['input', 'cachedInput', 'output', 'reasoning'].map(key => [key, count(usageReport.usage[key]) ? usageReport.usage[key] : null])), aggregateComplete: usageReport.coverage?.aggregate === true } : null, realSavingsMeasured: false, detail: { eventIds: events.map(event => event.eventId) } };
}

export async function reportEvents(files, directory, { root = process.cwd(), maxBytes = 65536, usageReport } = {}) {
  const target = await safeRuntimePath(root, directory);
  await mkdir(target, { recursive: true });
  const parsed = await readEvents(files, { root });
  const summary = summarizeEvents(parsed, usageReport);
  if (!Number.isInteger(maxBytes) || maxBytes < 512) throw new Error('invalid summary cap');
  const json = boundedJson(summary, maxBytes - 1);
  const markdown = `# Execution observations\n\n${boundedJson({ ...summary, detail: { streams: files } }, Math.min(maxBytes - 128, 60000))}\n\nDetails: ${files.length} local streams. Real subscription savings unmeasured.\n`;
  for (const [name, content] of [['summary.json', json + '\n'], ['report.md', markdown]]) {
    const temporary = path.join(target, `${name}.${randomUUID()}.tmp`);
    await writeFile(temporary, content, 'utf8'); await rename(temporary, path.join(target, name));
  }
  return summary;
}

async function main() {
  const args = process.argv.slice(2); const index = args.indexOf('--output');
  if (index < 1 || !args[index + 1]) throw new Error('usage: dev:report <stream.jsonl> ... --output <runtime-directory>');
  const summary = await reportEvents(args.slice(0, index), args[index + 1]);
  console.log(boundedJson({ eventCount: summary.eventCount, counts: summary.counts, gaps: summary.gaps, incompleteAttempts: summary.incompleteAttempts }));
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { console.error(boundedJson({ error: error.message })); process.exitCode = 1; });
