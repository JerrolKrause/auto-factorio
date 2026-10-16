import type { ProductionPlan, ProductionStageStatus, ProductionStatusPage, ProductionProduct, ProductionBlocker } from '@autofactorio/contracts';
import type { Coordinator } from '../orchestration/coordinator.js';
import { OperationalStore } from '../context/operational.js';
import { ProductionCommitter } from './commit.js';
import { stageStatus } from './status.js';
import { digest } from './graph.js';
export interface OperatorPlanPage { plans: { id: string; revision: number; status: string; target: ProductionProduct; stageCount: number; blockers: ProductionBlocker[]; omittedBlockers: number }[]; next: number | null; omitted: number }
interface Record { owner: string; planId: string; revision: number; plan: ProductionPlan }
function offset(value: number) { if (!Number.isSafeInteger(value) || value < 0 || value > 200) throw new Error('Invalid production page offset'); }
/** Operator-only bounded views of ordinary plan/task evidence, never evaluator projections. */
export function operatorPlans(c: Coordinator, start = 0): OperatorPlanPage {
  offset(start); const records = c.runtime.journal.list<Record>(c.runtime.run, 'productionPlans');
  const rows = records.slice(start, start + 10).map(({ plan }) => ({ id: plan.id, revision: plan.revision, status: plan.status, target: plan.request.target, stageCount: plan.stages.length, blockers: plan.blockers.slice(0, 8), omittedBlockers: Math.max(0, plan.blockers.length - 8) }));
  return { plans: rows, next: start + rows.length < records.length ? start + rows.length : null, omitted: Math.max(0, records.length - start - rows.length) };
}
export function operatorStages(c: Coordinator, id: string, revision: number, start = 0, nowTick?: number): ProductionStatusPage {
  offset(start); if (!/^plan\.[a-f0-9]{32}$/.test(id) || !Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid production plan reference');
  const record = c.runtime.journal.get<Record>(c.runtime.run, 'productionPlans', `${id}.${revision}`); if (!record) throw new Error('Plan unavailable');
  const store = new OperationalStore(c.runtime), progress = new ProductionCommitter(c).progress(record.owner, record.plan), stages: ProductionStageStatus[] = [];
  for (const stage of record.plan.stages.slice(start, start + 4)) {
    const old = c.runtime.journal.get<ProductionStageStatus>(c.runtime.run, 'productionStatuses', `${id}.${revision}.${digest(stage.id).slice(0, 16)}`);
    const current = progress.find(p => p.stage === stage.id) ?? null;
    const scope = old?.scope ? store.scope(old.scope.id) : undefined;
    const observed = scope && current?.current && scope.task === current.task && scope.revision === current.taskRevision && old?.scope?.revision === scope.revision ? { scope: { id: scope.id, revision: scope.revision }, tick: nowTick ?? old.tick ?? 0, metrics: store.metrics(scope.id, 600, nowTick), symptoms: store.samples(scope.id, scope.revision, c.runtime.context().epoch).at(-1)?.symptoms ?? [], symptomsOmitted: store.samples(scope.id, scope.revision, c.runtime.context().epoch).at(-1)?.symptomsOmitted ?? 0 } : null;
    const row = stageStatus(id, revision, stage, old?.planned ?? [], current, observed, old?.stale ?? false);
    if (Buffer.byteLength(JSON.stringify([...stages, row])) > 23000) break;
    stages.push(row);
  }
  const next = start + stages.length;
  return { id, revision, stages, next: next < record.plan.stages.length ? next : null, omitted: Math.max(0, record.plan.stages.length - next), scenarioVerdict: 'not-evaluated' as const };
}
