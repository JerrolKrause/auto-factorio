import { describe, expect, it } from 'vitest';
import { FirstShiftAttempt, FirstShiftControl, briefing, commonKit, plateToScienceKit, evaluatorManifest, fingerprint, validateFirstShift } from '../packages/factorio/src/first-shift.js';
import { VerificationControl } from '../packages/factorio/src/verification.js';
import type { ControlState } from '../packages/factorio/src/lifecycle.js';
import type { Measurement } from '../packages/core/evaluation/contracts.js';
import { runDeadline } from '../packages/core/evaluation/run-clock.js';
import { dashboardFixture } from '../scripts/dev/dashboard-fixture.js';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Operator } from '../apps/runtime/operator.js';
import { referencePlan } from '../scripts/dev/first-shift-reference.js';

const fixture = () => validateFirstShift({ id: '01-first-shift', version: 's1-v1', seed: 42, mods: { base: '2.0.77', 'space-age': '2.0.77' }, surface: 'nauvis', quality: 'normal', area: [[-32, -32], [32, 32]], grants: ['automation'], kit: commonKit, allowedActions: ['walk', 'place'], allowedRecipes: ['automation-science-pack'], rates: { 'iron-gear-wheel': 60, 'copper-plate': 60 }, terminals: {}, collector: {}, settlingTicks: 600, windowTicks: 3600, windows: 5, target: 30, gameLimitTicks: 108000, wallLimitMs: 5400000, evaluator: 's1-measurement-v1', recipe: { name: 'automation-science-pack', energy: 5, ingredients: [{ type: 'item', name: 'iron-gear-wheel', amount: 1 }, { type: 'item', name: 'copper-plate', amount: 1 }], products: [{ type: 'item', name: 'automation-science-pack', amount: 1 }] }, assemblerSpeed: 0.5 });
const s2Fixture = () => validateFirstShift({ ...fixture(), id: '02-some-assembly-required', version: 's2-v6', area: [[-40, -40], [40, 40]], kit: plateToScienceKit, allowedRecipes: ['automation-science-pack', 'iron-gear-wheel'], rates: { 'iron-plate': 120, 'copper-plate': 60 }, evaluator: 's2-measurement-v5', gearRecipe: { name: 'iron-gear-wheel', energy: 0.5, ingredients: [{ type: 'item', name: 'iron-plate', amount: 2 }], products: [{ type: 'item', name: 'iron-gear-wheel', amount: 1 }] } });
const measurement = (sequence: number, tick: number): Measurement => ({ tick, sequence, scope: 'fixture', continuous: true, coverage: 'complete', machineScience: 0, automaticCollector: 0, collectorReverse: 0, manualSupply: 0, artificialOutput: 0, humanEdits: 0, stages: Object.fromEntries(evaluatorManifest(fixture(), 'fixture', 0, 0).stages.map(s => [s.id, { source: s.source, boundary: s.boundary, consumer: s.consumer, produced: 0, causalProduced: 0, forward: 0, reverse: 0, consumed: 0, upstream: { containers: 0, belts: 0, hands: 0, inProcess: 0, segments: {} }, downstream: { containers: 0, belts: 0, hands: 0, inProcess: 0, segments: {} }, coverage: 'complete' }])) });
describe('First Shift manifest', () => {
  it('keeps building deadlines across paused polling and controller replacement', () => {
    const clock = { originTick: 100, originWallMs: 1000, gameLimitTicks: 18000, wallLimitMs: 90000 };
    expect(runDeadline(clock, 100, 90999)).toBeNull();
    expect(runDeadline(structuredClone(clock), 100, 91000)).toBe('scenario_wall_deadline');
    expect(runDeadline(clock, 18100, 2000)).toBeNull();
    expect(runDeadline(clock, 18101, 2000)).toBe('scenario_game_deadline');
    expect(runDeadline(clock, 99, 2000)).toBe('scenario_clock_invalid');
  });
  it('derives chain minima from installed recipes and fails unsupported products', () => {
    const m = fixture(); m.recipe.ingredients[0]!.amount = 2;
    expect(evaluatorManifest(m, 'fixture', 40, 20).stages[0]!.minimum).toBe(300);
    m.recipe.products[0]!.probability = 0.5;
    expect(() => validateFirstShift(m)).toThrow('Unsupported installed');
  });
  it('rejects altered kits and timing instead of silently calibrating a different fixture', () => {
    const m = fixture(); m.kit['assembling-machine-1'] = 120;
    expect(() => validateFirstShift(m)).toThrow('finite kit');
    expect(() => validateFirstShift({ ...fixture(), settlingTicks: -1 })).toThrow('clock');
  });
  it('derives the S2 plate, gear and science stages from installed recipes', () => {
    const m = s2Fixture(); const evaluation = evaluatorManifest(m, 'fixture', 0, 0);
    expect(evaluation).toMatchObject({ version: 's2-measurement-v5', toleranceVersion: 's2-calibration-v5' });
    expect(evaluation.stages.map(s => [s.id, s.minimum])).toEqual([['iron-plate', 300], ['iron-gear-wheel', 150], ['copper-plate', 150], ['automation-science-pack', 150]]);
    expect(evaluation.stages.find(s => s.id === 'iron-gear-wheel')?.balanceTolerance).toBe(4);
    expect(referencePlan(m).filter(s => s.kind === 'place' && s.item === 'assembling-machine-1')).toHaveLength(9);
    expect({ ...briefing(m, 'solo'), roster: 'team' }).toEqual(briefing(m, 'team'));
    expect(briefing(m, 'team').rules.join()).toContain('iron-gear-wheel');
    m.recipe.ingredients.reverse();
    expect(evaluatorManifest(m, 'fixture', 0, 0).stages.map(s => s.id)).toEqual(['iron-plate', 'iron-gear-wheel', 'copper-plate', 'automation-science-pack']);
  });
  it('rejects changed S2 recipe costs and fixture identity', () => {
    const m = s2Fixture(); m.gearRecipe!.ingredients[0]!.amount = 3;
    expect(() => validateFirstShift(m)).toThrow('gear recipe');
    expect(() => validateFirstShift({ ...s2Fixture(), area: [[-32, -32], [32, 32]] })).toThrow('site');
  });
  it('fingerprints canonical content, including source changes, and gives both rosters the same briefing', () => {
    expect(fingerprint({ b: 1, a: { d: 3, c: 2 } })).toBe(fingerprint({ a: { c: 2, d: 3 }, b: 1 }));
    expect(fingerprint({ fixture: fixture(), modHash: 'old' })).not.toBe(fingerprint({ fixture: fixture(), modHash: 'new' }));
    expect({ ...briefing(fixture(), 'solo'), roster: 'team' }).toEqual(briefing(fixture(), 'team'));
    expect(JSON.stringify(briefing(fixture(), 'team'))).not.toMatch(/referencePlan|bypass|assemblers.*position/);
  });
});
describe('First Shift measurement adapter', () => {
  it('a replacement operator stops a paused expired scenario and refuses to replenish its limits', async () => {
    const f = await dashboardFixture(mkdtempSync(path.join(os.tmpdir(), 'af-s1-clock-')), true);
    try {
      await f.operator.control('pause');
      f.runtime.record('scenario/clock', [{ entity: 'runs', id: 'scenario-clock', value: { originTick: f.state.tick, originWallMs: Date.now() - 1000, gameLimitTicks: 10000, wallLimitMs: 1 } }]);
      const replacement = new Operator(f.c); await replacement.poll();
      expect(replacement.state().scoringClosed).toBe(true); expect(f.state.paused).toBe(true); expect(f.c.budget.state.closed).toBe(true);
      expect((await replacement.control('resume')).admission).toBe(false);
      expect(f.runtime.journal.get<{ reason: string }>(f.runtime.run, 'runs', 'verification')?.reason).toBe('scenario_wall_deadline');
    } finally { f.close(); }
  });
  function setup() {
    const manifest = evaluatorManifest(fixture(), 'fixture', 0, Date.now());
    let response: unknown = { ok: true, tick: 100, guard: 'admitted', samples: [measurement(0, 100)] };
    const port = { command: async () => { if (response instanceof Error) throw response; return JSON.stringify(response); }, close: () => {} };
    const scenario = new FirstShiftControl(port);
    const guardPort = { command: async () => JSON.stringify({ ok: true, verification: { state: 'admitted', scope: 'fixture', baseline: { attempt: 'attempt', scope: 'fixture', tick: 100, mutationsClosed: true, pendingMutations: 0, neutral: true } } }), close: () => {} };
    const guard = new VerificationControl(guardPort, () => {});
    const attempt = new FirstShiftAttempt('attempt', manifest, scenario, guard, () => {});
    return { attempt, control: { tick: 100 } as ControlState, set: (v: unknown) => { response = v; } };
  }
  it('invalidates a lost connection and retains the last accepted evidence', async () => {
    const f = setup(); await f.attempt.admit(f.control); f.set(new Error('connection lost'));
    await expect(f.attempt.poll()).rejects.toThrow('connection lost');
    expect(f.attempt.engine.report()).toMatchObject({ state: 'invalid', samples: [measurement(0, 100)] });
  });
  it('retains game invalidations and refuses an absent exact admission sample', async () => {
    const f = setup(); f.set({ ok: true, tick: 100, guard: 'admitted', samples: [] });
    await expect(f.attempt.admit(f.control)).rejects.toThrow('Missing exact admission');
    expect(f.attempt.engine.report().state).toBe('invalid');
    const g = setup(); await g.attempt.admit(g.control); g.set({ ok: true, tick: 101, guard: 'invalid', error: 'character inventory changed', samples: [] }); await g.attempt.poll();
    expect(g.attempt.engine.report().reasons.join()).toContain('character inventory changed');
  });
  it('enforces wall limits under frozen game ticks and explicit budget closure', async () => {
    const f = setup(); await f.attempt.admit(f.control); const m = f.attempt.engine.report().manifest;
    await f.attempt.poll(m.originWallMs + m.wallLimitMs); expect(f.attempt.engine.report().state).toBe('aborted');
    const g = setup(); await g.attempt.admit(g.control); g.attempt.stop('budget'); expect(g.attempt.engine.report().reasons).toContain('run_closed:budget');
  });
  it('requires an unbroken exact sequence across a paused poll', async () => {
    const f = setup(); await f.attempt.admit(f.control); await f.attempt.poll();
    f.set({ ok: true, tick: 700, guard: 'admitted', samples: [measurement(2, 700)] }); await f.attempt.poll();
    expect(f.attempt.engine.report().reasons).toContain('disconnect_or_sequence_gap');
  });
});
