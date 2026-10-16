import { describe, expect, it } from 'vitest';
import type { MachineFact, ProductionAvailability, ProductionCatalog, ProductionProduct, ProductionRequest, RecipeFact, WorkshopStageMeasurement, WorkshopWindowMeasurement } from '@autofactorio/contracts';
import { validateWorkshopAssignment } from '@autofactorio/contracts';
import { resolveWorkshopChain, validateChainBlueprint } from '../packages/core/workshop/production.js';
import { evaluateWorkshop } from '../packages/core/workshop/evaluation.js';
import { blueprintContentHash } from '../packages/core/workshop/blueprint.js';
import { compileCharacterBlueprint } from '../packages/core/workshop/construction.js';
import type { BlueprintDocument } from '@autofactorio/contracts';
import type { CapabilityProfile } from '../packages/core/workshop/profiles.js';
import { chainMeasurementRequirements } from '../apps/runtime/workshop-chain-measurement.js';

const item = (name: string): ProductionProduct => ({ kind: 'item', name, quality: 'normal', surface: 'nauvis' });
const fluid = (name: string): ProductionProduct => ({ kind: 'fluid', name, quality: 'normal', surface: 'nauvis' });
const flow = (product: ProductionProduct, amount: number) => ({ type: product.kind, name: product.name, amount });
const recipe = (name: string, category: string, ingredients: [ProductionProduct, number][], products: [ProductionProduct, number][]): RecipeFact => ({ id: `recipe:${name}`, name, category, seconds: 1, ingredients: ingredients.map(([p, n]) => flow(p, n)), products: products.map(([p, n]) => flow(p, n)), unlocks: [], surfaceConditions: [] });
const machine = (name: string, categories: string[]): MachineFact => ({ id: `machine:${name}`, name, type: 'assembling-machine', categories, speed: 1, ingredientLimit: 20, collisionBox: [{ x: -1, y: -1 }, { x: 1, y: 1 }], fluidBoxes: Array.from({ length: 6 }, (_, index) => ({ index: index + 1, productionType: 'input-output', volume: 100, connections: [{ connection_type: 'pipe', direction: 0, flow_direction: 'input', positions: [{ x: 0, y: 0 }], connection_category: ['default'] }] })), placementItems: [name], energy: { kind: 'electric', maxJoulesPerTick: 0, drainJoulesPerTick: 0 }, baseEffects: {}, surfaceConditions: [] });

