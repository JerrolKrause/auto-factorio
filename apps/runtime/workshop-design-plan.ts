import type { WorkshopAssignment } from '@autofactorio/contracts';
import type { InstalledWorkshopProfile } from '../../packages/factorio/src/workshop.js';

const amount = (value: { numerator: string; denominator: string }) => Number(value.numerator) / Number(value.denominator);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Public engineering estimates, never a substitute for physical throughput evidence. */
export function workshopDesignPlan(assignment: WorkshopAssignment, installed: InstalledWorkshopProfile) {
  const output = assignment.ports.find(port => port.direction === 'output' && port.required);
  const product = installed.recipe.products.find(row => row.name === output?.product.name && row.type === output.product.kind);
  const facts = installed.machineFacts;
  const warnings: string[] = [];
  const belts = (installed.equipmentFacts ?? []).flatMap(raw => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    if (typeof row.name !== 'string' || row.type !== 'transport-belt' || !positive(row.beltSpeed) || !installed.allowedEquipment.includes(row.name)) return [];
    // Installed belt speed is tiles/tick: four items/tile, 60 ticks/s, two lanes.
    return [{ name: row.name, totalPerSecond: row.beltSpeed * 480, perLanePerSecond: row.beltSpeed * 240 }];
  }).sort((a, b) => a.totalPerSecond - b.totalPerSecond);
  if (!output || !product || !positive(product.amount) || !positive(installed.recipe.energy) || !facts || !positive(facts.craftingSpeed) || !positive(amount(output.rate))) {
    return { schema: 1, basis: 'Installed normal-quality base machine, without module/beacon bonuses', sizing: null, inputs: [], fuel: null, belts, warnings: ['Sizing unavailable: required output or installed recipe/machine facts are incomplete. Do not infer missing values.'] };
  }
  const requiredOutputPerSecond = amount(output.rate);
  const outputPerMachineSecond = facts.craftingSpeed * product.amount / installed.recipe.energy;
  const minimumMachines = Math.ceil(requiredOutputPerSecond / outputPerMachineSecond);
  const recommendedMachines = Math.ceil(requiredOutputPerSecond * 1.25 / outputPerMachineSecond);
  const plannedOutputPerSecond = recommendedMachines * outputPerMachineSecond;
  const plannedCraftsPerSecond = plannedOutputPerSecond / product.amount;
  let fuel: { product: string; requiredPerSecond: number; plannedPerSecond: number } | null = null;
  if (facts.burner) {
    if (positive(facts.energyWatts) && positive(facts.coalFuelJoules)) fuel = {
      product: 'coal', requiredPerSecond: minimumMachines * facts.energyWatts / facts.coalFuelJoules,
      plannedPerSecond: recommendedMachines * facts.energyWatts / facts.coalFuelJoules,
    };
    else warnings.push('Burner fuel demand is unknown: installed energy/fuel facts are incomplete.');
  }
  const demands = installed.recipe.ingredients.map(row => ({ product: row.name, kind: row.type,
    requiredPerSecond: requiredOutputPerSecond / product.amount * row.amount,
    plannedPerSecond: plannedCraftsPerSecond * row.amount }));
  if (fuel) {
    const coal = demands.find(row => row.kind === 'item' && row.product === 'coal');
    if (coal) { coal.requiredPerSecond += fuel.requiredPerSecond; coal.plannedPerSecond += fuel.plannedPerSecond; }
    else demands.push({ ...fuel, kind: 'item' });
  }
  const inputs = demands.map(row => {
    const sources = assignment.ports.filter(port => port.direction === 'input' && port.product.name === row.product && port.product.kind === row.kind);
    const declaredSupplyPerSecond = sources.reduce((sum, port) => sum + amount(port.rate), 0);
    if (declaredSupplyPerSecond < row.plannedPerSecond) warnings.push(`${row.product}: declared supply ${declaredSupplyPerSecond}/s is below planned ${row.plannedPerSecond}/s; machine headroom alone cannot achieve this flow.`);
    return { ...row, declaredSupplyPerSecond, ports: sources.map(port => port.id) };
  });
  const outputBelts = output.product.kind === 'item' ? belts.filter(belt => belt.totalPerSecond > plannedOutputPerSecond).map(belt => belt.name) : [];
  if (output.product.kind === 'item' && !outputBelts.length) warnings.push('No known allowed single belt exceeds planned output. Reconcile capacity and lane routing; do not claim a static throughput proof.');
  return { schema: 1, basis: 'Installed normal-quality base machine, without module/beacon bonuses',
    sizing: { machine: installed.machine, recipe: installed.recipe.id, recipeSeconds: installed.recipe.energy, craftingSpeed: facts.craftingSpeed,
      outputPerCraft: product.amount, requiredOutputPerSecond, outputPerMachineSecond, minimumMachines, recommendedMachines, plannedOutputPerSecond, headroomFactor: 1.25 },
    inputs, fuel, belts, outputBelts, warnings,
    limits: ['Nominal machine and belt capacities do not prove connectivity or inserter throughput.', 'Fuel rates describe full-duty consumption, not the initial fuel inventory needed to fill a long row.', 'The target and evaluator remain unchanged; reconcile this suggested headroom with declared input supplies.'] };
}

