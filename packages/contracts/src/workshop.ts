import type { Position } from './game.js';

export const WORKSHOP_SCHEMA = 1 as const;
export type WorkshopRole = 'designer' | 'scorer' | 'learnings';
export type ProductKind = 'item' | 'fluid';
export interface ProductIdentity { kind: ProductKind; name: string; quality: 'normal'; surface: string; temperature?: number }
export interface Rational { numerator: string; denominator: string }
export interface ModelSelection { provider: string; modelId: string; reasoningEffort: string }
export interface WorkshopModelOptions { sessionDefault: ModelSelection; overrides: Partial<Record<WorkshopRole, ModelSelection>> }
export interface WorkshopPort {
  id: string; direction: 'input' | 'output' | 'utility' | 'byproduct'; product: ProductIdentity;
  position: Position; facing: number; transport: 'belt' | 'pipe' | 'chest' | 'power'; lane?: 1 | 2;
  rate: Rational; unit: 'units-per-game-second'; required: boolean;
}
export interface ThroughputRule {
  portId: string; windowTicks: number; windows: number; quantum: Rational;
  productionError: Rational; deliveryError: Rational; maxStockDrawdown: Rational; maxResidual: Rational;
  interval: '(startTick,endTick]';
}
export interface WorkshopBudgets { wallMs: number; gameTicks: number; turns: number; toolCalls: number; reportedTokens: number | null; learningReservedTurns: number; learningReservedTools: number }
export interface WorkshopCheckpoints { brief: boolean; afterScore: boolean; libraryAdmission: boolean; learningActivation: boolean; timeoutMs: number; timeoutAction: 'finish' | 'continue' }
export interface WorkshopLearningPolicy { cadence:'off'|'after-session'|'batch'; batchSessions:number; candidateCap:number; attemptsPerCandidate:number; autoActivate:boolean }
export interface IterationPolicy { attempts: number; mode: 'maximum' | 'exact'; earlyStop: boolean; plateauRounds: number }
export interface WorkshopAssignment {
  schema: typeof WORKSHOP_SCHEMA; id: string; revision: number; comparisonSeries: string; objective: string;
  source: { kind: 'brief' | 'preset' | 'revision'; id: string | null; numericTargetText?: string };
  ports: WorkshopPort[]; profileId: string; profileRevision: number; gameFingerprint: string;
  footprint: { width: number; height: number; clearance: number; maxTiles: number };
  construction: 'direct' | 'character'; libraryAccess: boolean; improveRevision: string | null;
  requestedSpeed: Rational; settlingTicks: number; throughput: ThroughputRule[];
  rubric: { version: string; weights: Record<string, Rational>; materiality: Record<string, Rational>; directions: Record<string, 'maximize'|'minimize'> };
  iterations: IterationPolicy; checkpoints: WorkshopCheckpoints; budgets: WorkshopBudgets; models: WorkshopModelOptions; learning: WorkshopLearningPolicy;
}
export interface WorkshopInvocationProvenance {
  role: WorkshopRole | 'private-comparison' | 'learning-review'; session: string; selection: ModelSelection;
  reportedModel: string | null; reportedEffort: string | null; contextLineage: string[]; libraryBlind: boolean;
  iteration: number | null; contextScope: 'designer-private'|'library-blind-score'|'private-comparison'|'learning-review'; modelConcreteId: string | null;
}
export interface WorkshopCandidateRef { sessionId: string; iteration: number; artifactHash: string; assignmentRevision: number; bundleHash: string; evidence: string[] }
export interface BlueprintEntity {
  id: string; entityNumber: number; name: string; position: Position; direction: number; quality: 'normal';
  recipe?: string; modules?: Record<string,number>; filters?: { index:number; name:string; quality:'normal' }[];
  inventoryBar?: number; settings?: Record<string,string|number|boolean>;
  /** Validated as input/output by blueprint normalization. */
  undergroundType?: string;
}
export interface BlueprintWire { from: { entityId:string; connector:string }; to: { entityId:string; connector:string }; color: 'copper'|'red'|'green' }
export interface BlueprintDocument {
  schema: typeof WORKSHOP_SCHEMA; label: string; description: string; entities: BlueprintEntity[]; wires: BlueprintWire[];
  ports: WorkshopPort[]; icons: { index:number; name:string }[]; tiles: { name:string; position:Position }[];
}
export interface BlueprintRevisionMetadata {
  schema: typeof WORKSHOP_SCHEMA; familyId: string; variantId: string; revisionHash: string; parentHash: string|null;
  label: string; product: ProductIdentity; profileId: string; gameFingerprint: string; statuses: ('draft'|'export-valid'|'production-verified'|'character-build-verified')[];
  footprint: { width:number; height:number }; machines:string[]; rate:Rational; provenance:string[]; evidence:string[];
}
export interface WorkshopScore {
  schema: typeof WORKSHOP_SCHEMA; candidate: WorkshopCandidateRef; rubricVersion: string; eligible: boolean;
  dimensions: Record<string, { value: number | null; unit: string; evidence: string[]; judgment: 'measured' | 'derived' | 'subjective' | 'unknown' }>;
  feedback: string; interactionFeedback: string; invalidReasons: string[];
}
export interface WorkshopPortMeasurement {
  portId:string; product:ProductIdentity; production:Rational; delivery:Rational; openingStock:Rational; closingStock:Rational; residual:Rational;
  productionAllocationId:string; coverage:'complete'|'partial'|'unknown'; evidence:string[];
}
export interface WorkshopWindowMeasurement {
  schema:typeof WORKSHOP_SCHEMA; attemptId:string; index:number; startTick:number; endTick:number; interval:'(startTick,endTick]';
  ports:WorkshopPortMeasurement[]; stageCoverage:'complete'|'partial'|'unknown'; energyCoverage:'complete'|'partial'|'unknown';
  contamination:string[]; mutationsFrozen:boolean; connected:boolean; evidence:string[];
}
export interface WorkshopEvaluationReport {
  schema:typeof WORKSHOP_SCHEMA; attemptId:string; valid:boolean; passed:boolean; reasons:string[];
  ports:{portId:string;windows:{index:number;required:Rational;productionLower:Rational;deliveryLower:Rational;passed:boolean;reasons:string[]}[]}[];
  evidence:string[];
}
export interface LearningOutcome {
  schema: typeof WORKSHOP_SCHEMA; id: string; decision: 'accept' | 'refine' | 'merge' | 'reject' | 'defer' | 'no-change';
  scope: 'designer-instructions' | 'scorer-instructions' | 'lesson' | 'design-helper'; evidence: string[];
  candidateHash: string | null; incumbentHash: string; expectedGeneration: number; bundleHash: string | null;
  activatedGeneration: number | null; reason: string; revisitCondition: string | null;
}

