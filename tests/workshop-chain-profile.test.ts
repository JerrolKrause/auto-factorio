import { describe, expect, it } from 'vitest';
import type { MachineFact, ProductionAvailability, ProductionCatalog, ProductionProduct, RecipeFact } from '@autofactorio/contracts';
import { installedChainContext, type InstalledChainPreset } from '../packages/core/workshop/installed-chain.js';
import { resolveWorkshopChain } from '../packages/core/workshop/production.js';
import { WorkshopControl } from '../packages/factorio/src/workshop.js';
import type { CommandPort } from '../packages/factorio/src/rcon.js';

const item = (name: string): ProductionProduct => ({ kind: 'item', name, quality: 'normal', surface: 'nauvis' });
const fluid = (name: string): ProductionProduct => ({ kind: 'fluid', name, quality: 'normal', surface: 'nauvis' });
const flow = (p: ProductionProduct, amount: number) => ({ type: p.kind, name: p.name, amount });
const recipe = (name: string, category: string, ingredients: [ProductionProduct, number][], products: [ProductionProduct, number][]): RecipeFact => ({ id: `recipe:${name}`, name, category, seconds: 1, ingredients: ingredients.map(([p, n]) => flow(p, n)), products: products.map(([p, n]) => flow(p, n)), unlocks: [], surfaceConditions: [] });
const pipeConnection = { connection_type: 'pipe', direction: 0, flow_direction: 'input', positions: [{ x: 0, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }], connection_category: ['default'] };
const machine = (name: string, category: string): MachineFact => ({ id: `machine:${name}`, name, type: 'assembling-machine', categories: [category], speed: 1, ingredientLimit: 20, collisionBox: [{ x: -1, y: -1 }, { x: 1, y: 1 }], fluidBoxes: Array.from({ length: 6 }, (_, index) => ({ index: index + 1, productionType: 'input-output' as const, volume: 100, connections: [pipeConnection] })), placementItems: [name], energy: { kind: 'electric', maxJoulesPerTick: 0, drainJoulesPerTick: 0 }, baseEffects: {}, surfaceConditions: [] });
// Synthetic basic-refining-shaped flows exercise multi-output sink boundaries; they do not claim installed-game recipe facts.
const recipes = [recipe('basic-oil-processing', 'oil-processing', [[fluid('crude-oil'), 100]], [[fluid('petroleum-gas'), 45], [fluid('light-oil'), 25], [fluid('heavy-oil'), 10]]), recipe('sulfur', 'chemistry', [[fluid('petroleum-gas'), 30], [fluid('water'), 30]], [[item('sulfur'), 2]])];
const catalog: ProductionCatalog = { schema: 1, mods: { base: '2.0.77', space_age: '2.0.77' }, fingerprint: 'a'.repeat(64), products: [...['crude-oil','petroleum-gas','light-oil','heavy-oil','water'].map(n => ({ id: `fluid:${n}`, kind: 'fluid' as const, name: n })), ...['sulfur','oil-refinery','chemical-plant'].map(n => ({ id: `item:${n}`, kind: 'item' as const, name: n }))], recipes, machines: [machine('oil-refinery', 'oil-processing'), machine('chemical-plant', 'chemistry')] };
const availability: ProductionAvailability = { tick: 14, force: 'player', researched: ['unrelated-tech'], surfaceProperties: { pressure: 1000 }, recipes: { sulfur: { enabled: false, productivity: 0.2 }, 'basic-oil-processing': { enabled: true, productivity: 0.5 } } };
const snapshot = { catalog, availability, availabilityRevision: 'b'.repeat(64) };
const preset = (changes: Partial<InstalledChainPreset> = {}): InstalledChainPreset => ({ schema: 1, gameVersion: '2.0.77', mods: { space_age: '2.0.77', base: '2.0.77' }, profileId: 'production-chain', profileRevision: 3, surface: 'nauvis', technologies: ['sulfur-processing'], recipes: ['sulfur', 'basic-oil-processing'], allowedEquipment: ['chemical-plant', 'oil-refinery'], ...changes });
const makeContext = (p = preset(), s = snapshot) => installedChainContext(p, s);

