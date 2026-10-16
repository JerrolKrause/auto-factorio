import { createHash, randomBytes } from 'node:crypto';
import type { GameRequest, MachineFact, ProductionAvailability, ProductionCatalog, ProductionProfile, ProductionSearchInput, ProductionSearchResult, ProductFact, RecipeFact, RecipeFlow, SurfaceCondition } from '@autofactorio/contracts';
import { validateAvailability, validateCatalog } from './validation.js';

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const pick = <T>(value: unknown, keys: string[]): T => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Malformed production fact');
  return Object.fromEntries(Object.entries(value).filter(([key]) => keys.includes(key))) as T;
};
const flow = (v: unknown) => pick<RecipeFlow>(v, ['type', 'name', 'amount', 'amount_min', 'amount_max', 'probability', 'temperature', 'minimum_temperature', 'maximum_temperature', 'fluidbox_index', 'ignored_by_productivity', 'ignored_by_stats', 'fluidbox_multiplier', 'extra_count_fraction', 'percent_spoiled']);
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, canonical(value)])) : v;
const list = <T>(v: unknown): T[] => {
  // Factorio encodes empty Lua arrays as {}. Accept that case, never arbitrary objects.
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === 'object' && Object.keys(v).length === 0) return [];
  throw new Error('Malformed production array');
};
const aliases: Record<string, string[]> = { 'blue circuits': ['item:processing-unit'], 'blue circuit': ['item:processing-unit'], 'yellow science': ['item:utility-science-pack'], 'petroleum gas': ['fluid:petroleum-gas'], 'circuits': ['item:electronic-circuit', 'item:advanced-circuit', 'item:processing-unit'] };
export interface FactAccess { key: string; authorize: () => void; query: (request: Extract<GameRequest, { op: 'production-facts' }>) => Promise<Record<string, unknown>> }
export interface FactLimits { rows: number; catalogBytes: number; responseBytes: number; pageProducts: number; cursorMs: number; cursors: number; pages: number }
export const DEFAULT_FACT_LIMITS: FactLimits = { rows: 20000, catalogBytes: 8_000_000, responseBytes: 24_000, pageProducts: 4, cursorMs: 60_000, cursors: 100, pages: 1000 };

function surfaceBlockers(conditions: SurfaceCondition[], properties: Record<string, number>) {
  return conditions.flatMap(c => properties[c.property] === undefined ? [`unknown_surface_property:${c.property}`] : (c.min !== undefined && properties[c.property]! < c.min) || (c.max !== undefined && properties[c.property]! > c.max) ? [`surface_condition:${c.property}`] : []);
}
function fluidFits(flow: RecipeFlow, box: MachineFact['fluidBoxes'][number], output: boolean) {
  // Multi-box ingredients need an explicit port allocation model; retain their facts
  // but do not claim ordinary one-box compatibility in the supported v1 envelope.
  if (flow.fluidbox_multiplier !== undefined && flow.fluidbox_multiplier !== 1) return false;
  if (box.productionType !== 'input-output' && box.productionType !== (output ? 'output' : 'input')) return false;
  if (box.filter && box.filter !== flow.name) return false;
  if (flow.fluidbox_index !== undefined && box.index !== flow.fluidbox_index) return false;
  const lo = flow.temperature ?? flow.minimum_temperature ?? -Infinity, hi = flow.temperature ?? flow.maximum_temperature ?? Infinity;
  return Math.max(lo, box.minimumTemperature ?? -Infinity) <= Math.min(hi, box.maximumTemperature ?? Infinity) && box.connections.length > 0;
}
/** Bipartite matching prevents two required fluids from silently sharing one machine port. */
export function compatibleMachine(recipe: RecipeFact, machine: MachineFact): boolean {
  if (!machine.categories.includes(recipe.category) || recipe.ingredients.length > machine.ingredientLimit) return false;
  const flows = [...recipe.ingredients.filter(f => f.type === 'fluid').map(flow => ({ flow, output: false })), ...recipe.products.filter(f => f.type === 'fluid').map(flow => ({ flow, output: true }))];
  const assigned = new Map<number, number>();
  const match = (i: number, seen: Set<number>): boolean => machine.fluidBoxes.some((box, b) => {
    if (seen.has(b) || !fluidFits(flows[i]!.flow, box, flows[i]!.output)) return false;
    seen.add(b); const previous = assigned.get(b);
    if (previous !== undefined && !match(previous, seen)) return false;
    assigned.set(b, i); return true;
  });
  return flows.every((_, i) => match(i, new Set()));
}

