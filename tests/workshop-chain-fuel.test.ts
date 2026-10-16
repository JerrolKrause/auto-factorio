import { describe, expect, it } from 'vitest';
import type { BlueprintDocument, MachineFact, ProductionAvailability, ProductionCatalog, ProductionProduct, ProductionRequest, RecipeFact, WorkshopAssignment, WorkshopStageMeasurement, WorkshopStageRequirement, WorkshopWindowMeasurement } from '@autofactorio/contracts';
import { resolveWorkshopChain } from '../packages/core/workshop/production.js';
import { evaluateWorkshop } from '../packages/core/workshop/evaluation.js';
import type { CapabilityProfile } from '../packages/core/workshop/profiles.js';
import { bindChainStages, validateChainBindings } from '../apps/runtime/workshop-chain-measurement.js';

const item = (name: string): ProductionProduct => ({ kind: 'item', name, quality: 'normal', surface: 'nauvis' });
const flow = (product: ProductionProduct, amount: number) => ({ type: product.kind, name: product.name, amount });

const coal = item('coal');
const plate = item('test-plate');
const ore = item('test-ore');
const recipe: RecipeFact = {
  id: 'recipe:test-plate', name: 'test-plate', category: 'smelting', seconds: 1,
  ingredients: [flow(ore, 1), flow(coal, 1)], products: [flow(plate, 1)], unlocks: [], surfaceConditions: [],
};
const furnace: MachineFact = {
  id: 'machine:test-furnace', name: 'test-furnace', type: 'furnace', categories: ['smelting'], speed: 1,
  ingredientLimit: 2, collisionBox: [{ x: -1, y: -1 }, { x: 1, y: 1 }], fluidBoxes: [], placementItems: ['test-furnace'],
  energy: { kind: 'burner', maxJoulesPerTick: 1, drainJoulesPerTick: 0, effectivity: 1, fuelCategories: ['chemical'] },
  baseEffects: {}, surfaceConditions: [],
};
const catalog: ProductionCatalog = {
  schema: 1, mods: { base: 'synthetic-public-test-catalog' }, fingerprint: 'f'.repeat(64),
  products: [ore, coal, plate].map(product => ({
    id: `${product.kind}:${product.name}`, kind: product.kind, name: product.name,
    ...(product.name === 'coal' ? { fuelValue: 60, fuelCategory: 'chemical' } : {}),
  })),
  recipes: [recipe], machines: [furnace],
};
const availability: ProductionAvailability = {
  tick: 1, force: 'player', researched: [], surfaceProperties: {}, recipes: { 'test-plate': { enabled: true, productivity: 0 } },
};
const profile: CapabilityProfile = {
  schema: 1, id: 'test-fuel-profile', revision: 1, fingerprint: 'test-fuel-profile', source: 'custom',
  technologies: [], researchBonuses: {}, recipes: ['test-plate'], allowedEquipment: ['test-furnace'],
  locallyManufacturable: [], modules: [], beacons: [], quality: 'normal', surface: 'nauvis',
};
const request: ProductionRequest = {
  schema: 1, target: plate, mode: 'rate', rate: { numerator: '1', denominator: '1', unit: 'items-per-game-second' },
  profile: { id: profile.id, revision: profile.revision, fingerprint: profile.fingerprint, recipes: ['test-plate'], equipment: ['test-furnace'] },
  facts: { schema: 1, id: `production.${catalog.fingerprint}`, fingerprint: catalog.fingerprint, availabilityRevision: 'a'.repeat(64) },
  externalInputs: [{ product: ore, capacity: { kind: 'unlimited' } }, { product: coal, capacity: { kind: 'unlimited' } }],
  initialStock: [], utilities: { electricityWatts: 0 }, constructionEquipment: { 'test-furnace': 1 }, sinks: [],
  routes: { 'item:test-plate': 'recipe:test-plate' }, machines: { 'recipe:test-plate': 'machine:test-furnace' }, fuels: { 'recipe:test-plate': coal },
};
const resolved = () => resolveWorkshopChain(request, { catalog, availability, availabilityRevision: 'a'.repeat(64) }, profile);

