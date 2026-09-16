import { isDeepStrictEqual } from 'node:util';
import type { AdmissionAck, EvaluationManifest, EvaluationState, InventoryBalance, Measurement, StageResult, WindowResult } from './contracts.js';

const natural = (n: number) => Number.isSafeInteger(n) && n >= 0;
const active = (s: EvaluationState) => ['admitting', 'settling', 'scoring'].includes(s);
const total = (i: InventoryBalance) => i.containers + i.belts + i.hands + i.inProcess;

/** One immutable attempt. Restart requires a new instance and a newly acknowledged game barrier. */
export class VerificationEngine {
  private manifest: EvaluationManifest;
  private state: EvaluationState = 'building';
  private reasons: string[] = [];
  private admission: AdmissionAck | null = null;
  private samples: Measurement[] = [];
  private baseline: Measurement | null = null;
  private windows: WindowResult[] = [];
  private stages: StageResult[] = [];
  private assisted = false;
  private closed = false;
  private lastWall: number;
  private lastTick: number;
  private admissionEvidence: unknown = null;
  private lastInput: unknown = null;

  constructor(readonly attempt: string, manifest: EvaluationManifest, private sink: (e: unknown) => void) {
    if (!attempt || !manifest.version || !manifest.scope || !manifest.toleranceVersion || manifest.windowTicks !== 3600 || manifest.windows !== 5 || manifest.target !== 30 || !manifest.stages.length) throw new Error('Invalid verification manifest');
    for (const n of [manifest.settlingTicks, manifest.originTick, manifest.originWallMs, manifest.gameLimitTicks, manifest.wallLimitMs, ...(manifest.admissionLimitTicks === undefined ? [] : [manifest.admissionLimitTicks])]) if (!natural(n)) throw new Error('Invalid manifest clock');
    if (!manifest.wallLimitMs || !manifest.gameLimitTicks) throw new Error('Empty run limit');
    const ids = new Set<string>();
    for (const s of manifest.stages) {
      if (!s.id || ids.has(s.id) || !s.source || !s.boundary || !s.consumer || !s.item.name || !s.item.quality || !s.item.surface || !natural(s.minimum) || !s.minimum || !natural(s.balanceTolerance) || !natural(s.maxDrawdown)) throw new Error('Invalid required stage');
      ids.add(s.id);
    }
    this.manifest = structuredClone(manifest);
    this.lastWall = manifest.originWallMs; this.lastTick = manifest.originTick;
    this.emit('created', { manifest: this.manifest });
  }
  report() {
    return structuredClone({ schema: 1, attempt: this.attempt, state: this.state, manifest: this.manifest, admission: this.admission, admissionEvidence: this.admissionEvidence, baseline: this.baseline, lastInput: this.lastInput, samples: this.samples, windows: this.windows, stages: this.stages, assisted: this.assisted, scoringClosed: this.closed, reasons: this.reasons });
  }
  // Persist each sample once. Full snapshots here would copy the entire trace on
  // every poll, making a tick-resolution run quadratic in CPU and log storage.
  private emit(kind: string, data: unknown = null) {
    this.sink(structuredClone({ kind: 'evaluation/' + kind, visibility: { kind: 'evaluator' }, attempt: this.attempt, state: this.state, assisted: this.assisted, scoringClosed: this.closed, data }));
  }
  private end(state: 'invalid' | 'failed' | 'aborted', reason: string) {
    if (!active(this.state) && this.state !== 'building') return;
    this.state = state; this.reasons.push(reason);
    this.emit(state, { reason, lastInput: this.lastInput, admissionEvidence: this.admissionEvidence });
  }
  invalidate(reason: string) { this.end('invalid', reason); }
  repair() { this.end('aborted', 'repair_requested'); }
  humanEdit(detail: string) { this.assisted = true; this.invalidate('human_or_uncertain_edit:' + detail); }
  stop(reason: string) { this.closed = true; this.end('aborted', 'run_closed:' + reason); }

