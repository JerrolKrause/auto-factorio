import { createHash, randomUUID } from 'node:crypto';
import {
  DEFAULT_OPERATIONAL_LIMITS, OBSERVATION_SCHEMA, validateObservationScope, validateOperationalLimits,
} from '@autofactorio/contracts';
import type {
  MetricKind, ObservationScope, OperationalLimits, OperationalMetric, OperationalReading, OperationalSample,
  Position, ProductionTarget,
} from '@autofactorio/contracts';
import type { DurableRuntime } from '../../../apps/runtime/durable-runtime.js';
import type { Visibility } from '../execution/durable.js';
import { privateTo } from './authorization.js';

const metricId = (r: Pick<OperationalReading, 'kind' | 'surface' | 'name' | 'quality'>) => `${r.kind}/${r.surface}/${r.name}/${r.quality}`;
const sampleId = (s: OperationalSample, slot: number) => `${s.scopeId}.${s.scopeRevision}.${slot}`;
const finiteTotal = (value: number | null) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);

export function validateOperationalSample(value: OperationalSample): OperationalSample {
  if (value.schema !== OBSERVATION_SCHEMA || !Number.isSafeInteger(value.tick) || value.tick < 0 || !value.epoch || !value.membershipHash || !Array.isArray(value.readings)) throw new Error('Invalid operational sample');
  if (!/^[\w.-]{1,100}$/.test(value.scopeId) || !Number.isSafeInteger(value.scopeRevision) || value.scopeRevision < 1) throw new Error('Invalid sample scope');
  const seen = new Set<string>();
  for (const reading of value.readings) {
    const key = metricId(reading);
    if (seen.has(key)) throw new Error('Duplicate operational reading'); seen.add(key);
    if (![reading.name, reading.quality, reading.surface].every(v => typeof v === 'string' && /^[\w.-]{1,100}$/.test(v)) || !['production', 'consumption', 'boundary-delivery', 'stock', 'configured-supply', 'nominal-capacity', 'target-demand'].includes(reading.kind) || !['complete', 'partial', 'unknown'].includes(reading.coverage) || !finiteTotal(reading.total) || (reading.stock !== undefined && !finiteTotal(reading.stock)) || !reading.method || !Array.isArray(reading.evidence)) throw new Error('Invalid operational reading');
    if (reading.coverage === 'unknown' && !reading.reason) throw new Error('Unknown reading requires reason');
  }
  return structuredClone(value);
}

