import { evaluatePlan } from './usage.mjs';
import { readdir, mkdir } from 'node:fs/promises';
import { acquireResource, releaseResource } from './resources.mjs';
import { safeRuntimePath, sha256, writeNewJson } from './safe-artifacts.mjs';

/** Local admission only; external reasoning/direct commands remain outside enforcement. */
export function admitWork(plan, report, { now = Date.now(), admissions = 0, alternative } = {}) {
  let checkpoint = evaluatePlan(plan, report, now);
  if (checkpoint.decision !== 'stop' && report.coverage?.aggregate !== true) checkpoint = { ...checkpoint, decision: 'unknown', reasons: [...checkpoint.reasons, { unit: 'tokens', reason: 'aggregate-accounting-unknown' }] };
  if (checkpoint.decision !== 'stop' && report.version === 2 && (!Number.isFinite(Date.parse(report.observedAt)) || now - Date.parse(report.observedAt) > plan.checkpointCadenceMs || now < Date.parse(report.observedAt))) checkpoint = { ...checkpoint, decision: 'unknown', reasons: [...checkpoint.reasons, { unit: 'tokens', reason: 'usage-checkpoint-stale-or-unknown' }] };
  const result = { ...checkpoint, advisory: false, enforcement: 'managed-admission-only', directCommandsCovered: false, alreadyRunningReasoningCovered: false, cleanupAllowed: true };
  if (checkpoint.decision === 'stop') return { ...result, admitted: false };
  if (checkpoint.decision === 'unknown') {
    const valid = alternative && typeof alternative.reason === 'string' && alternative.reason.trim() && Number.isSafeInteger(alternative.maxAdmissions) && alternative.maxAdmissions > 0 && Number.isSafeInteger(alternative.deadlineMs) && alternative.deadlineMs > now;
    if (!valid || admissions >= alternative.maxAdmissions) return { ...result, admitted: false, reason: 'unknown-accounting-needs-bounded-alternative' };
    return { ...result, admitted: true, alternative: { reason: alternative.reason, maxAdmissions: alternative.maxAdmissions, deadlineMs: alternative.deadlineMs } };
  }
  return { ...result, admitted: true };
}

/** A plan fingerprint owns one admission history across retries and replacement workers. */
export async function reserveAdmission(plan, report, { root = process.cwd(), alternative, owner = 'managed-runner' } = {}) {
  const planId = sha256(JSON.stringify(plan));
  const lease = await acquireResource({ id: `budget-${planId}` }, owner, { root });
  try {
    const directory = await safeRuntimePath(root, `.runtime/development/budgets/${planId}`);
    await mkdir(directory, { recursive: true });
    const admissions = (await readdir(directory)).filter(file => /^admission-\d+\.json$/.test(file)).length;
    const decision = admitWork(plan, report, { admissions, alternative });
    if (decision.admitted) await writeNewJson(`${directory}/admission-${admissions + 1}.json`, { planId, owner, at: new Date().toISOString(), decision });
    return { ...decision, admissions, planId };
  } finally { await releaseResource(lease); }
}

export function assertionSummary(input) {
  const complete = input?.fresh === true && input?.windowComplete === true && typeof input.surface === 'string' && typeof input.scope === 'string' && input.window != null && Number.isFinite(input.tick) && Number.isFinite(input.actual) && Number.isFinite(input.expected) && typeof input.units === 'string';
  return { id: input?.id ?? null, surface: input?.surface ?? null, scope: input?.scope ?? null, tick: Number.isFinite(input?.tick) ? input.tick : null, window: input?.window ?? null, units: input?.units ?? null, expected: Number.isFinite(input?.expected) ? input.expected : null, actual: Number.isFinite(input?.actual) ? input.actual : null, coverage: complete ? 'complete' : 'unknown', outcome: !complete ? 'unknown' : input.actual === input.expected ? 'pass' : 'fail' };
}
