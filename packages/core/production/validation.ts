import type { MachineFact, ProductionAvailability, ProductionCatalog, RecipeFlow, SurfaceCondition } from '@autofactorio/contracts';

const fail = () => { throw new Error('Malformed production facts'); };
const identifier = (v: unknown) => typeof v === 'string' && /^[\w.-]{1,100}$/.test(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonnegative = (v: unknown) => finite(v) && v >= 0;
const strings = (v: unknown) => Array.isArray(v) && v.every(identifier);
function optionalNumbers(v: object, keys: string[]) {
  for (const key of keys) if (key in v && !finite((v as Record<string, unknown>)[key])) fail();
}
function conditions(values: SurfaceCondition[]) {
  for (const c of values) {
    if (!identifier(c.property)) fail();
    optionalNumbers(c, ['min', 'max']);
    if (c.min !== undefined && c.max !== undefined && c.min > c.max) fail();
  }
}
function flow(value: RecipeFlow, products: Set<string>, output: boolean) {
  if (!['item', 'fluid'].includes(value.type) || !identifier(value.name) || !products.has(`${value.type}:${value.name}`)) fail();
  optionalNumbers(value, ['amount', 'amount_min', 'amount_max', 'probability', 'temperature', 'minimum_temperature', 'maximum_temperature', 'fluidbox_index', 'ignored_by_productivity', 'ignored_by_stats', 'fluidbox_multiplier', 'extra_count_fraction', 'percent_spoiled']);
  if (value.amount === undefined ? value.amount_min === undefined || value.amount_max === undefined || value.amount_min < 0 || value.amount_max < value.amount_min : value.amount < 0) fail();
  if (!output && !(value.amount! > 0)) fail();
  for (const p of [value.probability, value.extra_count_fraction, value.percent_spoiled]) if (p !== undefined && (p < 0 || p > 1)) fail();
  for (const n of [value.fluidbox_index, value.fluidbox_multiplier]) if (n !== undefined && (!Number.isSafeInteger(n) || n < 1)) fail();
}
function machine(m: MachineFact) {
  if (!strings(m.categories) || !m.categories.length || !strings(m.placementItems) || !finite(m.speed) || m.speed <= 0 || !Number.isSafeInteger(m.ingredientLimit) || m.ingredientLimit < 0) fail();
  if (!Array.isArray(m.collisionBox) || m.collisionBox.length !== 2 || m.collisionBox.some(p => !finite(p.x) || !finite(p.y)) || m.collisionBox[0].x > m.collisionBox[1].x || m.collisionBox[0].y > m.collisionBox[1].y) fail();
  if (!['electric', 'burner', 'unsupported'].includes(m.energy.kind) || !nonnegative(m.energy.maxJoulesPerTick)) fail();
  optionalNumbers(m.energy, ['drainJoulesPerTick', 'effectivity']);
  if (m.energy.drainJoulesPerTick !== undefined && m.energy.drainJoulesPerTick < 0) fail();
  if (m.energy.effectivity !== undefined && m.energy.effectivity <= 0) fail();
  if (m.energy.fuelCategories !== undefined && !strings(m.energy.fuelCategories)) fail();
  if (Object.values(m.baseEffects).some(v => !finite(v))) fail();
  conditions(m.surfaceConditions);
  const indices = new Set<number>();
  for (const b of m.fluidBoxes) {
    if (!Number.isSafeInteger(b.index) || b.index < 1 || indices.has(b.index) || !['input', 'output', 'input-output', 'none'].includes(b.productionType) || !finite(b.volume) || b.volume <= 0) fail();
    indices.add(b.index); optionalNumbers(b, ['minimumTemperature', 'maximumTemperature']);
    if (b.filter !== undefined && !identifier(b.filter)) fail();
    for (const c of b.connections) {
      if (typeof c.connection_type !== 'string' || typeof c.flow_direction !== 'string' || !Number.isSafeInteger(c.direction) || c.direction < 0 || c.direction > 15 || !strings(c.connection_category) || !Array.isArray(c.positions) || c.positions.length !== 4 || c.positions.some(p => !finite(p.x) || !finite(p.y))) fail();
      optionalNumbers(c, ['max_underground_distance', 'linked_connection_id']);
    }
  }
}

/** Validate normalized public exports before caching or using them for compatibility. */
export function validateCatalog(c: Omit<ProductionCatalog, 'fingerprint'>): void {
  for (const [kind, entries] of [['product', c.products], ['recipe', c.recipes], ['machine', c.machines]] as const) {
    const ids = new Set<string>();
    for (const entry of entries) {
      if (!identifier(entry.name) || typeof entry.id !== 'string' || ids.has(entry.id)) fail();
      const prefix = kind === 'product' ? (entry as ProductionCatalog['products'][number]).kind : kind;
      if (entry.id !== `${prefix}:${entry.name}`) fail();
      ids.add(entry.id);
    }
  }
  const products = new Set(c.products.map(p => p.id));
  for (const p of c.products) {
    if (!['item', 'fluid'].includes(p.kind)) fail();
    optionalNumbers(p, ['fuelValue', 'defaultTemperature', 'maximumTemperature']);
    if (p.fuelValue !== undefined && p.fuelValue < 0) fail();
    if (p.spoilage !== undefined && typeof p.spoilage !== 'boolean') fail();
    if ([p.fuelCategory, p.burntResult].some(v => v !== undefined && !identifier(v))) fail();
  }
  for (const r of c.recipes) {
    if (!identifier(r.category) || !finite(r.seconds) || r.seconds <= 0 || !strings(r.unlocks)) fail();
    conditions(r.surfaceConditions);
    for (const f of r.ingredients) flow(f, products, false);
    for (const f of r.products) flow(f, products, true);
  }
  for (const m of c.machines) machine(m);
}
export function validateAvailability(a: ProductionAvailability): void {
  if (!Number.isSafeInteger(a.tick) || a.tick < 0 || !identifier(a.force) || !strings(a.researched) || !a.surfaceProperties || typeof a.surfaceProperties !== 'object' || Array.isArray(a.surfaceProperties) || Object.entries(a.surfaceProperties).some(([k, v]) => !identifier(k) || !finite(v))) fail();
}