/** Durable materialized samples. Scope ID is part of every key; equal local revisions never collide. */
export class OperationalStore {
  readonly limits: OperationalLimits;
  constructor(readonly runtime: DurableRuntime, limits: OperationalLimits = DEFAULT_OPERATIONAL_LIMITS) { this.limits = validateOperationalLimits(limits); }
  scopes(): ObservationScope[] { return this.runtime.journal.list(this.runtime.run, 'operationalScopes'); }
  scope(id: string): ObservationScope | undefined { return this.runtime.journal.get(this.runtime.run, 'operationalScopes', id); }
  register(value: ObservationScope, visibility: Visibility): ObservationScope {
    const scope = validateObservationScope(value); const prior = this.scope(scope.id);
    if (!prior && this.scopes().length >= this.limits.maxScopes) throw new Error('Operational scope limit reached');
    if (scope.entityLimit > this.limits.maxEntities) throw new Error('Operational entity limit exceeded');
    if (prior && scope.revision <= prior.revision) throw new Error('Scope revision must increase');
    this.runtime.record('operational/scope', [{ entity: 'operationalScopes', id: scope.id, value: { ...scope }, visibility }], visibility);
    return scope;
  }
  ingest(value: OperationalSample, visibility: Visibility): OperationalSample {
    const sample = validateOperationalSample(value); const scope = this.scope(sample.scopeId);
    if (!scope || scope.revision !== sample.scopeRevision) throw new Error('Unknown or stale operational scope');
    if (sample.readings.some(reading => reading.surface !== scope.surface)) throw new Error('Operational reading outside scope surface');
    const history = this.samples(scope.id, scope.revision);
    const last = history.at(-1);
    if (last && sample.tick <= last.tick) throw new Error('Operational sample tick did not advance');
    const slot = Math.floor(sample.tick / this.limits.sampleTicks) % this.limits.historySamples;
    this.runtime.record('operational/sample', [{ entity: 'operationalSamples', id: sampleId(sample, slot), value: { ...sample }, visibility, sources: [{ entity: 'operationalScopes', id: scope.id }] }], visibility, sample.tick);
    return sample;
  }
  samples(scopeId: string, revision?: number): OperationalSample[] {
    return this.runtime.journal.list<OperationalSample>(this.runtime.run, 'operationalSamples')
      .filter(s => s.scopeId === scopeId && (revision === undefined || s.scopeRevision === revision))
      .sort((a, b) => a.tick - b.tick);
  }
  metrics(scopeId: string, windowTicks: number, nowTick?: number, kinds?: MetricKind[], items?: string[]): OperationalMetric[] {
    if (!Number.isSafeInteger(windowTicks) || windowTicks < this.limits.sampleTicks) throw new Error('Invalid metric window');
    const scope = this.scope(scopeId); if (!scope) throw new Error('Unknown operational scope');
    const samples = this.samples(scopeId, scope.revision); const end = samples.at(-1);
    if (!end) return [];
    const requested = new Map(end.readings.filter(r => (!kinds || kinds.includes(r.kind)) && (!items || items.includes(r.name))).map(r => [metricId(r), r]));
    const start = [...samples].reverse().find(s => s.tick <= end.tick - windowTicks);
    const interval = start ? samples.filter(s => s.tick >= start.tick && s.tick <= end.tick) : [];
    const age = Math.max(0, (nowTick ?? end.tick) - end.tick);
    return [...requested.values()].map(current => {
      const base = start?.readings.find(r => metricId(r) === metricId(current));
      const epochChanged = interval.some(sample => sample.epoch !== end.epoch);
      const membershipChanged = interval.some(sample => sample.membershipHash !== end.membershipHash);
      const discontinuity = !start || epochChanged || membershipChanged;
      const intervalReadings = interval.map(sample => sample.readings.find(r => metricId(r) === metricId(current)));
      const unsupported = intervalReadings.some(reading => !reading || reading.coverage === 'unknown');
      const partial = intervalReadings.some(reading => reading?.coverage === 'partial');
      const deltaTicks = start ? end.tick - start.tick : 0;
      const stock = current.kind === 'stock';
      const quantity = discontinuity || unsupported || current.total === null || base?.total === null || base === undefined ? null : current.total - base.total;
      const rate = stock ? null : quantity === null || deltaTicks <= 0 ? null : quantity / (deltaTicks / 60);
      const coverage = discontinuity || unsupported ? 'unknown' : partial || deltaTicks < windowTicks ? 'partial' : 'complete';
      const unknownReading = intervalReadings.find(reading => reading?.coverage === 'unknown');
      const reason = discontinuity ? (!start ? 'insufficient_history' : epochChanged ? 'epoch_changed' : 'scope_membership_changed') : unsupported ? unknownReading?.reason ?? current.reason ?? base?.reason ?? 'missing_or_unsupported_interval' : partial || deltaTicks < windowTicks ? 'partial_interval' : undefined;
      return { schema: OBSERVATION_SCHEMA, scopeId, scopeRevision: scope.revision, epoch: end.epoch, kind: current.kind, name: current.name, quality: current.quality, surface: current.surface, quantity, rate, unit: 'items-per-game-second', startTick: start?.tick ?? end.tick, endTick: end.tick, ageTicks: age, coverage, ...(reason ? { reason } : {}), method: current.method, evidence: [...new Set([...(base?.evidence ?? []), ...current.evidence])] } satisfies OperationalMetric;
    });
  }
}

