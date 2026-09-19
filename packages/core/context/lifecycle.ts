import { createHash } from 'node:crypto';
import { DEFAULT_OPERATIONAL_LIMITS } from '@autofactorio/contracts';
import type { ContextLifecyclePolicy, RunManifest } from '@autofactorio/contracts';
import type { DurableRuntime } from '../../../apps/runtime/durable-runtime.js';
import type { SessionBinding } from '../orchestration/coordinator.js';
import { privateTo } from './authorization.js';

export type DeliveryCategory = 'prompt' | 'catalog' | 'tool-arguments' | 'tool-result' | 'provider-output';
export interface ContextDelivery {
  role: string; session: string; turn: string | null; category: DeliveryCategory; bytes: number;
  omissions: number; fingerprint: string; repeated: boolean; method: 'utf8-json-v1';
}
export class ContextAccounting {
  constructor(private runtime: DurableRuntime) {}
  record(role: string, session: string, turn: string | null, category: DeliveryCategory, value: unknown, omissions = 0): ContextDelivery {
    const serialized = JSON.stringify(value); const fingerprint = createHash('sha256').update(serialized).digest('hex');
    const prior = this.runtime.journal.list<ContextDelivery>(this.runtime.run, 'contextDeliveries').some(v => v.role === role && v.session === session && v.category === category && v.fingerprint === fingerprint);
    const delivery = { role, session, turn, category, bytes: Buffer.byteLength(serialized), omissions, fingerprint, repeated: prior, method: 'utf8-json-v1' } as const;
    this.runtime.record('context/delivered', [{ entity: 'contextDeliveries', id: `${role}.${session}.${this.runtime.journal.events().length}`, value: delivery, visibility: privateTo(role) }], { kind: 'operator' });
    return delivery;
  }
  summary(role: string, session?: string) {
    const values = this.runtime.journal.list<ContextDelivery>(this.runtime.run, 'contextDeliveries').filter(v => v.role === role && (!session || v.session === session));
    return { method: 'utf8-json-v1', role, session: session ?? null, deliveredBytes: values.reduce((n, v) => n + v.bytes, 0), calls: values.filter(v => v.category === 'tool-arguments').length, omissions: values.reduce((n, v) => n + v.omissions, 0), repeated: values.filter(v => v.repeated).length, providerContextOccupancy: null, subscriptionBalance: null };
  }
}

export interface SessionLifecycleState {
  role: string; generation: number; previousSession: string | null; session: string | null;
  state: 'ready' | 'rotation-requested' | 'deferred-active-work' | 'reconstructing' | 'blocked';
  reason: string | null; requiredReplacement: boolean; startedAt: string; reconstructedAt: string | null;
}
export class SessionLifecycle {
  readonly policy: ContextLifecyclePolicy;
  constructor(private runtime: DurableRuntime, private accounting = new ContextAccounting(runtime), policy?: ContextLifecyclePolicy) {
    const manifest = runtime.journal.get<RunManifest>(runtime.run, 'runs', runtime.run);
    this.policy = policy ?? manifest?.contextLifecycle ?? { schema: 1, maxTurns: DEFAULT_OPERATIONAL_LIMITS.rotationTurns, maxDeliveredBytes: DEFAULT_OPERATIONAL_LIMITS.rotationBytes };
    if (this.policy.schema !== 1 || !Number.isSafeInteger(this.policy.maxTurns) || this.policy.maxTurns < 1 || !Number.isSafeInteger(this.policy.maxDeliveredBytes) || this.policy.maxDeliveredBytes < 512 || (this.policy.providerOccupancy !== undefined && (!(this.policy.providerOccupancy > 0) || this.policy.providerOccupancy > 1))) throw new Error('Invalid context lifecycle policy');
  }
  get(role: string): SessionLifecycleState | undefined { return this.runtime.journal.get(this.runtime.run, 'sessionLifecycle', role); }
  due(role: string, session: string, admittedTurns: number, providerOccupancy?: number) {
    const delivered = this.accounting.summary(role, session).deliveredBytes;
    return { due: admittedTurns >= this.policy.maxTurns || delivered >= this.policy.maxDeliveredBytes || providerOccupancy !== undefined && this.policy.providerOccupancy !== undefined && providerOccupancy >= this.policy.providerOccupancy,
      reasons: [...(admittedTurns >= this.policy.maxTurns ? ['admitted_turns'] : []), ...(delivered >= this.policy.maxDeliveredBytes ? ['delivered_bytes'] : []), ...(providerOccupancy !== undefined && this.policy.providerOccupancy !== undefined && providerOccupancy >= this.policy.providerOccupancy ? ['provider_occupancy'] : [])], deliveredBytes: delivered, admittedTurns, providerOccupancy: providerOccupancy ?? null };
  }
  request(role: string, previousSession: string, activeWork: boolean) {
    const prior = this.get(role); const value: SessionLifecycleState = { role, generation: (prior?.generation ?? 0) + 1, previousSession, session: null, state: activeWork ? 'deferred-active-work' : 'rotation-requested', reason: activeWork ? 'active deterministic work' : null, requiredReplacement: true, startedAt: new Date().toISOString(), reconstructedAt: null };
    this.save(value, 'session/rotation-requested'); return value;
  }
  begin(role: string, previousSession: string | null, session: string) {
    const prior = this.get(role); const value: SessionLifecycleState = { role, generation: (prior?.generation ?? 0) + 1, previousSession, session, state: 'reconstructing', reason: 'replacement observation and reconciliation required', requiredReplacement: true, startedAt: new Date().toISOString(), reconstructedAt: null };
    this.save(value, 'session/reconstructing'); return value;
  }
  complete(binding: SessionBinding, safe: boolean, reason?: string) {
    const prior = this.get(binding.agent); if (!prior) return undefined;
    if (prior.session !== binding.session || !['reconstructing', 'blocked'].includes(prior.state)) throw new Error('No matching reconstruction gate');
    const next: SessionLifecycleState = safe ? { ...prior, state: 'ready', reason: null, requiredReplacement: false, reconstructedAt: new Date().toISOString() } : { ...prior, state: 'blocked', reason: reason ?? 'reconstruction failed', requiredReplacement: true, reconstructedAt: null };
    this.save(next, safe ? 'session/reconstructed' : 'session/reconstruction-blocked'); return next;
  }
  mutation(binding: SessionBinding) {
    const gate = this.get(binding.agent);
    if (gate?.requiredReplacement && (gate.session === null || gate.session === binding.session)) throw new Error(`Mutation closed: ${gate.reason ?? 'session reconstruction required'}`);
  }
  private save(value: SessionLifecycleState, type: string) { this.runtime.record(type, [{ entity: 'sessionLifecycle', id: value.role, value: { ...value }, visibility: privateTo(value.role) }], { kind: 'operator' }); }
}
