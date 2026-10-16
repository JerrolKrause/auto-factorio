import type { BlueprintDocument, ProductionRequest, WorkshopAssignment } from '@autofactorio/contracts';
import type { InstalledChainContext } from '../../packages/core/workshop/installed-chain.js';

export const CHAIN_REFERENCE_CASES = ['sulfur-direct', 'sulfur-character', 'refining-cracking'] as const;
export type ChainReferenceCase = typeof CHAIN_REFERENCE_CASES[number];

/** A closed diagnostic menu: never accept a save, host, port or profile. */
export function referenceCase(args: string[]): ChainReferenceCase {
  if (args.length !== 2 || args[0] !== '--case' || !CHAIN_REFERENCE_CASES.includes(args[1] as ChainReferenceCase)) {
    throw new Error(`Expected --case ${CHAIN_REFERENCE_CASES.join('|')}; no save/profile/host options are supported`);
  }
  return args[1] as ChainReferenceCase;
}

export function referenceRequest(context: InstalledChainContext, selected: ChainReferenceCase): ProductionRequest {
  const oil = selected === 'refining-cracking';
  const product = (kind: 'item' | 'fluid', name: string) => ({ kind, name, quality: 'normal' as const, surface: 'nauvis' });
  return {
    schema: 1, target: product(oil ? 'fluid' : 'item', oil ? 'petroleum-gas' : 'sulfur'), mode: 'rate',
    rate: { numerator: oil ? '10' : '1', denominator: '1', unit: oil ? 'units-per-game-second' : 'items-per-game-second' },
    profile: { id: context.profile.id, revision: context.profile.revision, fingerprint: context.profile.fingerprint,
      recipes: context.profile.recipes, equipment: context.profile.allowedEquipment },
    facts: { schema: 1, id: `production.${context.snapshot.catalog.fingerprint}`, fingerprint: context.snapshot.catalog.fingerprint,
      availabilityRevision: context.snapshot.availabilityRevision },
    externalInputs: ['crude-oil', 'water'].map(name => ({ product: product('fluid', name), capacity: { kind: 'rate', numerator: '100', denominator: '1' } })),
    initialStock: [], utilities: { electricityWatts: 2_000_000 },
    constructionEquipment: { 'oil-refinery': 2, 'chemical-plant': 1, pipe: 500, 'pipe-to-ground': 20,
      'medium-electric-pole': 30, 'transport-belt': 100, 'fast-inserter': 2 },
    sinks: oil ? [{ product: product('fluid', 'heavy-oil'), capacity: { kind: 'rate', numerator: '20', denominator: '1' } }] : [],
    routes: oil ? { 'fluid:petroleum-gas': 'recipe:light-oil-cracking', 'fluid:light-oil': 'recipe:advanced-oil-processing' }
      : { 'fluid:petroleum-gas': 'recipe:basic-oil-processing' },
    machines: {}, fuels: {},
  };
}

/** Fixed reference schematics, not an agent layout generator. Coordinates use
 * the installed normal Nauvis refinery/chemical/tank ports and are engine-tested.
 * Underground endpoints bridge the explicitly named unlike-fluid crossings. */
