import type { DashboardSnapshot } from '../../runtime/dashboard-types.js';
import type { Event } from '../../../packages/core/execution/durable.js';
export function roleState(agent: Record<string, unknown>, snapshot: DashboardSnapshot): string {
  if (!snapshot.control.connected) return 'Disconnected';
  if (snapshot.control.scoringClosed) return 'Blocked by usage';
  if (!snapshot.control.admission) return 'Waiting for control';
  const labels: Record<string, string> = { reasoning: 'Reasoning', executing: 'Executing', 'waiting-dependency': 'Waiting for dependency', 'waiting-game': 'Waiting for game', 'waiting-user': 'Awaiting user input', 'blocked-usage': 'Blocked by usage', disconnected: 'Disconnected', completed: 'Completed', failed: 'Failed', idle: 'Idle', blocked: 'Blocked' };
  const task = snapshot.projections.tasks?.find(t => t.id === agent.assignment);
  if (task?.wait === 'user') return 'Awaiting user input';
  return labels[String(agent.status)] ?? 'Unknown activity';
}
/** Ignore duplicates at the transport boundary, before modifying either history or projections. */
export function applyEvent(snapshot: DashboardSnapshot, event: Event): DashboardSnapshot {
  if (event.run !== snapshot.run || event.sequence <= snapshot.cursor) return snapshot;
  const projections = { ...snapshot.projections };
  for (const change of event.changes) {
    const values = [...(projections[change.entity] ?? [])];
    const index = values.findIndex(v => v.id === change.id || (change.entity === 'commands' && (v.batch as { commandId?: string } | undefined)?.commandId === change.id));
    const value = { ...change.value, id: change.id };
    if (index < 0) values.push(value); else values[index] = value;
    projections[change.entity] = values;
  }
  const controlChange = event.changes.find(c => c.entity === 'runs' && c.id === 'operator-control');
  return { ...snapshot, cursor: event.sequence, projections, control: controlChange ? controlChange.value as unknown as DashboardSnapshot['control'] : snapshot.control, events: [...snapshot.events, event].slice(-200) };
}
