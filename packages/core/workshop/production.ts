import type { BlueprintDocument, ProductionAvailability, ProductionCatalog, ProductionPlan, ProductionRequest, WorkshopPort, WorkshopStageRequirement } from '@autofactorio/contracts';
import { billOfMaterials, normalizeBlueprint } from './blueprint.js';
import type { CapabilityProfile } from './profiles.js';
import { calculatePlan } from '../production/planner.js';
import { digest } from '../production/graph.js';
import { validateRequest } from '../production/request.js';
import { Q, ZERO } from '../production/rational.js';

export interface WorkshopChainResolution {
  schema: 1; request: ProductionRequest; plan: ProductionPlan;
  ports: WorkshopPort[]; stages: WorkshopStageRequirement[];
  /** Dependencies for physical validation, including fluid geometry and temperature. */
  catalog: Pick<ProductionCatalog, 'recipes' | 'machines'>;
}

/** Resolve against an already authorized installed profile. Never broaden it to fit. */
export function resolveWorkshopChain(raw: ProductionRequest, snapshot: { catalog: ProductionCatalog; availability: ProductionAvailability; availabilityRevision: string }, profile: CapabilityProfile): WorkshopChainResolution {
  const request = validateRequest(raw);
  if (request.mode !== 'rate' || request.target.surface !== profile.surface || profile.surface !== 'nauvis' || profile.quality !== 'normal') throw new Error('Workshop chains require a normal-quality Nauvis rate request');
  if (Object.values(profile.researchBonuses).some(value => value !== 0)) throw new Error('Workshop chain bonuses are unsupported');
  // Profile restrictions are sets. Reordering a public request must not change
  // authority; missing, extra or duplicate restrictions still fail the exact pin.
  const sameRestrictions = (selected: string[] | null, permitted: string[]) => selected !== null && digest([...selected].sort()) === digest([...permitted].sort());
  if (request.profile.id !== profile.id || request.profile.revision !== profile.revision || request.profile.fingerprint !== profile.fingerprint || !sameRestrictions(request.profile.recipes, profile.recipes) || !sameRestrictions(request.profile.equipment, profile.allowedEquipment)) throw new Error('Chain request does not match the authorized installed profile');
  if (request.initialStock.length) throw new Error('Workshop chain evaluation requires zero initial process stock');
  if (request.externalInputs.length > 32 || request.sinks.length > 32) throw new Error('Workshop chain boundary exceeds port limits');
  if (request.utilities.electricityWatts === null) throw new Error('Chain electricity allowance must be explicit');
  const plan = calculatePlan(snapshot.catalog, snapshot.availability, snapshot.availabilityRevision, request);
  if (!plan.executable || plan.status !== 'feasible' || plan.omitted) throw new Error(`Chain plan is not executable: ${plan.blockers.map(value => `${value.code}:${value.detail}`).join('; ')}`);
  plan.id = `plan.${digest(request).slice(0, 32)}`; plan.revision = 1;
  const recipes = plan.stages.map(stage => snapshot.catalog.recipes.find(value => value.id === stage.recipe)!);
  const machines = [...new Set(plan.stages.map(stage => stage.machine))].map(id => snapshot.catalog.machines.find(value => value.id === id)!);
  if (recipes.some(value => !value) || machines.some(value => !value)) throw new Error('Incomplete installed chain facts');
  const stages = plan.stages.map(stage => {
    const recipe = recipes.find(value => value.id === stage.recipe)!;
    const machine = machines.find(value => value.id === stage.machine)!;
    if (!stage.crafts || !profile.recipes.includes(recipe.name) || !profile.allowedEquipment.includes(machine.name)) throw new Error('Chain stage denied by selected profile');
    const inputs = recipe.ingredients.map(value => ({ kind: value.type, name: value.name, amount: Q.from(value.amount!).json() }));
    const outputs = recipe.products.map(value => ({ kind: value.type, name: value.name, amount: Q.from(value.amount!).json() }));
    if (stage.fuel) {
      const fuel = snapshot.catalog.products.find(value => value.id === stage.fuel!.product);
      if (!fuel || fuel.kind !== 'item') throw new Error('Incomplete selected burner fuel facts');
      const crafts = Q.from(stage.crafts), perCraft = crafts.cmp(ZERO) > 0 ? Q.from(stage.fuel.operating).div(crafts) : ZERO;
      const merge = (rows: typeof inputs, name: string) => {
        const existing = rows.find(value => value.kind === 'item' && value.name === name);
        if (existing) existing.amount = Q.from(existing.amount).add(perCraft).json();
        else rows.push({ kind: 'item', name, amount: perCraft.json() });
      };
      // Fuel is a utility edge, not necessarily a recipe ingredient. Keep the
      // same combined consumption and supported residue semantics as the solver.
      merge(inputs, fuel.name);
      if (fuel.burntResult) merge(outputs, fuel.burntResult);
    }
    // The evaluator requires the original target's upstream flow. Optional
    // once-only headroom is physical slack, never a second scoring target.
    const fuel = stage.fuel && snapshot.catalog.products.find(value => value.id === stage.fuel!.product);
    return { id: stage.id, recipe: recipe.name, machine: machine.name, ...(fuel ? {fuel:{name:fuel.name}} : {}), craftsPerSecond: Q.from(stage.crafts).div(new Q(1).add(Q.from(request.headroom ?? 0))).json(),
      inputs, outputs };
  });
  const ports: WorkshopPort[] = [];
  const add = (direction: WorkshopPort['direction'], product: ProductionRequest['target'], rate: Q) => {
    if (rate.cmp(ZERO) <= 0) return;
    if (product.kind === 'item' && rate.cmp(new Q(45)) > 0) throw new Error('Chain boundary exceeds the 45 items/s belt port capacity');
    const input = direction === 'input', index = ports.filter(value => (value.direction === 'input') === input).length;
    ports.push({ id: `${direction}-${product.kind}-${product.name}`, direction, product: structuredClone(product), position: { x: input ? -32.5 : 32.5, y: index * 6 - 12.5 }, facing: 4, transport: product.kind === 'fluid' ? 'pipe' : 'belt', rate: rate.json(), unit: 'units-per-game-second', required: direction !== 'byproduct' });
  };
  for (const source of request.externalInputs) {
    const balance = plan.balances.find(value => value.product === `${source.product.kind}:${source.product.name}`);
    // Unlimited is an operator declaration; a fixture still has a deterministic
    // finite feed rate derived from the shared plan. Never create an internal feed.
    const rate = source.capacity.kind === 'rate' ? Q.from(source.capacity) : balance ? Q.from(balance.external) : ZERO;
    if (source.capacity.kind === 'unknown') throw new Error('Unknown chain source capacity');
    add('input', source.product, rate);
  }
  add('output', request.target, Q.from(request.rate!));
  for (const sink of request.sinks) {
    const balance = plan.balances.find(value => value.product === `${sink.product.kind}:${sink.product.name}`);
    if (balance && Q.from(balance.disposed).cmp(ZERO) > 0) add('byproduct', sink.product, sink.capacity.kind === 'rate' ? Q.from(sink.capacity) : Q.from(balance.disposed));
  }
  if (ports.length > 64 || !ports.some(value => value.direction === 'input')) throw new Error('Chain requires a bounded external production boundary');
  // Match the existing blueprint canonicalizer without moving any physical port.
  ports.sort((a, b) => a.id.localeCompare(b.id));
  return { schema: 1, request, plan, ports, stages, catalog: { recipes, machines: snapshot.catalog.machines.filter(value => profile.allowedEquipment.includes(value.name)) } };
}