describe('installed production-chain profile', () => {
  it('canonicalizes ordering into stable pins and ignores player research, productivity, and tick', () => {
    const first = makeContext(), reordered = makeContext(preset({ technologies: ['sulfur-processing'], recipes: ['basic-oil-processing', 'sulfur'], allowedEquipment: ['oil-refinery', 'chemical-plant'] }));
    const changedPlayer = makeContext(preset(), { ...snapshot, availability: { ...availability, tick: 900, researched: ['different-tech'], recipes: { sulfur: { enabled: true, productivity: 1 }, 'basic-oil-processing': { enabled: false, productivity: 0 } } } });
    expect(first.profile.fingerprint).toBe(reordered.profile.fingerprint);
    expect(first.profile.fingerprint).toBe(changedPlayer.profile.fingerprint);
    expect(first.snapshot.availabilityRevision).toBe(changedPlayer.snapshot.availabilityRevision);
    expect(first.profile.recipes).toEqual(['basic-oil-processing', 'sulfur']);
    expect(first.snapshot.availability.recipes.sulfur).toEqual({ enabled: true, productivity: 0 });
    expect(first.snapshot.availability.force).toBe('workshop-profile.production-chain');
  });
  it('changes pins when catalog, revision, or surface properties change', () => {
    const base = makeContext().profile.fingerprint;
    expect(makeContext(preset({ profileRevision: 4 })).profile.fingerprint).not.toBe(base);
    expect(makeContext(preset(), { ...snapshot, catalog: { ...catalog, fingerprint: 'c'.repeat(64) } }).profile.fingerprint).not.toBe(base);
    expect(makeContext(preset(), { ...snapshot, availability: { ...availability, surfaceProperties: { pressure: 999 } } }).profile.fingerprint).not.toBe(base);
  });
  it('rejects malformed lists, duplicates, unknown recipes or equipment, and mismatched game/mod/profile/surface facts', () => {
    for (const bad of [preset({ recipes: ['sulfur', 'sulfur'] }), preset({ recipes: ['missing-recipe'] }), preset({ allowedEquipment: ['missing-equipment'] }), preset({ technologies: ['bad name'] }), preset({ gameVersion: 'other' }), preset({ mods: { base: '2.0.77' } }), preset({ profileId: 'other' }), preset({ surface: 'vulcanus' as 'nauvis' }), preset({ profileRevision: 0 })]) expect(() => makeContext(bad)).toThrow();
  });
  it('plans the sulfur chain from preset facts and excludes the advanced recipe and refinery when denied', () => {
    const context = makeContext();
    const requestFor = (profileContext: ReturnType<typeof makeContext>) => ({ schema: 1 as const, target: item('sulfur'), mode: 'rate' as const, rate: { numerator: '2', denominator: '1', unit: 'items-per-game-second' as const }, profile: { id: profileContext.profile.id, revision: profileContext.profile.revision, fingerprint: profileContext.profile.fingerprint, recipes: profileContext.profile.recipes, equipment: profileContext.profile.allowedEquipment }, facts: { schema: 1 as const, id: `production.${catalog.fingerprint}`, fingerprint: catalog.fingerprint, availabilityRevision: profileContext.snapshot.availabilityRevision }, externalInputs: [{ product: fluid('crude-oil'), capacity: { kind: 'unlimited' as const } }, { product: fluid('water'), capacity: { kind: 'unlimited' as const } }], initialStock: [], utilities: { electricityWatts: 100000 }, constructionEquipment: { 'oil-refinery': 1, 'chemical-plant': 1 }, sinks: [{ product: fluid('light-oil'), capacity: { kind: 'unlimited' as const } }, { product: fluid('heavy-oil'), capacity: { kind: 'unlimited' as const } }], routes: { 'fluid:petroleum-gas': 'recipe:basic-oil-processing', 'item:sulfur': 'recipe:sulfur' }, machines: { 'recipe:basic-oil-processing': 'machine:oil-refinery', 'recipe:sulfur': 'machine:chemical-plant' }, fuels: {} });
    const request = requestFor(context);
    const resolved = resolveWorkshopChain(request, context.snapshot, context.profile);
    expect(resolved.stages.map(s => s.recipe).sort()).toEqual(['basic-oil-processing', 'sulfur']);
    expect(resolved.request.externalInputs.map(x => x.product.name).sort()).toEqual(['crude-oil', 'water']);
    const recipeDenied = makeContext(preset({ recipes: ['sulfur'] }));
    expect(() => resolveWorkshopChain(requestFor(recipeDenied), recipeDenied.snapshot, recipeDenied.profile)).toThrow();
    const machineDenied = makeContext(preset({ allowedEquipment: ['chemical-plant'] }));
    expect(() => resolveWorkshopChain(requestFor(machineDenied), machineDenied.snapshot, machineDenied.profile)).toThrow();
  });
});

