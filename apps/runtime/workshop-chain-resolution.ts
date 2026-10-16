import type { WorkshopAssignment } from '@autofactorio/contracts';
import { validateWorkshopAssignment } from '@autofactorio/contracts';
import type { InstalledChainContext } from '../../packages/core/workshop/installed-chain.js';
import { resolveWorkshopChain } from '../../packages/core/workshop/production.js';
import type { WorkshopChainResolution } from '../../packages/core/workshop/production.js';
import { digest } from '../../packages/core/production/graph.js';
import { workshopSetupRequest } from './workshop-chain-setup.js';
import { CHAIN_FLUID_MEASUREMENT } from './workshop-chain-measurement.js';

export interface ResolvedWorkshopChain {
  schema: 1;
  assignment: WorkshopAssignment;
  profile: InstalledChainContext['profile'];
  chain: WorkshopChainResolution;
}

/** Installed authority and the shared calculator own ports; callers cannot add feeds. */
export function resolveInstalledWorkshopChain(raw: Record<string, unknown>, context: InstalledChainContext): ResolvedWorkshopChain {
  if (raw.productionMode !== 'chain' || raw.profileId !== context.profile.id) throw new Error('Chain installed profile identity mismatch');
  if (raw.chainSetup !== undefined) {
    if (raw.chainRequest !== undefined || raw.ports !== undefined) throw new Error('Chain setup cannot override a resolved request or ports');
    const { chainSetup, ...options } = raw;
    raw = { ...options, chainRequest: workshopSetupRequest(chainSetup, context) };
  }
  if (!raw.chainRequest || typeof raw.chainRequest !== 'object' || Array.isArray(raw.chainRequest) || JSON.stringify(raw.chainRequest).length > 131072) throw new Error('Bounded production request required for chain mode');
  const chain = resolveWorkshopChain(raw.chainRequest as WorkshopChainResolution['request'], context.snapshot, context.profile);
  let assignment: WorkshopAssignment;
  if (Array.isArray(raw.ports)) {
    assignment = validateWorkshopAssignment(raw);
    if (assignment.profileRevision !== context.profile.revision || assignment.gameFingerprint !== context.profile.fingerprint || digest(assignment.ports) !== digest(chain.ports)) throw new Error('Resolved chain assignment no longer matches installed facts or boundary');
  } else {
    const { windowTicks, windows, ...options } = raw;
    const output = chain.ports.find(port => port.direction === 'output' && port.required)!;
    assignment = validateWorkshopAssignment({ ...options, chainRequest: chain.request,
      profileRevision: context.profile.revision, gameFingerprint: context.profile.fingerprint,
      footprint: { width: 500, height: 500, clearance: 4, maxTiles: 512 * 512 }, ports: chain.ports,
      throughput: [{ portId: output.id, windowTicks, windows, quantum: { numerator: '1', denominator: '1' },
        productionError: { numerator: '0', denominator: '1' }, deliveryError: { numerator: '0', denominator: '1' },
        maxStockDrawdown: { numerator: '0', denominator: '1' }, maxResidual: { numerator: '0', denominator: '1' },
        ...(output.product.kind === 'fluid' ? structuredClone(CHAIN_FLUID_MEASUREMENT) : {}), interval: '(startTick,endTick]' }] });
  }
  // Every evaluation owns a new durable plan revision, even when its boundary
  // is equivalent. Plan identity is provenance, never a score equivalence key.
  chain.plan.id = `plan.${assignment.id}`;
  chain.plan.revision = assignment.revision;
  return { schema: 1, assignment, profile: structuredClone(context.profile), chain };
}
