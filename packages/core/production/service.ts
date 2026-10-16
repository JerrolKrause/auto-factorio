import { randomBytes } from 'node:crypto';
import type { ProductionPlan, ProductionPlanInput, ProductionPlanPage, ProductionPlanSummary, ProductionInspectInput, ProductionStageProgress } from '@autofactorio/contracts';
import type { Change, Journal } from '../execution/durable.js';
import { ProductionFacts } from './facts.js';
import type { FactAccess } from './facts.js';
import { calculatePlan } from './planner.js';
import { digest, PLANNING_LIMITS } from './graph.js';
import type { PlanningLimits } from './graph.js';

interface PlanRecord { id: string; owner: string; planId: string; revision: number; plan: ProductionPlan }
export interface PlanStore { run: string; journal: Journal; record: (type: string, changes: Change[]) => void }
export interface PlanAccess extends FactAccess { owner: string }
export interface PlanCoordination {
  revisionChanges(owner: string, prior: ProductionPlan, next: ProductionPlan): Change[];
  progress(owner: string, plan: ProductionPlan): ProductionStageProgress[];
  permittedStage(viewer: string, plan: ProductionPlan, stage: string): boolean;
}
export function summarizePlan(plan: ProductionPlan, bytes = PLANNING_LIMITS.responseBytes): ProductionPlanSummary {
  const result: ProductionPlanSummary = { schema: 1, id: plan.id, revision: plan.revision, status: plan.status, executable: plan.executable, fingerprint: plan.fingerprint, availabilityRevision: plan.availabilityRevision, stageCount: plan.stages.length, blockers: plan.blockers.slice(0, 16).map(b => ({ ...b, detail: b.detail.slice(0, 500) })), assumptions: [...plan.assumptions], omitted: plan.omitted + Math.max(0, plan.blockers.length - 16) + plan.blockers.slice(0, 16).filter(b => b.detail.length > 500).length + Math.max(0, plan.invalidatedEvidence.length - 32), invalidatedEvidence: plan.invalidatedEvidence.slice(0, 32), mode: plan.request.mode, target: plan.request.target, ...(plan.targetDemand ? { targetDemand: plan.targetDemand } : {}), ...(plan.headroomDemand ? { headroomDemand: plan.headroomDemand } : {}) };
  while (Buffer.byteLength(JSON.stringify(result)) > bytes) {
    if (result.blockers.length) result.blockers.pop(); else if (result.invalidatedEvidence.length) result.invalidatedEvidence.pop(); else if (result.assumptions.length) result.assumptions.pop(); else throw new Error('Plan identity exceeds response cap');
    result.omitted++;
  }
  return result;
}