const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
};
const identifier = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^[\w.-]{1,160}$/.test(value)) throw new Error(`Invalid ${label}`);
  return value;
};
const text = (value: unknown, label: string, max = 16_384): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${label}`);
  return value;
};
const integer = (value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`Invalid ${label}`);
  return Number(value);
};
const exactKeys = (value: Record<string, unknown>, required: string[], optional: string[] = []): void => {
  if (required.some(k => !(k in value)) || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) throw new Error('Unexpected or missing workshop fields');
};
export function rational(value: unknown, label = 'rational'): Rational {
  const v = object(value, label); exactKeys(v, ['numerator', 'denominator']);
  if (typeof v.numerator !== 'string' || !/^-?\d+$/.test(v.numerator) || typeof v.denominator !== 'string' || !/^[1-9]\d*$/.test(v.denominator)) throw new Error(`Invalid ${label}`);
  const numerator = BigInt(v.numerator); const denominator = BigInt(v.denominator);
  if (numerator < 0n) throw new Error(`Negative ${label}`);
  return { numerator: numerator.toString(), denominator: denominator.toString() };
}
export function rationalFromDecimal(value: string, per: 'second' | 'minute' = 'second'): Rational {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid decimal rate');
  const [whole, fraction = ''] = value.split('.');
  let numerator = BigInt(whole! + fraction); let denominator = 10n ** BigInt(fraction.length);
  if (per === 'minute') denominator *= 60n;
  const gcd = (a: bigint, b: bigint): bigint => b === 0n ? a : gcd(b, a % b);
  const divisor = gcd(numerator, denominator); numerator /= divisor; denominator /= divisor;
  return { numerator: numerator.toString(), denominator: denominator.toString() };
}
export function compareRational(a: Rational, b: Rational): number {
  const left = BigInt(a.numerator) * BigInt(b.denominator); const right = BigInt(b.numerator) * BigInt(a.denominator);
  return left < right ? -1 : left > right ? 1 : 0;
}
export function resolveWorkshopModels(options: WorkshopModelOptions): Record<WorkshopRole, ModelSelection> {
  return { designer: structuredClone(options.overrides.designer ?? options.sessionDefault), scorer: structuredClone(options.overrides.scorer ?? options.sessionDefault), learnings: structuredClone(options.overrides.learnings ?? options.sessionDefault) };
}
function validateSelection(value: unknown, label: string): ModelSelection {
  const v = object(value, label); exactKeys(v, ['provider', 'modelId', 'reasoningEffort']);
  return { provider: identifier(v.provider, `${label} provider`), modelId: identifier(v.modelId, `${label} model`), reasoningEffort: identifier(v.reasoningEffort, `${label} effort`) };
}
function validateIdentity(value: unknown): ProductIdentity {
  const v = object(value, 'product identity'); exactKeys(v, ['kind', 'name', 'quality', 'surface'], ['temperature']);
  if (v.kind !== 'item' && v.kind !== 'fluid') throw new Error('Invalid product kind');
  if (v.quality !== 'normal') throw new Error('Only normal quality is supported');
  if (v.temperature !== undefined && (v.kind !== 'fluid' || typeof v.temperature !== 'number' || !Number.isFinite(v.temperature))) throw new Error('Invalid fluid temperature');
  return { kind: v.kind, name: identifier(v.name, 'product name'), quality: 'normal', surface: identifier(v.surface, 'product surface'), ...(v.temperature === undefined ? {} : { temperature: v.temperature as number }) };
}
export function validateWorkshopAssignment(value: unknown): WorkshopAssignment {
  const v = object(value, 'workshop assignment');
  exactKeys(v, ['schema','id','revision','comparisonSeries','objective','source','ports','profileId','profileRevision','gameFingerprint','footprint','construction','libraryAccess','improveRevision','requestedSpeed','settlingTicks','throughput','rubric','iterations','checkpoints','budgets','models'], ['learning']);
  if (v.schema !== WORKSHOP_SCHEMA) throw new Error('Unsupported workshop schema');
  const source = object(v.source, 'assignment source'); exactKeys(source, ['kind','id'], ['numericTargetText']);
  if (!['brief','preset','revision'].includes(String(source.kind)) || source.id !== null && typeof source.id !== 'string') throw new Error('Invalid assignment source');
  if (source.numericTargetText !== undefined && typeof source.numericTargetText !== 'string') throw new Error('Invalid numeric target text');
  if (!Array.isArray(v.ports) || v.ports.length < 2 || v.ports.length > 64) throw new Error('Invalid workshop ports');
  const ports = v.ports.map(raw => { const p = object(raw, 'workshop port'); exactKeys(p, ['id','direction','product','position','facing','transport','rate','unit','required'], ['lane']);
    if (!['input','output','utility','byproduct'].includes(String(p.direction)) || !['belt','pipe','chest','power'].includes(String(p.transport)) || p.unit !== 'units-per-game-second' || typeof p.required !== 'boolean') throw new Error('Invalid workshop port');
    const position = object(p.position, 'port position'); exactKeys(position, ['x','y']); if (![position.x, position.y].every(n => typeof n === 'number' && Number.isFinite(n))) throw new Error('Invalid port position');
    if (p.lane !== undefined && p.lane !== 1 && p.lane !== 2) throw new Error('Invalid port lane');
    return { id: identifier(p.id, 'port id'), direction: p.direction, product: validateIdentity(p.product), position: { x: Number(position.x), y: Number(position.y) }, facing: integer(p.facing, 'port facing', 0, 15), transport: p.transport, ...(p.lane === undefined ? {} : { lane: p.lane }), rate: rational(p.rate, 'port rate'), unit: p.unit, required: p.required } as WorkshopPort;
  });
  if (new Set(ports.map(p => p.id)).size !== ports.length || !ports.some(p => p.direction === 'output' && p.required)) throw new Error('Workshop requires unique ports and a required output');
  const footprint = object(v.footprint, 'footprint'); exactKeys(footprint, ['width','height','clearance','maxTiles']);
  const construction = v.construction; if (construction !== 'direct' && construction !== 'character') throw new Error('Invalid construction mode');
  if (typeof v.libraryAccess !== 'boolean' || v.improveRevision !== null && typeof v.improveRevision !== 'string' || v.improveRevision !== null && !v.libraryAccess) throw new Error('Improve requires library access');
  if (!Array.isArray(v.throughput) || v.throughput.length !== ports.filter(p => p.direction === 'output' && p.required).length) throw new Error('Every required output needs one throughput rule');
  const throughput = v.throughput.map(raw => { const t = object(raw, 'throughput rule'); exactKeys(t, ['portId','windowTicks','windows','quantum','productionError','deliveryError','maxStockDrawdown','maxResidual','interval']);
    if (t.interval !== '(startTick,endTick]') throw new Error('Unsupported window interval');
    const rule: ThroughputRule = { portId: identifier(t.portId, 'throughput port'), windowTicks: integer(t.windowTicks, 'window ticks', 1, 216000), windows: integer(t.windows, 'window count', 1, 100), quantum: rational(t.quantum, 'quantity quantum'), productionError: rational(t.productionError, 'production error'), deliveryError: rational(t.deliveryError, 'delivery error'), maxStockDrawdown: rational(t.maxStockDrawdown, 'stock drawdown'), maxResidual: rational(t.maxResidual, 'residual'), interval: t.interval };
    if (compareRational(rule.quantum, { numerator: '0', denominator: '1' }) <= 0) throw new Error('Quantity quantum must be positive'); return rule;
  });
  if (new Set(throughput.map(t => t.portId)).size !== throughput.length || throughput.some(t => !ports.some(p => p.id === t.portId && p.direction === 'output' && p.required))) throw new Error('Invalid throughput port coverage');
  if (throughput.some(t => t.windowTicks !== throughput[0]?.windowTicks || t.windows !== throughput[0]?.windows)) throw new Error('Workshop windows must be fixed across ports');
  const rubric = object(v.rubric, 'rubric'); exactKeys(rubric, ['version','weights','materiality'], ['directions']);
  const rationalMap = (raw: unknown, label: string) => Object.fromEntries(Object.entries(object(raw, label)).map(([key,val]) => [identifier(key, label), rational(val, `${label} ${key}`)]));
  const weights = rationalMap(rubric.weights, 'rubric weights');
  const materiality = rationalMap(rubric.materiality, 'rubric materiality');
  const defaultDirections:Record<string,'maximize'|'minimize'>={throughput:'maximize',expandability:'maximize',space:'minimize',clearance:'maximize',resourceEfficiency:'maximize',connectability:'maximize',constructionCost:'minimize',energy:'minimize',aesthetics:'maximize',interactionQuality:'minimize'};
  const suppliedDirections=rubric.directions===undefined?{}:object(rubric.directions,'rubric directions');
  if(Object.keys(weights).some(key=>!Object.hasOwn(materiality,key))||Object.keys(materiality).some(key=>!Object.hasOwn(weights,key)))throw new Error('Rubric weights and materiality must cover the same dimensions');
  if(Object.keys(suppliedDirections).some(key=>!Object.hasOwn(weights,key)||!['maximize','minimize'].includes(String(suppliedDirections[key]))))throw new Error('Invalid rubric direction');
  const directions=Object.fromEntries(Object.keys(weights).map(key=>{const direction=suppliedDirections[key]??defaultDirections[key];if(!direction)throw new Error(`Missing rubric direction: ${key}`);return[key,direction];})) as Record<string,'maximize'|'minimize'>;
  const iterations = object(v.iterations, 'iteration policy'); exactKeys(iterations, ['attempts','mode','earlyStop','plateauRounds']);
  if (!['maximum','exact'].includes(String(iterations.mode)) || typeof iterations.earlyStop !== 'boolean' || iterations.mode === 'exact' && iterations.earlyStop) throw new Error('Contradictory iteration policy');
  const checkpoints = object(v.checkpoints, 'checkpoints'); exactKeys(checkpoints, ['brief','afterScore','libraryAdmission','learningActivation','timeoutMs','timeoutAction']);
  if (['brief','afterScore','libraryAdmission','learningActivation'].some(k => typeof checkpoints[k] !== 'boolean') || !['finish','continue'].includes(String(checkpoints.timeoutAction))) throw new Error('Invalid checkpoint policy');
  const budgets = object(v.budgets, 'budgets'); exactKeys(budgets, ['wallMs','gameTicks','turns','toolCalls','reportedTokens','learningReservedTurns','learningReservedTools']);
  if (budgets.reportedTokens !== null) integer(budgets.reportedTokens, 'reported token budget', 1);
  const models = object(v.models, 'model options'); exactKeys(models, ['sessionDefault','overrides']); const overrides = object(models.overrides, 'model overrides');
  if (Object.keys(overrides).some(k => !['designer','scorer','learnings'].includes(k))) throw new Error('Invalid model override role');
  const learning = v.learning === undefined ? { cadence:'after-session', batchSessions:5, candidateCap:3, attemptsPerCandidate:2, autoActivate:true } : object(v.learning,'learning policy');
  if (v.learning !== undefined) exactKeys(learning,['cadence','batchSessions','candidateCap','attemptsPerCandidate','autoActivate']);
  if (!['off','after-session','batch'].includes(String(learning.cadence)) || typeof learning.autoActivate !== 'boolean') throw new Error('Invalid learning policy');
  const result: WorkshopAssignment = {
    schema: WORKSHOP_SCHEMA, id: identifier(v.id, 'assignment id'), revision: integer(v.revision, 'assignment revision', 1), comparisonSeries: identifier(v.comparisonSeries, 'comparison series'), objective: text(v.objective, 'objective'),
    source: { kind: source.kind as 'brief'|'preset'|'revision', id: source.id as string|null, ...(source.numericTargetText === undefined ? {} : { numericTargetText: source.numericTargetText }) }, ports,
    profileId: identifier(v.profileId, 'profile id'), profileRevision: integer(v.profileRevision, 'profile revision', 1), gameFingerprint: identifier(v.gameFingerprint, 'game fingerprint'),
    footprint: { width: integer(footprint.width, 'footprint width', 1, 4096), height: integer(footprint.height, 'footprint height', 1, 4096), clearance: integer(footprint.clearance, 'footprint clearance', 0, 256), maxTiles: integer(footprint.maxTiles, 'footprint cap', 1, 16_777_216) },
    construction, libraryAccess: v.libraryAccess, improveRevision: v.improveRevision as string|null, requestedSpeed: rational(v.requestedSpeed, 'requested speed'), settlingTicks: integer(v.settlingTicks, 'settling ticks', 0, 216000), throughput,
    rubric: { version: identifier(rubric.version, 'rubric version'), weights, materiality, directions },
    iterations: { attempts: integer(iterations.attempts, 'attempts', 1, 100), mode: iterations.mode as 'maximum'|'exact', earlyStop: iterations.earlyStop, plateauRounds: integer(iterations.plateauRounds, 'plateau rounds', 1, 20) },
    checkpoints: { brief: checkpoints.brief as boolean, afterScore: checkpoints.afterScore as boolean, libraryAdmission: checkpoints.libraryAdmission as boolean, learningActivation: checkpoints.learningActivation as boolean, timeoutMs: integer(checkpoints.timeoutMs, 'checkpoint timeout', 1, 86_400_000), timeoutAction: checkpoints.timeoutAction as 'finish'|'continue' },
    budgets: { wallMs: integer(budgets.wallMs, 'wall budget', 1), gameTicks: integer(budgets.gameTicks, 'game budget', 1), turns: integer(budgets.turns, 'turn budget', 1), toolCalls: integer(budgets.toolCalls, 'tool budget', 1), reportedTokens: budgets.reportedTokens as number|null, learningReservedTurns: integer(budgets.learningReservedTurns, 'learning turn reserve', 0), learningReservedTools: integer(budgets.learningReservedTools, 'learning tool reserve', 0) },
    models: { sessionDefault: validateSelection(models.sessionDefault, 'session model'), overrides: Object.fromEntries(Object.entries(overrides).map(([role, selection]) => [role, validateSelection(selection, `${role} model`)])) },
    learning: { cadence: learning.cadence as WorkshopLearningPolicy['cadence'], batchSessions: integer(learning.batchSessions,'learning batch sessions',1,1000), candidateCap:integer(learning.candidateCap,'learning candidate cap',1,100), attemptsPerCandidate:integer(learning.attemptsPerCandidate,'learning attempt cap',1,20), autoActivate:learning.autoActivate as boolean },
  };
  if (result.budgets.learningReservedTurns > result.budgets.turns || result.budgets.learningReservedTools > result.budgets.toolCalls) throw new Error('Learning reserve exceeds aggregate budget');
  if (source.numericTargetText !== undefined) {
    const match = /^\s*(\d+(?:\.\d+)?)\s*(?:\/|per\s+)(second|minute)\s*$/i.exec(source.numericTargetText as string);
    if (match) { const prose = rationalFromDecimal(match[1]!, match[2]!.toLowerCase() as 'second'|'minute'); const required = ports.find(p => p.direction === 'output' && p.required)!; if (compareRational(prose, required.rate) !== 0) throw new Error('Contradictory numeric target'); }
  }
  return result;
}
