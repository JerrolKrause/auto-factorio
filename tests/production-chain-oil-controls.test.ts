import { describe, expect, it } from 'vitest';
import type { BlueprintDocument, WorkshopWindowMeasurement } from '@autofactorio/contracts';
import { oilControlBlueprint, requireOilDeficit } from '../scripts/dev/production-chain-oil-controls.js';

const zero = { numerator: '0', denominator: '1' };

function blueprint(): BlueprintDocument {
  return {
    schema: 1,
    label: 'oil fault fixture',
    description: '',
    entities: [
      { id: 'crude-connector', entityNumber: 1, name: 'pipe', position: { x: -15.5, y: 3.5 }, direction: 0, quality: 'normal' },
      { id: 'heavy-connector', entityNumber: 2, name: 'pipe', position: { x: -18.5, y: -2.5 }, direction: 0, quality: 'normal' },
      { id: 'refinery', entityNumber: 3, name: 'oil-refinery', position: { x: -16.5, y: 0.5 }, direction: 0, quality: 'normal', recipe: 'advanced-oil-processing' },
      { id: 'plant', entityNumber: 4, name: 'chemical-plant', position: { x: 10.5, y: 0.5 }, direction: 0, quality: 'normal', recipe: 'light-oil-cracking' },
    ],
    ports: [{ id: 'input-crude', direction: 'input', product: { kind: 'fluid', name: 'crude-oil', quality: 'normal', surface: 'nauvis' }, position: { x: -30.5, y: -13.5 }, facing: 0, transport: 'pipe', rate: { numerator: '1', denominator: '1' }, unit: 'units-per-game-second', required: true }],
    wires: [{ from: { entityId: 'pole-a', connector: '1' }, to: { entityId: 'pole-b', connector: '1' }, color: 'copper' }],
    icons: [], tiles: [],
  };
}

function sample(index: number): WorkshopWindowMeasurement {
  return {
    schema: 1,
    attemptId: 'oil-negative:1',
    index,
    startTick: 300 + index * 3600,
    endTick: 3900 + index * 3600,
    interval: '(startTick,endTick]',
    ports: [{
      portId: 'output-petroleum-gas',
      product: { kind: 'fluid', name: 'petroleum-gas', quality: 'normal', surface: 'nauvis' },
      production: zero, delivery: zero, openingStock: zero, closingStock: zero, residual: zero,
      productionAllocationId: `gas-${index}`, coverage: 'complete', evidence: ['native-port-window'],
    }],
    stages: [
      { id: 'stage-advanced-oil', recipe: 'advanced-oil-processing', machine: 'oil-refinery', crafts: zero, coverage: 'complete', inputs: [{ kind: 'fluid', name: 'crude-oil', amount: zero, error: zero }], outputs: [{ kind: 'fluid', name: 'light-oil', amount: zero, error: zero }], evidence: ['refinery-unit'] },
      { id: 'stage-light-cracking', recipe: 'light-oil-cracking', machine: 'chemical-plant', crafts: zero, coverage: 'complete', inputs: [{ kind: 'fluid', name: 'light-oil', amount: zero, error: zero }], outputs: [{ kind: 'fluid', name: 'petroleum-gas', amount: zero, error: zero }], evidence: ['plant-unit'] },
    ],
    stageCoverage: 'complete', energyCoverage: 'complete', contamination: [], mutationsFrozen: true, connected: true, evidence: ['native-window'],
  };
}

const fiveWindows = () => Array.from({ length: 5 }, (_, index) => sample(index));
const amount = (value: string) => ({ numerator: value, denominator: '1' });

describe('production-chain oil negative controls', () => {
  it.each([
    ['missing-crude', 'crude-connector'],
    ['blocked-heavy', 'heavy-connector'],
  ] as const)('%s removes only its exact machine-adjacent connector from a cloned blueprint', (scenario, connectorId) => {
    const source = blueprint();
    const original = structuredClone(source);
    const faulted = oilControlBlueprint(source, scenario);

    expect(source).toEqual(original);
    expect(faulted.entities.map(entity => entity.id)).toEqual(original.entities.map(entity => entity.id).filter(id => id !== connectorId));
    expect(faulted.ports).toEqual(original.ports);
    expect(faulted.wires).toEqual(original.wires);
  });

  it.each([
    ['missing-crude', { x: -15.4, y: 3.5 }],
    ['blocked-heavy', { x: -18.5, y: -2.4 }],
  ] as const)('%s fails closed when the intended pipe is absent at its exact coordinate', (scenario, position) => {
    const source = blueprint();
    source.entities.find(entity => entity.name === 'pipe' && entity.position.x === (scenario === 'missing-crude' ? -15.5 : -18.5))!.position = position;
    expect(() => oilControlBlueprint(source, scenario)).toThrow('Expected exactly one physical fault connector');
  });

  it('adds an undeclared light-oil port only to the malicious blueprint clone', () => {
    const source = blueprint();
    const original = structuredClone(source);
    const faulted = oilControlBlueprint(source, 'undeclared-port');
    expect(source).toEqual(original);
    expect(faulted.ports).toHaveLength(2);
    expect(faulted.ports[1]).toMatchObject({ id: 'input-fluid-light-oil', direction: 'input', product: { name: 'light-oil' } });
    expect(faulted.entities).toEqual(original.entities);
    expect(faulted.wires).toEqual(original.wires);
  });

  it.each(['preloaded-target', 'injected-light'] as const)('%s leaves the reference document content intact', scenario => {
    const source = blueprint();
    const faulted = oilControlBlueprint(source, scenario);
    expect(faulted).toEqual(source);
    expect(faulted).not.toBe(source);
  });

  it.each(['missing-crude', 'blocked-heavy'] as const)('%s accepts five contiguous complete zero-flow windows', scenario => {
    expect(() => requireOilDeficit(fiveWindows(), scenario)).not.toThrow();
  });

  const rejectedMutations: [string, (samples: WorkshopWindowMeasurement[]) => void][] = [
    ['nonzero craft count', samples => { samples[2]!.stages![0]!.crafts = amount('1'); }],
    ['nonzero stage input flow', samples => { samples[1]!.stages![0]!.inputs[0]!.amount = amount('1'); }],
    ['nonzero intermediate output flow', samples => { samples[3]!.stages![0]!.outputs[0]!.amount = amount('1'); }],
    ['missing stage evidence', samples => { samples[0]!.stages = [samples[0]!.stages![0]!]; }],
    ['incomplete stage coverage', samples => { samples[0]!.stages![1]!.coverage = 'partial'; }],
    ['incomplete window coverage', samples => { samples[0]!.stageCoverage = 'partial'; }],
    ['incomplete port coverage', samples => { samples[0]!.ports[0]!.coverage = 'partial'; }],
    ['target production', samples => { samples[0]!.ports[0]!.production = amount('1'); }],
    ['target delivery', samples => { samples[0]!.ports[0]!.delivery = amount('1'); }],
    ['residual fluid', samples => { samples[0]!.ports[0]!.residual = amount('1'); }],
    ['contamination', samples => { samples[0]!.contamination = ['unexpected-fluid']; }],
    ['cadence gap', samples => { samples[2]!.startTick += 1; samples[2]!.endTick += 1; }],
  ];

  it.each(rejectedMutations)('rejects %s in otherwise valid deficit measurements', (_label, mutate) => {
    const samples = fiveWindows();
    mutate(samples);
    expect(() => requireOilDeficit(samples, 'missing-crude')).toThrow();
  });
});
