import assert from 'node:assert/strict';
import { validateWorkshopAssignment } from '@autofactorio/contracts';
import type { BlueprintDocument, Position, WorkshopAssignment, WorkshopWindowMeasurement } from '@autofactorio/contracts';
import type { CapabilityProfile } from '../../packages/core/workshop/profiles.js';
import type { WorkshopFixture } from '../../packages/factorio/src/workshop.js';

export interface MeasurementLifecycleFixture {
  id: string;
  surface: string;
  capability: CapabilityProfile;
  positions: { active: Position; output: Position; pole: Position; spare: Position; sink: Position; power: Position };
  fixtures: WorkshopFixture[];
  document: BlueprintDocument;
  assignment: WorkshopAssignment;
}

/** Pure fixture construction lets malformed assignments fail before a game is created. */
export function measurementLifecycleFixture(): MeasurementLifecycleFixture {
  const id = 'measure-furnace-idle', surface = `af-${id}`;
  const positions = {
    active: { x: 0, y: 0 }, output: { x: 1.5, y: 0.5 }, pole: { x: 1.5, y: 2.5 },
    spare: { x: 5, y: 0 }, sink: { x: 2.5, y: 0.5 }, power: { x: 0, y: 5 },
  };
  const capability: CapabilityProfile = {
    schema: 1, id: 'measurement', revision: 1, fingerprint: 'live-2.0.77', source: 'custom',
    technologies: ['automation', 'automation-2'], researchBonuses: {}, recipes: ['iron-gear-wheel', 'iron-plate'],
    allowedEquipment: ['assembling-machine-2', 'stone-furnace', 'inserter', 'small-electric-pole'],
    locallyManufacturable: [], modules: [], beacons: [], quality: 'normal', surface: 'nauvis',
  };
  const fixtures: WorkshopFixture[] = [
    { id: 'plate-sink', kind: 'sink', position: { ...positions.sink }, product: { kind: 'item', name: 'iron-plate', quality: 'normal' }, rate: 0, transport: 'belt', facing: 4 },
    { id: 'power', kind: 'power', position: { ...positions.power }, product: { kind: 'item', name: 'electricity', quality: 'normal' }, rate: 0 },
  ];
  const document: BlueprintDocument = {
    schema: 1, label: 'Active furnace with a dormant spare',
    description: 'A powered inserter removes the baseline plate before measurement; a burner furnace then becomes idle while an empty spare remains observed.',
    entities: [
      { id: 'active-furnace', entityNumber: 1, name: 'stone-furnace', position: { ...positions.active }, direction: 0, quality: 'normal', recipe: 'iron-plate' },
      { id: 'plate-output', entityNumber: 2, name: 'inserter', position: { ...positions.output }, direction: 12, quality: 'normal' },
      { id: 'power-pole', entityNumber: 3, name: 'small-electric-pole', position: { ...positions.pole }, direction: 0, quality: 'normal' },
      { id: 'dormant-spare', entityNumber: 4, name: 'stone-furnace', position: { ...positions.spare }, direction: 0, quality: 'normal', recipe: 'iron-plate' },
    ], wires: [], ports: [], icons: [{ index: 1, name: 'iron-plate' }], tiles: [],
  };
  const assignment = validateWorkshopAssignment({
    schema: 1, id: 'furnace-lifecycle-pass', revision: 1, comparisonSeries: 'furnace-lifecycle-series',
    objective: 'Produce one iron plate per ten game seconds', source: { kind: 'brief', id: null },
    ports: [
      { id: 'preloaded-ore', direction: 'input', product: { kind: 'item', name: 'iron-ore', quality: 'normal', surface }, position: { ...positions.active }, facing: 4, transport: 'chest', rate: { numerator: '0', denominator: '1' }, unit: 'units-per-game-second', required: true },
      { id: 'plates', direction: 'output', product: { kind: 'item', name: 'iron-plate', quality: 'normal', surface }, position: { ...positions.sink }, facing: 4, transport: 'belt', rate: { numerator: '1', denominator: '10' }, unit: 'units-per-game-second', required: true },
    ],
    profileId: 'measurement', profileRevision: 1, gameFingerprint: 'live-2.0.77',
    footprint: { width: 16, height: 8, clearance: 1, maxTiles: 512 * 512 }, construction: 'direct', libraryAccess: false, improveRevision: null,
    requestedSpeed: { numerator: '10', denominator: '1' }, settlingTicks: 1,
    throughput: [{ portId: 'plates', windowTicks: 600, windows: 1, quantum: { numerator: '1', denominator: '1' }, productionError: { numerator: '0', denominator: '1' }, deliveryError: { numerator: '0', denominator: '1' }, maxStockDrawdown: { numerator: '0', denominator: '1' }, maxResidual: { numerator: '1', denominator: '1' }, interval: '(startTick,endTick]' }],
    rubric: { version: 'live-furnace-1', weights: { throughput: { numerator: '1', denominator: '1' } }, materiality: { throughput: { numerator: '1', denominator: '1' } } },
    iterations: { attempts: 1, mode: 'exact', earlyStop: false, plateauRounds: 1 },
    checkpoints: { brief: false, afterScore: false, libraryAdmission: false, learningActivation: false, timeoutMs: 600000, timeoutAction: 'finish' },
    budgets: { wallMs: 600000, gameTicks: 100000, turns: 1, toolCalls: 1, reportedTokens: null, learningReservedTurns: 0, learningReservedTools: 0 },
    models: { sessionDefault: { provider: 'openai', modelId: 'gpt-6-astra', reasoningEffort: 'low' }, overrides: {} },
    learning: { cadence: 'off', batchSessions: 1, candidateCap: 1, attemptsPerCandidate: 1, autoActivate: false },
  });
  const fixture = { id, surface, capability, positions, fixtures, document, assignment };
  validateMeasurementLifecycleFixture(fixture);
  return fixture;
}

