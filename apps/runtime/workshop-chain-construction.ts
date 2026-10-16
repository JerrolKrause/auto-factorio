import type { BlueprintDocument, Exact, WorkshopAssignment } from '@autofactorio/contracts';
import type { CapabilityProfile } from '../../packages/core/workshop/profiles.js';
import type { InstalledChainContext } from '../../packages/core/workshop/installed-chain.js';
import { validateChainBlueprint } from '../../packages/core/workshop/production.js';
import type { WorkshopChainResolution } from '../../packages/core/workshop/production.js';
import { billOfMaterials } from '../../packages/core/workshop/blueprint.js';
import { compileCharacterBlueprint } from '../../packages/core/workshop/construction.js';
import { digest } from '../../packages/core/production/graph.js';
import type { WorkshopFixture } from '../../packages/factorio/src/workshop.js';
import { resolveInstalledWorkshopChain } from './workshop-chain-resolution.js';
import { Q, ZERO } from '../../packages/core/production/rational.js';

/** Target rate is required delivery, not a disposal ceiling. A fluid destination
 * must let the physical chain demonstrate a conservative lower bound above that
 * target. Derive a finite full-duty bound from declared equipment, independent
 * of a candidate's layout. Source and explicit co-product capacities stay exact;
 * the request/equipment/catalog pins also preserve this bound in library identity. */
export function targetFluidDrainBound(chain: WorkshopChainResolution): Exact {
  const target = chain.request.target;
  let bound = ZERO;
  for (const stage of chain.stages) {
    const recipe = chain.catalog.recipes.find(value => value.name === stage.recipe)!;
    const machine = chain.catalog.machines.find(value => value.name === stage.machine)!;
    const output = recipe.products.find(value => value.type === target.kind && value.name === target.name);
    if (!output) continue;
    bound = bound.add(Q.from(output.amount!).mul(Q.from(machine.speed)).div(Q.from(recipe.seconds))
      .mul(Q.from(chain.request.constructionEquipment[stage.machine] ?? 0)));
  }
  const required = Q.from(chain.request.rate!);
  if (bound.cmp(required) < 0) throw new Error('Target drain capacity lacks declared production equipment');
  return bound.json();
}

/** Pure pre-mutation admission shared by direct and legal-character construction. */
export function prepareChainConstruction(assignment: WorkshopAssignment, input: BlueprintDocument, profile: CapabilityProfile, context: InstalledChainContext) {
  const resolved = resolveInstalledWorkshopChain(assignment as unknown as Record<string, unknown>, context);
  if (digest(profile) !== digest(resolved.profile)) throw new Error('Chain construction profile differs from installed pin');
  const document = validateChainBlueprint(input, resolved.chain, profile);
  // Compile against the declared bill before even provisioning. Unsupported
  // character settings/wires/underground pairs must not leave setup effects.
  // Work positions must avoid protected fixtures as well as candidate entities.
  // A source tank occupies several tiles; an otherwise empty blueprint position
  // inside it cannot be reached. The chain's declared clearance covers the
  // supported 3x3 tank, belt and power fixtures plus character collision radius.
  const fixtureCenters = [...resolved.chain.ports.map(port => port.position), { x: 0, y: 14 }];
  const fixtureClearance = Math.max(3, assignment.footprint.clearance);
  const canStand = (position: { x: number; y: number }) => fixtureCenters.every(center =>
    Math.abs(position.x - center.x) >= fixtureClearance || Math.abs(position.y - center.y) >= fixtureClearance
  ) && document.entities.every(entity => {
    const box = resolved.chain.catalog.machines.find(machine => machine.name === entity.name)?.collisionBox;
    if (!box) return Math.abs(position.x - entity.position.x) >= 1 || Math.abs(position.y - entity.position.y) >= 1;
    const rotated = entity.direction === 4 || entity.direction === 12;
    const halfX = Math.max(Math.abs(box[0].x), Math.abs(box[1].x)) + 0.3;
    const halfY = Math.max(Math.abs(box[0].y), Math.abs(box[1].y)) + 0.3;
    return Math.abs(position.x - entity.position.x) >= (rotated ? halfY : halfX) || Math.abs(position.y - entity.position.y) >= (rotated ? halfX : halfY);
  });
  // Refineries are wider than assemblers: the work position must also be
  // outside the final collision box or the actor can prevent legal placement.
  const character = assignment.construction === 'character' ? compileCharacterBlueprint(document, billOfMaterials(document), canStand) : null;
  const finite = (value: { numerator: string; denominator: string }) => {
    const rate = Number(value.numerator) / Number(value.denominator);
    if (!Number.isFinite(rate) || rate < 0) throw new Error('Unrepresentable chain fixture capacity');
    return rate;
  };
  const fixtures: WorkshopFixture[] = resolved.chain.ports.map(port => ({ id: port.id,
    kind: port.direction === 'input' ? 'source' : 'sink', position: port.position,
    product: { kind: port.product.kind, name: port.product.name, quality: 'normal' },
    rate: finite(port.direction === 'output' && port.product.kind === 'fluid' ? targetFluidDrainBound(resolved.chain) : port.rate),
    transport: port.transport, facing: port.facing, bounded: true }));
  fixtures.push({ id: 'power', kind: 'power', position: { x: 0, y: 14 },
    product: { kind: 'item', name: 'electricity', quality: 'normal' },
    rate: resolved.chain.request.utilities.electricityWatts!, bounded: true });
  return { resolved, document, character, fixtures,
    boundaryFingerprint: digest({ assignment: resolved.assignment, chain: resolved.chain, document, fixtures }) };
}