/** Shared gameplay/workshop service; immutable projection IDs are revision-qualified. */
export class ProductionPlanService {
  private cursors = new Map<string, { key: string; selector: string; fingerprint: string; availability: string; offset: number; expires: number }>();
  constructor(private store: PlanStore, private facts = new ProductionFacts(), readonly limits: PlanningLimits = PLANNING_LIMITS, private now = Date.now, private coordination?: PlanCoordination) {
    if (Object.values(limits).some(v => !Number.isSafeInteger(v) || v <= 0) || limits.responseBytes < 1024) throw new Error('Invalid planning limits');
  }
  private load(access: PlanAccess, id: string, revision: number, assignedStage?: string) {
    access.authorize();
    if (!/^plan\.[a-f0-9]{32}$/.test(id) || !Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid plan reference');
    const record = this.store.journal.get<PlanRecord>(this.store.run, 'productionPlans', `${id}.${revision}`);
    if (!record) throw new Error('Plan unavailable');
    if (record.owner !== access.owner) {
      if (!assignedStage || !this.coordination?.permittedStage(access.owner, record.plan, assignedStage)) throw new Error('Plan unavailable');
      // Assigned execution scope grants one stage, never request bodies or the rest of its owner's graph.
      const plan = structuredClone(record.plan);
      plan.stages = plan.stages.filter(s => s.id === assignedStage).map(s => ({ ...s, evidence: [] }));
      // Product balances aggregate the owner's whole graph, even for a stage-local product.
      plan.balances = [];
      plan.blockers = plan.blockers.filter(b => b.stage === assignedStage);
      plan.invalidatedEvidence = []; plan.assumptions = []; plan.omitted = 0;
      access.authorize(); return plan;
    }
    access.authorize(); return structuredClone(record.plan);
  }
  /** Internal status join; assigned executors must name their one authorized stage. */
  statusPlan(access: PlanAccess, id: string, revision: number, stage?: string): ProductionPlan { return this.load(access, id, revision, stage); }
  async executable<T>(access: PlanAccess, id: string, revision: number, admit: (plan: ProductionPlan) => T): Promise<T> {
    const plan = this.load(access, id, revision);
    const snapshot = await this.facts.snapshot(access); access.authorize();
    if (snapshot.catalog.fingerprint !== plan.fingerprint || snapshot.availabilityRevision !== plan.availabilityRevision) throw new Error('Stale facts or availability; calculate a new revision');
    const retained = this.store.journal.list<PlanRecord>(this.store.run, 'productionPlans');
    if (retained.some(r => r.planId === id && r.revision > revision)) throw new Error('Superseded plan revision');
    if (!plan.executable || plan.status !== 'feasible') throw new Error('Plan is not complete executable work');
    // No await between re-authentication and the commit transaction.
    access.authorize(); return admit(plan);
  }
  async plan(access: PlanAccess, input: ProductionPlanInput): Promise<ProductionPlanSummary> {
    access.authorize();
    if (!input || Object.keys(input).some(k => !['request', 'prior'].includes(k))) throw new Error('Invalid plan input');
    const prior = input.prior ? this.load(access, input.prior.id, input.prior.revision) : null;
    const snapshot = await this.facts.snapshot(access); access.authorize();
    const plan = calculatePlan(snapshot.catalog, snapshot.availability, snapshot.availabilityRevision, input.request, this.limits, this.now);
    const retained = this.store.journal.list<PlanRecord>(this.store.run, 'productionPlans');
    if (retained.length >= this.limits.revisions) throw new Error('Production revision retention cap; no new plan stored');
    plan.id = prior?.id ?? `plan.${randomBytes(16).toString('hex')}`;
    plan.revision = prior ? Math.max(...retained.filter(r => r.planId === prior.id).map(r => r.revision)) + 1 : 1;
    if (prior) {
      const changed = new Set(prior.stages.filter(s => plan.stages.find(n => n.id === s.id)?.meaning !== s.meaning).map(s => s.id));
      let grew = true;
      while (grew) {
        grew = false;
        for (const stage of prior.stages) if (!changed.has(stage.id) && prior.stages.some(s => changed.has(s.id) && s.outputs.some(p => stage.inputs.includes(p)))) { changed.add(stage.id); grew = true; }
      }
      plan.invalidatedEvidence = [...new Set(prior.stages.filter(s => changed.has(s.id)).flatMap(s => s.evidence))];
      for (const stage of plan.stages) { const old = prior.stages.find(s => s.id === stage.id); if (old && !changed.has(stage.id)) stage.evidence = [...old.evidence]; }
    }
    if (Buffer.byteLength(JSON.stringify(plan)) > this.limits.artifactBytes) throw new Error('Plan artifact byte cap; no new plan stored');
    access.authorize();
    const id = `${plan.id}.${plan.revision}`;
    const summary = summarizePlan(plan, this.limits.responseBytes);
    const latest = retained.filter(r => r.planId === plan.id).sort((a, b) => b.revision - a.revision)[0];
    const changes = latest && this.coordination ? this.coordination.revisionChanges(access.owner, latest.plan, plan) : [];
    this.store.record('production/plan-calculated', [{ entity: 'productionPlans', id, value: { id, owner: access.owner, planId: plan.id, revision: plan.revision, plan }, visibility: { kind: 'restricted', agents: [access.owner], roles: [], tasks: [] } }, ...changes]);
    access.authorize(); return summary;
  }
  async inspect(access: PlanAccess, input: ProductionInspectInput): Promise<ProductionPlanPage> {
    const stageOnly = input.view !== 'request' && (input.depth ?? 0) === 0 ? input.stage : undefined;
    const plan = this.load(access, input.id, input.revision, stageOnly);
    const assigned = this.store.journal.get<PlanRecord>(this.store.run, 'productionPlans', `${input.id}.${input.revision}`)!.owner !== access.owner;
    if (Object.keys(input).some(k => !['id', 'revision', 'stage', 'depth', 'cursor', 'view'].includes(k)) || (input.view !== undefined && !['stages', 'request'].includes(input.view)) || (input.depth !== undefined && (!Number.isSafeInteger(input.depth) || input.depth < 0 || input.depth > 6)) || (input.stage !== undefined && (typeof input.stage !== 'string' || input.stage.length > 150)) || (input.cursor !== undefined && (typeof input.cursor !== 'string' || input.cursor.length > 64))) throw new Error('Invalid plan detail selector');
    const snapshot = await this.facts.snapshot(access); access.authorize();
    // Assignment may have changed during the facts query; reapply stage scope before delivery.
    this.load(access, input.id, input.revision, stageOnly);
    const revalidation = [...(snapshot.catalog.fingerprint !== plan.fingerprint ? ['prototype_fingerprint_changed'] : []), ...(snapshot.availabilityRevision !== plan.availabilityRevision ? ['availability_changed'] : [])];
    const selection = new Set(plan.stages.filter(s => !input.stage || s.id === input.stage).map(s => s.id));
    if (input.stage && !selection.size) throw new Error('Unknown plan stage');
    for (let depth = 0; depth < (input.depth ?? 0); depth++) {
      const products = new Set(plan.stages.filter(s => selection.has(s.id)).flatMap(s => [...s.inputs, ...s.outputs]));
      for (const s of plan.stages) if ([...s.inputs, ...s.outputs].some(p => products.has(p))) selection.add(s.id);
    }
    const rows = plan.stages.filter(s => selection.has(s.id)), selector = digest({ id: input.id, revision: input.revision, stage: input.stage ?? null, depth: input.depth ?? 0, view: input.view ?? 'stages' });
    const summary: ProductionPlanPage['summary'] = assigned
      ? { schema: 1, id: plan.id, revision: plan.revision, scope: 'assigned-stage', stage: stageOnly!, fingerprint: plan.fingerprint, availabilityRevision: plan.availabilityRevision }
      : summarizePlan(plan, this.limits.responseBytes - 512);
    const result: ProductionPlanPage = { summary, stages: [], balances: [], stale: revalidation.length > 0, revalidation, omitted: 0, next: null, status: 'complete' };
    let offset = 0;
    if (input.cursor) {
      const c = this.cursors.get(input.cursor);
      if (!c || c.key !== access.key || c.selector !== selector || c.expires <= this.now() || c.fingerprint !== snapshot.catalog.fingerprint || c.availability !== snapshot.availabilityRevision) { result.status = 'expired'; access.authorize(); return result; }
      offset = c.offset;
    }
    let end = offset;
    const progress = this.coordination?.progress(access.owner, plan);
    const requestText = input.view === 'request' ? JSON.stringify(plan.request) : null;
    if (requestText !== null) {
      let text = requestText.slice(offset, offset + 4000);
      while (text.length && Buffer.byteLength(JSON.stringify({ ...result, requestChunk: { encoding: 'json', offset, text, totalCharacters: requestText.length } })) + 256 > this.limits.responseBytes) text = text.slice(0, Math.floor(text.length / 2));
      end += text.length; result.requestChunk = { encoding: 'json', offset, text, totalCharacters: requestText.length };
    }
    for (const stage of requestText === null ? rows.slice(offset, offset + this.limits.pageStages) : []) {
      const selected = [...result.stages, stage], products = new Set(selected.flatMap(s => [...s.inputs, ...s.outputs]));
      const balances = plan.balances.filter(b => products.has(b.product));
      const commitments = progress?.filter(b => selected.some(s => s.id === b.stage));
      if (Buffer.byteLength(JSON.stringify({ ...result, stages: selected, balances, commitments })) + 256 > this.limits.responseBytes) break;
      result.stages = selected; result.balances = balances; if (commitments) result.commitments = commitments; end++;
    }
    const total = requestText === null ? rows.length : requestText.length;
    result.omitted = total - end + plan.omitted;
    if (end < total) {
      result.status = 'partial';
      if (end > offset) {
        for (const [key, c] of this.cursors) if (c.expires <= this.now()) this.cursors.delete(key);
        while (this.cursors.size >= this.limits.cursors) this.cursors.delete(this.cursors.keys().next().value!);
        result.next = randomBytes(24).toString('hex');
        this.cursors.set(result.next, { key: access.key, selector, fingerprint: snapshot.catalog.fingerprint, availability: snapshot.availabilityRevision, offset: end, expires: this.now() + this.limits.cursorMs });
      }
    }
    access.authorize(); return result;
  }
}

/** The trusted workshop assignment supplies its owner, pinned boundary and scope check. */
export class WorkshopProductionAdapter {
  constructor(private service: ProductionPlanService, private assignment: () => PlanAccess) {}
  plan(input: ProductionPlanInput) { return this.service.plan(this.assignment(), input); }
  inspect(input: ProductionInspectInput) { return this.service.inspect(this.assignment(), input); }
}
