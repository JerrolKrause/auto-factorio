import { createReadStream } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundedJson, safeRuntimePath, writeNewJson } from './safe-artifacts.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const first = (...values) => values.find(value => value !== undefined && value !== null);
const tokens = value => ({
  input: first(value?.input, value?.inputTokens, value?.input_tokens, 0),
  cachedInput: first(value?.cachedInput, value?.cachedInputTokens, value?.cached_input_tokens, 0),
  output: first(value?.output, value?.outputTokens, value?.output_tokens, 0),
  reasoning: first(value?.reasoning, value?.reasoningTokens, value?.reasoning_output_tokens, 0),
});
const validTokens = value => Object.values(value).every(finite) && value.cachedInput <= value.input && value.reasoning <= value.output;
const add = (left, right) => Object.fromEntries(Object.keys(left).map(key => [key, left[key] + right[key]]));
const subtract = (left, right) => Object.fromEntries(Object.keys(left).map(key => [key, left[key] - right[key]]));
const zero = () => ({ input: 0, cachedInput: 0, output: 0, reasoning: 0 });
const timestamp = record => first(record.timestamp, record.time, record.payload?.timestamp);

async function jsonl(file) {
  const records = []; const malformed = []; let lastNonemptyLine = 0;
  const input = createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let line = 0;
  for await (const text of lines) {
    line += 1;
    if (!text.trim()) continue; lastNonemptyLine = line;
    try { records.push({ value: JSON.parse(text), line }); }
    catch { malformed.push(line); }
  }
  return { records, gaps: malformed.map(value => ({ code: value === lastNonemptyLine ? 'incomplete-tail' : 'malformed-record', file: path.basename(file), line: value })) };
}

function meta(record, fallback) {
  const payload = record.payload ?? record;
  if (record.type !== 'session_meta' && payload.type !== 'session_meta' && !payload.sessionId && !payload.threadId) return null;
  return {
    id: first(payload.id, payload.sessionId, payload.threadId, record.sessionId, fallback),
    parentId: first(payload.parentId, payload.parent_id, payload.parentThreadId, payload.parent_thread_id, null),
    model: first(payload.model, record.model, null),
  };
}

function usageSample(record, sessionId, line) {
  const payload = record.payload ?? record;
  const info = payload.info ?? payload.usage ?? record.usage;
  const per = first(info?.last_token_usage, info?.lastUsage, payload.responseUsage,
    ['response_usage', 'usage'].includes(record.type) && !record.cumulative ? info : undefined);
  const cumulative = first(info?.total_token_usage, info?.totalUsage, payload.cumulativeUsage, record.cumulativeUsage);
  const compact = first(payload.compactionUsage, record.compactionUsage,
    record.type === 'compaction' ? info : undefined);
  if (!per && !cumulative && !compact) return null;
  return {
    sessionId,
    line,
    at: timestamp(record),
    model: first(payload.model, record.model, info?.model, null),
    tier: first(payload.serviceTier, payload.service_tier, payload.tier, record.serviceTier, record.service_tier, null),
    responseId: first(payload.responseId, payload.response_id, payload.turnId, payload.turn_id, payload.requestId, payload.request_id, record.responseId, record.response_id, null),
    per: per ? tokens(per) : null,
    cumulative: cumulative ? tokens(cumulative) : null,
    compact: compact ? tokens(compact) : null,
    compactInCumulative: first(payload.compactionIncludedInCumulative, record.compactionIncludedInCumulative, null),
  };
}

