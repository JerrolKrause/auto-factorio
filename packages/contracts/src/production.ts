import type { Position } from './game.js';

/** Public process facts only. Evaluator fixtures and reference layouts never enter this catalog. */
export const PRODUCTION_SCHEMA = 1 as const;
export interface ProductionProduct {
  kind: 'item' | 'fluid'; name: string; quality: 'normal'; surface: string;
}
export interface ProductFact {
  id: string; kind: 'item' | 'fluid'; name: string;
  fuelValue?: number; fuelCategory?: string; burntResult?: string;
  spoilage?: boolean; defaultTemperature?: number; maximumTemperature?: number;
}
export interface RecipeFlow {
  type: 'item' | 'fluid'; name: string; amount?: number; amount_min?: number; amount_max?: number;
  probability?: number; temperature?: number; minimum_temperature?: number; maximum_temperature?: number;
  fluidbox_index?: number; ignored_by_productivity?: number; ignored_by_stats?: number;
  fluidbox_multiplier?: number; extra_count_fraction?: number; percent_spoiled?: number;
}
export interface SurfaceCondition { property: string; min?: number; max?: number }
export interface RecipeFact {
  id: string; name: string; category: string; seconds: number; ingredients: RecipeFlow[]; products: RecipeFlow[];
  unlocks: string[]; surfaceConditions: SurfaceCondition[];
}
export interface FluidConnection {
  connection_type: string; direction: number; flow_direction: string; positions: Position[];
  connection_category: string[]; max_underground_distance?: number; linked_connection_id?: number;
}
export interface MachineFluidBox {
  index: number; productionType: string; filter?: string; minimumTemperature?: number; maximumTemperature?: number;
  volume: number; connections: FluidConnection[];
}
export interface MachineFact {
  id: string; name: string; type: string; categories: string[]; speed: number; ingredientLimit: number;
  collisionBox: [Position, Position]; fluidBoxes: MachineFluidBox[]; placementItems: string[];
  energy: { kind: 'electric' | 'burner' | 'unsupported'; maxJoulesPerTick: number; drainJoulesPerTick?: number;
    effectivity?: number; fuelCategories?: string[] };
  baseEffects: Record<string, number>; surfaceConditions: SurfaceCondition[];
}
export interface ProductionAvailability {
  tick: number; force: string; recipes: Record<string, { enabled: boolean; productivity: number }>;
  researched: string[]; surfaceProperties: Record<string, number>;
}
export interface ProductionCatalog {
  schema: 1; mods: Record<string, string>; fingerprint: string;
  products: ProductFact[]; recipes: RecipeFact[]; machines: MachineFact[];
}
export interface ProductionProfile {
  id: string; revision: number; fingerprint: string; recipes: string[] | null; equipment: string[] | null;
}
export interface ProductionArtifactRef { schema: 1; id: string; fingerprint: string; availabilityRevision: string }
export interface ProductionRequest {
  schema: 1; target: ProductionProduct; mode: 'explore' | 'rate' | 'quantity';
  rate?: { numerator: string; denominator: string; unit: 'items-per-game-second' | 'units-per-game-second' };
  quantity?: number; profile: ProductionProfile; facts: ProductionArtifactRef;
  externalInputs: { product: ProductionProduct; capacity: { kind: 'unlimited' } | { kind: 'rate'; numerator: string; denominator: string } | { kind: 'unknown' } }[];
  initialStock: { product: ProductionProduct; quantity: number }[];
  utilities: { electricityWatts: number | null }; constructionEquipment: Record<string, number>;
  sinks: { product: ProductionProduct; capacity: { kind: 'unlimited' } | { kind: 'rate'; numerator: string; denominator: string } }[];
  routes: Record<string, string>; machines: Record<string, string>; fuels: Record<string, ProductionProduct>;
  headroom?: number;
  transport?: { product: ProductionProduct; capacity: Exact; laneCapacity?: Exact }[];
}
export interface ProductionSearchInput { query: string; cursor?: string; product?: string; recipe?: string; machine?: string; profile?: ProductionProfile }
export interface ProductionSearchResult {
  schema: 1; facts: ProductionArtifactRef; availability: { tick: number; revision: string; force: string };
  items: { product: ProductionProduct; producers: { recipe: RecipeFact; blockers: string[];
    machines: { fact: MachineFact; blockers: string[] }[] }[] }[];
  ambiguous: boolean; omitted: number; next: string | null; status: 'complete' | 'partial' | 'expired';
}

