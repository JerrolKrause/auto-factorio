import type { Position, RecipeFacts } from './game.js';

export const OBSERVATION_SCHEMA = 1 as const;
export type MetricKind = 'production' | 'consumption' | 'boundary-delivery' | 'stock' | 'configured-supply' | 'nominal-capacity' | 'target-demand';
export type MetricCoverage = 'complete' | 'partial' | 'unknown';
export interface ItemIdentity { name: string; quality: string; surface: string }
export interface ProductionTarget extends ItemIdentity { rate: number; unit: 'items-per-game-second'; recipe: string }
export interface OperationalLimits {
  sampleTicks: number; historySamples: number; maxScopes: number; maxEntities: number;
  maxSnapshots: number; snapshotTtlMs: number; snapshotBytes: number;
  maxWatchesPerRole: number; maxWatchesPerRun: number; maxPendingTransitions: number;
  watchPersistenceTicks: number; rotationTurns: number; rotationBytes: number;
}
export const DEFAULT_OPERATIONAL_LIMITS: OperationalLimits = {
  sampleTicks: 60, historySamples: 120, maxScopes: 32, maxEntities: 5_000,
  maxSnapshots: 32, snapshotTtlMs: 30_000, snapshotBytes: 4 * 1024 * 1024,
  maxWatchesPerRole: 8, maxWatchesPerRun: 32, maxPendingTransitions: 32,
  watchPersistenceTicks: 300, rotationTurns: 8, rotationBytes: 128 * 1024,
};
export interface ObservationScope {
  schema: typeof OBSERVATION_SCHEMA; id: string; revision: number; task: string; surface: string;
  area: [Position, Position]; entityLimit: number; membershipHash?: string;
}
export interface OperationalReading extends ItemIdentity {
  kind: MetricKind; total: number | null; stock?: number | null; method: string;
  coverage: MetricCoverage; reason?: string; evidence: string[];
}
export interface OperationalSample {
  schema: typeof OBSERVATION_SCHEMA; epoch: string; scopeId: string; scopeRevision: number;
  membershipHash: string; tick: number; readings: OperationalReading[];
}
export interface OperationalMetric extends ItemIdentity {
  schema: typeof OBSERVATION_SCHEMA; scopeId: string; scopeRevision: number; epoch: string;
  kind: MetricKind; quantity: number | null; rate: number | null; unit: 'items-per-game-second';
  startTick: number; endTick: number; ageTicks: number; coverage: MetricCoverage; reason?: string;
  method: string; evidence: string[];
}
export interface MachineSymptom {
  unit: number; name: string; position: Position; tick: number; status: string | null;
  recipe: string | null; inputs?: unknown; outputs?: unknown; power: string | number | null;
  coverage: MetricCoverage; evidence: string[];
}
export interface ContextLifecyclePolicy { schema: 1; maxTurns: number; maxDeliveredBytes: number; providerOccupancy?: number }

const identifier = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !/^[\w.-]{1,100}$/.test(value)) throw new Error(`Invalid ${field}`);
  return value;
};
const positive = (value: unknown, field: string, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max) throw new Error(`Invalid ${field}`);
  return Number(value);
};
const finitePositive = (value: unknown, field: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${field}`);
  return value;
};
export function validateProductionTarget(value: unknown): ProductionTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid production target');
  const v = value as Record<string, unknown>;
  const expected = ['name', 'quality', 'surface', 'rate', 'unit', 'recipe'];
  if (Object.keys(v).some(k => !expected.includes(k)) || expected.some(k => !(k in v))) throw new Error('Ambiguous production target');
  if (v.unit !== 'items-per-game-second') throw new Error('Ambiguous production target unit');
  return { name: identifier(v.name, 'target item'), quality: identifier(v.quality, 'target quality'), surface: identifier(v.surface, 'target surface'), rate: finitePositive(v.rate, 'target rate'), unit: v.unit, recipe: identifier(v.recipe, 'target recipe') };
}
export function validateOperationalLimits(value: OperationalLimits): OperationalLimits {
  const v = { ...value };
  positive(v.sampleTicks, 'sample cadence', 3600); positive(v.historySamples, 'history samples', 10_000);
  positive(v.maxScopes, 'scope limit', 1_000); positive(v.maxEntities, 'entity limit', 100_000);
  positive(v.maxSnapshots, 'snapshot limit', 1_000); positive(v.snapshotTtlMs, 'snapshot TTL'); positive(v.snapshotBytes, 'snapshot bytes');
  positive(v.maxWatchesPerRole, 'role watch limit'); positive(v.maxWatchesPerRun, 'run watch limit'); positive(v.maxPendingTransitions, 'pending transition limit');
  positive(v.watchPersistenceTicks, 'watch persistence'); positive(v.rotationTurns, 'rotation turns'); positive(v.rotationBytes, 'rotation bytes');
  if (v.maxWatchesPerRole > v.maxWatchesPerRun) throw new Error('Role watch limit exceeds run limit');
  return v;
}
export function validateObservationScope(value: ObservationScope): ObservationScope {
  if (value.schema !== OBSERVATION_SCHEMA) throw new Error('Unsupported observation schema');
  identifier(value.id, 'scope id'); identifier(value.task, 'scope task'); identifier(value.surface, 'scope surface'); positive(value.revision, 'scope revision');
  if (!Array.isArray(value.area) || value.area.length !== 2 || value.area.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) || value.area[0].x > value.area[1].x || value.area[0].y > value.area[1].y) throw new Error('Invalid scope area');
  positive(value.entityLimit, 'scope entity limit', 100_000);
  if (value.membershipHash !== undefined) identifier(value.membershipHash, 'membership hash');
  return structuredClone(value);
}
export function targetRequirements(target: ProductionTarget, facts: RecipeFacts): { supported: true; inputs: ProductionTarget[] } | { supported: false; reason: string } {
  const t = validateProductionTarget(target);
  if (facts.name !== t.recipe || !['crafting', 'basic-crafting', 'advanced-crafting'].includes(facts.category) || facts.products.length !== 1 || facts.ingredients.some(i => i.type !== 'item')) return { supported: false, reason: 'unsupported_recipe' };
  const product = facts.products[0];
  if (!product || product.type !== 'item' || product.name !== t.name || !product.amount || (product.probability !== undefined && product.probability !== 1) || product.extra_count_fraction) return { supported: false, reason: 'unsupported_product' };
  return { supported: true, inputs: facts.ingredients.map(i => ({ name: i.name, quality: t.quality, surface: t.surface, rate: t.rate * i.amount / product.amount!, unit: t.unit, recipe: facts.name })) };
}

export const DECISION_FACT_ORACLES = {
  'supply-deficit': ['target-demand', 'measured-supply', 'stock-trend', 'coverage', 'scope-identity'],
  'idle-machine': ['machine-status', 'recipe', 'inputs', 'outputs', 'power', 'tick'],
  'partial-command': ['command-id', 'task-revision', 'certainty', 'completed-count', 'remaining-count', 'failure', 'detail-reference'],
  replacement: ['objective', 'ownership', 'committed-plan', 'pending-or-unknown-effects', 'steering', 'conditions', 'fresh-world', 'budget'],
} as const;
