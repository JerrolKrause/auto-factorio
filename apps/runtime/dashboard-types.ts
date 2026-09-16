import type { Event, Entity } from '../../packages/core/execution/durable.js';
import type { OperatorState } from './operator.js';
export interface DashboardSnapshot {
  run: string; cursor: number; control: OperatorState;
  projections: Partial<Record<Entity, Record<string, unknown>[]>>;
  events: Event[];
}