// Synthetic basic-refining-shaped facts intentionally emit multiple fluids to exercise sink boundaries.
const recipes = [
  recipe('basic-oil-processing', 'oil-processing', [[fluid('crude-oil'), 100]], [[fluid('petroleum-gas'), 45], [fluid('light-oil'), 25], [fluid('heavy-oil'), 10]]),
  recipe('sulfur', 'chemistry', [[fluid('petroleum-gas'), 30], [fluid('water'), 30]], [[item('sulfur'), 2]]),
];
const machines = [machine('oil-refinery', ['oil-processing']), machine('chemical-plant', ['chemistry'])];
const profile: CapabilityProfile = { schema: 1, id: 'sulfur-normal', revision: 3, fingerprint: 'profile-fingerprint', source: 'custom', technologies: [], researchBonuses: {}, recipes: recipes.map(value => value.name), allowedEquipment: machines.map(value => value.name), locallyManufacturable: [], modules: [], beacons: [], quality: 'normal', surface: 'nauvis' };
const catalog: ProductionCatalog = { schema: 1, mods: { base: 'test' }, fingerprint: 'a'.repeat(64), products: ['fluid:crude-oil','fluid:petroleum-gas','fluid:light-oil','fluid:heavy-oil','fluid:water','item:sulfur'].map(id => ({ id, kind: id.startsWith('fluid:') ? 'fluid' : 'item', name: id.slice(id.indexOf(':') + 1) } as const)), recipes, machines };
const availability: ProductionAvailability = { tick: 1, force: 'player', researched: [], surfaceProperties: {}, recipes: Object.fromEntries(recipes.map(value => [value.name, { enabled: true, productivity: 0 }])) };
const request = (changes: Partial<ProductionRequest> = {}): ProductionRequest => ({ schema: 1, target: item('sulfur'), mode: 'rate', rate: { numerator: '2', denominator: '1', unit: 'items-per-game-second' }, profile: { id: profile.id, revision: profile.revision, fingerprint: profile.fingerprint, recipes: [...profile.recipes], equipment: [...profile.allowedEquipment] }, facts: { schema: 1, id: `production.${catalog.fingerprint}`, fingerprint: catalog.fingerprint, availabilityRevision: 'b'.repeat(64) }, externalInputs: [{ product: fluid('crude-oil'), capacity: { kind: 'unlimited' } }, { product: fluid('water'), capacity: { kind: 'unlimited' } }], initialStock: [], utilities: { electricityWatts: 1000000 }, constructionEquipment: { 'oil-refinery': 1, 'chemical-plant': 1 }, sinks: [{ product: fluid('light-oil'), capacity: { kind: 'unlimited' } }, { product: fluid('heavy-oil'), capacity: { kind: 'unlimited' } }], routes: { 'fluid:petroleum-gas': 'recipe:basic-oil-processing', 'item:sulfur': 'recipe:sulfur' }, machines: { 'recipe:basic-oil-processing': 'machine:oil-refinery', 'recipe:sulfur': 'machine:chemical-plant' }, fuels: {}, ...changes });
const ports = [
  { id: 'crude', direction: 'input' as const, product: { ...fluid('crude-oil'), quality: 'normal' as const }, position: { x: 0, y: 0 }, facing: 0, transport: 'pipe' as const, rate: { numerator: '20', denominator: '9' }, unit: 'units-per-game-second' as const, required: true },
  { id: 'water', direction: 'input' as const, product: { ...fluid('water'), quality: 'normal' as const }, position: { x: 0, y: 6 }, facing: 0, transport: 'pipe' as const, rate: { numerator: '30', denominator: '1' }, unit: 'units-per-game-second' as const, required: true },
  { id: 'sulfur', direction: 'output' as const, product: { ...item('sulfur'), quality: 'normal' as const }, position: { x: 32, y: 0 }, facing: 4, transport: 'belt' as const, rate: { numerator: '2', denominator: '1' }, unit: 'units-per-game-second' as const, required: true },
  { id: 'light', direction: 'byproduct' as const, product: { ...fluid('light-oil'), quality: 'normal' as const }, position: { x: 32, y: 6 }, facing: 4, transport: 'pipe' as const, rate: { numerator: '50', denominator: '3' }, unit: 'units-per-game-second' as const, required: false },
  { id: 'heavy', direction: 'byproduct' as const, product: { ...fluid('heavy-oil'), quality: 'normal' as const }, position: { x: 32, y: 12 }, facing: 4, transport: 'pipe' as const, rate: { numerator: '20', denominator: '3' }, unit: 'units-per-game-second' as const, required: false },
];
const assignment = (overrides: Record<string, unknown> = {}) => validateWorkshopAssignment({ schema: 1, id: 'sulfur-chain', revision: 1, comparisonSeries: 'sulfur-series', objective: 'Produce sulfur from crude oil and water', source: { kind: 'brief', id: null }, ports, profileId: profile.id, profileRevision: profile.revision, gameFingerprint: 'a'.repeat(64), footprint: { width: 32, height: 16, clearance: 2, maxTiles: 512 }, construction: 'direct', libraryAccess: false, improveRevision: null, requestedSpeed: { numerator: '1', denominator: '1' }, settlingTicks: 0, throughput: [{ portId: 'sulfur', windowTicks: 60, windows: 1, quantum: { numerator: '1', denominator: '1' }, productionError: { numerator: '0', denominator: '1' }, deliveryError: { numerator: '0', denominator: '1' }, maxStockDrawdown: { numerator: '0', denominator: '1' }, maxResidual: { numerator: '0', denominator: '1' }, interval: '(startTick,endTick]' }], rubric: { version: 'r1', weights: { throughput: { numerator: '1', denominator: '1' } }, materiality: { throughput: { numerator: '0', denominator: '1' } } }, iterations: { attempts: 1, mode: 'exact', earlyStop: false, plateauRounds: 1 }, checkpoints: { brief: false, afterScore: false, libraryAdmission: false, learningActivation: false, timeoutMs: 1000, timeoutAction: 'finish' }, budgets: { wallMs: 60000, gameTicks: 600, turns: 3, toolCalls: 8, reportedTokens: 1000, learningReservedTurns: 0, learningReservedTools: 0 }, models: { sessionDefault: { provider: 'openai', modelId: 'gpt-6-astra', reasoningEffort: 'low' }, overrides: {} }, learning: { cadence: 'off', batchSessions: 1, candidateCap: 1, attemptsPerCandidate: 1, autoActivate: false }, ...overrides });
const chain = () => resolveWorkshopChain(request(), { catalog, availability, availabilityRevision: 'b'.repeat(64) }, profile);
const documentFor = (entities: BlueprintDocument['entities'], chainPorts: BlueprintDocument['ports']): BlueprintDocument => ({ schema: 1, label: 'Sulfur line', description: 'Two stage chain', entities, wires: [], ports: structuredClone(chainPorts), icons: [{ index: 1, name: 'sulfur' }], tiles: [] });
const entities = (chainStages: ReturnType<typeof chain>['stages']): BlueprintDocument['entities'] => chainStages.map((stage, index) => ({ id: `stage-${index}`, entityNumber: index + 1, name: stage.machine, position: { x: index * 4, y: 0 }, direction: 0, quality: 'normal', recipe: stage.recipe }));
const stageProof = (chainStages: ReturnType<typeof chain>['stages']): WorkshopStageMeasurement[] => chainStages.map(stage => ({ id: stage.id, recipe: stage.recipe, machine: stage.machine, crafts: stage.craftsPerSecond, coverage: 'complete', inputs: stage.inputs.map(value => ({ ...value, amount: { numerator: String(Number(value.amount.numerator) * 60), denominator: value.amount.denominator }, error: { numerator: '0', denominator: '1' } })), outputs: stage.outputs.map(value => ({ ...value, amount: { numerator: String(Number(value.amount.numerator) * 60), denominator: value.amount.denominator }, error: { numerator: '0', denominator: '1' } })), evidence: [`stage:${stage.id}`] }));
const windowFor = (stages?: WorkshopStageMeasurement[], changes: Partial<WorkshopWindowMeasurement> = {}): WorkshopWindowMeasurement => ({ schema: 1, attemptId: 'sulfur-chain:1', index: 0, startTick: 0, endTick: 60, interval: '(startTick,endTick]', ports: [{ portId: 'sulfur', product: { ...item('sulfur'), quality: 'normal' }, production: { numerator: '2', denominator: '1' }, delivery: { numerator: '2', denominator: '1' }, openingStock: { numerator: '0', denominator: '1' }, closingStock: { numerator: '0', denominator: '1' }, residual: { numerator: '0', denominator: '1' }, productionAllocationId: 'alloc-sulfur', coverage: 'complete', evidence: ['port:sulfur'] }], stageCoverage: 'complete', energyCoverage: 'complete', contamination: [], mutationsFrozen: true, connected: true, evidence: ['window'], ...(stages ? { stages } : {}), ...changes });

