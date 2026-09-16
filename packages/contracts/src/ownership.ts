import type { Position } from './game.js';

export type Resource =
  | { kind: 'area'; surface: string; bounds: [Position, Position] }
  | { kind: 'actor'; actor: string }
  // Exclusive main-inventory allocation includes ingredients, outputs and cancellation refunds.
  | { kind: 'items'; actor: string };
export interface Grant { id: string; generation: number }
export interface Assignment {
  id: string; owner: string; task: string; revision: number; actor: string;
  resources: { grant: Grant; resource: Resource }[];
}
export interface OwnershipControl {
  id: string; epoch: string; session: string; operation: 'grant' | 'revoke'; assignment: Assignment;
}
export interface OwnershipAck {
  request: OwnershipControl; tick: number; receipts: import('./game.js').Receipt[];
}
export function resourceKey(r: Resource): string {
  if (r.kind !== 'area') return `${r.kind}.${r.actor}`;
  return `area.${r.surface}.${r.bounds[0].x}.${r.bounds[0].y}.${r.bounds[1].x}.${r.bounds[1].y}`;
}
export function conflicts(a: Resource, b: Resource): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind !== 'area' || b.kind !== 'area') return 'actor' in a && 'actor' in b && a.actor === b.actor;
  return a.surface === b.surface && a.bounds[0].x <= b.bounds[1].x && b.bounds[0].x <= a.bounds[1].x && a.bounds[0].y <= b.bounds[1].y && b.bounds[0].y <= a.bounds[1].y;
}
export function validateAssignment(a: Assignment): void {
  const id = (s: string) => { if (typeof s !== 'string' || !/^[\w.-]{1,100}$/.test(s)) throw new Error('Invalid ownership identity'); };
  for (const s of [a.id, a.owner, a.task, a.actor]) id(s);
  if (!Number.isSafeInteger(a.revision) || a.revision < 1) throw new Error('Invalid task revision');
  if (!Array.isArray(a.resources) || a.resources.length < 3 || a.resources.length > 32) throw new Error('Incomplete reservation set');
  const ids = new Set<string>();
  for (const { grant, resource: r } of a.resources) {
    id(grant.id); if (ids.has(grant.id)) throw new Error('Duplicate reservation'); ids.add(grant.id);
    if (!Number.isSafeInteger(grant.generation) || grant.generation < 1) throw new Error('Invalid generation');
    if (r.kind === 'area') {
      id(r.surface);
      if (!Array.isArray(r.bounds) || r.bounds.length !== 2 || r.bounds.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 32 || Math.abs(p.y) > 32) || r.bounds[0].x > r.bounds[1].x || r.bounds[0].y > r.bounds[1].y) throw new Error('Invalid reservation area');
    } else if (r.kind === 'actor' || r.kind === 'items') { id(r.actor); if (r.actor !== a.actor) throw new Error('Reservation actor mismatch'); }
    else throw new Error('Invalid resource');
  }
  if (!['area', 'actor', 'items'].every(k => a.resources.some(r => r.resource.kind === k))) throw new Error('Incomplete reservation set');
}
export function diagnosticAssignment(generation: number): Assignment {
  return { id: 'diagnostic', owner: 'diagnostic-operator', task: 'phase03-actions', revision: 1, actor: 'builder-1', resources: [
    { grant: { id: 'test-area', generation }, resource: { kind: 'area', surface: 'nauvis', bounds: [{ x: -32, y: -32 }, { x: 32, y: 32 }] } },
    { grant: { id: 'test-items', generation }, resource: { kind: 'items', actor: 'builder-1' } },
    { grant: { id: 'test-actor', generation }, resource: { kind: 'actor', actor: 'builder-1' } },
  ] };
}
export const diagnosticGrants = (generation: number): Grant[] => diagnosticAssignment(generation).resources.map(r => r.grant);
