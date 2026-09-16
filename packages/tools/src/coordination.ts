import { randomBytes } from 'node:crypto';
import type { Batch, ToolGroup } from '@autofactorio/contracts';
import { object, string } from '../../codex/src/protocol.js';
import type { Coordinator, MessageInput, SessionBinding, TaskInput } from '../../core/orchestration/coordinator.js';

const operations: Record<string, { group: ToolGroup; keys: string[] }> = {
  observe: { group: 'observe', keys: [] }, propose: { group: 'plan', keys: ['task'] },
  revise: { group: 'plan', keys: ['task', 'revision'] }, cancel: { group: 'plan', keys: ['task', 'revision'] },
  message: { group: 'message', keys: ['message'] }, report: { group: 'message', keys: ['task', 'revision', 'evidence'] },
  submit: { group: 'execute', keys: ['batch'] },
};
const taskKeys = ['id', 'goal', 'parent', 'dependencies', 'scope', 'resources', 'successCriteria', 'deadline', 'committedPlan', 'actor', 'reservations', 'criteria'];
function exact(value: unknown, keys: string[]) {
  const input = object(value);
  if (Object.keys(input).some(k => !keys.includes(k)) || keys.some(k => !(k in input))) throw new Error('Identity spoofing or unsupported arguments');
  return input;
}
/** Opaque credentials bind server-assigned identities; no sender/agent argument is accepted. */
export class CoordinationGateway {
  private grants = new Map<string, SessionBinding>();
  constructor(private coordinator: Coordinator) {}
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
    try {
      this.coordinator.activity(b.agent, 'tool-attempt', { name, args, admitted });
      if (!admitted) throw new Error('Turn admission closed');
      const op = operations[name]; if (!op) throw new Error('Unknown tool');
      const a = this.coordinator.authenticate(b, op.group);
      if (this.coordinator.budget.get(b.turn).attempts > a.definition.limits.tools) {
        this.coordinator.budget.closeTurn(this.coordinator.budget.get(b.turn), 'agent_tool_attempts'); throw new Error('Agent tool admission closed');
      }
      const input = exact(args, op.keys); let result: unknown;
      switch (name) {
        case 'observe': result = this.coordinator.view(a.id); break;
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
      this.coordinator.activity(a.id, 'tool-result', { name, result }); return result;
    } catch (error) {
      this.coordinator.activity(b.agent, 'tool-rejected', { name, error: String(error) }); throw error;
    } finally { this.coordinator.budget.afterAttempt(b.turn); }
  }
}