describe('workshop production chains', () => {
  it('resolves the authorized sulfur chain with raw crude and water only, explicit sinks, and no widened profile', () => {
    const result = chain();
    expect(result.stages).toHaveLength(2);
    expect(result.stages.map(value => value.recipe).sort()).toEqual(['basic-oil-processing', 'sulfur']);
    expect(result.request.externalInputs.map(value => value.product.name).sort()).toEqual(['crude-oil', 'water']);
    expect(result.ports.filter(value => value.direction === 'input').map(value => value.product.name).sort()).toEqual(['crude-oil', 'water']);
    expect(result.ports.filter(value => value.direction === 'byproduct').map(value => value.product.name).sort()).toEqual(['heavy-oil', 'light-oil']);
    expect(result.plan.balances.find(value => value.product === 'fluid:petroleum-gas')?.external.numerator).toBe('0');
    expect(() => resolveWorkshopChain(request({ initialStock: [{ product: item('sulfur'), quantity: 1 }] }), { catalog, availability, availabilityRevision: 'b'.repeat(64) }, profile)).toThrow('zero initial process stock');
    const refineryDenied = { ...profile, allowedEquipment: ['chemical-plant'] }, refineryDeniedRequest = request(); refineryDeniedRequest.profile.equipment = ['chemical-plant'];
    expect(() => resolveWorkshopChain(refineryDeniedRequest, { catalog, availability, availabilityRevision: 'b'.repeat(64) }, refineryDenied)).toThrow();
    const recipeDenied = { ...profile, recipes: ['sulfur'] }, recipeDeniedRequest = request(); recipeDeniedRequest.profile.recipes = ['sulfur'];
    expect(() => resolveWorkshopChain(recipeDeniedRequest, { catalog, availability, availabilityRevision: 'b'.repeat(64) }, recipeDenied)).toThrow();
    expect(() => resolveWorkshopChain(request({ target: item('crude-oil') }), { catalog, availability, availabilityRevision: 'b'.repeat(64) }, profile)).toThrow();
  });
  it('pins all stages, recipes, equipment, construction allowance and preserves normalized blueprint content', () => {
    const resolved = chain(), doc = documentFor(entities(resolved.stages), resolved.ports);
    expect(validateChainBlueprint(doc, resolved, profile)).toEqual(doc);
    expect(blueprintContentHash(validateChainBlueprint(doc, resolved, profile))).toBe(blueprintContentHash(doc));
    const compiled = compileCharacterBlueprint(doc, { 'oil-refinery': 1, 'chemical-plant': 1 }, () => true);
    expect(blueprintContentHash(compiled.document)).toBe(blueprintContentHash(doc));
    expect(compiled.steps.filter(step => step.kind === 'recipe').map(step => step.recipe).sort()).toEqual(['basic-oil-processing', 'sulfur']);
    expect(() => validateChainBlueprint(documentFor(entities(resolved.stages).slice(0, 1), resolved.ports), resolved, profile)).toThrow('omits a required chain stage');
    expect(() => validateChainBlueprint(documentFor([...entities(resolved.stages), { ...entities(resolved.stages)[0]!, id: 'wrong', entityNumber: 3, recipe: 'unplanned' }], resolved.ports), resolved, profile)).toThrow('Unplanned chain recipe/machine');
    const denied = { ...profile, allowedEquipment: ['oil-refinery'] };
    expect(() => validateChainBlueprint(doc, resolved, denied)).toThrow('Chain equipment denied');
    const tooCostly = { ...profile, allowedEquipment: [...profile.allowedEquipment], locallyManufacturable: [] };
    expect(() => validateChainBlueprint(doc, { ...resolved, request: { ...resolved.request, constructionEquipment: { 'oil-refinery': 0, 'chemical-plant': 1 } } }, tooCostly)).toThrow('construction allowance exceeded');
    expect(() => validateChainBlueprint(documentFor(entities(resolved.stages).map(entity => ({ ...entity, modules: { 'speed-module': 1 } })), resolved.ports), resolved, profile)).toThrow('Chain equipment denied');
  });
  it('requires complete local stage craft and gross-flow proof for every evaluation window', () => {
    const resolved = chain(), chainPorts = resolved.ports, output = chainPorts.find(port => port.direction === 'output')!;
    const manifest = assignment({ productionMode: 'chain', chainRequest: request(), ports: chainPorts, throughput: [{ ...assignment().throughput[0]!, portId: output.id }] });
    const complete = stageProof(resolved.stages), requirements = chainMeasurementRequirements(manifest, resolved);
    const windowForChain = (stages?: WorkshopStageMeasurement[]) => {
      const base = windowFor().ports[0]!;
      return windowFor(stages, { ports: [{ ...base, portId: output.id, productionAllocationId: `allocation:${output.id}` }, ...requirements.coProducts.map(rule => {
        const aboveRequired = { numerator: (BigInt(rule.requiredRate.numerator) + 4n * BigInt(rule.requiredRate.denominator)).toString(), denominator: rule.requiredRate.denominator };
        return { ...base, portId: rule.portId, productionAllocationId: `allocation:${rule.portId}`, product: chainPorts.find(port => port.id === rule.portId)!.product, production: aboveRequired, delivery: aboveRequired };
      })] });
    };
    const completeEvaluation = evaluateWorkshop(manifest, [windowForChain(complete)], resolved.stages, requirements.coProducts);
    expect(completeEvaluation.reasons).toEqual([]);
    expect(completeEvaluation).toMatchObject({ valid: true, passed: true });
    expect(evaluateWorkshop(manifest, [windowForChain()], resolved.stages, requirements.coProducts).reasons).toContain('chain_stage_coverage_incomplete');
    expect(evaluateWorkshop(manifest, [windowForChain(complete.slice(0, 1))], resolved.stages, requirements.coProducts).reasons).toContain('chain_stage_coverage_incomplete');
    const targetOnly = windowForChain(complete);
    targetOnly.ports = targetOnly.ports.slice(0, 1);
    expect(evaluateWorkshop(manifest, [targetOnly], resolved.stages, requirements.coProducts).reasons).toContain('chain_coproduct_delivery_failed');
    const accumulating = windowForChain(complete);
    const sink = accumulating.ports.find(port => port.portId === requirements.coProducts[0]!.portId)!;
    sink.closingStock = { numerator: '1', denominator: '10' };
    expect(evaluateWorkshop(manifest, [accumulating], resolved.stages, requirements.coProducts).reasons).toContain('chain_coproduct_accumulation');
    const underflow = structuredClone(complete); underflow[0]!.inputs[0]!.amount = { numerator: '0', denominator: '1' };
    expect(evaluateWorkshop(manifest, [windowForChain(underflow)], resolved.stages, requirements.coProducts).reasons).toContain('chain_stage_below_target');
    const malformed = structuredClone(complete); malformed[0]!.inputs[0]!.error = { numerator: '-1', denominator: '1' };
    expect(evaluateWorkshop(manifest, [windowForChain(malformed)], resolved.stages, requirements.coProducts).reasons).toContain('chain_measurement_invalid');
    const noUpstream = structuredClone(complete); noUpstream[1]!.inputs = noUpstream[1]!.inputs.filter(value => value.name !== 'petroleum-gas');
    expect(evaluateWorkshop(manifest, [windowForChain(noUpstream)], resolved.stages, requirements.coProducts).reasons).toContain('chain_flow_coverage_incomplete');
  });
});