export interface SnapshotFilter { types?: string[]; names?: string[]; fields?: string[]; subarea?: [Position, Position] }
interface Snapshot { id: string; principal: string; task: string; revision: number; created: number; tick: number; filterHash: string; entities: Record<string, unknown>[]; bytes: number }
export class ObservationSnapshots {
  private values = new Map<string, Snapshot>();
  constructor(private limits: OperationalLimits = DEFAULT_OPERATIONAL_LIMITS, private now = () => Date.now()) {}
  private reap() { for (const [id, s] of this.values) if (this.now() - s.created > this.limits.snapshotTtlMs) this.values.delete(id); }
  create(principal: string, task: string, revision: number, tick: number, filter: SnapshotFilter, entities: Record<string, unknown>[]) {
    this.reap();
    while (this.values.size >= this.limits.maxSnapshots) this.values.delete(this.values.keys().next().value!);
    const size = Buffer.byteLength(JSON.stringify(entities)); if (size > this.limits.snapshotBytes) throw new Error('Observation snapshot byte limit exceeded');
    const id = randomUUID(); const filterHash = createHash('sha256').update(JSON.stringify(filter)).digest('hex');
    this.values.set(id, { id, principal, task, revision, created: this.now(), tick, filterHash, entities: structuredClone(entities), bytes: size });
    return id;
  }
  read(id: string, principal: string, task: string, revision: number, filter: SnapshotFilter) {
    this.reap(); const value = this.values.get(id);
    const filterHash = createHash('sha256').update(JSON.stringify(filter)).digest('hex');
    if (!value) throw new Error('Observation snapshot expired or evicted; start a fresh query');
    if (value.principal !== principal || value.task !== task || value.revision !== revision || value.filterHash !== filterHash) throw new Error('Observation snapshot scope changed');
    return value;
  }
}

