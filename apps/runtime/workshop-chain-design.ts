import type { ResolvedWorkshopChain } from './workshop-chain-resolution.js';
import type { ProductionPlan, ProductionRequest, WorkshopStageRequirement, WorkshopPort } from '@autofactorio/contracts';
import type { CapabilityProfile } from '../../packages/core/workshop/profiles.js';

export interface WorkshopChainDesignInput {
  schema: number; mode: string;
  plan: Pick<ProductionPlan, 'id' | 'revision' | 'fingerprint' | 'availabilityRevision' | 'routes' | 'stages' | 'balances' | 'assumptions' | 'transport'>;
  request: ProductionRequest; stageInterfaces: WorkshopStageRequirement[]; ports: WorkshopPort[];
  profile: CapabilityProfile; installed: ResolvedWorkshopChain['chain']['catalog']; connectivity: string;
}

/** Selected public plan only; no whole-game catalog or private measurement state. */
export function workshopChainDesignInput(resolved: ResolvedWorkshopChain): WorkshopChainDesignInput {
  const { chain, profile } = resolved;
  const input = { schema: 1, mode: 'chain', plan: { id: chain.plan.id, revision: chain.plan.revision,
    fingerprint: chain.plan.fingerprint, availabilityRevision: chain.plan.availabilityRevision,
    routes: chain.plan.routes, stages: chain.plan.stages, balances: chain.plan.balances,
    assumptions: chain.plan.assumptions, transport: chain.plan.transport },
    request: chain.request, stageInterfaces: chain.stages, ports: chain.ports,
    profile, installed: chain.catalog, connectivity: 'unverified' };
  if (Buffer.byteLength(JSON.stringify(input)) > 96000) throw new Error('Selected chain designer input exceeds the 96000-byte limit; reduce the chain boundary.');
  return input;
}
