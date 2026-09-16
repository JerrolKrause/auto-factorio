/** Evaluator-only inputs. Gameplay claims and global force counters are not measurements. */
export interface EvaluationManifest {
  version: string;
  scope: string;
  settlingTicks: number;
  windowTicks: 3600;
  windows: 5;
  target: 30;
  originTick: number;
  originWallMs: number;
  gameLimitTicks: number;
  wallLimitMs: number;
  admissionLimitTicks?: number;
  toleranceVersion: string;
  stages: StageRequirement[];
}
export interface StageRequirement {
  id: string;
  source: string;
  boundary: string;
  consumer: string;
  item: { name: string; quality: string; surface: string };
  minimum: number;
  balanceTolerance: number;
  maxDrawdown: number;
}
/** Coverage must include ALL relevant storage, not just chest inventories. */
export interface InventoryBalance { containers: number; belts: number; hands: number; inProcess: number }
export interface StageReading {
  source: string;
  boundary: string;
  consumer: string;
  produced: number;
  forward: number;
  reverse: number;
  consumed: number;
  upstream: InventoryBalance;
  downstream: InventoryBalance;
  coverage: 'complete' | 'missing' | 'ambiguous';
}
export interface Measurement {
  tick: number;
  sequence: number;
  scope: string;
  /** Complete engine interval coverage since the preceding sample, including attribution. */
  continuous: boolean;
  coverage: 'complete' | 'missing' | 'ambiguous';
  machineScience: number;
  automaticCollector: number;
  collectorReverse: number;
  /** Contamination in this interval; reset to zero at a reconciled admission baseline. */
  manualSupply: number;
  artificialOutput: number;
  humanEdits: number;
  stages: Record<string, StageReading>;
}
export interface AdmissionAck {
  attempt: string;
  scope: string;
  tick: number;
  mutationsClosed: boolean;
  pendingMutations: number;
  neutral: boolean;
  /** Raw Lua receipt/inventory/coverage record retained even before calibrated measurement exists. */
  raw: unknown;
}
export type EvaluationState = 'building' | 'admitting' | 'settling' | 'scoring' | 'aborted' | 'invalid' | 'failed' | 'passed';
export interface WindowResult { start: number; end: number; produced: number; delivered: number; passed: boolean }
export interface StageResult { id: string; produced: number; delivered: number; consumed: number; drawdown: number; upstreamResidual: number; downstreamResidual: number; passed: boolean }