export interface OperationalWatch {
  id: string; role: string; task: string; scopeId: string; scopeRevision: number; metric: { kind: MetricKind; name: string; quality: string; surface: string };
  threshold: number; recovery: number; persistenceTicks: number; state: 'healthy' | 'pending-active' | 'active' | 'pending-recovery'; sinceTick: number; sequence: number;
}
export interface WatchTransition { watch: string; sequence: number; state: 'active' | 'recovered'; tick: number; gap: boolean; metric: number }
interface WatchAcknowledgement { recipient: string; sequences: Record<string, number> }
export class OperationalWatches {
  constructor(private runtime: DurableRuntime, private limits: OperationalLimits = DEFAULT_OPERATIONAL_LIMITS) {}
  list(): OperationalWatch[] { return this.runtime.journal.list(this.runtime.run, 'operationalWatches'); }
  register(watch: Omit<OperationalWatch, 'state' | 'sinceTick' | 'sequence'>, visibility: Visibility) {
    const all = this.list(); const prior = all.find(w => w.id === watch.id);
    if (!prior && (all.length >= this.limits.maxWatchesPerRun || all.filter(w => w.role === watch.role).length >= this.limits.maxWatchesPerRole)) throw new Error('Operational watch limit reached');
    if (!(watch.threshold > 0) || !(watch.recovery > watch.threshold) || !Number.isSafeInteger(watch.persistenceTicks) || watch.persistenceTicks < 1) throw new Error('Invalid operational watch');
    // Stable watch IDs span scope revisions. Preserve their sequence so an
    // acknowledgement from an older revision cannot hide a new transition.
    const value: OperationalWatch = { ...structuredClone(watch), state: 'healthy', sinceTick: 0, sequence: prior?.sequence ?? 0 };
    this.runtime.record('operational/watch', [{ entity: 'operationalWatches', id: value.id, value: { ...value }, visibility }], visibility); return value;
  }
  evaluate(id: string, tick: number, metric: number, visibility: Visibility): WatchTransition | null {
    const watch = this.runtime.journal.get<OperationalWatch>(this.runtime.run, 'operationalWatches', id); if (!watch) throw new Error('Unknown operational watch');
    let next = { ...watch }; let transition: WatchTransition | null = null;
    if (watch.state === 'healthy' && metric < watch.threshold) next = { ...watch, state: 'pending-active', sinceTick: tick };
    else if (watch.state === 'pending-active' && metric >= watch.threshold) next = { ...watch, state: 'healthy', sinceTick: tick };
    else if (watch.state === 'pending-active' && tick - watch.sinceTick >= watch.persistenceTicks) { next = { ...watch, state: 'active', sequence: watch.sequence + 1 }; transition = { watch: id, sequence: next.sequence, state: 'active', tick, gap: false, metric }; }
    else if (watch.state === 'active' && metric >= watch.recovery) next = { ...watch, state: 'pending-recovery', sinceTick: tick };
    else if (watch.state === 'pending-recovery' && metric < watch.recovery) next = { ...watch, state: 'active', sinceTick: tick };
    else if (watch.state === 'pending-recovery' && tick - watch.sinceTick >= watch.persistenceTicks) { next = { ...watch, state: 'healthy', sequence: watch.sequence + 1 }; transition = { watch: id, sequence: next.sequence, state: 'recovered', tick, gap: false, metric }; }
    if (JSON.stringify(next) !== JSON.stringify(watch)) this.runtime.record('operational/watch-state', [{ entity: 'operationalWatches', id, value: { ...next }, visibility }, ...(transition ? [{ entity: 'watchTransitions' as const, id: `${id}.${transition.sequence}`, value: { ...transition }, visibility }] : [])], visibility, tick);
    return transition;
  }
  pending(role: string): { transitions: WatchTransition[]; gap: boolean } {
    const all = this.runtime.journal.list<WatchTransition>(this.runtime.run, 'watchTransitions').filter(t => this.list().some(w => w.id === t.watch && w.role === role));
    return { transitions: all.slice(-this.limits.maxPendingTransitions), gap: all.length > this.limits.maxPendingTransitions };
  }
  pendingFor(recipient: string, watchIds: Set<string>) {
    const acknowledgement = this.runtime.journal.get<WatchAcknowledgement>(this.runtime.run, 'watchAcknowledgements', recipient);
    const all = this.runtime.journal.list<WatchTransition>(this.runtime.run, 'watchTransitions').filter(t => watchIds.has(t.watch) && t.sequence > (acknowledgement?.sequences[t.watch] ?? 0));
    const transitions = all.slice(-this.limits.maxPendingTransitions);
    const gap = all.length > this.limits.maxPendingTransitions || transitions.some(t => t.sequence > (acknowledgement?.sequences[t.watch] ?? 0) + 1);
    return { transitions, gap };
  }
  acknowledge(recipient: string, transitions: WatchTransition[]) {
    if (!transitions.length) return;
    const prior = this.runtime.journal.get<WatchAcknowledgement>(this.runtime.run, 'watchAcknowledgements', recipient);
    const sequences = { ...(prior?.sequences ?? {}) }; for (const transition of transitions) sequences[transition.watch] = Math.max(sequences[transition.watch] ?? 0, transition.sequence);
    const value: WatchAcknowledgement = { recipient, sequences };
    this.runtime.record('operational/watch-acknowledged', [{ entity: 'watchAcknowledgements', id: recipient, value: { ...value }, visibility: privateTo(recipient) }], { kind: 'operator' });
  }
}

export function targetReadings(target: ProductionTarget, inputs: ProductionTarget[], scope: ObservationScope): OperationalReading[] {
  return [target, ...inputs].map(t => ({ kind: 'target-demand', name: t.name, quality: t.quality, surface: t.surface, total: t.rate, method: `recipe-target-v1:${scope.id}:${scope.revision}`, coverage: 'complete', evidence: [`task:${scope.task}`] }));
}