/** Host-side installed facts; mutable availability is freshly read and separately fingerprinted. */
export class ProductionFacts {
  private catalog: ProductionCatalog | null = null;
  private contentIdentity: string | null = null;
  private reverse = new Map<string, RecipeFact[]>();
  private cursors = new Map<string, { key: string; query: string; profile: string; fingerprint: string; availability: string; offset: number; expires: number; page: number }>();
  constructor(readonly limits: FactLimits = DEFAULT_FACT_LIMITS, private now = Date.now) {
    if (Object.values(limits).some(v => !Number.isSafeInteger(v) || v <= 0) || limits.responseBytes < 512) throw new Error('Invalid production limits');
  }
  private async read(access: FactAccess, section: 'products' | 'recipes' | 'machines' | 'availability') {
    const rows: unknown[] = []; let mods: Record<string, string> | null = null; let last: Record<string, unknown> = {}; let total = -1;
    for (let offset = 0, pages = 0; ; pages++) {
      if (pages >= this.limits.pages) throw new Error('Production export page limit');
      access.authorize(); const r = await access.query({ op: 'production-facts', section, offset, limit: 50 }); access.authorize();
      const currentMods = r.mods as Record<string, string>;
      if (r.ok !== true || r.schema !== 1 || r.section !== section || !currentMods || typeof currentMods !== 'object' || Array.isArray(currentMods) || !currentMods.base || Object.values(currentMods).some(v => typeof v !== 'string' || !v) || !Number.isSafeInteger(r.tick) || !Number.isSafeInteger(r.total) || Number(r.total) > this.limits.rows || Number(r.total) < 0) throw new Error('Malformed production export');
      if (mods && (hash(canonical(mods)) !== hash(canonical(currentMods)) || last.contentIdentity !== r.contentIdentity || (section === 'availability' && last.availabilityIdentity !== r.availabilityIdentity))) throw new Error('Game facts or availability changed during export');
      if (total !== -1 && total !== r.total) throw new Error('Production catalog changed during export');
      total = Number(r.total); mods = currentMods;
      const page = list<unknown>(r.items); if (page.length > 50 || rows.length + page.length > total || (!page.length && rows.length < total)) throw new Error('Malformed production page');
      rows.push(...page); last = r;
      if (Buffer.byteLength(JSON.stringify(rows)) > this.limits.catalogBytes) throw new Error('Production catalog byte limit');
      if (rows.length === total) { if (r.next !== undefined && r.next !== null) throw new Error('Malformed production continuation'); break; }
      if (r.next !== offset + page.length) throw new Error('Malformed production continuation');
      offset = Number(r.next);
    }
    return { rows, mods: mods!, last };
  }
  async snapshot(access: FactAccess): Promise<{ catalog: ProductionCatalog; availability: ProductionAvailability; availabilityRevision: string }> {
    const current = await this.read(access, 'availability');
    const contentIdentity = typeof current.last.contentIdentity === 'string' ? current.last.contentIdentity : null;
    if (!this.catalog || contentIdentity === null || this.contentIdentity !== contentIdentity || hash(canonical(this.catalog.mods)) !== hash(canonical(current.mods))) {
      const products = await this.read(access, 'products'), recipes = await this.read(access, 'recipes'), machines = await this.read(access, 'machines');
      if ([products, recipes, machines].some(p => hash(canonical(p.mods)) !== hash(canonical(current.mods)) || p.last.contentIdentity !== current.last.contentIdentity)) throw new Error('Game facts changed during export');
      const pp = products.rows.map(p => pick<ProductFact>(p, ['id', 'kind', 'name', 'fuelValue', 'fuelCategory', 'burntResult', 'spoilage', 'defaultTemperature', 'maximumTemperature']));
      const rr = recipes.rows.map(value => {
        const r = pick<RecipeFact>(value, ['id', 'name', 'category', 'seconds', 'ingredients', 'products', 'unlocks', 'surfaceConditions']);
        return { ...r, ingredients: list(r.ingredients).map(flow), products: list(r.products).map(flow), unlocks: list<string>(r.unlocks), surfaceConditions: list(r.surfaceConditions).map(c => pick<SurfaceCondition>(c, ['property', 'min', 'max'])) };
      });
      const mm = machines.rows.map(value => {
        const m = pick<MachineFact>(value, ['id', 'name', 'type', 'categories', 'speed', 'ingredientLimit', 'collisionBox', 'fluidBoxes', 'placementItems', 'energy', 'baseEffects', 'surfaceConditions']);
        return { ...m, categories: list<string>(m.categories), placementItems: list<string>(m.placementItems), surfaceConditions: list(m.surfaceConditions).map(c => pick<SurfaceCondition>(c, ['property', 'min', 'max'])),
          collisionBox: list(m.collisionBox).map(p => pick(p, ['x', 'y'])) as MachineFact['collisionBox'],
          baseEffects: pick(m.baseEffects, ['speed', 'productivity', 'consumption', 'pollution', 'quality']) as Record<string, number>,
          fluidBoxes: list(m.fluidBoxes).map(value => {
            const b = pick<MachineFact['fluidBoxes'][number]>(value, ['index', 'productionType', 'filter', 'minimumTemperature', 'maximumTemperature', 'volume', 'connections']);
            return { ...b, connections: list(b.connections).map(value => {
              const c = pick<MachineFact['fluidBoxes'][number]['connections'][number]>(value, ['connection_type', 'direction', 'flow_direction', 'positions', 'connection_category', 'max_underground_distance', 'linked_connection_id']);
              return { ...c, positions: list(c.positions).map(p => pick(p, ['x', 'y'])) as typeof c.positions, connection_category: list<string>(c.connection_category) };
            }) };
          }), energy: { ...pick<MachineFact['energy']>(m.energy, ['kind', 'maxJoulesPerTick', 'drainJoulesPerTick', 'effectivity', 'fuelCategories']), ...(m.energy.fuelCategories ? { fuelCategories: list<string>(m.energy.fuelCategories) } : {}) } };
      });
      for (const entries of [pp, rr, mm]) if (new Set(entries.map(v => v.id)).size !== entries.length || entries.some(v => typeof v.id !== 'string' || typeof v.name !== 'string')) throw new Error('Malformed production identities');
      const facts = { schema: 1 as const, mods: current.mods, products: pp, recipes: rr, machines: mm };
      validateCatalog(facts);
      const fingerprint = hash(canonical(facts));
      this.catalog = { ...facts, fingerprint }; this.contentIdentity = contentIdentity; this.reverse.clear();
      for (const r of rr) for (const p of r.products) { const id = `${p.type}:${p.name}`; const producers = this.reverse.get(id) ?? []; if (!producers.includes(r)) producers.push(r); this.reverse.set(id, producers); }
    }
    const recipes: ProductionAvailability['recipes'] = Object.create(null) as ProductionAvailability['recipes'];
    for (const raw of current.rows) {
      const r = raw as { name: string; enabled: boolean; productivity: number };
      if (typeof r.name !== 'string' || typeof r.enabled !== 'boolean' || !Number.isFinite(r.productivity) || recipes[r.name]) throw new Error('Malformed production availability');
      recipes[r.name] = { enabled: r.enabled, productivity: r.productivity };
    }
    const availability: ProductionAvailability = { tick: Number(current.last.tick), force: current.last.force as string, recipes, researched: list<string>(current.last.researched), surfaceProperties: current.last.surfaceProperties as Record<string, number> };
    validateAvailability(availability);
    // Game ticks do not invalidate cursors; changed research, recipes, bonuses and surfaces do.
    const availabilityRevision = hash(canonical({ force: availability.force, recipes, researched: availability.researched, surfaceProperties: availability.surfaceProperties }));
    access.authorize(); return { catalog: structuredClone(this.catalog!), availability, availabilityRevision };
  }
  async search(access: FactAccess, input: ProductionSearchInput): Promise<ProductionSearchResult> {
    if (input.machine !== undefined && !/^machine:[\w.-]{1,100}$/.test(input.machine)) throw new Error('Invalid production machine selector');
    if (typeof input.query !== 'string' || input.query.length > 100 || (input.cursor !== undefined && (typeof input.cursor !== 'string' || input.cursor.length > 64)) || (input.recipe !== undefined && !/^recipe:[\w.-]{1,100}$/.test(input.recipe)) || (input.product !== undefined && !/^(item|fluid):[\w.-]{1,100}$/.test(input.product))) throw new Error('Invalid production search');
    if (input.profile !== undefined) this.validateProfile(input.profile);
    const query = input.query.trim().toLowerCase(); const profile = hash(canonical(input.profile ?? null));
    const { catalog, availability, availabilityRevision } = await this.snapshot(access);
    const facts = { schema: 1 as const, id: `production.${catalog.fingerprint}`, fingerprint: catalog.fingerprint, availabilityRevision };
    const envelope = { schema: 1 as const, facts, availability: { tick: availability.tick, revision: availabilityRevision, force: availability.force } };
    let start = 0, page = 0;
    const queryKey = JSON.stringify([query, input.product ?? null, input.recipe ?? null, input.machine ?? null]);
    if (input.cursor) {
      const c = this.cursors.get(input.cursor);
      if (!c || c.key !== access.key || c.expires <= this.now() || c.query !== queryKey || c.profile !== profile || c.fingerprint !== catalog.fingerprint || c.availability !== availabilityRevision || c.page >= this.limits.pages) {
        access.authorize(); return { ...envelope, items: [], ambiguous: false, omitted: 0, next: null, status: 'expired' };
      }
      start = c.offset; page = c.page;
    }
    const targets = Object.hasOwn(aliases, query) ? aliases[query] : undefined;
    const matches = catalog.products.filter(p => input.product ? p.id === input.product : targets ? targets.includes(p.id) : `${p.name} ${p.kind}`.replaceAll('-', ' ').includes(query.replaceAll('-', ' '))).sort((a, b) => a.id.localeCompare(b.id));
    // Page producer records, not entire product families: recycling can give one product
    // dozens of producers. Repeated product identity explicitly associates each route.
    const rows = matches.flatMap<{ product: ProductFact; recipe: RecipeFact | null }>(product => {
      const routes = (this.reverse.get(product.id) ?? []).filter(r => !input.recipe || r.id === input.recipe).sort((a, b) => Number(a.category.includes('recycling')) - Number(b.category.includes('recycling')) || a.id.localeCompare(b.id));
      return routes.length ? routes.map(recipe => ({ product, recipe })) : [{ product, recipe: null }];
    });
    const result: ProductionSearchResult = { ...envelope, items: [], ambiguous: matches.length > 1, omitted: rows.length - start, next: null, status: 'complete' };
    let end = start;
    for (const row of rows.slice(start, start + this.limits.pageProducts)) {
      const product = row.product;
      const producers = (row.recipe ? [row.recipe] : []).map(recipe => {
        const blockers = [...surfaceBlockers(recipe.surfaceConditions, availability.surfaceProperties)];
        if (recipe.ingredients.some(f => f.fluidbox_multiplier !== undefined && f.fluidbox_multiplier !== 1)) blockers.push('unsupported_fluidbox_multiplier');
        if (!availability.recipes[recipe.name]?.enabled) blockers.push(`research_locked:${recipe.unlocks.join(',') || recipe.name}`);
        if (input.profile?.recipes && !input.profile.recipes.includes(recipe.name)) blockers.push('profile_recipe_denied');
        const machines = catalog.machines.filter(m => (!input.machine || m.id === input.machine) && compatibleMachine(recipe, m)).map(fact => ({ fact, blockers: [...surfaceBlockers(fact.surfaceConditions, availability.surfaceProperties), ...(input.profile?.equipment && !fact.placementItems.some(i => input.profile!.equipment!.includes(i)) ? ['profile_machine_denied'] : [])] }));
        if (!machines.length) blockers.push('no_compatible_machine');
        return { recipe, blockers, machines };
      });
      const item = { product: { kind: product.kind, name: product.name, quality: 'normal' as const, surface: 'nauvis' }, producers };
      // Never trim recipe/machine fields and pretend detail is complete.
      if (Buffer.byteLength(JSON.stringify({ ...result, items: [...result.items, item] })) + 256 > this.limits.responseBytes) break;
      result.items.push(item); end++;
    }
    result.omitted = rows.length - end;
    if (result.omitted) {
      result.status = 'partial';
      if (end > start) {
        for (const [id, c] of this.cursors) if (c.expires <= this.now()) this.cursors.delete(id);
        while (this.cursors.size >= this.limits.cursors) this.cursors.delete(this.cursors.keys().next().value!);
        const id = randomBytes(24).toString('hex'); this.cursors.set(id, { key: access.key, query: queryKey, profile, fingerprint: catalog.fingerprint, availability: availabilityRevision, offset: end, expires: this.now() + this.limits.cursorMs, page: page + 1 }); result.next = id;
      }
    }
    access.authorize(); return result;
  }
  private validateProfile(p: ProductionProfile) {
    if (!p || typeof p.id !== 'string' || !Number.isSafeInteger(p.revision) || p.revision < 1 || typeof p.fingerprint !== 'string' || [p.recipes, p.equipment].some(v => v !== null && (!Array.isArray(v) || v.length > 2000 || v.some(n => typeof n !== 'string' || n.length > 100)))) throw new Error('Invalid production profile');
  }
}
