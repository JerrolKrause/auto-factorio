import { ComputationLimit, ONE, Q, ZERO } from './rational.js';

export interface LinearConstraint { coefficients: Q[]; bound: Q; label: string }
export interface SolverBudget { pivots: number; maxPivots: number; deadline: number; now: () => number }
export type Solution = { status: 'optimal'; values: Q[]; objective: Q } | { status: 'infeasible' | 'unbounded' };
/** Two-phase exact simplex for A*x <= b, x>=0. Bland ordering makes degenerate ties repeatable. */
export function maximize(constraints: LinearConstraint[], objective: Q[], budget: SolverBudget): Solution {
  const m = constraints.length, n = objective.length;
  const basic = Array.from({ length: m }, (_, i) => n + i), nonbasic = Array.from({ length: n + 1 }, (_, i) => i === n ? -1 : i);
  const d = Array.from({ length: m + 2 }, () => Array.from({ length: n + 2 }, () => ZERO));
  constraints.forEach((c, i) => { d[i] = [...c.coefficients, ONE.neg(), c.bound]; });
  for (let j = 0; j < n; j++) d[m]![j] = objective[j]!.neg();
  d[m + 1]![n] = ONE;
  const pivot = (r: number, s: number) => {
    if (++budget.pivots > budget.maxPivots || budget.now() > budget.deadline) throw new ComputationLimit('solver_exhausted');
    const inverse = ONE.div(d[r]![s]!);
    // Sparse balance/lexicographic rows contain many exact zeros. Preserve them
    // without allocating/reducing rational products, keeping the same finite budget.
    for (let i = 0; i < m + 2; i++) if (i !== r && d[i]![s]!.n !== 0n) {
      // This multiplier is invariant across the row. Reduce it once rather than
      // repeating the same product for every nonzero pivot-row cell.
      const multiplier = d[i]![s]!.mul(inverse);
      for (let j = 0; j < n + 2; j++) if (j !== s && d[r]![j]!.n !== 0n) d[i]![j] = d[i]![j]!.sub(d[r]![j]!.mul(multiplier));
    }
    for (let j = 0; j < n + 2; j++) if (j !== s && d[r]![j]!.n !== 0n) d[r]![j] = d[r]![j]!.mul(inverse);
    for (let i = 0; i < m + 2; i++) if (i !== r && d[i]![s]!.n !== 0n) d[i]![s] = d[i]![s]!.mul(inverse).neg();
    d[r]![s] = inverse; [basic[r], nonbasic[s]] = [nonbasic[s]!, basic[r]!];
  };
  const simplex = (phase: number): boolean => {
    const x = phase === 1 ? m + 1 : m;
    for (;;) {
      if (budget.now() > budget.deadline) throw new ComputationLimit('solver_exhausted');
      const candidates = nonbasic.map((id, j) => ({ id, j })).filter(v => !(phase === 2 && v.id === -1) && d[x]![v.j]!.cmp(ZERO) < 0).sort((a, b) => a.id - b.id);
      if (!candidates.length) return true;
      const s = candidates[0]!.j; let r = -1;
      for (let i = 0; i < m; i++) if (d[i]![s]!.cmp(ZERO) > 0) {
        const comparison = r === -1 ? -1 : d[i]![n + 1]!.div(d[i]![s]!).cmp(d[r]![n + 1]!.div(d[r]![s]!));
        if (r === -1 || comparison < 0 || (comparison === 0 && basic[i]! < basic[r]!)) r = i;
      }
      if (r === -1) return false;
      pivot(r, s);
    }
  };
  let r = -1;
  for (let i = 0; i < m; i++) if (r === -1 || d[i]![n + 1]!.cmp(d[r]![n + 1]!) < 0) r = i;
  if (r !== -1 && d[r]![n + 1]!.cmp(ZERO) < 0) {
    pivot(r, n);
    if (!simplex(1) || d[m + 1]![n + 1]!.cmp(ZERO) !== 0) return { status: 'infeasible' };
    const artificial = basic.indexOf(-1);
    if (artificial !== -1) {
      const s = nonbasic.map((id, j) => ({ id, j })).filter(v => d[artificial]![v.j]!.cmp(ZERO) !== 0).sort((a, b) => a.id - b.id)[0];
      if (s) pivot(artificial, s.j);
    }
  }
  if (!simplex(2)) return { status: 'unbounded' };
  const values = Array.from({ length: n }, () => ZERO);
  basic.forEach((id, i) => { if (id >= 0 && id < n) values[id] = d[i]![n + 1]!; });
  return { status: 'optimal', values, objective: d[m]![n + 1]! };
}

export function equality(coefficients: Q[], bound: Q, label: string): LinearConstraint[] {
  return [{ coefficients, bound, label }, { coefficients: coefficients.map(q => q.neg()), bound: bound.neg(), label }];
}

/** Minimize total crafts, then stable recipe-ID lexicographic rates on that optimum face. */
export function solveRoutes(constraints: LinearConstraint[], variableCount: number, stages: number, budget: SolverBudget): Solution {
  const objective = Array.from({ length: variableCount }, (_, i) => i < stages ? ONE.neg() : ZERO);
  let result = maximize(constraints, objective, budget);
  if (result.status !== 'optimal') return result;
  const fixed = [...constraints, ...equality(objective, result.objective, 'minimum_total_crafts')];
  for (let i = 0; i < stages; i++) {
    const lex = Array.from({ length: variableCount }, (_, j) => i === j ? ONE.neg() : ZERO);
    result = maximize(fixed, lex, budget);
    if (result.status !== 'optimal') return result;
    fixed.push(...equality(lex, result.objective, `lex:${i}`));
  }
  return result;
}
