import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProductionFacts, DEFAULT_FACT_LIMITS, compatibleMachine } from '../packages/core/production/facts.js';
import type { FactAccess, FactLimits } from '../packages/core/production/facts.js';
import type { GameRequest, MachineFact, ProductionProfile } from '@autofactorio/contracts';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import { Coordinator } from '../packages/core/orchestration/coordinator.js';
import { team } from '../packages/core/orchestration/roles.js';
import { CoordinationGateway } from '../packages/tools/src/coordination.js';
import { PROBE_CAPS } from '../packages/codex/src/budget.js';

const mods = { base: '2.0.77', space_age: '2.0.77' };
const product = (id: string, kind: 'item' | 'fluid', name: string) => ({ id, kind, name });
const recipe = (id: string, name: string, category: string, flow: { type: 'item' | 'fluid'; name: string; fluidbox_index?: number }[], unlocks: string[] = [], output = `item:${name.replace(/-recipe$/, '')}`) => ({
  id, name, category, seconds: 2, ingredients: flow.map(f => ({ ...f, amount: 1 })), products: [{ type: output.startsWith('fluid:') ? 'fluid' as const : 'item' as const, name: output.slice(output.indexOf(':') + 1), amount: 1 }], unlocks, surfaceConditions: [],
});
const connection = { connection_type: 'pipe', direction: 0, flow_direction: 'input', positions: [{ x: 0, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }], connection_category: ['default'] };
const machine = (id: string, categories: string[], fluidBoxes: MachineFact['fluidBoxes'] = []): MachineFact => ({
  id, name: id.slice(id.indexOf(':') + 1), type: 'assembling-machine', categories, speed: 1, ingredientLimit: 10,
  collisionBox: [{ x: -1, y: -1 }, { x: 1, y: 1 }], fluidBoxes, placementItems: [id.slice(id.indexOf(':') + 1)],
  energy: { kind: 'electric', maxJoulesPerTick: 1000 }, baseEffects: {}, surfaceConditions: [],
});
const catalog = {
  products: [
    product('item:processing-unit', 'item', 'processing-unit'), product('item:utility-science-pack', 'item', 'utility-science-pack'),
    product('fluid:petroleum-gas', 'fluid', 'petroleum-gas'), product('fluid:sulfuric-acid', 'fluid', 'sulfuric-acid'), product('fluid:crude-oil', 'fluid', 'crude-oil'), product('item:electronic-circuit', 'item', 'electronic-circuit'),
    product('item:advanced-circuit', 'item', 'advanced-circuit'),
  ],
  recipes: [
    recipe('recipe:processing-unit-recipe', 'processing-unit-recipe', 'crafting-with-fluid', [{ type: 'item', name: 'advanced-circuit' }, { type: 'fluid', name: 'sulfuric-acid', fluidbox_index: 2 }], ['advanced-electronics-2'], 'item:processing-unit'),
    recipe('recipe:utility-science-pack-recipe', 'utility-science-pack-recipe', 'crafting', [{ type: 'item', name: 'processing-unit' }], ['utility-science'], 'item:utility-science-pack'),
    recipe('recipe:advanced-oil-processing', 'advanced-oil-processing', 'oil-processing', [{ type: 'fluid', name: 'crude-oil', fluidbox_index: 1 }], [], 'fluid:petroleum-gas'),
    recipe('recipe:electronic-circuit-recipe', 'electronic-circuit-recipe', 'crafting', [], [], 'item:electronic-circuit'),
    recipe('recipe:advanced-circuit-recipe', 'advanced-circuit-recipe', 'crafting', [], [], 'item:advanced-circuit'),
  ],
  machines: [
    machine('machine:assembler', ['crafting'], []),
    machine('machine:chemical-plant', ['crafting-with-fluid', 'oil-processing'], [
      { index: 2, productionType: 'input', minimumTemperature: 15, maximumTemperature: 100, volume: 100, connections: [connection] },
      { index: 1, productionType: 'input', volume: 100, connections: [connection] },
      { index: 3, productionType: 'output', volume: 100, connections: [{ ...connection, flow_direction: 'output' }] },
    ]),
  ],
};
type Section = 'products' | 'recipes' | 'machines' | 'availability';
function source(options: { availability?: Record<string, unknown> | (() => Record<string, unknown>); mods?: Record<string, string>; rows?: Partial<Record<Section, unknown[]>> | (() => Partial<Record<Section, unknown[]>>); contentIdentity?: string | (() => string); availabilityIdentity?: string | (() => string); pageSize?: number } = {}) {
  let tick = 10;
  return async (request: Extract<GameRequest, { op: 'production-facts' }>): Promise<Record<string, unknown>> => {
    const section = request.section as Section;
    const configured = typeof options.availability === 'function' ? options.availability() : options.availability;
    const mutable = configured ?? { tick: tick++, force: 'player', researched: ['advanced-electronics-2'], surfaceProperties: { pressure: 1000 }, recipes: {
      'processing-unit-recipe': { enabled: true, productivity: 0 }, 'utility-science-pack-recipe': { enabled: false, productivity: 0 },
      'advanced-oil-processing': { enabled: true, productivity: 0 }, 'electronic-circuit-recipe': { enabled: true, productivity: 0 }, 'advanced-circuit-recipe': { enabled: true, productivity: 0 },
    } };
    const configuredRows = typeof options.rows === 'function' ? options.rows() : options.rows;
    const rows = configuredRows?.[section] ?? (section === 'availability' ? Object.entries(mutable.recipes as Record<string, unknown>).map(([name, value]) => ({ name, ...(value as object) })) : catalog[section]);
    const page = rows.slice(request.offset, request.offset + (options.pageSize ?? request.limit));
    return { ok: true, schema: 1, section, mods: options.mods ?? mods, tick: Number(mutable.tick ?? tick), total: rows.length, items: page,
      next: request.offset + page.length < rows.length ? request.offset + page.length : null,
      contentIdentity: typeof options.contentIdentity === 'function' ? options.contentIdentity() : options.contentIdentity ?? 'content-v1',
      ...(section === 'availability' ? { availabilityIdentity: typeof options.availabilityIdentity === 'function' ? options.availabilityIdentity() : options.availabilityIdentity ?? 'availability-v1', force: mutable.force, researched: mutable.researched, surfaceProperties: mutable.surfaceProperties } : {}) };
  };
}
function access(query: FactAccess['query'], key = 'agent') { return { key, authorize() {}, query }; }
const profile: ProductionProfile = { id: 'nauvis', revision: 1, fingerprint: 'profile-v1', recipes: ['processing-unit-recipe'], equipment: ['chemical-plant'] };
const runtimes: DurableRuntime[] = [];
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.close(); });

