import { describe, expect, it } from 'vitest';
import type { BlueprintDocument, WorkshopAssignment, WorkshopStageRequirement } from '@autofactorio/contracts';
import type { WorkshopChainResolution } from '../packages/core/workshop/production.js';
import { bindChainStages, chainMeasurementRequirements, validateChainBindings } from '../apps/runtime/workshop-chain-measurement.js';
import { evaluateWorkshop } from '../packages/core/workshop/evaluation.js';

const stage: WorkshopStageRequirement = {
  id: 'stage-sulfur', recipe: 'sulfur', machine: 'chemical-plant', craftsPerSecond: { numerator: '1', denominator: '1' },
  inputs: [{ kind: 'fluid', name: 'petroleum-gas', amount: { numerator: '30', denominator: '1' } }],
  outputs: [{ kind: 'item', name: 'sulfur', amount: { numerator: '2', denominator: '1' } }],
};
const assignment = { productionMode: 'chain', throughput: [{ portId: 'sulfur', windowTicks: 60, windows: 1, quantum: { numerator: '1', denominator: '1' }, productionError: { numerator: '0', denominator: '1' }, deliveryError: { numerator: '0', denominator: '1' }, maxStockDrawdown: { numerator: '0', denominator: '1' }, maxResidual: { numerator: '0', denominator: '1' }, interval: '(startTick,endTick]' }] } as WorkshopAssignment;
const chain = {
  stages: [stage], plan: { stages: [{ fuel: null }], balances: [{ product: 'fluid:light-oil', disposed: { numerator: '5', denominator: '1' } }] },
  request: { headroom: { numerator: '0', denominator: '1' } },
  ports: [{ id: 'light-oil', direction: 'byproduct', product: { kind: 'fluid', name: 'light-oil' } }],
} as unknown as WorkshopChainResolution;
const document: BlueprintDocument = { schema: 1, label: 'sulfur', description: '', entities: [{ id: 'chemical', entityNumber: 1, name: 'chemical-plant', position: { x: 4, y: 2 }, direction: 0, quality: 'normal', recipe: 'sulfur' }], wires: [], ports: [], icons: [], tiles: [] };

describe('candidate-local chain measurement manifest', () => {
  it('keeps the 10-per-second fluid target strict after calibrated error while accepting above-target delivery', () => {
    const fluidAssignment = {
      ports: [{ id: 'output-fluid-petroleum-gas', direction: 'output', product: { kind: 'fluid', name: 'petroleum-gas', quality: 'normal', surface: 'nauvis' },
        rate: { numerator: '10', denominator: '1' } }],
      throughput: [{ portId: 'output-fluid-petroleum-gas', windowTicks: 3600, windows: 1,
        quantum: { numerator: '1', denominator: '1000' }, productionError: { numerator: '2', denominator: '1000' },
        deliveryError: { numerator: '2', denominator: '1000' }, maxStockDrawdown: { numerator: '2', denominator: '1000' },
        maxResidual: { numerator: '1', denominator: '100' }, interval: '(startTick,endTick]' }],
    } as WorkshopAssignment;
    const window = (observed: string) => [{ schema: 1 as const, attemptId: 'fluid-target', index: 0, startTick: 0, endTick: 3600,
      interval: '(startTick,endTick]' as const, connected: true, mutationsFrozen: true, stageCoverage: 'complete' as const,
      energyCoverage: 'complete' as const, contamination: [], evidence: [], ports: [{ portId: 'output-fluid-petroleum-gas',
        product: { kind: 'fluid' as const, name: 'petroleum-gas', quality: 'normal' as const, surface: 'nauvis' },
        production: { numerator: observed, denominator: '1' }, delivery: { numerator: observed, denominator: '1' },
        openingStock: { numerator: '0', denominator: '1' }, closingStock: { numerator: '0', denominator: '1' },
        residual: { numerator: '0', denominator: '1' }, productionAllocationId: 'fluid-cell-0', coverage: 'complete' as const, evidence: [] }] }];

    const exactTarget = evaluateWorkshop(fluidAssignment, window('600'));
    expect(exactTarget).toMatchObject({ valid: true, passed: false, reasons: ['sustained_target_failed'] });
    expect(exactTarget.ports[0]?.windows[0]).toMatchObject({ required: { numerator: '600', denominator: '1' },
      productionLower: { numerator: '299999', denominator: '500' }, deliveryLower: { numerator: '299999', denominator: '500' },
      passed: false, reasons: ['production_below_target', 'delivery_below_target'] });
    expect(evaluateWorkshop(fluidAssignment, window('601'))).toMatchObject({ valid: true, passed: true, reasons: [] });
  });

  it('pins assignment requirements and binds every planned stage to the exact reconstructed machine', () => {
    const requirements = chainMeasurementRequirements(assignment, chain);
    const bindings = bindChainStages([stage], document, [{ unit: 47, name: 'chemical-plant', position: { x: 4, y: 2 } }]);
    const manifest = { schema: 1 as const, ...requirements, boundaryFingerprint: 'boundary-a', candidateFingerprint: 'candidate-a', bindings };
    expect(manifest).toEqual({
      schema: 1,
      assignmentFingerprint: expect.any(String),
      stages: [stage],
      coProducts: [expect.objectContaining({ portId: 'light-oil', requiredRate: { numerator: '5', denominator: '1' } })],
      boundaryFingerprint: 'boundary-a', candidateFingerprint: 'candidate-a',
      bindings: [{ id: 'stage-sulfur', recipe: 'sulfur', machine: 'chemical-plant', units: [47] }],
    });
  });

  it('rejects incomplete and ambiguous candidate machine bindings', () => {
    expect(() => bindChainStages([stage], document, [])).toThrow('Missing reconstructed stage machine');
    const duplicateDocument = { ...document, entities: [...document.entities, { ...document.entities[0]!, id: 'chemical-copy', entityNumber: 2 }] };
    expect(() => bindChainStages([stage], duplicateDocument, [
      { unit: 47, name: 'chemical-plant', position: { x: 4, y: 2 } },
      { unit: 47, name: 'chemical-plant', position: { x: 4, y: 2 } },
    ])).toThrow('Incomplete stage machine binding');
  });

  it('retains manifest requirements for burner chains while game measurement owns fuel support checks', () => {
    const requirements = chainMeasurementRequirements(assignment, { ...chain, plan: { ...chain.plan, stages: [{ fuel: {} }] } } as never);
    expect(requirements.stages).toEqual([stage]);
  });

  it('requires exact planned stage identities and unique nonempty unit bindings', () => {
    const requirements = chainMeasurementRequirements(assignment, chain);
    const manifest = { schema: 1 as const, ...requirements, boundaryFingerprint: 'boundary', candidateFingerprint: 'candidate', bindings: [{ id: stage.id, recipe: stage.recipe, machine: stage.machine, units: [47] }] };
    expect(() => validateChainBindings({ ...manifest, bindings: [{ ...manifest.bindings[0]!, id: 'changed-stage' }] }, [stage])).toThrow('stage bindings differ');
    expect(() => validateChainBindings({ ...manifest, bindings: [{ ...manifest.bindings[0]!, units: [] }] }, [stage])).toThrow('unit bindings');
    expect(() => validateChainBindings({ ...manifest, bindings: [{ ...manifest.bindings[0]!, units: [47, 47] }] }, [stage])).toThrow('unit bindings');
  });
});