describe('burner fuel and residue in chain manifests', () => {
  it('includes fuel beyond recipe ingredients and verifies burnt residue as measured gross flow', () => {
    const ore = item('iron-ore'), coal = item('coal'), plate = item('iron-plate'), ash = item('ash');
    const burnerRecipe: RecipeFact = { id: 'recipe:iron-plate', name: 'iron-plate', category: 'smelting', seconds: 1, ingredients: [flow(ore, 1), flow(coal, 1)], products: [flow(plate, 1)], unlocks: [], surfaceConditions: [] };
    const furnace: MachineFact = { id: 'machine:stone-furnace', name: 'stone-furnace', type: 'furnace', categories: ['smelting'], speed: 1, ingredientLimit: 2, collisionBox: [{ x: -1, y: -1 }, { x: 1, y: 1 }], fluidBoxes: [], placementItems: ['stone-furnace'], energy: { kind: 'burner', maxJoulesPerTick: 1, drainJoulesPerTick: 0, effectivity: 1, fuelCategories: ['chemical'] }, baseEffects: {}, surfaceConditions: [] };
    const burnerCatalog: ProductionCatalog = { schema: 1, mods: { base: 'test' }, fingerprint: 'c'.repeat(64), products: [ore, coal, plate, ash].map(product => ({ id: `${product.kind}:${product.name}`, kind: product.kind, name: product.name, ...(product.name === 'coal' ? { fuelValue: 60, fuelCategory: 'chemical', burntResult: 'ash' } : {}) })), recipes: [burnerRecipe], machines: [furnace] };
    const burnerAvailability: ProductionAvailability = { tick: 1, force: 'player', researched: [], surfaceProperties: {}, recipes: { 'iron-plate': { enabled: true, productivity: 0 } } };
    const burnerProfile: CapabilityProfile = { schema: 1, id: 'burner-iron', revision: 1, fingerprint: 'burner-profile', source: 'custom', technologies: [], researchBonuses: {}, recipes: ['iron-plate'], allowedEquipment: ['stone-furnace'], locallyManufacturable: [], modules: [], beacons: [], quality: 'normal', surface: 'nauvis' };
    const burnerRequest: ProductionRequest = { schema: 1, target: plate, mode: 'rate', rate: { numerator: '2', denominator: '1', unit: 'items-per-game-second' }, profile: { id: burnerProfile.id, revision: burnerProfile.revision, fingerprint: burnerProfile.fingerprint, recipes: ['iron-plate'], equipment: ['stone-furnace'] }, facts: { schema: 1, id: `production.${burnerCatalog.fingerprint}`, fingerprint: burnerCatalog.fingerprint, availabilityRevision: 'd'.repeat(64) }, externalInputs: [{ product: ore, capacity: { kind: 'unlimited' } }, { product: coal, capacity: { kind: 'unlimited' } }], initialStock: [], utilities: { electricityWatts: 0 }, constructionEquipment: { 'stone-furnace': 2 }, sinks: [{ product: ash, capacity: { kind: 'unlimited' } }], routes: { 'item:iron-plate': 'recipe:iron-plate' }, machines: { 'recipe:iron-plate': 'machine:stone-furnace' }, fuels: { 'recipe:iron-plate': coal } };
    const resolved = resolveWorkshopChain(burnerRequest, { catalog: burnerCatalog, availability: burnerAvailability, availabilityRevision: 'd'.repeat(64) }, burnerProfile);
    expect(resolved.stages).toHaveLength(1);
    expect(resolved.stages[0]!.inputs.find(value => value.kind === 'item' && value.name === 'coal')?.amount).toEqual({ numerator: '2', denominator: '1' });
    expect(resolved.stages[0]!.outputs.find(value => value.kind === 'item' && value.name === 'ash')?.amount).toEqual({ numerator: '1', denominator: '1' });
    const manifest = assignment({ productionMode: 'chain', chainRequest: burnerRequest, ports: assignment().ports.filter(port => port.direction !== 'byproduct') });
    const complete = stageProof(resolved.stages);
    const coProducts: [] = [];
    const withSinks = (stages: WorkshopStageMeasurement[]) => windowFor(stages);
    expect(evaluateWorkshop(manifest, [withSinks(complete)], resolved.stages, coProducts)).toMatchObject({ valid: true, passed: true });
    const recipeOnlyFuel = structuredClone(complete); recipeOnlyFuel[0]!.inputs.find(value => value.kind === 'item' && value.name === 'coal')!.amount = { numerator: '2', denominator: '1' };
    expect(evaluateWorkshop(manifest, [withSinks(recipeOnlyFuel)], resolved.stages, coProducts).reasons).toContain('chain_stage_below_target');
    const noResidue = structuredClone(complete); noResidue[0]!.outputs = noResidue[0]!.outputs.filter(value => value.name !== 'ash');
    expect(evaluateWorkshop(manifest, [withSinks(noResidue)], resolved.stages, coProducts).reasons).toContain('chain_flow_coverage_incomplete');
  });
});