  /** Wall checks must continue while game.tick is frozen. Deadline equality allows an exact final tick. */
  clock(tick: number, wallMs: number): boolean {
    if (!natural(tick) || !natural(wallMs) || tick < this.lastTick || wallMs < this.lastWall) { this.invalidate('clock_regression'); return false; }
    this.lastTick = tick; this.lastWall = wallMs;
    if (wallMs - this.manifest.originWallMs >= this.manifest.wallLimitMs || tick - this.manifest.originTick > this.manifest.gameLimitTicks) this.stop('deadline');
    return !this.closed && (active(this.state) || this.state === 'building');
  }
  request(tick: number, wallMs: number) {
    if (this.state !== 'building') throw new Error('Attempt already requested');
    if (!this.clock(tick, wallMs)) return;
    this.state = 'admitting'; this.emit('requested');
  }
  acknowledge(ack: AdmissionAck, first: Measurement, wallMs: number) {
    if (this.state !== 'admitting') throw new Error('No pending admission');
    // Retain rejected input too: invalid coverage must remain diagnosable/calibratable.
    this.admissionEvidence = structuredClone({ ack, first, wallMs });
    if (!this.clock(ack.tick, wallMs)) return;
    if (ack.attempt !== this.attempt || ack.scope !== this.manifest.scope || !ack.mutationsClosed || ack.pendingMutations !== 0 || !ack.neutral || ack.tick !== first.tick) { this.invalidate('unacknowledged_mutations_or_baseline'); return; }
    if (this.manifest.admissionLimitTicks !== undefined && ack.tick - this.manifest.originTick > this.manifest.admissionLimitTicks) { this.end('failed', 'admission_deadline'); return; }
    this.admission = structuredClone(ack);
    this.state = 'settling';
    this.sample(first, wallMs);
    if (this.state === 'settling' || this.state === 'scoring') this.emit('admitted', this.admissionEvidence);
  }
  sample(input: Measurement, wallMs: number) {
    if (!['settling', 'scoring'].includes(this.state)) return;
    const s = structuredClone(input);
    this.lastInput = { sample: s, wallMs };
    if (!this.clock(s.tick, wallMs)) return;
    try { this.validate(s); } catch (error) { this.invalidate(String(error)); return; }
    if (s.humanEdits) { this.humanEdit('measurement'); return; }
    if (s.manualSupply || s.artificialOutput) { this.invalidate('nonautomatic_supply'); return; }
    const last = this.samples.at(-1);
    if (last && s.tick === last.tick) {
      if (!isDeepStrictEqual(last, s)) this.invalidate('changed_evidence_at_frozen_tick');
      return;
    }
    if (last && (s.sequence !== last.sequence + 1 || !s.continuous)) { this.invalidate('disconnect_or_sequence_gap'); return; }
    if (last && !this.monotonic(last, s)) { this.invalidate('counter_regression'); return; }
    const start = this.admission!.tick + this.manifest.settlingTicks;
    const boundary = this.baseline ? start + (this.windows.length + 1) * 3600 : start;
    // Polling past an unsampled boundary cannot allocate production to either adjacent window.
    if (s.tick > boundary) { this.invalidate('missing_exact_boundary:' + boundary); return; }
    this.samples.push(s);
    const priorWindows = this.windows.length;
    if (!this.baseline && s.tick === start) { this.baseline = s; this.state = 'scoring'; }
    else if (this.baseline && s.tick === boundary) {
      const previousTick = boundary - 3600;
      const previous = this.samples.find(v => v.tick === previousTick)!;
      const produced = s.machineScience - previous.machineScience;
      const delivered = s.automaticCollector - previous.automaticCollector - (s.collectorReverse - previous.collectorReverse);
      this.windows.push({ start: previousTick, end: boundary, produced, delivered, passed: produced >= 30 && delivered >= 30 });
      if (this.windows.length === 5) this.finish(s);
    }
    this.emit('measurement', { sample: s, wallMs, window: this.windows.length > priorWindows ? this.windows.at(-1) : null, stages: this.windows.length === 5 ? this.stages : null });
  }
  private validate(s: Measurement) {
    if (s.scope !== this.manifest.scope || s.coverage !== 'complete' || !s.continuous || !natural(s.sequence)) throw new Error('incomplete_scope_coverage');
    for (const n of [s.machineScience, s.automaticCollector, s.collectorReverse, s.manualSupply, s.artificialOutput, s.humanEdits]) if (!natural(n)) throw new Error('invalid_measurement');
    for (const r of this.manifest.stages) {
      const v = s.stages[r.id];
      if (!v || v.coverage !== 'complete' || v.source !== r.source || v.boundary !== r.boundary || v.consumer !== r.consumer) throw new Error('stage_coverage:' + r.id);
      for (const n of [v.produced, v.forward, v.reverse, v.consumed, ...[v.upstream, v.downstream].flatMap(i => [i.containers, i.belts, i.hands, i.inProcess])]) if (!natural(n)) throw new Error('stage_quantity:' + r.id);
    }
  }
  private monotonic(a: Measurement, b: Measurement) {
    if (b.machineScience < a.machineScience || b.automaticCollector < a.automaticCollector || b.collectorReverse < a.collectorReverse) return false;
    return this.manifest.stages.every(r => (['produced', 'forward', 'reverse', 'consumed'] as const).every(k => b.stages[r.id]![k] >= a.stages[r.id]![k]));
  }
  private finish(end: Measurement) {
    const start = this.baseline!;
    this.stages = this.manifest.stages.map(r => {
      const a = start.stages[r.id]!; const b = end.stages[r.id]!;
      const produced = b.produced - a.produced;
      const delivered = b.forward - a.forward - (b.reverse - a.reverse);
      const consumed = b.consumed - a.consumed;
      const upstreamResidual = total(b.upstream) - total(a.upstream) - produced + delivered;
      const downstreamResidual = total(b.downstream) - total(a.downstream) - delivered + consumed;
      const drawdown = Math.max(0, total(a.upstream) - total(b.upstream)) + Math.max(0, total(a.downstream) - total(b.downstream));
      return { id: r.id, produced, delivered, consumed, drawdown, upstreamResidual, downstreamResidual, passed: produced >= r.minimum && delivered >= r.minimum && consumed >= r.minimum && drawdown <= r.maxDrawdown && Math.abs(upstreamResidual) <= r.balanceTolerance && Math.abs(downstreamResidual) <= r.balanceTolerance };
    });
    if (this.stages.some((s, i) => Math.abs(s.upstreamResidual) > this.manifest.stages[i]!.balanceTolerance || Math.abs(s.downstreamResidual) > this.manifest.stages[i]!.balanceTolerance)) { this.invalidate('unreconciled_balances'); return; }
    this.state = this.windows.every(w => w.passed) && this.stages.every(s => s.passed) ? 'passed' : 'failed';
    if (this.state === 'failed') this.reasons.push('insufficient_fresh_output_or_connected_flow');
  }
}