export function validateMeasurementLifecycleFixture(fixture: MeasurementLifecycleFixture): void {
  validateWorkshopAssignment(fixture.assignment);
  assert.equal(fixture.surface, `af-${fixture.id}`);
  const entities = [
    ['active-furnace', 'stone-furnace', fixture.positions.active],
    ['plate-output', 'inserter', fixture.positions.output],
    ['power-pole', 'small-electric-pole', fixture.positions.pole],
    ['dormant-spare', 'stone-furnace', fixture.positions.spare],
  ] as const;
  for (const [id, name, position] of entities) {
    const entity = fixture.document.entities.find(entity => entity.id === id);
    assert(entity, `Lifecycle fixture is missing ${id}`);
    assert.equal(entity.name, name);
    assert.deepEqual(entity.position, position, `Lifecycle geometry disagrees for ${id}`);
    assert(fixture.capability.allowedEquipment.includes(name), `Lifecycle capability excludes ${name}`);
  }
  const sink = fixture.fixtures.find(value => value.id === 'plate-sink');
  assert(sink && sink.kind === 'sink' && sink.transport === 'belt', 'Lifecycle fixture requires its public belt sink');
  assert.deepEqual(sink.position, fixture.positions.sink);
  const power = fixture.fixtures.find(value => value.kind === 'power');
  assert(power, 'Lifecycle fixture requires electricity for its output inserter');
  assert.deepEqual(power.position, fixture.positions.power);
  const input = fixture.assignment.ports.find(value => value.id === 'preloaded-ore');
  const output = fixture.assignment.ports.find(value => value.id === 'plates');
  assert(input && output, 'Lifecycle assignment requires both preloaded input and measured output');
  assert.deepEqual(input.position, fixture.positions.active);
  assert.deepEqual(output.position, fixture.positions.sink);
  assert.equal(input.product.surface, fixture.surface);
  assert.equal(output.product.surface, fixture.surface);
}

/** Console observations use the same half-tile positions as materialization. Mod counters are read separately through inspect(). */
export function measurementLifecycleCounterCommand(fixture: MeasurementLifecycleFixture): string {
  const position = (value: Position) => `{x=${value.x},y=${value.y}}`;
  return `/silent-command local s=game.surfaces[${JSON.stringify(fixture.surface)}];local force=game.forces[${JSON.stringify(fixture.surface)}];local rows=s.find_entities_filtered{type="furnace"};local sum=0;local active=0;local spare={};local scopeStock=0;for _,e in ipairs(rows) do local count=e.products_finished or 0;sum=sum+count;if e.get_recipe() then active=active+1 end;if math.abs(e.position.x-${fixture.positions.spare.x})<0.01 and math.abs(e.position.y-${fixture.positions.spare.y})<0.01 then spare={energy=e.energy or 0,productsFinished=count,hasRecipe=e.get_recipe()~=nil} end;local result=e.get_inventory(defines.inventory.furnace_result);scopeStock=scopeStock+result.get_item_count({name="iron-plate",quality="normal"}) end;local inserter=s.find_entity("inserter",${position(fixture.positions.output)});assert(inserter,"Expected lifecycle output inserter");if inserter.held_stack.valid_for_read and inserter.held_stack.name=="iron-plate" then scopeStock=scopeStock+inserter.held_stack.count end;local sink=s.find_entity("express-transport-belt",${position(fixture.positions.sink)});assert(sink,"Expected lifecycle output belt");for lane=1,sink.get_max_transport_line_index() do for _,item in pairs(sink.get_transport_line(lane).get_contents()) do if item.name=="iron-plate" then scopeStock=scopeStock+item.count end end end;local manufactured=force.get_item_production_statistics(s).get_input_count("iron-plate");rcon.print(helpers.table_to_json{manufactured=manufactured,productsFinished=sum,activeFurnaces=active,furnaceCount=#rows,scopeStock=scopeStock,spare=spare})`;
}

export interface LifecycleCounters {
  manufactured: number;
  productsFinished: number;
  activeFurnaces: number;
  furnaceCount: number;
  delivered: number;
  scopeStock: number;
  spare: { energy: number; productsFinished: number; hasRecipe: boolean };
}

export interface LifecycleObservations {
  firstDone?: LifecycleCounters;
  baseline?: LifecycleCounters;
  latest?: LifecycleCounters;
  timeline: LifecycleCounters[];
  samples: WorkshopWindowMeasurement[];
}

export const LIFECYCLE_TIMELINE_LIMIT = 128;

/** Keep the first observed state and recent states; incomplete evidence never becomes acceptance. */
export function captureLifecycleObservation(observations: LifecycleObservations, counters: LifecycleCounters, samples: WorkshopWindowMeasurement[] = []): LifecycleObservations {
  const timeline = [...observations.timeline, structuredClone(counters)];
  if (timeline.length > LIFECYCLE_TIMELINE_LIMIT) timeline.splice(1, timeline.length - LIFECYCLE_TIMELINE_LIMIT);
  return { ...structuredClone(observations), latest: structuredClone(counters), timeline, samples: [...structuredClone(observations.samples), ...structuredClone(samples)] };
}

export function lifecycleFailureEvidence(stage: string, error: unknown, observations: LifecycleObservations) {
  return {
    schema: 1, passed: false, stage, error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack ?? null } : { name: 'Error', message: String(error), stack: null },
    observations: structuredClone(observations), observationsFile: 'lifecycle-observations.json', modelInference: false,
  };
}
