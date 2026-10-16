import type { ProductionStatusInput, ProductionStatusPage, ProductionStageStatus, OperationalMetric, MachineSymptom, ProductionStage } from '@autofactorio/contracts';
import type { Coordinator } from '../orchestration/coordinator.js';
import type { AgentContext } from '../context/service.js';
import { ProductionFacts } from './facts.js';
import { ProductionPlanService } from './service.js';
import type { PlanAccess } from './service.js';
import { ProductionCommitter } from './commit.js';
import { Q } from './rational.js';
import { digest } from './graph.js';

/** Stage health is an ordinary, bounded observation. It never establishes evaluation authority. */
export class ProductionStatusService {
  constructor(private c: Coordinator, private plans: ProductionPlanService, private commits: ProductionCommitter, private facts: ProductionFacts) {}
  async status(access: PlanAccess, input: ProductionStatusInput, context: AgentContext): Promise<ProductionStatusPage> {
    if (Object.keys(input).some(k => !['id', 'revision', 'stage', 'area', 'windowTicks', 'offset'].includes(k)) || !Number.isSafeInteger(input.offset ?? 0) || (input.offset ?? 0) < 0 || (input.offset ?? 0) > 64 || !Number.isSafeInteger(input.area ?? 0) || (input.area ?? 0) < 0 || !Number.isSafeInteger(input.windowTicks ?? 600) || (input.windowTicks ?? 600) < 60 || (input.windowTicks ?? 600) > 7140 || input.stage !== undefined && (typeof input.stage !== 'string' || input.stage.length > 150)) throw new Error('Invalid production status selector');
    const plan = this.plans.statusPlan(access, input.id, input.revision, input.stage);
    if (input.stage && !plan.stages.some(s => s.id === input.stage)) throw new Error('Unknown plan stage');
    const snapshot = await this.facts.snapshot(access);
    this.plans.statusPlan(access, input.id, input.revision, input.stage); access.authorize();
    const stale = snapshot.catalog.fingerprint !== plan.fingerprint || snapshot.availabilityRevision !== plan.availabilityRevision;
    const selected = plan.stages.filter(s => !input.stage || s.id === input.stage), offset = input.offset ?? 0;
    const page: ProductionStatusPage = { id: plan.id, revision: plan.revision, stages: [], next: null, omitted: Math.max(0, selected.length - offset), scenarioVerdict: 'not-evaluated' };
    for (const stage of selected.slice(offset, offset + 4)) {
      const progress = this.commits.progress(access.owner, plan).find(p => p.stage === stage.id) ?? null;
      const recipe = snapshot.catalog.recipes.find(r => r.id === stage.recipe || r.name === stage.recipe);
      const planned = recipe && stage.crafts ? [...recipe.products.map(p => ({ p, kind: 'production' as const })), ...recipe.ingredients.map(p => ({ p, kind: 'consumption' as const }))].filter(v => v.p.amount !== undefined).map(({ p, kind }) => ({ product: `${p.type}:${p.name}`, kind, rate: Q.from(stage.crafts!).mul(Q.from(p.amount!)).json() })) : [];
      let observed: Awaited<ReturnType<AgentContext['stageMetrics']>> | null = null;
      if (!stale && progress?.current && progress.construction !== 'blocked' && stage.machine && this.c.principal(access.owner).tasks.includes(progress.task)) {
        observed = await context.stageMetrics(progress.task, input.area ?? 0, input.windowTicks ?? 600, { recipe: recipe?.name ?? stage.recipe.replace(/^recipe:/, ''), machine: snapshot.catalog.machines.find(m => m.id === stage.machine || m.name === stage.machine)?.name ?? stage.machine.replace(/^machine:/, ''), targets: planned.filter(p => p.kind === 'production').map(p => { const [productKind, name] = p.product.split(':') as ['item' | 'fluid', string]; return { name, productKind, rate: Number(p.rate.numerator) / Number(p.rate.denominator) }; }) });
      }
      // Assignment/revision and grant checks apply after every asynchronous observation.
      this.plans.statusPlan(access, input.id, input.revision, input.stage); access.authorize();
      const currentProgress = this.commits.progress(access.owner, plan).find(p => p.stage === stage.id) ?? null;
      if (JSON.stringify(currentProgress) !== JSON.stringify(progress)) throw new Error('Stage task changed during observation');
      const row = stageStatus(plan.id, plan.revision, stage, planned, progress, observed, stale);
      if (Buffer.byteLength(JSON.stringify({ ...page, stages: [...page.stages, row] })) > 23000) break;
      page.stages.push(row); page.omitted--;
      // One latest projection per committed stage, not an unbounded polling history.
      // Source links preserve task/scope authorization for archive retrieval.
      if (progress?.current) {
        const sources = [{ entity: 'tasks' as const, id: progress.task }, ...(observed ? [{ entity: 'operationalScopes' as const, id: observed.scope.id }] : [])];
        const durableRow = { ...row, progress: row.progress ? { ...row.progress, suppliers: [] } : null };
        const old = this.c.runtime.journal.get<ProductionStageStatus>(this.c.runtime.run, 'productionStatuses', row.id);
        if (JSON.stringify(old) !== JSON.stringify(durableRow)) this.c.runtime.record('production/status', [{ entity: 'productionStatuses', id: row.id, value: { ...durableRow }, visibility: { kind: 'restricted', agents: [], roles: [], tasks: [progress.task] }, sources }], { kind: 'operator' }, observed?.tick);
      }
    }
    const next = offset + page.stages.length; if (next < selected.length) page.next = next;
    access.authorize(); return page;
  }
}

