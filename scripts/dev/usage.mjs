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
    parentId: first(payload.parentId, payload.parent_id, payload.parentThreadId, payload.parent_thread_id, payload.source?.subagent?.thread_spawn?.parent_thread_id, null),
    model: first(payload.model, record.model, null),
    effort: first(payload.effort, payload.reasoning_effort, null),
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

/** Never follow rollout symlinks into another operator's session tree. */
async function rolloutFiles(directory) {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await rolloutFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(file);
  }
  return files;
}

export async function reportUsage({ rolloutDirectory, rootSessionId, start, cutoff, mappings = [], rates, account, plan }) {
  const sessions = new Map(); const fileGaps = new Map(); const allSamples = [];
  for (const file of await rolloutFiles(rolloutDirectory)) {
    const parsed = await jsonl(file); const fallback = path.basename(file, '.jsonl');
    let sessionId = fallback; let context = {}; let changedModel = false;
    for (const row of parsed.records) {
      const found = meta(row.value, fallback);
      if (found?.id) {
        sessionId = found.id;
        const old = sessions.get(sessionId);
        if (old && old.parentId !== found.parentId) throw new Error('conflicting session ancestry');
        sessions.set(sessionId, { ...found, file: path.relative(rolloutDirectory, file) });
        context = { model: found.model, effort: found.effort };
      }
      if (row.value.type === 'turn_context') {
        const value = row.value.payload ?? row.value;
        const nextModel = value.model ?? context.model;
        changedModel ||= !!context.model && nextModel !== context.model;
        context = { model: nextModel, effort: value.effort ?? value.reasoning_effort ?? null };
      }
      const sample = usageSample(row.value, sessionId, row.line);
      if (sample) {
        allSamples.push({ ...sample, model: sample.model ?? context.model ?? null, effort: context.effort ?? null, changedModel });
        changedModel = false;
      }
    }
    if (!sessions.has(sessionId)) sessions.set(sessionId, { id: sessionId, parentId: null, model: null });
    fileGaps.set(sessionId, [...(fileGaps.get(sessionId) ?? []), ...parsed.gaps]);
  }
  const selected = new Set([rootSessionId]); const gaps = []; const attributionGaps = [];
  for (const mapping of mappings) {
    if (!mapping.runId || !mapping.sessionId) gaps.push({ code: 'invalid-run-mapping' });
    else selected.add(mapping.sessionId);
  }
  // Expand only proven ancestry, including descendants of explicitly mapped runs.
  let changed = true;
  while (changed) {
    changed = false;
    for (const session of sessions.values()) if (selected.has(session.parentId) && !selected.has(session.id)) { selected.add(session.id); changed = true; }
  }
  if (!sessions.has(rootSessionId)) gaps.push({ code: 'missing-root-session', sessionId: rootSessionId });
  const from = start ? Date.parse(start) : -Infinity; const to = cutoff ? Date.parse(cutoff) : Infinity;
  if (Number.isNaN(from) || Number.isNaN(to) || from > to) throw new Error('invalid usage interval');
  let total = zero(); const sessionReports = [];
  for (const id of selected) {
    const localGaps = [...(fileGaps.get(id) ?? [])]; const localAttribution = [];
    const gap = (code, detail = {}) => { if (!localGaps.some(row => row.code === code)) localGaps.push({ code, sessionId: id, ...detail }); };
    const allocationGap = code => { if (!localAttribution.some(row => row.code === code)) localAttribution.push({ code, sessionId: id }); };
    if (!sessions.has(id)) gap('missing-mapped-session');
    const samples = allSamples.filter(sample => sample.sessionId === id).sort((a, b) => (Date.parse(a.at ?? 0) || 0) - (Date.parse(b.at ?? 0) || 0) || a.line - b.line);
    let perTotal = zero(); let compaction = zero(); let lastCumulative = null; let baseline = null; let reset = false; let missingId = false;
    const responses = new Map(); const compactKeys = new Map(); const allocations = new Map(); const cumulativeAllocations = new Map();
    const allocate = (sample, value, bucket = allocations) => {
      const key = JSON.stringify([sample.model ?? null, sample.effort ?? null, sample.tier ?? null]);
      const old = bucket.get(key);
      bucket.set(key, { model: sample.model ?? null, effort: sample.effort ?? null, tier: sample.tier ?? null, usage: add(old?.usage ?? zero(), value) });
    };
    for (const sample of samples) {
      const at = sample.at ? Date.parse(sample.at) : NaN;
      if ((Number.isFinite(from) || Number.isFinite(to)) && (!sample.at || Number.isNaN(at))) { if (sample.cumulative) gap('missing-cumulative-timestamp'); if (sample.per) gap('missing-response-timestamp'); if (sample.compact) gap('missing-compaction-timestamp'); continue; }
      if (at > to) continue;
      if (sample.cumulative) {
        if (!validTokens(sample.cumulative)) gap('invalid-token-subsets');
        else {
          if (lastCumulative && Object.keys(lastCumulative).some(key => sample.cumulative[key] < lastCumulative[key])) reset = true;
          const delta = subtract(sample.cumulative, lastCumulative ?? zero());
          if (!(at <= from) && validTokens(delta)) allocate(sample.changedModel ? { ...sample, model: null, effort: null, tier: null } : sample, delta, cumulativeAllocations);
          lastCumulative = sample.cumulative;
          if (at <= from) baseline = sample.cumulative;
        }
      }
      if (at < from) continue;
      if (sample.per) {
        if ((Number.isFinite(from) || Number.isFinite(to)) && (!sample.at || Number.isNaN(at))) { gap('missing-response-timestamp'); continue; }
        if (!validTokens(sample.per)) { gap('invalid-token-subsets'); continue; }
        if (!sample.responseId) { missingId = true; allocationGap('missing-response-identity'); }
        else {
          const prior = responses.get(sample.responseId);
          if (prior && JSON.stringify(prior) !== JSON.stringify(sample.per)) gap('conflicting-response-usage');
          if (!prior) { responses.set(sample.responseId, sample.per); perTotal = add(perTotal, sample.per); allocate(sample, sample.per); }
        }
      }
      if (sample.compact) {
        if (!validTokens(sample.compact)) gap('invalid-compaction-usage');
        else {
          const key = sample.responseId ?? sample.at ?? `line-${sample.line}`;
          if (!sample.responseId && !sample.at) gap('missing-compaction-identity');
          const value = { usage: sample.compact, included: sample.compactInCumulative };
          const prior = compactKeys.get(key);
          if (prior && JSON.stringify(prior) !== JSON.stringify(value)) gap('conflicting-compaction-usage');
          if (!prior) { compactKeys.set(key, value); compaction = add(compaction, sample.compact); }
          if (prior && prior.included !== value.included) gap('conflicting-compaction-inclusion');
        }
      }
    }
    if (reset) gap('cumulative-counter-reset');
    let cumulativeInterval = lastCumulative;
    if (Number.isFinite(from)) {
      if (baseline && lastCumulative) cumulativeInterval = subtract(lastCumulative, baseline);
      else { cumulativeInterval = null; if (lastCumulative) gap('missing-interval-baseline'); }
    }
    if (cumulativeInterval && !validTokens(cumulativeInterval)) { gap('invalid-cumulative-interval'); cumulativeInterval = null; }
    const hasPer = responses.size > 0;
    if (!hasPer && cumulativeInterval) allocationGap('missing-response-identity');
    let chosen = zero(); let representation = 'unknown';
    if (hasPer && !missingId) { chosen = add(perTotal, compaction); representation = 'responses'; }
    else if (cumulativeInterval) {
      chosen = cumulativeInterval; representation = 'cumulative';
      if (Object.values(compaction).some(value => value > 0)) {
        for (const item of compactKeys.values()) {
          if (item.included === false) chosen = add(chosen, item.usage);
          else if (item.included !== true) gap('compaction-inclusion-unknown');
        }
      }
    } else if (hasPer) { chosen = add(perTotal, compaction); representation = 'responses'; gap('incomplete-response-aggregate'); }
    else gap('missing-usage');
    if (missingId && !cumulativeInterval) gap('missing-response-identity');
    if (hasPer && cumulativeInterval && !missingId && Object.keys(chosen).some(key => chosen[key] !== cumulativeInterval[key])) gap('representation-disagreement', { response: chosen, cumulative: cumulativeInterval });
    // Even incomplete response attribution can disprove an aggregate endpoint.
    if (hasPer && cumulativeInterval && missingId && Object.keys(perTotal).some(key => perTotal[key] > cumulativeInterval[key])) gap('representation-disagreement', { responseSubset: perTotal, cumulative: cumulativeInterval });
    const models = [...new Set(samples.map(row => row.model).filter(Boolean))];
    const efforts = [...new Set(samples.map(row => row.effort).filter(Boolean))];
    // Cumulative endpoints establish totals, not the location of a model switch.
    // Preserve the aggregate and put unsupported allocation in an explicit bucket.
    let breakdown = [...allocations.values()];
    if (representation === 'cumulative' && !reset && !Object.values(compaction).some(value => value > 0)) {
      breakdown = [...cumulativeAllocations.values()];
      if (breakdown.some(row => row.model === null)) allocationGap('model-allocation-unknown');
    } else if (Object.values(compaction).some(value => value > 0) || reset || representation === 'unknown') {
      const model = models.length === 1 && !reset ? models[0] : null; const effort = efforts.length === 1 ? efforts[0] : null;
      breakdown = [{ model, effort, tier: null, usage: chosen }];
      if (!model) allocationGap('model-allocation-unknown');
    }
    if (models.length === 0) allocationGap('model-allocation-unknown');
    allocationGap('phase-allocation-unavailable');
    gaps.push(...localGaps); attributionGaps.push(...localAttribution); total = add(total, chosen);
    sessionReports.push({ sessionId: id, relation: id === rootSessionId ? 'root' : mappings.some(row => row.sessionId === id) ? 'mapped-run' : 'descendant', model: models.length === 1 ? models[0] : null, effort: efforts.length === 1 ? efforts[0] : null, tier: samples.find(row => row.tier)?.tier ?? null, usage: chosen, representation, breakdown, aggregateComplete: localGaps.length === 0 });
  }
  const report = {
    version: 2, observedAt: cutoff ?? new Date().toISOString(), interval: { start: start ?? null, cutoff: cutoff ?? null }, rootSessionId,
    sessions: sessionReports, unrelatedSessionCount: [...sessions.keys()].filter(id => !selected.has(id)).length,
    usage: total, uncachedInput: total.input - total.cachedInput,
    coverage: { complete: gaps.length === 0, aggregate: gaps.length === 0, response: !attributionGaps.some(g => g.code === 'missing-response-identity'), model: !attributionGaps.some(g => g.code === 'model-allocation-unknown'), phase: false, compaction: !gaps.some(g => /compaction/.test(g.code)), gaps, attributionGaps },
  };
  if (rates) report.estimate = estimateCost(sessionReports.flatMap(row => row.breakdown.map(part => ({ ...part, sessionId: row.sessionId }))), rates);
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
      const currentAge = observation?.observedAt ? now - Date.parse(observation.observedAt) : observation?.ageMs;
      if (!observation || !Number.isFinite(currentAge) || currentAge < 0 || currentAge > limit.freshnessMs || (limit.windowId && observation.windowId !== limit.windowId)) spent = null;
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
