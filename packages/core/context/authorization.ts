import type { Visibility } from '../execution/durable.js';

export interface Principal { run: string; agent: string; role: string; tasks: string[]; observations?: string[] }
/** Restricted lists are alternatives; independent source labels are conjunctive. */
export function permits(label: unknown, principal: Principal): boolean {
  if (!label || typeof label !== 'object') return false;
  const v = label as Visibility;
  if (v.kind === 'shared') return true;
  if (v.kind !== 'restricted' || ![v.agents, v.roles, v.tasks].every(a => Array.isArray(a) && a.every(s => typeof s === 'string' && s.length > 0))) return false;
  return v.agents.includes(principal.agent) || v.roles.includes(principal.role) || v.tasks.some(t => principal.tasks.includes(t));
}
export const privateTo = (agent: string): Visibility => ({ kind: 'restricted', agents: [agent], roles: [], tasks: [] });
export const taskVisibility = (task: string): Visibility => ({ kind: 'restricted', agents: [], roles: [], tasks: [task] });
