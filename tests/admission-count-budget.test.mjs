import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { admitWork, reserveAdmission } from '../scripts/dev/admission.mjs';
import { standardAdmissionAlternative } from '../scripts/dev/standard-verification.mjs';
import { evaluatePlan, validatePlan } from '../scripts/dev/usage.mjs';

const now = Date.parse('2026-10-11T12:00:00.000Z');
const unknownReport = () => ({
  sessions: [{ sessionId: 'author' }],
  usage: { input: 0, output: 0 },
  coverage: { complete: false, aggregate: false },
});
const plan = (limits = [{ unit: 'admissions', value: 120, closeoutReserve: 0 }]) => ({
  version: 1,
  objective: 'focused admission-count budget',
  sessions: { author: 'author', workers: [], runs: [] },
  startTime: new Date(now).toISOString(),
  checkpointCadenceMs: 60_000,
  limits,
});
const alternative = { reason: 'bounded unknown usage', maxAdmissions: 120 };
const tempRoots = [];

async function isolatedRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'af-admission-count-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  const tempRoot = path.resolve(os.tmpdir());
  await Promise.all(tempRoots.splice(0).map(async root => {
    const target = path.resolve(root);
    const relative = path.relative(tempRoot, target);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`refusing recursive cleanup outside the isolated temp root: ${target}`);
    }
    await rm(target, { recursive: true, force: true });
  }));
});

