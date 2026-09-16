import { createHash } from 'node:crypto';
import type { InterventionRecord } from '@autofactorio/contracts';
import type { Coordinator } from './coordinator.js';
import { privateTo } from '../context/authorization.js';
import type { Change } from '../execution/durable.js';

export interface Advice extends Omit<InterventionRecord, 'gameTick'> {
  kind: 'advice'; gameTick: number | null; fingerprint: string;
}
const identity = (id: string) => { if (typeof id !== 'string' || !/^[\w.-]{1,100}$/.test(id)) throw new Error('Invalid intervention identity'); };
export function assistanceChanges(c: Coordinator): Change[] {
  const manifest = c.runtime.journal.get<Record<string, unknown>>(c.runtime.run, 'runs', c.runtime.run);
  return [{ entity: 'runs', id: 'assistance', value: { assisted: true } },
    ...(manifest ? [{ entity: 'runs' as const, id: c.runtime.run, value: { ...manifest, assisted: true } }] : [])];
}
/** Advice is a durable inbox, independent of task assignment and active construction. */
export class Interventions {
  constructor(private c: Coordinator) {}
  advice(id: string, recipient: string, text: string, gameTick: number | null): Advice {
    identity(id); this.c.agent(recipient);
    if (typeof text !== 'string' || !text.trim() || text.length > 8000) throw new Error('Advice must contain 1–8000 characters');
    const fingerprint = createHash('sha256').update(JSON.stringify([recipient, text])).digest('hex');
    const prior = this.c.runtime.journal.get<Advice>(this.c.runtime.run, 'interventions', id);
    if (prior) { if (prior.fingerprint !== fingerprint) throw new Error('Intervention identity conflict'); return prior; }
    const advice: Advice = { id, kind: 'advice', recipient, text, fingerprint, wallTime: new Date().toISOString(), gameTick, delivery: 'pending', interpretation: null, resultingTasks: [], supersededTasks: [] };
    this.c.runtime.record('steering/persisted', [
      { entity: 'interventions', id, value: { ...advice }, visibility: privateTo(recipient) },
      ...assistanceChanges(this.c),
    ], { kind: 'operator' }, gameTick);
    return advice;
  }
  deliver(): void {
    for (const advice of this.c.runtime.journal.list<Advice>(this.c.runtime.run, 'interventions').filter(i => i.kind === 'advice' && i.delivery === 'pending')) {
      // Receipt means durably available in the recipient's bounded briefing, not understood by a model.
      this.c.runtime.record('steering/received', [{ entity: 'interventions', id: advice.id, value: { ...advice, delivery: 'received' }, visibility: privateTo(advice.recipient) }], { kind: 'operator' }, advice.gameTick);
    }
  }
  interpret(who: string, id: string, interpretation: string, resultingTasks: string[], supersededTasks: string[]): void {
    const advice = this.c.runtime.journal.get<Advice>(this.c.runtime.run, 'interventions', id);
    if (!advice || advice.kind !== 'advice' || advice.recipient !== who || advice.delivery === 'pending') throw new Error('Advice not delivered to this identity');
    if (typeof interpretation !== 'string' || !interpretation.trim() || interpretation.length > 4000) throw new Error('Invalid interpretation');
    for (const links of [resultingTasks, supersededTasks]) {
      if (!Array.isArray(links) || links.length > 30) throw new Error('Invalid task links');
      for (const key of links) { const t = this.c.task(key); if (t.manager !== who && t.owner !== who) throw new Error('Task link forbidden'); }
    }
    const next = { ...advice, interpretation, resultingTasks, supersededTasks, delivery: 'interpreted' };
    if (JSON.stringify(next) === JSON.stringify(advice)) return;
    this.c.runtime.record('steering/interpreted', [{ entity: 'interventions', id, value: next, visibility: privateTo(who), sources: [...resultingTasks, ...supersededTasks].map(id => ({ entity: 'tasks' as const, id })) }]);
  }
}
