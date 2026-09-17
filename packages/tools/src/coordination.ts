import { randomBytes } from 'node:crypto';
import type { Batch, Step, ToolGroup } from '@autofactorio/contracts';
import { object, string } from '../../codex/src/protocol.js';
import type { Coordinator, MessageInput, SessionBinding, TaskInput } from '../../core/orchestration/coordinator.js';
import { AgentContext, RecipeCache } from '../../core/context/service.js';
import { DEFAULT_LIMITS } from '../../core/context/archive.js';
import type { Limits } from '../../core/context/archive.js';
import type { Reference } from '../../core/execution/durable.js';
import { entities } from '../../storage/src/journal.js';
import { Interventions } from '../../core/orchestration/interventions.js';

export const operations: Record<string, { group: ToolGroup; keys: string[] }> = {
  observe: { group: 'observe', keys: [] }, propose: { group: 'plan', keys: ['task'] },
  revise: { group: 'plan', keys: ['task', 'revision'] }, cancel: { group: 'plan', keys: ['task', 'revision'] },
  message: { group: 'message', keys: ['message'] }, report: { group: 'message', keys: ['task', 'revision', 'evidence'] },
  submit: { group: 'execute', keys: ['batch'] },
  build: { group: 'execute', keys: ['task', 'revision', 'commandId', 'deadline', 'steps'] },
  scenario: { group: 'observe', keys: [] }, verify: { group: 'plan', keys: [] },
  briefing: { group: 'observe', keys: ['offset'] }, history: { group: 'observe', keys: ['query', 'offset'] },
  detail: { group: 'observe', keys: ['ref'] }, payload: { group: 'observe', keys: ['ref', 'offset'] },
  summary: { group: 'observe', keys: ['refs'] }, world: { group: 'observe', keys: ['task', 'area', 'offset'] }, recipe: { group: 'observe', keys: ['name'] },
  replacement: { group: 'observe', keys: ['task', 'area', 'offset'] },
  interpret: { group: 'message', keys: ['id', 'interpretation', 'resultingTasks', 'supersededTasks'] },
};
const taskKeys = ['id', 'goal', 'parent', 'dependencies', 'scope', 'resources', 'successCriteria', 'deadline', 'committedPlan', 'actor', 'reservations', 'criteria'];
function exact(value: unknown, keys: string[]) {
  const input = object(value);
  if (Object.keys(input).some(k => !keys.includes(k)) || keys.some(k => !(k in input))) throw new Error('Identity spoofing or unsupported arguments');
  return input;
}
function reference(value: unknown): Reference {
  const r = exact(value, ['entity', 'id']);
  if (![...entities, 'events'].includes(string(r.entity)) || !/^[\w.-]{1,100}$/.test(string(r.id))) throw new Error('Invalid reference');
  return r as unknown as Reference;
}
/** Opaque credentials bind server-assigned identities; no sender/agent argument is accepted. */
export class CoordinationGateway {
  private grants = new Map<string, SessionBinding>();
  private recipes = new RecipeCache();
  constructor(private coordinator: Coordinator, private limits: Limits = DEFAULT_LIMITS,
    private scenario?: { briefing: unknown; verify: () => unknown }) {}
  issue(binding: SessionBinding): string {
    this.coordinator.authenticate(binding, 'observe');
    const token = randomBytes(32).toString('hex'); this.grants.set(token, structuredClone(binding)); return token;
  }
  revoke(token: string): void { this.grants.delete(token); }
  catalog(token: string): string[] {
    const b = this.grants.get(token); if (!b) throw new Error('Unauthenticated identity');
    const a = this.coordinator.authenticate(b, 'observe');
    return Object.entries(operations).filter(([, spec]) => a.definition.tools.includes(spec.group)).map(([name]) => name);
  }
  call(token: string, name: string, args: unknown): unknown {
    const b = this.grants.get(token); const admitted = this.coordinator.budget.attempt(b?.turn ?? null);
    if (!b) throw new Error('Unauthenticated identity');
    let asynchronous = false;
    try {
      this.coordinator.activity(b.agent, 'tool-attempt', { name, args, admitted });
      if (!admitted) throw new Error('Turn admission closed');
      const op = operations[name]; if (!op) throw new Error('Unknown tool');
      const a = this.coordinator.authenticate(b, op.group);
      if (this.coordinator.budget.get(b.turn).attempts > a.definition.limits.tools) {
        this.coordinator.budget.closeTurn(this.coordinator.budget.get(b.turn), 'agent_tool_attempts'); throw new Error('Agent tool admission closed');
      }
      const input = exact(args, op.keys); let result: unknown;
      const context = new AgentContext(this.coordinator, b, this.limits, this.recipes);
      switch (name) {
        case 'scenario': if (!this.scenario) throw new Error('No scenario connected'); result = this.scenario.briefing; break;
        case 'verify': if (!this.scenario) throw new Error('No evaluator connected'); result = this.scenario.verify(); break;
        case 'build': {
          const task = this.coordinator.task(string(input.task));
          const reservation = this.coordinator.runtime.ownership.list().find(r => r.task === task.id && r.revision === input.revision && r.owner === a.id && r.state === 'active');
          if (!reservation) throw new Error('No active authorized reservation');
          // Credentials and fences come from acknowledged ownership, never model arguments.
          this.coordinator.submit(a.id, { commandId: string(input.commandId), task: task.id, revision: Number(input.revision),
            epoch: reservation.request.epoch, session: reservation.request.session, actor: reservation.actor,
            surface: 'nauvis', grants: reservation.resources.map(r => r.grant), deadline: Number(input.deadline), steps: input.steps as Step[] });
          result = { queued: true, commandId: input.commandId }; break;
        }
        case 'interpret': new Interventions(this.coordinator).interpret(a.id, string(input.id), string(input.interpretation), input.resultingTasks as string[], input.supersededTasks as string[]); result = { recorded: true }; break;
        case 'observe': result = context.briefing(); break;
        case 'briefing': result = context.briefing(Number(input.offset)); break;
        case 'history': result = context.search(string(input.query), Number(input.offset)); break;
        case 'detail': result = context.detail(reference(input.ref)); break;
        case 'payload': result = context.download(reference(input.ref), Number(input.offset)); break;
        case 'summary': {
          if (!Array.isArray(input.refs)) throw new Error('Invalid references');
          result = context.summary(input.refs.map(reference)); break;
        }
        case 'world': result = context.world(string(input.task), Number(input.area), Number(input.offset)); break;
        case 'replacement': result = context.replacement(string(input.task), Number(input.area), Number(input.offset)); break;
        case 'recipe': result = context.recipe(string(input.name)); break;
        case 'propose': result = this.coordinator.propose(a.id, exact(input.task, taskKeys) as unknown as TaskInput); break;
        case 'revise': {
          const task = exact(input.task, taskKeys) as unknown as TaskInput;
          this.coordinator.revise(a.id, task.id, Number(input.revision), task); result = { revised: true }; break;
        }
        case 'cancel': this.coordinator.cancel(a.id, string(input.task), Number(input.revision)); result = { cancelled: true }; break;
        case 'message': result = this.coordinator.send(a.id, exact(input.message, ['id', 'recipient', 'task', 'revision', 'intent', 'content', 'evidence']) as unknown as MessageInput); break;
        case 'report': this.coordinator.report(a.id, string(input.task), Number(input.revision), input.evidence as string[]); result = { verifying: true }; break;
        case 'submit': this.coordinator.submit(a.id, object(input.batch) as unknown as Batch); result = { queued: true }; break;
      }
      // Closing the final admitted attempt before its async query settles would invalidate the
      // query's post-await authentication. Finish accounting once, after success or rejection.
      if (result instanceof Promise) {
        asynchronous = true;
        return result.then(value => {
          this.coordinator.activity(a.id, 'tool-result', { name, result: value });
          return value;
        }, error => {
          this.coordinator.activity(a.id, 'tool-rejected', { name, error: String(error) });
          throw error;
        }).finally(() => this.coordinator.budget.afterAttempt(b.turn));
      }
      this.coordinator.activity(a.id, 'tool-result', { name, result });
      return result;
    } catch (error) {
      this.coordinator.activity(b.agent, 'tool-rejected', { name, error: String(error) });
      throw error;
    } finally {
      if (!asynchronous) this.coordinator.budget.afterAttempt(b.turn);
    }
  }
}
