import { describe, expect, it } from 'vitest';
import { VerificationEngine } from '../packages/core/evaluation/engine.js';
import type { AdmissionAck, EvaluationManifest, Measurement } from '../packages/core/evaluation/contracts.js';

const manifest = (): EvaluationManifest => ({ version: 'fake-v1', scope: 'science-chain', settlingTicks: 600, windowTicks: 3600, windows: 5, target: 30, originTick: 0, originWallMs: 0, gameLimitTicks: 108000, wallLimitMs: 5400000, toleranceVersion: 'fake-calibration-1', stages: [{ id: 'gears', source: 'terminal', boundary: 'science-input', consumer: 'science-assemblers', item: { name: 'iron-gear-wheel', quality: 'normal', surface: 'nauvis' }, minimum: 150, balanceTolerance: 1, maxDrawdown: 2 }] });
const inventory = (n = 10) => ({ containers: n, belts: 2, hands: 1, inProcess: 1, segments: { stock: n + 4 } });
function sample(tick: number, sequence: number, count = 0): Measurement {
  return { tick, sequence, scope: 'science-chain', continuous: true, coverage: 'complete', machineScience: 500 + count, automaticCollector: 700 + count, collectorReverse: 20, manualSupply: 0, artificialOutput: 0, humanEdits: 0, stages: { gears: { source: 'terminal', boundary: 'science-input', consumer: 'science-assemblers', produced: 1000 + count, causalProduced: 1000 + count, forward: 900 + count, reverse: 40, consumed: 800 + count, upstream: inventory(), downstream: inventory(), coverage: 'complete' } } };
}
const ack = (): AdmissionAck => ({ attempt: 'a1', scope: 'science-chain', tick: 100, mutationsClosed: true, pendingMutations: 0, neutral: true, raw: { cancelled: ['queued-transfer'], inventories: inventory() } });
function begin(m = manifest(), a = ack()) {
  const events: unknown[] = []; const e = new VerificationEngine('a1', m, v => events.push(v));
  e.request(90, 1); e.acknowledge(a, sample(a.tick, 0), 2);
  return { e, events };
}
function trace(e: VerificationEngine, edit: (s: Measurement, window: number) => void = () => {}) {
  e.sample(sample(700, 1), 3);
  for (let i = 1; i <= 5; i++) { const s = sample(700 + i * 3600, i + 1, i * 30); edit(s, i); e.sample(s, 3 + i); }
  return e.report();
}
describe('independent verification engine', () => {
  it('retains reproducible raw baselines, scoped flows and five exact windows', () => {
    const a = begin(); const b = begin(); expect(trace(a.e)).toEqual(trace(b.e)); expect(a.events).toEqual(b.events);
    expect(a.e.report()).toMatchObject({ state: 'passed', admission: { tick: 100 }, windows: Array.from({ length: 5 }, () => ({ produced: 30, delivered: 30, passed: true })) });
  });
  it('retains linear event payloads at tick-level sampling and isolates the sink from engine state', () => {
    const sizes: number[] = []; let rawSamples = 0;
    const e = new VerificationEngine('a1', manifest(), event => {
      const v = event as { kind: string; data: { sample?: Measurement } };
      sizes.push(JSON.stringify(event).length);
      if (v.kind === 'evaluation/measurement') { rawSamples++; v.data.sample!.machineScience = 0; }
    });
    e.request(90, 1); e.acknowledge(ack(), sample(100, 0), 2);
    for (let tick = 101; tick <= 18700; tick++) {
      const count = Math.max(0, Math.floor((tick - 700) / 120));
      e.sample(sample(tick, tick - 100, count), tick);
    }
    expect(e.report().state).toBe('passed'); expect(rawSamples).toBe(18601);
    expect(Math.max(...sizes)).toBeLessThan(4000);
    expect(sizes.reduce((sum, n) => sum + n, 0)).toBeLessThan(rawSamples * 2000);
    expect(e.report().samples).toHaveLength(rawSamples);
  });
  it.each([{ pendingMutations: 1 }, { mutationsClosed: false }, { neutral: false }, { attempt: 'wrong' }, { scope: 'elsewhere' }])('rejects premature or foreign acknowledgement %j', bad => {
    const { e } = begin(manifest(), { ...ack(), ...bad }); expect(e.report().state).toBe('invalid'); expect(e.report().baseline).toBeNull();
  });
  it('freezes manifest and isolates returned evidence from caller mutation', () => {
    const m = manifest(); const { e } = begin(m); m.stages[0]!.minimum = 0; m.settlingTicks = 0;
    e.report().manifest.stages[0]!.minimum = 0; expect(e.report().manifest).toEqual(manifest());
  });
  it('does not pool excess output across the 29-pack window', () => {
    const { e } = begin(); const result = trace(e, (s, i) => { if (i === 3) s.automaticCollector--; });
    expect(result.state).toBe('failed'); expect(result.windows[2]!.delivered).toBe(29); expect(result.windows[3]!.delivered).toBe(31);
  });
  it('excludes old inventory even when the collector has ample stock', () => {
    const { e } = begin(); expect(trace(e, s => { s.machineScience = 500; }).state).toBe('failed');
  });
  it('settling output is excluded by a fresh scoring baseline', () => {
    const { e } = begin(); e.sample(sample(700, 1, 1000), 3);
    for (let i = 1; i <= 5; i++) e.sample(sample(700 + i * 3600, i + 1, 1000), 3 + i);
    expect(e.report().state).toBe('failed'); expect(e.report().windows.every(w => w.produced === 0)).toBe(true);
  });
  it('accepts exact boundaries but never interpolates across a missed one', () => {
    const { e } = begin(); e.sample(sample(699, 1), 3); e.sample(sample(701, 2), 4);
    expect(e.report()).toMatchObject({ state: 'invalid', reasons: ['missing_exact_boundary:700'] });
  });
  it('allows frozen clock polling, rejects changed frozen evidence, enforces wall limits while paused', () => {
    const { e } = begin(); e.sample(sample(100, 0), 1000); expect(e.report().state).toBe('settling');
    e.clock(100, 5400000); expect(e.report()).toMatchObject({ state: 'aborted', scoringClosed: true });
    const next = begin().e; next.sample(sample(100, 0, 1), 4); expect(next.report().state).toBe('invalid');
  });
  it('permits final game deadline equality and permanently closes expired attempts', () => {
    const { e } = begin({ ...manifest(), gameLimitTicks: 18700 }); expect(trace(e).state).toBe('passed');
    const other = begin({ ...manifest(), gameLimitTicks: 18699 }).e; expect(trace(other).state).toBe('aborted');
    other.sample(sample(18700, 6, 150), 20); expect(other.report().state).toBe('aborted');
  });
  it('checks the admission deadline at acknowledgement, allowing fixed finish afterward', () => {
    expect(trace(begin({ ...manifest(), admissionLimitTicks: 100 }).e).state).toBe('passed');
    expect(begin({ ...manifest(), admissionLimitTicks: 99 }).e.report().state).toBe('failed');
  });
  it.each(['continuous', 'coverage', 'stage', 'sequence', 'regression', 'scope'] as const)('invalidates missing evidence: %s', kind => {
    const { e } = begin(); const s = sample(700, 1);
    if (kind === 'continuous') s.continuous = false;
    if (kind === 'coverage') s.coverage = 'ambiguous';
    if (kind === 'stage') delete s.stages.gears;
    if (kind === 'sequence') s.sequence = 3;
    if (kind === 'regression') s.machineScience = 0;
    if (kind === 'scope') s.scope = 'different';
    e.sample(s, 3); trace(e); expect(e.report().state).toBe('invalid');
  });
  it.each(['manualSupply', 'artificialOutput', 'humanEdits'] as const)('invalidates %s and cannot recover that attempt', field => {
    const { e } = begin(); const result = trace(e, (s, i) => { if (i === 3) s[field] = 1; });
    expect(result.state).toBe('invalid'); if (field === 'humanEdits') expect(result.assisted).toBe(true);
    e.repair(); expect(e.report().state).toBe('invalid');
  });
  it('repair aborts before any more samples can count', () => { const { e } = begin(); e.repair(); expect(trace(e).state).toBe('aborted'); });
  it('retains rejected admission and raw invalid coverage for calibration', () => {
    const denied = begin(manifest(), { ...ack(), pendingMutations: 2 }).e.report();
    expect(denied.admissionEvidence).toMatchObject({ ack: { pendingMutations: 2 } });
    const { e } = begin(); const s = sample(700, 1); s.stages.gears!.coverage = 'missing';
    e.sample(s, 3); expect(e.report()).toMatchObject({ state: 'invalid', lastInput: { sample: s } });
    expect(e.report().samples).toHaveLength(1);
  });
  it('does not count disconnected upstream totals', () => {
    const { e } = begin(); expect(trace(e, s => { s.stages.gears!.consumer = 'unused-cell'; }).state).toBe('invalid');
  });
  it('requires production on the observed causal route even when every aggregate check passes', () => {
    const { e } = begin(); const r = trace(e, s => { s.stages.gears!.causalProduced = 1000; });
    expect(r.state).toBe('failed'); expect(r.stages[0]).toMatchObject({ produced: 150, causalProduced: 0, delivered: 150, consumed: 150, drawdown: 0, passed: false });
  });
  it('rejects recirculation despite apparently adequate gross delivery', () => {
    const { e } = begin(); const r = trace(e, (s, i) => {
      const v = s.stages.gears!; v.produced = 1000; v.reverse += i * 30; v.consumed = 800;
    }); expect(r.state).toBe('failed'); expect(r.stages[0]!.delivered).toBe(0);
  });
  it('rejects reserves masking inadequate fresh supply without loosening minimums by tolerance', () => {
    const { e } = begin(); const r = trace(e, (s, i) => { const v = s.stages.gears!; v.produced--; v.upstream.containers--; v.upstream.segments.stock = v.upstream.segments.stock! - 1; if (i === 5) expect(v.produced).toBe(1149); });
    expect(r.state).toBe('failed'); expect(r.stages[0]!.produced).toBe(149);
  });
  it('does not let unused accumulation cancel depletion of a different storage segment', () => {
    expect(trace(begin().e).state).toBe('passed');
    const { e } = begin();
    e.sample(sample(700, 1), 3);
    for (let i = 1; i <= 5; i++) {
      const s = sample(700 + i * 3600, i + 1, i * 30);
      if (i === 5) s.stages.gears!.upstream.segments = { stock: 0, unused: 14 };
      e.sample(s, 3 + i);
    }
    const r = e.report(); expect(r.state).toBe('failed');
    expect(r.stages[0]).toMatchObject({ produced: 150, delivered: 150, upstreamResidual: 0, downstreamResidual: 0, drawdown: 14, passed: false });
  });
  it('does not count redistribution within one connected stock component as drawdown', () => {
    const { e } = begin();
    const r = trace(e, s => {
      const v = s.stages.gears!.upstream;
      v.containers -= 8; v.belts += 8;
    });
    expect(r.state).toBe('passed'); expect(r.stages[0]!.drawdown).toBe(0);
  });
  it('accepts normal buffering but rejects large balanced drawdown', () => {
    const { e } = begin(); expect(trace(e, s => { const v = s.stages.gears!.upstream; v.containers--; v.segments.stock = v.segments.stock! - 1; }).state).toBe('passed');
    const other = begin().e; const r = trace(other, s => { const v = s.stages.gears!; v.consumed += 5; v.downstream.containers -= 5; v.downstream.segments.stock = v.downstream.segments.stock! - 5; });
    expect(r.state).toBe('failed'); expect(r.stages[0]!.drawdown).toBe(5);
  });
  it('invalidates incomplete balances and nonfinite/incomplete inventory coverage', () => {
    expect(trace(begin().e, s => { s.stages.gears!.upstream.containers += 2; }).state).toBe('invalid');
    expect(trace(begin().e, s => { s.stages.gears!.downstream.hands = NaN; }).state).toBe('invalid');
    expect(trace(begin().e, s => { s.stages.gears!.downstream.segments.stock = NaN; }).state).toBe('invalid');
  });
});