export function stageStatus(planId: string, revision: number, stage: ProductionStage, planned: ProductionStageStatus['planned'], progress: ProductionStageStatus['progress'], observed: { scope: { id: string; revision: number }; tick: number; metrics: OperationalMetric[]; symptoms?: MachineSymptom[]; symptomsOmitted?: number } | null, stale: boolean): ProductionStageStatus {
  // Plan references use catalog IDs; ordinary engine scopes/symptoms use names.
  const recipeName = stage.recipe.replace(/^recipe:/, ''), machineName = stage.machine?.replace(/^machine:/, '') ?? null;
  const metrics = observed?.metrics.slice(0, 24) ?? [], exceptions: ProductionStageStatus['exceptions'] = [];
  const expected = planned.slice(0, 24);
  if (stale) exceptions.push({ kind: 'unknown', detail: 'Facts or research changed; revalidate this revision.', evidence: [] });
  if (!progress?.current || !observed) exceptions.push({ kind: 'unknown', detail: 'No current observed stage binding; construction is not production evidence.', evidence: [] });
  if (stage.crafts && stage.nominalCraftsPerSecond && Q.from(stage.nominalCraftsPerSecond).cmp(Q.from(stage.crafts)) < 0) exceptions.push({ kind: 'capacity-constraint', detail: 'Calculated nominal craft capacity is below planned demand; physical connectivity remains unverified.', evidence: [] });
  for (const demand of expected) {
    const [productKind, name] = demand.product.split(':');
    const m = metrics.find(m => m.kind === demand.kind && (m.productKind ?? 'item') === productKind && m.name === name);
    const target = Number(demand.rate.numerator) / Number(demand.rate.denominator);
    const bounds = m?.rateBounds ?? (m?.rate !== null && m?.rate !== undefined ? { lower: m.rate, upper: m.rate } : null);
    if (stale || !m || m.coverage !== 'complete' || m.ageTicks > 60 || bounds === null || bounds.lower < target && bounds.upper >= target) exceptions.push({ kind: 'unknown', product: demand.product, detail: m?.reason ?? 'Missing, stale or insufficiently precise interval.', evidence: m?.evidence ?? [] });
    else if (bounds.upper < target) exceptions.push({ kind: 'measured-shortfall', product: demand.product, detail: `${demand.kind} upper bound ${bounds.upper} below required ${target}; ticks ${m.startTick}-${m.endTick}.`, evidence: m.evidence });
  }
  const symptoms = (observed?.symptoms ?? []).slice(0, 16).filter(m => m.recipe === recipeName && m.name === machineName).map(m => ({ unit: m.unit, name: m.name, position: m.position, tick: m.tick, status: m.status ?? null, recipe: m.recipe ?? null, power: m.power ?? null, coverage: m.coverage, evidence: m.evidence }));
  for (const m of symptoms) if (m.coverage === 'complete' && observed!.tick - m.tick <= 60 && m.power === 0) exceptions.push({ kind: 'measured-symptom', detail: 'Machine ' + m.unit + ' has an empty electrical energy buffer at tick ' + m.tick + '; supply cause is unverified.', evidence: m.evidence });
  const health = exceptions.some(e => e.kind === 'measured-shortfall' || e.kind === 'capacity-constraint') ? 'shortfall' : exceptions.length || expected.length === 0 ? 'unknown' : 'healthy';
  return { id: `${planId}.${revision}.${digest(stage.id).slice(0, 16)}`, planId, revision, stage: stage.id, recipe: recipeName, machine: machineName, task: progress?.task ?? null, taskRevision: progress?.taskRevision ?? null, progress, planned: expected, nominalCraftsPerSecond: stage.nominalCraftsPerSecond ?? null, scope: observed?.scope ?? null, tick: observed?.tick ?? null, metrics, symptoms, health, exceptions, hypotheses: health === 'shortfall' ? ['Input supply, output blockage or utility loss may explain shortfall; these are hypotheses, not established root causes.'] : [], stale, scenarioVerdict: 'not-evaluated', omitted: Math.max(0, planned.length - expected.length) + Math.max(0, (observed?.metrics.length ?? 0) - metrics.length) + (observed?.symptomsOmitted ?? 0) };
}