const assignment = {
  productionMode: 'chain',
  ports: [{ id: 'test-plate', direction: 'output', product: { ...plate, quality: 'normal' }, rate: { numerator: '1', denominator: '1' } }],
  throughput: [{ portId: 'test-plate', windowTicks: 3600, windows: 1, quantum: { numerator: '1', denominator: '1' }, productionError: { numerator: '0', denominator: '1' }, deliveryError: { numerator: '0', denominator: '1' }, maxStockDrawdown: { numerator: '0', denominator: '1' }, maxResidual: { numerator: '0', denominator: '1' }, interval: '(startTick,endTick]' }],
} as unknown as WorkshopAssignment;
const measuredStage = (stage: ReturnType<typeof resolved>['stages'][number], coalAmount: string): WorkshopStageMeasurement => ({
  id: stage.id, recipe: stage.recipe, machine: stage.machine, crafts: { numerator: '60', denominator: '1' }, coverage: 'complete',
  inputs: stage.inputs.map(input => ({ ...input, amount: input.kind === 'item' && input.name === 'coal' ? { numerator: coalAmount, denominator: '1' } : { numerator: '60', denominator: '1' }, error: { numerator: '0', denominator: '1' } })),
  outputs: stage.outputs.map(output => ({ ...output, amount: { numerator: '60', denominator: '1' }, error: { numerator: '0', denominator: '1' } })), evidence: ['synthetic-stage-observation'],
});
const windowFor = (stage: WorkshopStageMeasurement, changes: Partial<WorkshopWindowMeasurement> = {}): WorkshopWindowMeasurement => ({
  schema: 1, attemptId: 'fuel-test', index: 0, startTick: 0, endTick: 3600, interval: '(startTick,endTick]',
  ports: [{ portId: 'test-plate', product: { ...plate, quality: 'normal' }, production: { numerator: '60', denominator: '1' }, delivery: { numerator: '60', denominator: '1' }, openingStock: { numerator: '0', denominator: '1' }, closingStock: { numerator: '0', denominator: '1' }, residual: { numerator: '0', denominator: '1' }, productionAllocationId: 'allocation:test-plate', coverage: 'complete', evidence: ['synthetic-port-observation'] }],
  stages: [stage], stageCoverage: 'complete', energyCoverage: 'complete', contamination: [], mutationsFrozen: true, connected: true, evidence: ['synthetic-window'], ...changes,
});

describe('workshop chain selected fuel identity and measurement', () => {
  it('merges coal recipe and burner consumption once and retains the selected fuel identity', () => {
    const stage = resolved().stages[0]!;
    expect(stage.fuel).toEqual({ name: 'coal' });
    expect(stage.inputs.filter(input => input.kind === 'item' && input.name === 'coal')).toEqual([
      { kind: 'item', name: 'coal', amount: { numerator: '2', denominator: '1' } },
    ]);
  });

  it('binds the selected fuel to reconstructed units and rejects missing, switched, or unexpected markers', () => {
    const stage = { id: 'stage-test', recipe: 'test-plate', machine: 'test-furnace', fuel: { name: 'coal' }, craftsPerSecond: { numerator: '1', denominator: '1' }, inputs: [], outputs: [] };
    const document: BlueprintDocument = { schema: 1, label: 'test', description: '', entities: [{ id: 'furnace', entityNumber: 1, name: 'test-furnace', position: { x: 0, y: 0 }, direction: 0, quality: 'normal', recipe: 'test-plate' }], wires: [], ports: [], icons: [], tiles: [] };
    const binding = bindChainStages([stage], document, [{ unit: 9, name: 'test-furnace', position: { x: 0, y: 0 } }])[0]!;
    expect(binding).toEqual({ id: stage.id, recipe: stage.recipe, machine: stage.machine, units: [9], fuel: 'coal' });
    const manifest = { bindings: [binding] } as never;
    expect(() => validateChainBindings(manifest, [stage])).not.toThrow();
    for (const fuel of [undefined, 'wood', 'unplanned-fuel']) {
      const tampered = { bindings: [{ ...binding, fuel }] } as never;
      expect(() => validateChainBindings(tampered, [stage])).toThrow('stage bindings differ');
    }
    const noFuelStage: WorkshopStageRequirement = { ...stage };
    delete noFuelStage.fuel;
    expect(() => validateChainBindings(manifest, [noFuelStage])).toThrow('stage bindings differ');
  });

  it('requires combined measured coal flow and complete energy coverage to pass', () => {
    const stage = resolved().stages[0]!;
    const complete = measuredStage(stage, '120');
    expect(evaluateWorkshop(assignment, [windowFor(complete)], [stage], []).passed).toBe(true);

    const recipeOnly = measuredStage(stage, '60');
    expect(evaluateWorkshop(assignment, [windowFor(recipeOnly)], [stage], []).reasons).toContain('chain_stage_below_target');

    const missingCoal = measuredStage(stage, '120');
    missingCoal.inputs = missingCoal.inputs.filter(input => input.name !== 'coal');
    expect(evaluateWorkshop(assignment, [windowFor(missingCoal)], [stage], []).reasons).toContain('chain_flow_coverage_incomplete');

    const unknownEnergy = evaluateWorkshop(assignment, [windowFor(complete, { energyCoverage: 'unknown' })], [stage], []);
    expect(unknownEnergy).toMatchObject({ valid: false, passed: false, reasons: expect.arrayContaining(['energy_coverage_incomplete']) });
  });
});