function decodeRequest(lua: string): Record<string, unknown> {
  const match = lua.match(/rpc","((?:\\\d{3})+)"/);
  if (!match) throw new Error('Missing wrapped request');
  return JSON.parse(match[1]!.replace(/\\(\d{3})/g, (_all, code: string) => String.fromCharCode(Number(code)))) as Record<string, unknown>;
}
function fakePort(handler: (request: Record<string, unknown>) => Record<string, unknown>): CommandPort & { requests: Record<string, unknown>[] } {
  const requests: Record<string, unknown>[] = [];
  return { requests, close() {}, async command(lua) {
    const request = decodeRequest(lua);
    // A payload-only fake would accept the wrong RPC channel unlike Factorio.
    expect(lua).toContain(request.op === 'production-facts' ? 'remote.call("autofactorio_v1"' : 'remote.call("autofactorio_operator_v1"');
    requests.push(request); return JSON.stringify(handler(request));
  } };
}
const emptyFacts = (request: Record<string, unknown>) => {
  const section = String(request.section);
  const rows = section === 'availability' ? Object.keys(availability.recipes).map(name => ({ name, enabled: true, productivity: 0 })) : catalog[section as 'products' | 'recipes' | 'machines'];
  return { ok: true, schema: 1, section, mods: catalog.mods, tick: 14, total: rows.length, items: rows, next: null, contentIdentity: 'content-1', ...(section === 'availability' ? { availabilityIdentity: 'availability-1', force: 'player', researched: [], surfaceProperties: {} } : {}) };
};

describe('WorkshopControl installed profile protocol', () => {
  it('requests only a read-only chain profile, normalizes empty Lua lists, and rejects malformed nonempty lists', async () => {
    const port = fakePort(request => request.op === 'workshop-profile' ? { ok: true, ...preset({ technologies: {} as unknown as string[], recipes: {} as unknown as string[], allowedEquipment: {} as unknown as string[] }) } : emptyFacts(request));
    const control = new WorkshopControl(port);
    const context = await control.installedChainProfile('production-chain');
    expect(port.requests[0]).toEqual({ op: 'workshop-profile', profileId: 'production-chain', chain: true });
    expect(context.profile.recipes).toEqual([]);
    const malformed = new WorkshopControl(fakePort(request => request.op === 'workshop-profile' ? { ok: true, ...preset({ recipes: { invalid: true } as unknown as string[] }) } : emptyFacts(request)));
    await expect(malformed.installedChainProfile('production-chain')).rejects.toThrow('Incomplete installed chain preset');
    const mismatchedId = new WorkshopControl(fakePort(request => request.op === 'workshop-profile' ? { ok: true, ...preset({ profileId: 'starter-assembly' }) } : emptyFacts(request)));
    await expect(mismatchedId.installedChainProfile('production-chain')).rejects.toThrow('Installed chain preset identity changed');
  });
  it('preserves the legacy installedProfile request and response fields', async () => {
    const legacy = { ok: true, gameVersion: '2.0.77', mods: catalog.mods, profileId: 'starter-assembly', profileRevision: 1, surface: 'nauvis', technologies: [], allowedEquipment: [], modules: [], beacons: [], recipe: { id: 'recipe:iron-plate', category: 'smelting', energy: 3, ingredients: [], products: [] }, machine: 'stone-furnace' };
    const port = fakePort(() => legacy);
    const result = await new WorkshopControl(port).installedProfile('starter-assembly', 'iron-plate');
    expect(port.requests).toEqual([{ op: 'workshop-profile', profileId: 'starter-assembly', product: 'iron-plate' }]);
    expect(result).toMatchObject({ profileId: 'starter-assembly', recipe: legacy.recipe, machine: 'stone-furnace' });
  });
});