export interface Exact { numerator: string; denominator: string }
export interface ProductionBlocker { code: string; stage?: string; product?: string; detail: string }
export interface ProductionStage {
  id: string; recipe: string; machine: string | null; inputs: string[]; outputs: string[];
  meaning: string; evidence: string[]; crafts?: Exact; machines?: number; fractionalMachines?: Exact;
  nominalCraftsPerSecond?: Exact; fuel?: { product: string; operating: Exact; fullDuty: Exact };
  power?: { lowerWatts: Exact; upperWatts: Exact; fullDutyWatts: Exact; basis: string };
}
export interface ProductionBalance {
  product: string; produced: Exact; consumed: Exact; external: Exact; delivered: Exact; disposed: Exact; residual: Exact;
  stockUsed?: Exact; accumulated?: Exact;
}
export interface ProductionPlan {
  schema: 1; id: string; revision: number; request: ProductionRequest; fingerprint: string; availabilityRevision: string;
  status: 'exploration' | 'feasible' | 'infeasible' | 'incomplete' | 'unsupported'; executable: boolean;
  routePolicy: string; routes: Record<string, string>; stages: ProductionStage[]; products: string[];
  blockers: ProductionBlocker[]; assumptions: string[]; balances: ProductionBalance[];
  targetDemand?: Exact; headroomDemand?: Exact; leftovers?: Record<string, Exact>; stockUsed?: Record<string, Exact>;
  transport: { product: string; unitsPerSecond: Exact; kind: 'belt' | 'fluid'; connectivity: 'unverified'; capacity?: Exact; lanes?: number }[];
  omitted: number; invalidatedEvidence: string[];
}
export interface ProductionPlanInput { request: ProductionRequest; prior?: { id: string; revision: number } }
export interface ProductionInspectInput { id: string; revision: number; stage?: string; depth?: number; cursor?: string; view?: 'stages' | 'request' }
export interface ProductionPlanSummary {
  schema: 1; id: string; revision: number; status: ProductionPlan['status']; executable: boolean;
  fingerprint: string; availabilityRevision: string; stageCount: number; blockers: ProductionBlocker[];
  assumptions: string[]; omitted: number; invalidatedEvidence: string[];
  mode: ProductionRequest['mode']; target: ProductionProduct; targetDemand?: Exact; headroomDemand?: Exact;
}
/** Assigned executors receive stage identity, without their manager's request or graph totals. */
export interface ProductionAssignedStageSummary {
  schema: 1; id: string; revision: number; scope: 'assigned-stage'; stage: string;
  fingerprint: string; availabilityRevision: string;
}
export interface ProductionPlanPage {
  summary: ProductionPlanSummary | ProductionAssignedStageSummary; stages: ProductionStage[]; balances: ProductionBalance[];
  stale: boolean; revalidation: string[]; omitted: number; next: string | null; status: 'complete' | 'partial' | 'expired';
  requestChunk?: { encoding: 'json'; offset: number; text: string; totalCharacters: number };
  commitments?: ProductionStageProgress[];
}

/** Construction proposals use existing task/ownership admission; never encode material flow as dependencies. */
export interface ProductionCommitInput {
  requestId: string; id: string; revision: number;
  assignments: { stage: string; task: { id: string; revision: number } | ProductionTaskProposal }[];
}
export type ProductionTaskProposal = Pick<import('./coordination.js').CoordinatedTask,
  'id' | 'goal' | 'parent' | 'dependencies' | 'scope' | 'resources' | 'successCriteria' | 'deadline' | 'committedPlan' | 'actor' | 'reservations' | 'criteria' | 'productionTarget'>;
export interface ProductionCommitment {
  id: string; owner: string; requestId: string; payloadHash: string; planId: string; revision: number;
  mappings: { stage: string; meaning: string; task: string; taskRevision: number }[];
}
export interface ProductionStageProgress {
  stage: string; task: string; taskRevision: number; current: boolean;
  construction: 'pending' | 'complete' | 'blocked'; evidence: string[];
  commissioning: 'unknown'; health: 'unknown'; scenarioVerdict: 'not-evaluated';
  suppliers: string[];
}

export interface ProductionStatusInput { id: string; revision: number; stage?: string; area?: number; windowTicks?: number; offset?: number }
export interface ProductionStageStatus {
  id: string; planId: string; revision: number; stage: string; recipe: string; machine: string | null;
  task: string | null; taskRevision: number | null; progress: ProductionStageProgress | null;
  planned: { product: string; kind: 'production' | 'consumption'; rate: Exact }[];
  nominalCraftsPerSecond: Exact | null; scope: { id: string; revision: number } | null;
  tick: number | null; metrics: import('./operational.js').OperationalMetric[]; symptoms?: import('./operational.js').MachineSymptom[];
  health: 'healthy' | 'shortfall' | 'unknown';
  exceptions: { kind: 'measured-shortfall' | 'capacity-constraint' | 'measured-symptom' | 'unknown'; product?: string; detail: string; evidence: string[] }[];
  hypotheses: string[]; stale: boolean; scenarioVerdict: 'not-evaluated'; omitted: number;
}
export interface ProductionStatusPage { id: string; revision: number; stages: ProductionStageStatus[]; next: number | null; omitted: number; scenarioVerdict: 'not-evaluated' }