const componentAssignment = (overrides: Record<string, unknown> = {}) => ({ schema: 1, id: 'legacy', revision: 1, comparisonSeries: 'series', objective: 'Produce circuits', source: { kind: 'brief', id: null }, ports: [{ id: 'in', direction: 'input', product: { kind: 'item', name: 'iron-plate', quality: 'normal', surface: 'nauvis' }, position: { x: 0, y: 0 }, facing: 0, transport: 'belt', rate: { numerator: '1', denominator: '1' }, unit: 'units-per-game-second', required: true }, { id: 'out', direction: 'output', product: { kind: 'item', name: 'electronic-circuit', quality: 'normal', surface: 'nauvis' }, position: { x: 10, y: 0 }, facing: 8, transport: 'belt', rate: { numerator: '1', denominator: '1' }, unit: 'units-per-game-second', required: true }], profileId: 'starter-assembly', profileRevision: 1, gameFingerprint: 'a'.repeat(64), footprint: { width: 32, height: 16, clearance: 2, maxTiles: 512 }, construction: 'direct', libraryAccess: true, improveRevision: null, requestedSpeed: { numerator: '1', denominator: '1' }, settlingTicks: 0, throughput: [{ portId: 'out', windowTicks: 60, windows: 1, quantum: { numerator: '1', denominator: '1' }, productionError: { numerator: '0', denominator: '1' }, deliveryError: { numerator: '0', denominator: '1' }, maxStockDrawdown: { numerator: '0', denominator: '1' }, maxResidual: { numerator: '0', denominator: '1' }, interval: '(startTick,endTick]' }], rubric: { version: 'r1', weights: { throughput: { numerator: '1', denominator: '1' } }, materiality: { throughput: { numerator: '0', denominator: '1' } } }, iterations: { attempts: 1, mode: 'exact', earlyStop: false, plateauRounds: 1 }, checkpoints: { brief: false, afterScore: false, libraryAdmission: false, learningActivation: false, timeoutMs: 1000, timeoutAction: 'finish' }, budgets: { wallMs: 60000, gameTicks: 600, turns: 3, toolCalls: 8, reportedTokens: 1000, learningReservedTurns: 0, learningReservedTools: 0 }, models: { sessionDefault: { provider: 'openai', modelId: 'gpt-6-astra', reasoningEffort: 'low' }, overrides: {} }, ...overrides });

describe('chain library assignment policy', () => {
  it('preserves component defaults and accepts chain library and exact revision declarations', () => {
    expect(validateWorkshopAssignment(componentAssignment()).productionMode).toBeUndefined();
    const chain = validateWorkshopAssignment({ ...componentAssignment(), productionMode: 'chain', chainRequest: request(), libraryAccess: true });
    expect(chain.productionMode).toBe('chain');
    expect(validateWorkshopAssignment({ ...componentAssignment(), source: { kind: 'revision', id: 'prior' }, libraryAccess: true, improveRevision: 'prior' }).improveRevision).toBe('prior');
  });
});
