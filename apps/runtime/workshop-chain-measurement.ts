import type { BlueprintDocument, Rational, ThroughputRule, WorkshopAssignment, WorkshopStageRequirement } from '@autofactorio/contracts';
import type { WorkshopChainResolution } from '../../packages/core/workshop/production.js';
import { digest } from '../../packages/core/production/graph.js';
import { Q } from '../../packages/core/production/rational.js';

/** Installed fluid calibration: finite resolution and conservative error bounds.
 * Use the same policy for the target and co-product ports. */
export const CHAIN_FLUID_MEASUREMENT = {
  quantum: { numerator: '1', denominator: '1000' },
  productionError: { numerator: '2', denominator: '1000' },
  deliveryError: { numerator: '2', denominator: '1000' },
  maxResidual: { numerator: '1', denominator: '100' },
  maxStockDrawdown: { numerator: '2', denominator: '1000' },
} satisfies Pick<ThroughputRule, 'quantum' | 'productionError' | 'deliveryError' | 'maxResidual' | 'maxStockDrawdown'>;

/** Host-owned, immutable requirements. Blueprint/model output never supplies this manifest. */
export interface ChainMeasurementManifest {
  schema: 1;
  assignmentFingerprint: string;
  boundaryFingerprint: string;
  candidateFingerprint: string;
  stages: WorkshopStageRequirement[];
  bindings: {id:string;recipe:string;machine:string;units:number[];fuel?:string}[];
  coProducts: (ThroughputRule & { requiredRate: Rational })[];
}

export function validateChainBindings(manifest:ChainMeasurementManifest,stages:WorkshopStageRequirement[]):void {
  if(!Array.isArray(manifest.bindings)||digest(manifest.bindings.map(({id,recipe,machine,fuel})=>({id,recipe,machine,fuel:fuel??null})))!==digest(stages.map(({id,recipe,machine,fuel})=>({id,recipe,machine,fuel:fuel?.name??null}))))throw new Error('Chain measurement stage bindings differ from immutable plan');
  const units=manifest.bindings.flatMap(binding=>binding.units);
  if(manifest.bindings.some(binding=>!Array.isArray(binding.units)||!binding.units.length)||units.some(unit=>!Number.isSafeInteger(unit)||unit<=0)||new Set(units).size!==units.length)throw new Error('Incomplete chain measurement unit bindings');
}

export function bindChainStages(stages:WorkshopStageRequirement[],document:BlueprintDocument,entities:{unit:number;name:string;position:{x:number;y:number}}[]) {
  return stages.map(stage=>{
    const units=document.entities.filter(entity=>entity.recipe===stage.recipe&&entity.name===stage.machine).map(entity=>{
      const placed=entities.find(value=>value.name===entity.name&&value.position.x===entity.position.x&&value.position.y===entity.position.y);
      if(!placed||!Number.isSafeInteger(placed.unit))throw new Error('Missing reconstructed stage machine');
      return placed.unit;
    });
    if(!units.length||new Set(units).size!==units.length)throw new Error('Incomplete stage machine binding');
    return {id:stage.id,recipe:stage.recipe,machine:stage.machine,units,...(stage.fuel?{fuel:stage.fuel.name}:{})};
  });
}

export function chainMeasurementRequirements(assignment: WorkshopAssignment, chain: WorkshopChainResolution): Pick<ChainMeasurementManifest, 'assignmentFingerprint' | 'stages' | 'coProducts'> {
  if (assignment.productionMode !== 'chain' || !chain.stages.length) throw new Error('Unsupported or incomplete chain measurement manifest');
  const rule = assignment.throughput[0]!;
  const coProducts = chain.ports.filter(port => port.direction === 'byproduct').map(port => {
    const balance = chain.plan.balances.find(value => value.product === `${port.product.kind}:${port.product.name}`);
    if (!balance) throw new Error('Missing co-product balance');
    const rate = Q.from(balance.disposed).div(new Q(1).add(Q.from(chain.request.headroom ?? 0))).json();
    return { ...structuredClone(rule), portId: port.id, requiredRate: rate,
      ...(port.product.kind === 'fluid' ? structuredClone(CHAIN_FLUID_MEASUREMENT) : {}) };
  });
  return { assignmentFingerprint: digest(assignment), stages: structuredClone(chain.stages), coProducts };
}
