import type { ProductionProduct, ProductionRequest } from '@autofactorio/contracts';
import { setupDecimal, setupRows, validateWorkshopChainSetup } from '@autofactorio/contracts';
import { PLANNING_LIMITS, selectGraph } from '../../packages/core/production/graph.js';
import type { InstalledChainContext } from '../../packages/core/workshop/installed-chain.js';

/** Only installed authority supplies identities. Setup never carries caller profile/fact pins. */
export function workshopSetupRequest(value: unknown, context: InstalledChainContext): ProductionRequest {
  const setup = validateWorkshopChainSetup(value), { profile, snapshot } = context;
  const product = (name: string): ProductionProduct => {
    const matches = snapshot.catalog.products.filter(row => row.name === name);
    if (matches.length !== 1) throw new Error(`Unknown or ambiguous installed product: ${name}`);
    return { kind: matches[0]!.kind, name, surface: profile.surface, quality: 'normal' };
  };
  const externalInputs = setupRows(setup.inputs, 'External inputs').map(row => {
    if (!['iron-ore','copper-ore','coal','crude-oil','water'].includes(row.name)) throw new Error(`Chain setup requires raw external inputs: ${row.name}`);
    return { product: product(row.name), capacity: { kind: 'rate' as const, ...setupDecimal(row.amount, 'Source rate') } };
  });
  const constructionEquipment = Object.fromEntries(setupRows(setup.equipment, 'Construction equipment', true).map(row => {
    if (!profile.allowedEquipment.includes(row.name)) throw new Error(`Profile-denied equipment: ${row.name}`);
    return [row.name, Number(row.amount)];
  }));
  const fuels: ProductionRequest['fuels'] = {};
  if (externalInputs.some(row => row.product.kind === 'item' && row.product.name === 'coal')) {
    for (const recipe of snapshot.catalog.recipes.filter(row => profile.recipes.includes(row.name))) {
      if (snapshot.catalog.machines.some(machine => profile.allowedEquipment.includes(machine.name) && machine.categories.includes(recipe.category) && machine.energy.kind === 'burner')) fuels[recipe.id] = product('coal');
    }
  }
  const target = product(setup.target);
  const electricity = setupDecimal(setup.electricityMW, 'Electricity');
  const request: ProductionRequest = { schema: 1, mode: 'rate', target, rate: { ...setupDecimal(setup.rate, 'Target rate'), unit: target.kind === 'item' ? 'items-per-game-second' : 'units-per-game-second' },
    profile: { id: profile.id, revision: profile.revision, fingerprint: profile.fingerprint, recipes: [...profile.recipes], equipment: [...profile.allowedEquipment] },
    facts: { schema: 1, id: `production.${snapshot.catalog.fingerprint}`, fingerprint: snapshot.catalog.fingerprint, availabilityRevision: snapshot.availabilityRevision },
    externalInputs, initialStock: [], utilities: { electricityWatts: Number(BigInt(electricity.numerator) * 1000000n / BigInt(electricity.denominator)) }, constructionEquipment,
    sinks: setupRows(setup.sinks, 'Co-product destinations').map(row => ({ product: product(row.name), capacity: { kind: 'rate', ...setupDecimal(row.amount, 'Sink rate') } })),
    routes: {}, machines: {}, fuels };
  // Explicit routes add graph roots. Apply the oil preference only when the
  // target closure needs petroleum; it must not create an unrelated oil chain.
  const graph = selectGraph(snapshot.catalog, snapshot.availability, request, PLANNING_LIMITS);
  if (Object.hasOwn(graph.routes, 'fluid:petroleum-gas')) request.routes['fluid:petroleum-gas'] = `recipe:${setup.oilRoute}-oil-processing`;
  return request;
}
