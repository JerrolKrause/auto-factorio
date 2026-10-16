import { describe, expect, it } from 'vitest';
import { ComputationLimit, Q } from '../packages/core/production/rational.js';
import { maximize, solveRoutes } from '../packages/core/production/solver.js';
import type { LinearConstraint, SolverBudget } from '../packages/core/production/solver.js';

const q = (n: bigint | number, d: bigint | number = 1) => new Q(n, d);
const constraint = (coefficients: Q[], bound: Q, label: string): LinearConstraint => ({ coefficients, bound, label });
const budget = (maxPivots = 100, now: () => number = () => 0, deadline = 1): SolverBudget => ({ pivots: 0, maxPivots, deadline, now });
const exact = (value: Q) => [value.n, value.d] as const;

describe('exact production simplex solver', () => {
  it('solves a fractional phase-one problem with negative coefficients exactly', () => {
    // -3x/2 <= -1/4 requires x >= 1/6; maximizing -x selects that boundary.
    const result = maximize([
      constraint([q(-3, 2)], q(-1, 4), 'fractional-lower-bound'),
      constraint([q(1)], q(2), 'upper-bound'),
    ], [q(-1)], budget());

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;
    expect(exact(result.values[0]!)).toEqual([1n, 6n]);
    expect(exact(result.objective)).toEqual([-1n, 6n]);
    // Check the returned point against the source inequalities, independently of tableau state.
    // Clearing denominators in -3x/2 = -1/4 gives -6*n = -d.
    expect(-6n * result.values[0]!.n).toBe(-result.values[0]!.d);
    expect(result.values[0]!.cmp(q(1, 6))).toBe(0);
    expect(result.values[0]!.cmp(q(2))).toBeLessThanOrEqual(0);
  });

  it('resolves a degenerate equal-cost route tie in stable lexicographic order', () => {
    // x + y >= 1 and each route is capped at 1. Every point on x+y=1 has
    // the same minimum total; lexicographically minimizing [x, y] gives [0, 1].
    const result = solveRoutes([
      constraint([q(-1), q(-1)], q(-1), 'meet-demand'),
      constraint([q(1), q(0)], q(1), 'first-route-cap'),
      constraint([q(0), q(1)], q(1), 'second-route-cap'),
    ], 2, 2, budget());

    expect(result.status).toBe('optimal');
    if (result.status !== 'optimal') return;
    expect(result.values.map(exact)).toEqual([[0n, 1n], [1n, 1n]]);
    // The final lexicographic stage maximizes -y, whose value at [0, 1] is -1.
    expect(exact(result.objective)).toEqual([-1n, 1n]);
  });

  it('distinguishes infeasible from unbounded feasible programs', () => {
    const infeasible = maximize([
      constraint([q(1)], q(0), 'x-at-most-zero'),
      constraint([q(-1)], q(-1), 'x-at-least-one'),
    ], [q(1)], budget());
    expect(infeasible).toEqual({ status: 'infeasible' });

    const unbounded = maximize([], [q(1)], budget());
    expect(unbounded).toEqual({ status: 'unbounded' });
  });

  it('reports pivot and deadline exhaustion as conservative computation limits', () => {
    const problem = [constraint([q(1)], q(2), 'finite-cap')];
    expect(() => maximize(problem, [q(1)], budget(0))).toThrowError(ComputationLimit);

    const expired = budget(100, () => 1, 0);
    expect(() => maximize(problem, [q(1)], expired)).toThrowError(ComputationLimit);
    expect(expired.pivots).toBe(0);
  });
});

describe('canonical exact rationals', () => {
  it('normalizes zero, signs and integer fractions', () => {
    expect(exact(q(0, -37))).toEqual([0n, 1n]);
    expect(exact(q(42, -14))).toEqual([-3n, 1n]);
    expect(exact(q(84, 28))).toEqual([3n, 1n]);
    expect(exact(q(7))).toEqual([7n, 1n]);
  });

  it('accepts a normalized 512-bit value and conservatively rejects a 513-bit denominator', () => {
    const power = 1n << 511n;
    const atLimit = q(power * 9n, 9n);
    expect(atLimit.n).toBe(power);
    expect(atLimit.d).toBe(1n);
    expect(atLimit.n.toString(2)).toHaveLength(512);

    expect(() => q(1n, 1n << 512n)).toThrowError(ComputationLimit);
  });
});