describe('admission-count budgets', () => {
  it('admits count 119 and stops at the original cap of 120', () => {
    const bounded = plan();
    expect(evaluatePlan(bounded, unknownReport(), now, 119).decision).toBe('continue');
    expect(evaluatePlan(bounded, unknownReport(), now, 120)).toMatchObject({ decision: 'stop', reasons: [{ unit: 'admissions', reason: 'limit-reached', spent: 120 }] });
    expect(admitWork(bounded, unknownReport(), { now, admissions: 119, alternative })).toMatchObject({ decision: 'unknown', admitted: true });
    expect(admitWork(bounded, unknownReport(), { now, admissions: 120, alternative }).admitted).toBe(false);
  });

  it('uses a finite count reserve and treats missing, negative, or fractional count telemetry as unknown', () => {
    const bounded = plan([{ unit: 'admissions', value: 120, closeoutReserve: 2 }]);
    expect(evaluatePlan(bounded, unknownReport(), now, 117).decision).toBe('continue');
    expect(evaluatePlan(bounded, unknownReport(), now, 118).decision).toBe('stop');
    for (const count of [null, undefined, -1, 1.5, Number.NaN]) {
      expect(evaluatePlan(bounded, unknownReport(), now, count).decision).toBe('unknown');
    }
  });

  it('validates admission limits as positive whole counts with a valid reserve', () => {
    for (const limit of [
      { unit: 'admissions', value: 0, closeoutReserve: 0 },
      { unit: 'admissions', value: 1.5, closeoutReserve: 0 },
      { unit: 'admissions', value: 5, closeoutReserve: 1.5 },
      { unit: 'admissions', value: 5, closeoutReserve: 5 },
    ]) {
      expect(() => validatePlan(plan([limit]))).toThrow();
    }
    expect(validatePlan(plan([{ unit: 'admissions', value: 120, closeoutReserve: 2 }]))).toBeDefined();
  });

  it('requires an explicit reason and bounded alternative for unknown accounting', () => {
    const bounded = plan();
    expect(admitWork(bounded, unknownReport(), { now }).admitted).toBe(false);
    expect(admitWork(bounded, unknownReport(), { now, alternative: { ...alternative, reason: ' ' } }).admitted).toBe(false);
    expect(admitWork(bounded, unknownReport(), { now, alternative: { ...alternative, maxAdmissions: 1.5 } }).admitted).toBe(false);
    for (const admissions of [-1, null, 1.5, Number.NaN]) {
      expect(admitWork(bounded, unknownReport(), { now, admissions, alternative })).toMatchObject({ admitted: false, reason: 'invalid-admission-count' });
    }
    expect(admitWork(bounded, unknownReport(), { now, alternative }).admitted).toBe(true);
    expect(admitWork(bounded, unknownReport(), { now, admissions: 2, alternative: { ...alternative, maxAdmissions: 2 } }).admitted).toBe(false);
    expect(admitWork(bounded, unknownReport(), { now, admissions: 1, alternative: { ...alternative, maxAdmissions: 2 } }).admitted).toBe(true);
  });

  it('allows a missing deadline only for an admission-only plan', () => {
    const countOnly = plan();
    const wallOnly = plan([{ unit: 'wallMs', value: 60_000, closeoutReserve: 1_000 }]);
    const mixed = plan([{ unit: 'wallMs', value: 60_000, closeoutReserve: 1_000 }, { unit: 'admissions', value: 120, closeoutReserve: 0 }]);
    expect(admitWork(countOnly, unknownReport(), { now, alternative }).admitted).toBe(true);
    expect(admitWork(wallOnly, unknownReport(), { now, alternative }).admitted).toBe(false);
    expect(admitWork(mixed, unknownReport(), { now, alternative }).admitted).toBe(false);
    expect(admitWork(countOnly, unknownReport(), { now, alternative: { ...alternative, deadlineMs: now } }).admitted).toBe(false);
    expect(admitWork(countOnly, unknownReport(), { now, alternative: { ...alternative, deadlineMs: now + 1 } }).admitted).toBe(true);
  });

  it('does not infer a wall stop for count-only plans or let an alternative relax the declared count cap', () => {
    const countOnly = plan();
    const oldStart = { ...countOnly, startTime: new Date(now - 86_400_000).toISOString() };
    expect(evaluatePlan(oldStart, unknownReport(), now, 1).decision).not.toBe('stop');
    expect(admitWork(oldStart, unknownReport(), { now, admissions: 1, alternative }).admitted).toBe(true);
    expect(admitWork(countOnly, unknownReport(), { now, admissions: 1, alternative: { reason: 'extra', maxAdmissions: 500 } }).admitted).toBe(true);
    expect(admitWork(countOnly, unknownReport(), { now, admissions: 120, alternative: { reason: 'extra', maxAdmissions: 500 } })).toMatchObject({ decision: 'stop', admitted: false });
  });

  it('preserves the original wall stop when usage is unknown', () => {
    const wallBounded = plan([{ unit: 'wallMs', value: 10_000, closeoutReserve: 1_000 }, { unit: 'admissions', value: 120, closeoutReserve: 0 }]);
    expect(admitWork(wallBounded, unknownReport(), {
      now: now + 10_000,
      admissions: 1,
      alternative: { ...alternative, maxAdmissions: 500, deadlineMs: now + 20_000 },
    })).toMatchObject({ decision: 'stop', admitted: false, reasons: expect.arrayContaining([expect.objectContaining({ unit: 'wallMs', reason: 'limit-reached' })]) });
  });

  it('preserves the original token stop when usage is known over the limit', () => {
    const tokenBounded = plan([{ unit: 'tokens', value: 100, closeoutReserve: 10 }, { unit: 'admissions', value: 120, closeoutReserve: 0 }]);
    const overBudget = { ...unknownReport(), coverage: { complete: true, aggregate: true }, usage: { input: 100, output: 0 } };
    expect(admitWork(tokenBounded, overBudget, {
      now,
      admissions: 1,
      alternative: { reason: 'additional admission room', maxAdmissions: 500, deadlineMs: now + 20_000 },
    })).toMatchObject({ decision: 'stop', admitted: false, reasons: expect.arrayContaining([expect.objectContaining({ unit: 'tokens', reason: 'limit-reached' })]) });
  });

  it('keeps stale or unknown usage unknown without turning it into zero', () => {
    const countOnly = plan();
    const stale = { ...unknownReport(), version: 2, observedAt: new Date(now - 60_001).toISOString() };
    const freshUnknown = { ...unknownReport(), version: 2, observedAt: new Date(now).toISOString() };
    expect(admitWork(countOnly, stale, { now, admissions: 1 }).decision).toBe('unknown');
    expect(admitWork(countOnly, freshUnknown, { now, admissions: 1 }).decision).toBe('unknown');
    expect(admitWork(countOnly, stale, { now, admissions: 1, alternative }).admitted).toBe(true);
  });

  it('persists admission history across separate calls under an isolated root', async () => {
    const root = await isolatedRoot();
    const bounded = plan([{ unit: 'admissions', value: 2, closeoutReserve: 0 }]);
    const first = await reserveAdmission(bounded, unknownReport(), { root, alternative: { reason: 'persisted count', maxAdmissions: 2 }, owner: 'test-one' });
    const second = await reserveAdmission(bounded, unknownReport(), { root, alternative: { reason: 'persisted count', maxAdmissions: 2 }, owner: 'test-two' });
    const third = await reserveAdmission(bounded, unknownReport(), { root, alternative: { reason: 'persisted count', maxAdmissions: 2 }, owner: 'test-three' });
    expect(first).toMatchObject({ admitted: true, admissions: 0 });
    expect(second).toMatchObject({ admitted: true, admissions: 1 });
    expect(third).toMatchObject({ admitted: false, decision: 'stop', admissions: 2 });
    const files = await readdir(path.join(root, '.runtime/development/budgets', first.planId));
    expect(files.filter(file => /^admission-\d+\.json$/.test(file))).toHaveLength(2);
  }, 10_000);

  it('builds standard alternatives from admission caps while preserving legacy deadlines', () => {
    const countOnly = plan();
    const countAlternative = standardAdmissionAlternative(countOnly);
    expect(countAlternative.maxAdmissions).toBe(120);
    expect(countAlternative).not.toHaveProperty('deadlineMs');
    expect(admitWork(countOnly, unknownReport(), { now, alternative: countAlternative }).admitted).toBe(true);

    const multipleCounts = plan([
      { unit: 'admissions', value: 140, closeoutReserve: 0 },
      { unit: 'admissions', value: 90, closeoutReserve: 0 },
    ]);
    expect(standardAdmissionAlternative(multipleCounts)).toMatchObject({ maxAdmissions: 90 });
    expect(standardAdmissionAlternative(multipleCounts)).not.toHaveProperty('deadlineMs');

    const mixed = plan([
      { unit: 'wallMs', value: 60_000, closeoutReserve: 1_000 },
      { unit: 'admissions', value: 120, closeoutReserve: 0 },
    ]);
    const wallOnly = plan([{ unit: 'wallMs', value: 20_000_000, closeoutReserve: 1_000 }]);
    const legacy = plan([{ unit: 'tokens', value: 1_000, closeoutReserve: 100 }]);
    for (const bounded of [mixed, wallOnly, legacy]) {
      expect(standardAdmissionAlternative(bounded)).toMatchObject({ deadlineMs: now + 14_280_000 });
    }
    expect(standardAdmissionAlternative(mixed).maxAdmissions).toBe(120);
    expect(standardAdmissionAlternative(wallOnly).maxAdmissions).toBe(60);
    expect(standardAdmissionAlternative(legacy).maxAdmissions).toBe(60);

    const invalid = plan([{ unit: 'admissions', value: 2.5, closeoutReserve: 0 }]);
    expect(() => admitWork(invalid, unknownReport(), { now, alternative: standardAdmissionAlternative(invalid) })).toThrow('admission limits must be whole counts');

    const expired = { ...wallOnly, startTime: new Date(now - 14_280_001).toISOString() };
    expect(admitWork(expired, unknownReport(), { now, alternative: standardAdmissionAlternative(expired) })).toMatchObject({ admitted: false, reason: 'unknown-accounting-needs-bounded-alternative' });
  });
});
