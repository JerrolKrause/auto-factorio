import type { CoordinatedTask, ProductionCommitInput, ProductionCommitment, ProductionPlan, ProductionStageProgress, ProductionTaskProposal } from '@autofactorio/contracts';
import { conflicts } from '@autofactorio/contracts';
import type { Coordinator } from '../orchestration/coordinator.js';
import type { Change } from '../execution/durable.js';
import { privateTo, taskVisibility } from '../context/authorization.js';
import { digest } from './graph.js';

interface Binding {
  id: string; owner: string; planId: string; revision: number; stage: string; meaning: string;
  task: string; taskRevision: number; active: boolean;
}
const keys = ['id', 'goal', 'parent', 'dependencies', 'scope', 'resources', 'successCriteria', 'deadline', 'committedPlan', 'actor', 'reservations', 'criteria'];
const exact = (v: unknown, required: string[], optional: string[] = []) => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => ![...required, ...optional].includes(k)) || required.some(k => !(k in v))) throw new Error('Invalid production commitment');
};
/** No execution lane: one transaction admits existing coordinator proposals and their immutable mapping. */
export class ProductionCommitter {
  constructor(private c: Coordinator) {}
  private bindings(): Binding[] { return this.c.runtime.journal.list(this.c.runtime.run, 'productionBindings'); }
  retry(owner: string, input: ProductionCommitInput): ProductionCommitment | undefined {
    exact(input, ['requestId', 'id', 'revision', 'assignments']);
    if (typeof input.requestId !== 'string' || !/^[\w.-]{1,100}$/.test(input.requestId) || Buffer.byteLength(JSON.stringify(input)) > 65536) throw new Error('Invalid commitment limits');
    const prior = this.c.runtime.journal.get<ProductionCommitment>(this.c.runtime.run, 'productionCommitments', `commit.${digest([owner, input.requestId])}`);
    if (prior && prior.payloadHash !== digest(input)) throw new Error('Commitment request identity conflict');
    return prior;
  }
  commit(owner: string, plan: ProductionPlan, input: ProductionCommitInput): ProductionCommitment {
    exact(input, ['requestId', 'id', 'revision', 'assignments']);
    if (!/^[\w.-]{1,100}$/.test(input.requestId) || !Array.isArray(input.assignments) || input.assignments.length < 1 || input.assignments.length > 64 || Buffer.byteLength(JSON.stringify(input)) > 65536) throw new Error('Invalid commitment limits');
    const id = `commit.${digest([owner, input.requestId])}`, payloadHash = digest(input);
    const journal = this.c.runtime.journal, run = this.c.runtime.run;
    const bindings = this.bindings();
    const prior = journal.get<ProductionCommitment>(run, 'productionCommitments', id);
    // A persisted acknowledgement is safe to recover without admitting any new work.
    if (prior) { if (prior.payloadHash !== payloadHash) throw new Error('Commitment request identity conflict'); return prior; }
    if (journal.list(run, 'productionCommitments').length >= 200) throw new Error('Commitment retention cap');
    if (plan.id !== input.id || plan.revision !== input.revision || !plan.executable || plan.status !== 'feasible') throw new Error('Plan is not complete executable work');
    this.c.budget.tick();
    if (this.c.held() || this.c.budget.state.closed || !this.c.agent(owner).definition.tools.includes('plan')) throw new Error('Planning admission closed');
    if (this.c.runtime.execution.pending().some(c => c.state === 'unknown' || c.state === 'sending' || ['accepted', 'running'].includes(c.receipt?.status ?? ''))) throw new Error('Unresolved effects require reconciliation');
    const stages = new Set<string>(), taskIds = new Set<string>(), inputs: ProductionTaskProposal[] = [];
    for (const assignment of input.assignments) {
      exact(assignment, ['stage', 'task']);
      if (typeof assignment.stage !== 'string' || stages.has(assignment.stage) || !plan.stages.some(s => s.id === assignment.stage)) throw new Error('Unknown or duplicate stage');
      stages.add(assignment.stage);
      const task = assignment.task;
      if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error('Invalid mapped task');
      exact(task, 'revision' in task ? ['id', 'revision'] : keys, 'revision' in task ? [] : ['productionTarget']);
      if (taskIds.has(task.id)) throw new Error('Duplicate mapped task'); taskIds.add(task.id);
      if ('revision' in task) {
        const current = this.c.task(task.id);
        if (current.manager !== owner || current.revision !== task.revision || current.epoch !== this.c.runtime.context().epoch || ['cancelled', 'superseded', 'failed', 'blocked'].includes(current.status)) throw new Error('Stale task revision or ownership');
        const stage = plan.stages.find(s => s.id === assignment.stage)!;
        const retained = bindings.some(b => b.active && b.owner === owner && b.planId === plan.id && b.stage === stage.id && b.meaning === stage.meaning && b.task === task.id && b.taskRevision === task.revision);
        if (current.committedPlan !== `${plan.id}.${plan.revision}/${assignment.stage}` && !retained) throw new Error('Task plan reference mismatch');
      } else {
        if (task.committedPlan !== `${plan.id}.${plan.revision}/${assignment.stage}`) throw new Error('Task plan reference mismatch');
        inputs.push(task);
      }
    }
    const tasks = this.c.prepareProposals(owner, inputs);
    const mappings: ProductionCommitment['mappings'] = [];
    const changes: Change[] = tasks.map(t => ({ entity: 'tasks', id: t.id, value: { ...t }, visibility: taskVisibility(t.id) }));
    for (const assignment of input.assignments) {
      const stage = plan.stages.find(s => s.id === assignment.stage)!;
      const task = tasks.find(t => t.id === assignment.task.id) ?? this.c.task(assignment.task.id);
      if (task.actor && !this.c.agents().some(a => a.actors.includes(task.actor!) && a.definition.tools.includes('execute'))) throw new Error('No authorized executor for task actor');
      const bound = bindings.filter(b => b.active);
      if (bound.some(b => b.task === task.id && (b.owner !== owner || b.planId !== plan.id || b.stage !== stage.id || b.meaning !== stage.meaning || b.taskRevision !== task.revision))) throw new Error('Task already mapped to different stage meaning');
      if (bound.some(b => b.planId === plan.id && b.revision === plan.revision && b.stage === stage.id && b.task !== task.id)) throw new Error('Stage already committed');
      if (this.c.runtime.ownership.list().some(r => r.state !== 'released' && (r.task === task.id && r.revision !== task.revision || r.state === 'revoking' && r.resources.some(a => task.reservations.some(b => conflicts(a.resource, b)))))) throw new Error('Acknowledged ownership release required');
      const mapping = { stage: stage.id, meaning: stage.meaning, task: task.id, taskRevision: task.revision };
      mappings.push(mapping);
      const binding: Binding = { id: `${plan.id}.${plan.revision}.${digest(stage.id).slice(0, 16)}`, owner, planId: plan.id, revision: plan.revision, ...mapping, active: true };
      changes.push({ entity: 'productionBindings', id: binding.id, value: { ...binding }, visibility: privateTo(owner) });
    }
    const value: ProductionCommitment = { id, owner, requestId: input.requestId, payloadHash, planId: plan.id, revision: plan.revision, mappings };
    if (Buffer.byteLength(JSON.stringify(value)) > 24000) throw new Error('Commitment response cap');
    changes.push({ entity: 'productionCommitments', id, value: { ...value }, visibility: privateTo(owner) });
    this.c.runtime.record('production/committed', changes);
    return value;
  }
  /** Called inside plan persistence's transaction. Closing affected tasks precedes any awaited revoke. */
  revisionChanges(owner: string, prior: ProductionPlan, next: ProductionPlan): Change[] {
    const changes: Change[] = [];
    const changed = new Set(prior.stages.filter(s => next.stages.find(n => n.id === s.id)?.meaning !== s.meaning).map(s => s.id));
    for (let size = -1; size !== changed.size;) {
      size = changed.size;
      for (const s of prior.stages) if (prior.stages.some(up => changed.has(up.id) && up.outputs.some(p => s.inputs.includes(p)))) changed.add(s.id);
    }
    for (const binding of this.bindings().filter(b => b.owner === owner && b.planId === prior.id && b.revision === prior.revision && b.active)) {
      changes.push({ entity: 'productionBindings', id: binding.id, value: { ...binding, active: false }, visibility: privateTo(owner) });
      const task = this.c.task(binding.task);
      const matching = !changed.has(binding.stage) && task.revision === binding.taskRevision && task.epoch === this.c.runtime.context().epoch && !['cancelled', 'failed', 'superseded', 'blocked'].includes(task.status) && (task.status !== 'succeeded' || this.c.constructionComplete(task));
      if (matching) {
        const retained: Binding = { ...binding, id: `${next.id}.${next.revision}.${digest(binding.stage).slice(0,16)}`, revision: next.revision };
        changes.push({ entity: 'productionBindings', id: retained.id, value: { ...retained }, visibility: privateTo(owner) });
      } else if (task.manager === owner && task.revision === binding.taskRevision && !['succeeded', 'failed', 'cancelled', 'superseded'].includes(task.status)) {
        changes.push({ entity: 'tasks', id: task.id, value: { ...task, status: 'cancelled', wait: 'plan revision awaiting acknowledged release' }, visibility: taskVisibility(task.id) });
      }
    }
    return changes;
  }
  progress(owner: string, plan: ProductionPlan): ProductionStageProgress[] {
    return this.bindings().filter(b => {
      if (b.planId !== plan.id || b.revision !== plan.revision) return false;
      if (b.owner === owner) return true;
      const t = this.c.task(b.task);
      return b.active && t.owner === owner && t.revision === b.taskRevision && t.epoch === this.c.runtime.context().epoch && !['cancelled', 'failed', 'superseded', 'blocked'].includes(t.status);
    }).map(b => {
      const t: CoordinatedTask = this.c.task(b.task);
      const current = b.active && t.revision === b.taskRevision && t.epoch === this.c.runtime.context().epoch;
      const complete = current && this.c.constructionComplete(t);
      return { stage: b.stage, task: b.task, taskRevision: b.taskRevision, current, construction: complete ? 'complete' : !current || ['blocked', 'cancelled', 'failed', 'superseded'].includes(t.status) ? 'blocked' : 'pending', evidence: complete ? [...t.evidence] : [], commissioning: 'unknown', health: 'unknown', scenarioVerdict: 'not-evaluated', suppliers: plan.stages.filter(up => up.id !== b.stage && up.outputs.some(p => plan.stages.find(s => s.id === b.stage)?.inputs.includes(p))).map(up => up.id) };
    });
  }
  permittedStage(viewer: string, plan: ProductionPlan, stage: string): boolean {
    return this.bindings().some(b => {
      if (!b.active || b.planId !== plan.id || b.revision !== plan.revision || b.stage !== stage) return false;
      const t = this.c.task(b.task);
      return t.owner === viewer && t.revision === b.taskRevision && t.epoch === this.c.runtime.context().epoch && !['cancelled', 'failed', 'superseded', 'blocked'].includes(t.status);
    });
  }
}