export async function reportUsage({ rolloutDirectory, rootSessionId, start, cutoff, mappings = [], rates, account, plan }) {
  const entries = (await readdir(rolloutDirectory, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'));
  const sessions = new Map(); const allSamples = []; const gaps = [];
  for (const entry of entries) {
    const file = path.join(rolloutDirectory, entry.name);
    const parsed = await jsonl(file); gaps.push(...parsed.gaps);
    const fallback = path.basename(entry.name, '.jsonl');
    let sessionId = fallback;
    for (const row of parsed.records) {
      const found = meta(row.value, fallback);
      if (found?.id) { sessionId = found.id; sessions.set(found.id, { ...found, file: entry.name }); }
      const sample = usageSample(row.value, sessionId, row.line);
      if (sample) allSamples.push(sample);
    }
    if (!sessions.has(sessionId)) sessions.set(sessionId, { id: sessionId, parentId: null, model: null, file: entry.name });
  }
  const selected = new Set([rootSessionId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const session of sessions.values()) if (selected.has(session.parentId) && !selected.has(session.id)) { selected.add(session.id); changed = true; }
  }
  for (const mapping of mappings) {
    if (!mapping.runId || !mapping.sessionId) { gaps.push({ code: 'invalid-run-mapping' }); continue; }
    selected.add(mapping.sessionId);
  }
  if (!sessions.has(rootSessionId)) gaps.push({ code: 'missing-root-session', sessionId: rootSessionId });
  for (const id of selected) if (!sessions.has(id)) gaps.push({ code: 'missing-mapped-session', sessionId: id });
  const from = start ? Date.parse(start) : -Infinity; const to = cutoff ? Date.parse(cutoff) : Infinity;
  if (Number.isNaN(from) || Number.isNaN(to) || from > to) throw new Error('invalid usage interval');
  let total = zero(); const responseKeys = new Set(); const sessionReports = [];
  for (const id of selected) {
    const samples = allSamples.filter(sample => sample.sessionId === id).sort((a, b) => Date.parse(a.at ?? 0) - Date.parse(b.at ?? 0) || a.line - b.line);
    let perTotal = zero(); let compaction = zero(); let hasPer = false; let lastCumulative = null; let baseline = null; let reset = false; const compactionFlags = new Set();
    for (const sample of samples) {
      const at = sample.at ? Date.parse(sample.at) : NaN;
      if (sample.cumulative) {
        if ((Number.isFinite(from) || Number.isFinite(to)) && (!sample.at || Number.isNaN(at))) gaps.push({ code: 'missing-cumulative-timestamp', sessionId: id, line: sample.line });
        else {
          if (!sample.at || at <= from) baseline = sample.cumulative;
          if (!sample.at || at <= to) {
            if (lastCumulative && Object.keys(lastCumulative).some(key => sample.cumulative[key] < lastCumulative[key])) reset = true;
            lastCumulative = sample.cumulative;
          }
        }
      }
      if (sample.at && (at < from || at > to)) continue;
      if (sample.per) {
        if ((Number.isFinite(from) || Number.isFinite(to)) && (!sample.at || Number.isNaN(at))) { gaps.push({ code: 'missing-response-timestamp', sessionId: id, line: sample.line }); continue; }
        if (!validTokens(sample.per)) { gaps.push({ code: 'invalid-token-subsets', sessionId: id, line: sample.line }); continue; }
        if (!sample.responseId) { gaps.push({ code: 'missing-response-identity', sessionId: id, line: sample.line }); continue; }
        const key = `${id}:${sample.responseId}`;
        if (responseKeys.has(key)) continue;
        responseKeys.add(key); perTotal = add(perTotal, sample.per); hasPer = true;
      }
      if (sample.compact) {
        if ((Number.isFinite(from) || Number.isFinite(to)) && (!sample.at || Number.isNaN(at))) { gaps.push({ code: 'missing-compaction-timestamp', sessionId: id, line: sample.line }); continue; }
        if (validTokens(sample.compact)) compaction = add(compaction, sample.compact);
        else gaps.push({ code: 'invalid-compaction-usage', sessionId: id, line: sample.line });
        if (typeof sample.compactInCumulative === 'boolean') compactionFlags.add(sample.compactInCumulative);
      }
    }
    if (reset) gaps.push({ code: 'cumulative-counter-reset', sessionId: id });
    let cumulativeInterval = null;
    if (lastCumulative && validTokens(lastCumulative)) {
      if (Number.isFinite(from)) {
        if (baseline && validTokens(baseline)) cumulativeInterval = subtract(lastCumulative, baseline);
        else gaps.push({ code: 'missing-interval-baseline', sessionId: id });
      } else cumulativeInterval = lastCumulative;
    }
    let chosen;
    if (hasPer) {
      chosen = add(perTotal, compaction);
      if (cumulativeInterval && Object.keys(chosen).some(key => chosen[key] !== cumulativeInterval[key]))
        gaps.push({ code: 'representation-disagreement', sessionId: id, response: chosen, cumulative: cumulativeInterval });
    } else if (cumulativeInterval) {
      chosen = cumulativeInterval;
      const hasCompaction = Object.values(compaction).some(value => value > 0);
      if (hasCompaction && compactionFlags.size > 1) gaps.push({ code: 'conflicting-compaction-inclusion', sessionId: id });
      else if (hasCompaction && compactionFlags.has(false)) chosen = add(chosen, compaction);
      else if (hasCompaction && !compactionFlags.has(true)) gaps.push({ code: 'compaction-inclusion-unknown', sessionId: id });
    }
    else { chosen = zero(); gaps.push({ code: 'missing-usage', sessionId: id }); }
    total = add(total, chosen);
    sessionReports.push({ sessionId: id, relation: id === rootSessionId ? 'root' : mappings.some(row => row.sessionId === id) ? 'mapped-run' : 'descendant', model: sessions.get(id)?.model ?? samples.find(row => row.model)?.model ?? null, tier: samples.find(row => row.tier)?.tier ?? null, usage: chosen, representation: hasPer ? 'responses' : cumulativeInterval ? 'cumulative' : 'unknown' });
  }
  const report = {
    version: 1, interval: { start: start ?? null, cutoff: cutoff ?? null }, rootSessionId,
    sessions: sessionReports, unrelatedSessionCount: [...sessions.keys()].filter(id => !selected.has(id)).length,
    usage: total, coverage: { complete: gaps.length === 0, gaps },
  };
  if (rates) report.estimate = estimateCost(sessionReports, rates);
  if (account) report.account = accountObservation(account, cutoff ?? new Date().toISOString());
  if (plan) report.checkpoint = evaluatePlan(plan, report);
  return report;
}

export function estimateCost(sessions, table) {
  if (!table || table.version !== 1 || !table.effectiveDate || !table.source || !Array.isArray(table.rates)) throw new Error('invalid rate table');
  let knownSubtotal = 0; const components = []; let complete = true;
  for (const session of sessions) {
    const rate = table.rates.find(row => row.model === session.model && (row.tier ?? null) === (session.tier ?? null));
    if (!rate || !finite(rate.inputPerMillion) || !finite(rate.outputPerMillion)) {
      components.push({ sessionId: session.sessionId, model: session.model, tier: session.tier ?? null, estimate: null, reason: 'unknown-rate' }); complete = false; continue;
    }
    const estimate = ((session.usage.input - session.usage.cachedInput) * rate.inputPerMillion + session.usage.cachedInput * first(rate.cachedInputPerMillion, rate.inputPerMillion) + session.usage.output * rate.outputPerMillion) / 1_000_000;
    knownSubtotal += estimate; components.push({ sessionId: session.sessionId, model: session.model, estimate });
  }
  return { currency: table.currency ?? 'USD', effectiveDate: table.effectiveDate, source: table.source, knownSubtotal, complete, components, exactSubscriptionSpend: false };
}

export function accountObservation(account, now) {
  if (!account || typeof account.observedAt !== 'string' || !account.windowId) throw new Error('invalid account observation');
  const ageMs = Date.parse(now) - Date.parse(account.observedAt);
  return { observedAt: account.observedAt, windowId: account.windowId, resetAt: account.resetAt ?? null, ageMs: Number.isFinite(ageMs) ? Math.max(0, ageMs) : null, allowance: account.allowance ?? null, causalAttribution: false };
}

export function validatePlan(plan) {
  if (!plan || plan.version !== 1 || typeof plan.objective !== 'string' || !plan.objective.trim()) throw new Error('invalid session plan');
  if (!plan.sessions || typeof plan.sessions.author !== 'string' || !Array.isArray(plan.sessions.workers) || !Array.isArray(plan.sessions.runs)) throw new Error('session plan needs author/worker/run mappings');
  const identities = [plan.sessions.author, ...plan.sessions.workers, ...plan.sessions.runs.map(run => typeof run === 'string' ? run : run?.sessionId)];
  if (identities.some(id => typeof id !== 'string' || !id.trim())) throw new Error('session plan mappings need nonempty session identities');
  if (plan.sessions.runs.some(run => typeof run === 'object' && (typeof run.runId !== 'string' || !run.runId.trim()))) throw new Error('run mappings need nonempty runId');
  if (!finite(plan.checkpointCadenceMs) || plan.checkpointCadenceMs <= 0) throw new Error('invalid checkpoint cadence');
  if (!Array.isArray(plan.limits) || plan.limits.length === 0) throw new Error('session plan needs limits');
  for (const limit of plan.limits) {
    if (!['tokens', 'wallMs', 'estimatedCost', 'allowance'].includes(limit.unit) || !finite(limit.value) || limit.value <= 0 || !finite(limit.closeoutReserve) || limit.closeoutReserve >= limit.value) throw new Error(`invalid limit: ${limit.unit ?? 'unknown'}`);
    if (limit.unit === 'allowance' && (!finite(limit.freshnessMs) || limit.freshnessMs <= 0)) throw new Error('allowance limit needs freshnessMs');
  }
  return plan;
}

export function evaluatePlan(plan, report, now = Date.now()) {
  validatePlan(plan); const reasons = []; let unknown = false; let checkpoint = false; let stop = false;
  const selected = new Set((report.sessions ?? []).map(session => session.sessionId));
  const planned = [plan.sessions.author, ...plan.sessions.workers, ...plan.sessions.runs.map(run => typeof run === 'string' ? run : run.sessionId)];
  for (const id of planned) if (!selected.has(id)) { unknown = true; reasons.push({ unit: 'sessions', reason: 'planned-session-missing', sessionId: id }); }
  const spentTokens = report.usage.input + report.usage.output;
  const wallMs = now - Date.parse(plan.startTime);
  for (const limit of plan.limits) {
    let spent;
    if (limit.unit === 'tokens') spent = report.coverage.complete ? spentTokens : null;
    if (limit.unit === 'wallMs') spent = Number.isFinite(wallMs) ? wallMs : null;
    if (limit.unit === 'estimatedCost') spent = report.estimate?.complete ? report.estimate.knownSubtotal : null;
    if (limit.unit === 'allowance') {
      const observation = report.account;
      if (!observation || observation.ageMs === null || observation.ageMs > limit.freshnessMs || (limit.windowId && observation.windowId !== limit.windowId)) spent = null;
      else spent = observation.allowance?.used ?? null;
    }
    if (!finite(spent)) { unknown = true; reasons.push({ unit: limit.unit, reason: 'required-telemetry-unavailable' }); continue; }
    if (spent >= limit.value || spent + limit.closeoutReserve >= limit.value) { stop = true; reasons.push({ unit: limit.unit, reason: spent >= limit.value ? 'limit-reached' : 'closeout-reserve-reached', spent }); }
  }
  if (Number.isFinite(wallMs) && wallMs >= plan.checkpointCadenceMs) { checkpoint = true; reasons.push({ unit: 'wallMs', reason: 'checkpoint-due', spent: wallMs }); }
  return { decision: stop ? 'stop' : unknown ? 'unknown' : checkpoint ? 'checkpoint' : 'continue', advisory: true, authorizesInference: false, reasons };
}

function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
async function main() {
  const directory = option('--rollouts'); const rootSessionId = option('--root'); const output = option('--output');
  if (!directory || !rootSessionId || !output) throw new Error('usage: dev:usage --rollouts <dir> --root <id> --output <new.json>');
  const load = async flag => option(flag) ? JSON.parse(await readFile(option(flag), 'utf8')) : undefined;
  const report = await reportUsage({ rolloutDirectory: directory, rootSessionId, start: option('--start'), cutoff: option('--cutoff'), mappings: await load('--mappings') ?? [], rates: await load('--rates'), account: await load('--account'), plan: await load('--plan') });
  const safeOutput = await safeRuntimePath(process.cwd(), output);
  await writeNewJson(safeOutput, report); console.log(boundedJson({ output: safeOutput, usage: report.usage, coverage: report.coverage, checkpoint: report.checkpoint }));
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { console.error(boundedJson({ error: error.message })); process.exitCode = 1; });