/** Shared before direct placement or character provisioning; recipes never fall back. */
export function validateChainBlueprint(input: BlueprintDocument, chain: WorkshopChainResolution, profile: CapabilityProfile): BlueprintDocument {
  const document = normalizeBlueprint(input);
  if (document.tiles.length) throw new Error('Chain construction does not support blueprint tiles');
  if (digest(document.ports) !== digest(chain.ports)) throw new Error('Blueprint ports differ from the pinned chain boundary');
  const present = new Set<string>();
  for (const entity of document.entities) {
    if (!profile.allowedEquipment.includes(entity.name) || entity.quality !== 'normal' || Object.keys(entity.modules ?? {}).length || entity.name === 'beacon') throw new Error(`Chain equipment denied: ${entity.name}`);
    const machine = chain.catalog.machines.find(value => value.name === entity.name);
    if (machine && entity.direction % 4 !== 0) throw new Error('Chain machine direction must be cardinal');
    if (Object.entries(entity.settings ?? {}).some(([name, value]) => !['active', 'inserter_filter_mode', 'splitter_input_priority', 'splitter_output_priority'].includes(name) || !['string', 'boolean'].includes(typeof value))) throw new Error('Unsupported chain entity setting');
    if (entity.recipe || machine) {
      const stage = chain.stages.find(value => value.recipe === entity.recipe && value.machine === entity.name);
      if (!stage) throw new Error(`Unplanned chain recipe/machine: ${entity.name}/${entity.recipe ?? 'unset'}`);
      present.add(stage.id);
    }
  }
  if (chain.stages.some(value => !present.has(value.id))) throw new Error('Blueprint omits a required chain stage');
  for (const [name, count] of Object.entries(billOfMaterials(document))) {
    if (count > (chain.request.constructionEquipment[name] ?? 0)) throw new Error(`Chain construction allowance exceeded: ${name}`);
  }
  return document;
}