export function referenceBlueprint(assignment: Pick<WorkshopAssignment, 'ports'>, selected: ChainReferenceCase, copperConnector: number): BlueprintDocument {
  const oil = selected === 'refining-cracking';
  const entities: BlueprintDocument['entities'] = [], wires: BlueprintDocument['wires'] = [];
  const occupied = new Map<string, string>();
  const add = (name: string, x: number, y: number, direction = 0, recipe?: string) => {
    const key = `${x},${y}`;
    if (occupied.has(key)) throw new Error(`Reference overlaps ${name} with ${occupied.get(key)} at ${key}`);
    const id = `entity-${entities.length + 1}`;
    entities.push({ id, entityNumber: entities.length + 1, name, position: { x, y }, direction, quality: 'normal', ...(recipe ? { recipe } : {}) });
    occupied.set(key, name); return id;
  };
  const pipes = new Set<string>();
  const pipe = (x: number, y: number) => { const key = `${x},${y}`; if (!pipes.has(key)) { add('pipe', x, y); pipes.add(key); } };
  const path = (...points: [number, number][]) => {
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1]!, [bx, by] = points[i]!;
      if (ax !== bx && ay !== by) throw new Error('Reference pipe path must be cardinal');
      const distance = Math.abs(bx - ax) + Math.abs(by - ay);
      for (let n = 0; n <= distance; n++) pipe(ax + Math.sign(bx - ax) * n, ay + Math.sign(by - ay) * n);
    }
  };
  const bridge = (x: number, top: number, bottom: number) => {
    add('pipe-to-ground', x, top, 0); add('pipe-to-ground', x, bottom, 8);
  };
  add('oil-refinery', -16.5, 0.5, 0, oil ? 'advanced-oil-processing' : 'basic-oil-processing');
  if (!oil) add('oil-refinery', -6.5, 0.5, 0, 'basic-oil-processing');
  add('chemical-plant', oil ? 10.5 : 14.5, 0.5, 0, oil ? 'light-oil-cracking' : 'sulfur');
  // Tank fixtures face east. These paths meet their actual west/east connectors.
  path([-30.5, -13.5], [-26.5, -13.5], [-26.5, 6.5], [-15.5, 6.5], [-15.5, 3.5]);
  if (oil) {
    path([-34.5, -5.5], [-36.5, -5.5], [-36.5, 10.5], [6.5, 10.5], [6.5, -3.5], [9.5, -3.5], [9.5, -1.5]);
    path([-17.5, 10.5], [-17.5, 9.5]); bridge(-17.5, 4.5, 8.5);
    pipe(-17.5, 3.5);
    // Heavy oil has an explicit finite outlet; all light oil is physically cracked.
    path([-18.5, -2.5], [-18.5, -16.5], [38.5, -16.5], [38.5, -7.5], [34.5, -7.5]);
    path([-16.5, -2.5], [-16.5, -6.5], [11.5, -6.5], [11.5, -1.5]);
    pipe(-14.5, -2.5); bridge(-14.5, -8.5, -3.5);
    path([-14.5, -9.5], [-14.5, -10.5], [26.5, -10.5], [26.5, -11.5], [30.5, -11.5]);
    path([9.5, 2.5], [9.5, 4.5], [24.5, 4.5], [24.5, -10.5]);
  } else {
    path([-15.5, 4.5], [-5.5, 4.5], [-5.5, 3.5]);
    path([-34.5, -5.5], [-36.5, -5.5], [-36.5, -20.5], [13.5, -20.5], [13.5, -8.5]);
    bridge(13.5, -7.5, -3.5); path([13.5, -2.5], [13.5, -1.5]);
    path([-14.5, -2.5], [-14.5, -5.5], [15.5, -5.5], [15.5, -1.5]);
    path([-4.5, -2.5], [-4.5, -5.5]);
    add('fast-inserter', 14.5, 2.5, 0);
    for (let x = 14.5; x < 28.5; x++) add('transport-belt', x, 3.5, 4);
    for (let y = 3.5; y > -12.5; y--) add('transport-belt', 28.5, y, 0);
    for (let x = 28.5; x < 32.5; x++) add('transport-belt', x, -12.5, 4);
  }
  const poles = [[0.5, 12.5], [0.5, 5.5], [-6.5, 5.5], [-13.5, 5.5], [7.5, 5.5],
    ...(oil ? [[10.5, 3.5]] : [[14.5, 5.5], [18.5, 1.5]])].map(([x, y]) => add('medium-electric-pole', x!, y!));
  const edges = [[0, 1], [1, 2], [2, 3], [1, 4], [4, 5], ...(!oil ? [[5, 6]] : [])];
  for (const [from, to] of edges) wires.push({ from: { entityId: poles[from!]!, connector: String(copperConnector) },
    to: { entityId: poles[to!]!, connector: String(copperConnector) }, color: 'copper' });
  return { schema: 1, label: `Deterministic ${selected} reference`, description: 'Physical pipes/belts only; no process stock or intermediate fixture',
    entities, ports: assignment.ports, wires, icons: [{ index: 1, name: oil ? 'oil-refinery' : 'sulfur' }], tiles: [] };
}