describe('installed production facts', () => {
  it('resolves user aliases to canonical product identities, preserving separate producer recipe identities', async () => {
    const facts = new ProductionFacts(); const query = source();
    const blue = await facts.search(access(query), { query: 'blue circuits' });
    const yellow = await facts.search(access(query), { query: 'yellow science' });
    const petroleum = await facts.search(access(query), { query: 'petroleum gas' });
    expect(blue.items[0]).toMatchObject({ product: { kind: 'item', name: 'processing-unit', quality: 'normal', surface: 'nauvis' }, producers: [{ recipe: { id: 'recipe:processing-unit-recipe', name: 'processing-unit-recipe' } }] });
    expect(yellow.items[0]?.producers[0]?.blockers).toContain('research_locked:utility-science');
    expect(petroleum.items[0]?.product).toMatchObject({ kind: 'fluid', name: 'petroleum-gas' });
    expect(blue.facts.fingerprint).toMatch(/^[a-f0-9]{64}$/); expect(blue.facts.schema).toBe(1);
  });

  it('keeps ambiguous aliases explicit and exposes effective categories, fluid ports, geometry, and profile blockers', async () => {
    const facts = new ProductionFacts(); const result = await facts.search(access(source()), { query: 'circuits', profile });
    expect(result.ambiguous).toBe(true);
    expect(result.items.map(i => i.product.name)).toEqual(['advanced-circuit', 'electronic-circuit', 'processing-unit']);
    const byProduct = await facts.search(access(source()), { query: '', product: 'item:processing-unit', profile: { ...profile, recipes: ['utility-science-pack-recipe'] } });
    const producer = byProduct.items[0]!.producers[0]!;
    expect(producer.recipe.category).toBe('crafting-with-fluid');
    expect(producer.machines.map(m => m.fact.id)).toEqual(['machine:chemical-plant']);
    expect(producer.machines[0]!.fact.collisionBox).toEqual([{ x: -1, y: -1 }, { x: 1, y: 1 }]);
    expect(producer.machines[0]!.fact.fluidBoxes[0]!.connections[0]!.positions).toEqual(connection.positions);
    expect(compatibleMachine({ ...producer.recipe, ingredients: producer.recipe.ingredients.map(flow => flow.type === 'fluid' ? { ...flow, minimum_temperature: 101 } : flow) }, producer.machines[0]!.fact)).toBe(false);
    expect(producer.blockers).toContain('profile_recipe_denied');
    expect(producer.machines[0]!.blockers).toEqual([]);
  });

  it('separates cached prototype fingerprints from refreshed force availability and refreshes on mod changes', async () => {
    const facts = new ProductionFacts(); const first = await facts.snapshot(access(source()));
    const locked = await facts.snapshot(access(source({ availability: { tick: 20, force: 'player', researched: [], surfaceProperties: { pressure: 1000 }, recipes: {
      'processing-unit-recipe': { enabled: false, productivity: 0.1 }, 'utility-science-pack-recipe': { enabled: false, productivity: 0 }, 'advanced-oil-processing': { enabled: true, productivity: 0 },
      'electronic-circuit-recipe': { enabled: true, productivity: 0 }, 'advanced-circuit-recipe': { enabled: true, productivity: 0 },
    } } })));
    expect(locked.catalog.fingerprint).toBe(first.catalog.fingerprint);
    expect(locked.availabilityRevision).not.toBe(first.availabilityRevision);
    const changedMod = await facts.snapshot(access(source({ mods: { ...mods, space_age: '2.0.78' } })));
    expect(changedMod.catalog.fingerprint).not.toBe(first.catalog.fingerprint);
    expect(changedMod.availabilityRevision).not.toBe(locked.availabilityRevision);
  });

  it('bounds page results, returns explicit expiry, and does not reuse cursors after availability changes', async () => {
    let now = 100; const limits: FactLimits = { ...DEFAULT_FACT_LIMITS, pageProducts: 1, cursorMs: 10 };
    const facts = new ProductionFacts(limits, () => now);
    const live = { tick: 10, force: 'player', researched: [], surfaceProperties: { pressure: 1000 }, recipes: { 'electronic-circuit-recipe': { enabled: true, productivity: 0 } } };
    const query = source({ availability: () => live });
    const first = await facts.search(access(query), { query: 'circuits' });
    expect(first).toMatchObject({ status: 'partial', omitted: 2, items: [{ product: { name: 'advanced-circuit' } }] });
    expect(first.next).toEqual(expect.any(String));
    live.tick = 11; live.recipes['electronic-circuit-recipe']!.productivity = 0.1;
    expect(await facts.search(access(query), { query: 'circuits', cursor: first.next! })).toMatchObject({ status: 'expired', items: [], next: null });
    const refreshed = await facts.search(access(query), { query: 'circuits' });
    const second = await facts.search(access(query), { query: 'circuits', cursor: refreshed.next! });
    expect(second.status).toBe('partial'); expect(second.items).toHaveLength(1);
    now += 11;
    expect(await facts.search(access(query), { query: 'circuits', cursor: second.next! })).toMatchObject({ status: 'expired', items: [], next: null });
  });

  it('rechecks authorization after an asynchronous export and the authenticated gateway withholds revoked results', async () => {
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    let authorized = true; const facts = new ProductionFacts();
    const query: FactAccess['query'] = async request => { await pending; return source()(request); };
    const accessWithRevocation: FactAccess = { key: 'revoked', authorize: () => { if (!authorized) throw new Error('revoked'); }, query };
    const direct = facts.search(accessWithRevocation, { query: 'blue circuits' }); authorized = false; release();
    await expect(direct).rejects.toThrow('revoked');

    const port = { command: async () => '{}', close() {} }; const game = new GameClient(port, () => {});
    const runtime = new DurableRuntime(mkdtempSync(path.join(os.tmpdir(), 'af-production-')), 'run', 'epoch', game, new Lifecycle(port, game, () => {})); runtimes.push(runtime);
    const caps = { ...PROBE_CAPS, tools: 100, turns: 10, runMs: 300000, turnMs: 300000 };
    const coordinator = new Coordinator(runtime, caps); team().forEach(a => coordinator.register(a));
    const gateway = new CoordinationGateway(coordinator); const turn = coordinator.budget.admit('engineer');
    const binding = coordinator.bind('engineer', 'session-' + turn.id, turn.id, async () => {}); const token = gateway.issue(binding);
    game.request = async request => {
      if ((request as { op?: string }).op !== 'production-facts') throw new Error('Unexpected query');
      return await source() (request as Extract<GameRequest, { op: 'production-facts' }>);
    };
    let releaseGateway!: () => void; const gatewayPending = new Promise<void>(resolve => { releaseGateway = resolve; });
    const prior = game.request.bind(game);
    game.request = async request => { await gatewayPending; return prior(request); };
    const response = gateway.call(token, 'production_search', { query: 'blue circuits' }) as Promise<unknown>;
    gateway.revoke(token); releaseGateway();
    await expect(response).rejects.toThrow('Unauthenticated identity');
  });

  it('excludes evaluator and private fields from search responses', async () => {
    const rows = { ...catalog, products: catalog.products.map((p, i) => i === 0 ? { ...p, referencePlan: 'private-evaluator-answer', faultSeed: 'secret' } : p) };
    const result = await new ProductionFacts().search(access(source({ rows })), { query: 'blue circuits' });
    const text = JSON.stringify(result);
    expect(text).not.toContain('private-evaluator-answer'); expect(text).not.toContain('faultSeed');
    expect(text).not.toContain('reference-plan'); expect(text).toContain('processing-unit');
  });

  it('preserves rich public flow mechanics and strips nested private fields', async () => {
    const rich = { ...catalog, recipes: catalog.recipes.map(r => r.name === 'processing-unit-recipe' ? {
      ...r, ingredients: [{ type: 'fluid', name: 'sulfuric-acid', amount: 1, probability: 1, fluidbox_multiplier: 2, extra_count_fraction: 0.25, percent_spoiled: 0.1,
        evaluatorNote: 'nested-private' }], products: [{ type: 'item', name: 'processing-unit', amount: 0, probability: 1, extra_count_fraction: 0.5, percent_spoiled: 0.2, referencePlan: 'nested-answer' }],
      privateFixture: 'recipe-private',
    } : r) };
    const result = await new ProductionFacts().search(access(source({ rows: rich })), { query: 'blue circuits' });
    const producer = result.items[0]!.producers[0]!;
    expect(producer.recipe.ingredients[0]).toMatchObject({ type: 'fluid', amount: 1, probability: 1, fluidbox_multiplier: 2, extra_count_fraction: 0.25, percent_spoiled: 0.1 });
    expect(producer.recipe.products[0]).toMatchObject({ amount: 0, probability: 1, extra_count_fraction: 0.5, percent_spoiled: 0.2 });
    const encoded = JSON.stringify(result);
    for (const secret of ['nested-private', 'nested-answer', 'recipe-private']) expect(encoded).not.toContain(secret);
  });

  it('pages every producer route for one product and applies exact recipe and machine selectors', async () => {
    const extra = recipe('recipe:processing-unit-byproduct', 'processing-unit-byproduct', 'crafting', [], [], 'item:processing-unit');
    const rows = { ...catalog, recipes: [...catalog.recipes, extra] };
    const facts = new ProductionFacts({ ...DEFAULT_FACT_LIMITS, pageProducts: 1 });
    const query = source({ rows }); const auth = access(query);
    const first = await facts.search(auth, { query: '', product: 'item:processing-unit' });
    expect(first).toMatchObject({ status: 'partial', omitted: 1 });
    expect(first.items[0]!.producers[0]!.recipe.id).toBe('recipe:processing-unit-byproduct');
    const second = await facts.search(auth, { query: '', product: 'item:processing-unit', cursor: first.next! });
    expect(second.items[0]!.product.name).toBe('processing-unit');
    expect(second.items[0]!.producers[0]!.recipe.id).toBe('recipe:processing-unit-recipe');
    const selectedRecipe = await facts.search(auth, { query: '', product: 'item:processing-unit', recipe: 'recipe:processing-unit-recipe' });
    expect(selectedRecipe.items).toHaveLength(1);
    expect(selectedRecipe.items[0]!.producers.map(p => p.recipe.id)).toEqual(['recipe:processing-unit-recipe']);
    const selectedMachine = await facts.search(auth, { query: '', product: 'item:processing-unit', recipe: 'recipe:processing-unit-recipe', machine: 'machine:chemical-plant' });
    expect(selectedMachine.items[0]!.producers[0]!.machines.map(m => m.fact.id)).toEqual(['machine:chemical-plant']);
    await expect(facts.search(auth, { query: '', product: 'item:processing-unit', machine: 'chemical-plant' })).rejects.toThrow();
    await expect(facts.search(auth, { query: '', product: 'item:processing-unit', recipe: 'item:processing-unit' })).rejects.toThrow();
  });

  it('returns an explicit byte-limited partial result and allows narrowing to a complete result', async () => {
    const facts = new ProductionFacts({ ...DEFAULT_FACT_LIMITS, responseBytes: 1300 });
    const query = source();
    const broad = await facts.search(access(query), { query: 'blue circuits' });
    expect(broad.status).toBe('partial'); expect(broad.items).toHaveLength(0); expect(broad.omitted).toBe(1); expect(broad.next).toBeNull();
    const narrow = await facts.search(access(query), { query: 'blue circuits', machine: 'machine:assembler' });
    expect(narrow.status).toBe('complete'); expect(narrow.items).toHaveLength(1);
  });

  it('binds producer cursors to caller, profile, query, selectors, availability, and expiry', async () => {
    let now = 100;
    const facts = new ProductionFacts({ ...DEFAULT_FACT_LIMITS, pageProducts: 1, cursorMs: 10 }, () => now);
    const authA = access(source(), 'agent-a');
    const first = await facts.search(authA, { query: 'circuits' });
    const authB = access(source(), 'agent-b');
    expect((await facts.search(authB, { query: 'circuits', cursor: first.next! })).status).toBe('expired');
    expect((await facts.search(authA, { query: 'other', cursor: first.next! })).status).toBe('expired');
    expect((await facts.search(authA, { query: 'circuits', cursor: first.next!, profile })).status).toBe('expired');
    const fresh = await facts.search(authA, { query: 'circuits' });
    expect((await facts.search(authA, { query: 'circuits', cursor: fresh.next!, product: 'item:advanced-circuit' })).status).toBe('expired');
    const live = { tick: 10, force: 'player', researched: [], surfaceProperties: { pressure: 1000 }, recipes: { 'electronic-circuit-recipe': { enabled: true, productivity: 0 } } };
    const changing = source({ availability: () => live }); const page = await facts.search(access(changing), { query: 'circuits' });
    live.recipes['electronic-circuit-recipe']!.productivity = 1;
    expect((await facts.search(access(changing), { query: 'circuits', cursor: page.next! })).status).toBe('expired');
    const expires = await facts.search(authA, { query: 'circuits' }); now += 11;
    expect((await facts.search(authA, { query: 'circuits', cursor: expires.next! })).status).toBe('expired');
  });

  it('refreshes same-mod content identity and rejects availability identity changes between pages', async () => {
    let content = 'content-v1'; let availability = 'availability-v1'; let changedCatalog = false;
    const facts = new ProductionFacts(); const query = source({ contentIdentity: () => content, availabilityIdentity: () => availability,
      rows: () => ({ ...catalog, products: catalog.products.map((p, i) => i === 0 ? { ...p, fuelValue: changedCatalog ? 1 : 0 } : p) }) });
    const initial = await facts.snapshot(access(query));
    content = 'content-v2'; changedCatalog = true;
    const refreshed = await facts.snapshot(access(query));
    expect(refreshed.catalog.mods).toEqual(initial.catalog.mods);
    expect(refreshed.catalog.fingerprint).not.toBe(initial.catalog.fingerprint);

    const paged = new ProductionFacts({ ...DEFAULT_FACT_LIMITS, pageProducts: 1 });
    let availabilityReads = 0;
    const pageSource = source({ pageSize: 1, availabilityIdentity: () => ++availabilityReads <= 7 ? 'availability-v1' : 'availability-v2' });
    const first = await paged.search(access(pageSource), { query: 'circuits' });
    availability = 'availability-v2';
    await expect(paged.search(access(pageSource), { query: 'circuits', cursor: first.next! })).rejects.toThrow('changed during export');
  });

  it('rejects two fluid flows assigned to one physical fluid box', () => {
    const plant = machine('machine:single-port', ['double-fluid'], [
      { index: 1, productionType: 'input', volume: 100, connections: [connection] },
    ]);
    const twoInputs = { ...catalog.recipes[0]!, category: 'double-fluid', ingredients: [
      { type: 'fluid' as const, name: 'sulfuric-acid' }, { type: 'fluid' as const, name: 'crude-oil' },
    ] };
    expect(compatibleMachine(twoInputs, plant)).toBe(false);
  });

  it('rejects malformed export page bounds and malformed row fields', async () => {
    const malformed = [
      source({ pageSize: 51, rows: { ...catalog, products: Array.from({ length: 51 }, (_, i) => product(`item:test-product-${i}`, 'item', `test-product-${i}`)) } }),
      source({ rows: { ...catalog, products: [{ ...catalog.products[0], id: 42 }] } }),
      source({ rows: { ...catalog, recipes: [{ ...catalog.recipes[0], seconds: 'two' }] } }),
      source({ rows: { ...catalog, machines: [{ ...catalog.machines[0], speed: NaN }] } }),
      (async (request: Extract<GameRequest, { op: 'production-facts' }>) => ({ ...await source()(request), next: 'not-an-offset' })),
    ];
    for (const [index, query] of malformed.entries()) await expect(new ProductionFacts().snapshot(access(query)), `malformed fixture ${index}`).rejects.toThrow();
  });
});
