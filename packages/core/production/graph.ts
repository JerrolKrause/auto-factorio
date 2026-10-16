import { createHash } from 'node:crypto';
import type { MachineFact, ProductionAvailability, ProductionBlocker, ProductionCatalog, ProductionRequest, ProductionStage, RecipeFact, RecipeFlow } from '@autofactorio/contracts';
import { compatibleMachine } from './facts.js';
import { productId } from './request.js';
import { Q, ZERO } from './rational.js';

export const digest = (value: unknown): string => {
  const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sorted(x)])) : v;
  return createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');
};
export const flowId = (f: RecipeFlow) => `${f.type}:${f.name}`;
export interface PlanningLimits { stages: number; products: number; edges: number; depth: number; pivots: number; solverMs: number; responseBytes: number; pageStages: number; cursorMs: number; cursors: number; revisions: number; artifactBytes: number }
export const PLANNING_LIMITS: PlanningLimits = { stages: 64, products: 128, edges: 512, depth: 40, pivots: 3000, solverMs: 5000, responseBytes: 24000, pageStages: 8, cursorMs: 60000, cursors: 100, revisions: 200, artifactBytes: 2_000_000 };
export interface SelectedGraph { recipes: RecipeFact[]; machines: Map<string, MachineFact>; stages: ProductionStage[]; products: string[]; routes: Record<string, string>; blockers: ProductionBlocker[]; omitted: number }
const conditions = (rows: RecipeFact['surfaceConditions'], availability: ProductionAvailability) => rows.some(c => availability.surfaceProperties[c.property] === undefined || (c.min !== undefined && availability.surfaceProperties[c.property]! < c.min) || (c.max !== undefined && availability.surfaceProperties[c.property]! > c.max));
export function recipeBlockers(recipe: RecipeFact, catalog: ProductionCatalog, availability: ProductionAvailability, request: ProductionRequest): string[] {
  return [
    ...(!availability.recipes[recipe.name]?.enabled ? ['research_locked'] : []),
    ...(request.profile.recipes && !request.profile.recipes.includes(recipe.name) ? ['profile_recipe_denied'] : []),
    ...(conditions(recipe.surfaceConditions, availability) ? ['unsupported_surface'] : []),
    ...(availability.recipes[recipe.name]?.productivity ? ['unsupported_productivity'] : []),
    ...([...recipe.ingredients, ...recipe.products].some(f => {
      if (f.type !== 'fluid') return false;
      const normal = catalog.products.find(p => p.id === flowId(f))?.defaultTemperature;
      return (f.temperature !== undefined && f.temperature !== normal) || (f.minimum_temperature !== undefined && (normal === undefined || f.minimum_temperature > normal)) || (f.maximum_temperature !== undefined && (normal === undefined || f.maximum_temperature < normal));
    }) ? ['unsupported_nondefault_temperature'] : []),
    ...([...recipe.ingredients, ...recipe.products].some(f => f.amount === undefined || f.amount_min !== undefined || f.amount_max !== undefined || (f.probability !== undefined && f.probability !== 1) || (f.extra_count_fraction ?? 0) !== 0 || (f.percent_spoiled ?? 0) !== 0 || catalog.products.find(p => p.id === flowId(f))?.spoilage) ? ['unsupported_stochastic_or_spoilage'] : []),
  ];
}
export function selectGraph(catalog: ProductionCatalog, availability: ProductionAvailability, request: ProductionRequest, limits: PlanningLimits): SelectedGraph {
  const stages = new Map<string, ProductionStage>(), recipes = new Map<string, RecipeFact>(), machines = new Map<string, MachineFact>();
  const products = new Set<string>(), routes: Record<string, string> = {}, blockers: ProductionBlocker[] = []; let omitted = 0, edges = 0, visits = 0;
  const sources = new Set(request.externalInputs.map(e => productId(e.product))), visited = new Set<string>();
  const batchDemand = new Map<string, Q>(), batchCrafts = new Map<string, Q>();
  const stock = new Map(request.initialStock.map(e => [productId(e.product), Q.from(e.quantity)]));
  // These are extraction boundaries, not implicit barrel/ice conversion routes.
  // Explicit conversion selections still use the installed recipe facts.
  const extraction = new Set(['item:iron-ore', 'item:copper-ore', 'item:coal', 'fluid:crude-oil', 'fluid:water']);
  const block = (code: string, product: string, detail: string, stage?: string) => { blockers.push({ code, product, detail, ...(stage ? { stage } : {}) }); };
  const visit = (id: string, path: string[], increment = ZERO) => {
    // Shared batch demand can revisit a DAG along many paths. Bound traversal
    // work as well as its unique stages/edges instead of allowing exponential work.
    if (++visits > Math.max(1, limits.edges * 8)) { omitted++; if (!blockers.some(b => b.code === 'expansion_limit')) block('expansion_limit', id, 'Traversal-work limit; narrow the batch boundary'); return; }
    if (request.mode !== 'quantity' && visited.has(id) && !path.includes(id)) return;
    if (path.length >= limits.depth || (!products.has(id) && products.size >= limits.products)) { omitted++; block('expansion_limit', id, 'Refresh with a narrower explicit boundary'); return; }
    visited.add(id); products.add(id);
    if (!catalog.products.some(p => p.id === id)) { block('unknown_product', id, 'Refresh installed facts or select a known product'); return; }
    let remaining = ZERO;
    if (request.mode === 'quantity') {
      const total = (batchDemand.get(id) ?? ZERO).add(increment);
      batchDemand.set(id, total);
      remaining = total.sub(stock.get(id) ?? ZERO);
      // Revisit shared products when later consumers cross their finite stock
      // boundary. Propagate only the increase in whole crafts to upstream demand.
      if (remaining.cmp(ZERO) <= 0) return;
    }
    if (path.includes(id)) { block('selected_cycle', id, [...path, id].join(' -> ')); return; }
    if (sources.has(id)) return;
    const explicit = request.routes[id];
    if (extraction.has(id) && !explicit) {
      block('unsupported_extraction', id, 'Declare a supplied raw input or sufficient finite-batch stock; extraction is outside supported production routes'); return;
    }
    const producers = catalog.recipes.filter(r => r.products.some(f => flowId(f) === id && (f.amount ?? 0) > 0));
    const ordered = producers.sort((a, b) => {
      const rank = (r: RecipeFact) => Number(/recycling|recycle|barrel/.test(r.name)) * 100 + recipeBlockers(r, catalog, availability, request).length * 10 + Number(!catalog.machines.some(m => compatibleMachine(r, m) && (!request.profile.equipment || m.placementItems.some(p => request.profile.equipment!.includes(p)))));
      return rank(a) - rank(b) || a.id.localeCompare(b.id);
    });
    const recipe = explicit ? producers.find(r => r.id === explicit) : ordered[0];
    if (!recipe) { block('missing_producer', id, explicit ? `Selected ${explicit} does not produce this product` : 'Declare an external source or a supported producer'); return; }
    routes[id] = recipe.id;
    const stageId = `stage.${recipe.name}`;
    const unsupported = recipeBlockers(recipe, catalog, availability, request);
    for (const code of unsupported) block(code, id, `Selected ${recipe.id}; unlock or explicitly revise route/profile`, stageId);
    if (!recipes.has(recipe.id)) {
      if (recipes.size >= limits.stages || edges + recipe.ingredients.length + recipe.products.length > limits.edges) { omitted++; block('expansion_limit', id, 'Stage/edge limit', stageId); return; }
      edges += recipe.ingredients.length + recipe.products.length;
      recipes.set(recipe.id, recipe);
      const eligible = catalog.machines.filter(m => compatibleMachine(recipe, m) && !conditions(m.surfaceConditions, availability) && (!request.profile.equipment || m.placementItems.some(p => request.profile.equipment!.includes(p)))).sort((a, b) => Number(!a.placementItems.some(p => (request.constructionEquipment[p] ?? 0) > 0)) - Number(!b.placementItems.some(p => (request.constructionEquipment[p] ?? 0) > 0)) || a.id.localeCompare(b.id));
      const machine = request.machines[recipe.id] ? eligible.find(m => m.id === request.machines[recipe.id]) : eligible[0];
      if (!machine) block('machine_prerequisite', id, `Select compatible permitted equipment for ${recipe.id}`, stageId);
      else {
        machines.set(recipe.id, machine);
        if (Object.values(machine.baseEffects).some(v => v !== 0)) block('unsupported_machine_bonus', id, 'Base machine effects are outside supported sizing', stageId);
        if (machine.energy.kind === 'unsupported') block('unsupported_utility', id, 'Unsupported energy source', stageId);
      }
      const outputs = recipe.products.map(flowId); outputs.forEach(p => products.add(p));
      const inputs = recipe.ingredients.map(flowId);
      if (machine?.energy.kind === 'burner') {
        const fuel = request.fuels[recipe.id], fact = fuel && catalog.products.find(p => p.id === productId(fuel));
        if (!fact || !fact.fuelValue || !machine.energy.effectivity || !machine.energy.fuelCategories?.includes(fact.fuelCategory ?? '') || fact.spoilage) block('fuel_prerequisite', id, 'Select a compatible permitted fuel and declare its source/producer', stageId);
        else { inputs.push(fact.id); if (request.mode === 'quantity') products.add(fact.id); if (fact.burntResult) { const residue = `item:${fact.burntResult}`; outputs.push(residue); products.add(residue); } }
      }
      stages.set(recipe.id, { id: stageId, recipe: recipe.id, machine: machine?.id ?? null, inputs: [...new Set(inputs)], outputs: [...new Set(outputs)], meaning: '', evidence: [] });
    }
    const stage = stages.get(recipe.id);
    if (request.mode === 'quantity') {
      if (unsupported.length) return;
      const outputs = recipe.products.filter(f => (f.amount ?? 0) > 0);
      if (outputs.length !== 1) return; // The batch calculator reports coupled whole-craft balances as unsupported.
      const crafts = new Q(remaining.div(Q.from(outputs[0]!.amount!)).ceil());
      const delta = crafts.sub(batchCrafts.get(recipe.id) ?? ZERO);
      if (delta.cmp(ZERO) <= 0) return;
      batchCrafts.set(recipe.id, crafts);
      for (const input of recipe.ingredients) visit(flowId(input), [...path, id], delta.mul(Q.from(input.amount!)));
    } else for (const input of stage?.inputs ?? recipe.ingredients.map(flowId)) visit(input, [...path, id]);
  };
  visit(productId(request.target), [], request.mode === 'quantity' ? Q.from(request.quantity!) : ZERO);
  // An explicit selection is a selected route, including optional co-product consumption.
  // Traverse it even when that product was already produced by a shared stage.
  if (request.mode !== 'quantity') for (const id of Object.keys(request.routes).sort()) visit(id, []);
  if (products.size > limits.products) { omitted += products.size - limits.products; block('expansion_limit', productId(request.target), 'Product limit'); }
  const resultStages = [...stages.values()].sort((a, b) => a.recipe.localeCompare(b.recipe));
  for (const stage of resultStages) stage.meaning = digest({ fingerprint: catalog.fingerprint, recipe: recipes.get(stage.recipe), machine: machines.get(stage.recipe), inputs: stage.inputs, outputs: stage.outputs, profile: request.profile, boundary: { sources: request.externalInputs, utilities: request.utilities, equipment: request.constructionEquipment, sinks: request.sinks, transport: request.transport ?? [], stock: request.mode === 'quantity' ? request.initialStock : [] }, headroom: request.headroom ?? 0 });
  return { stages: resultStages, recipes: [...recipes.values()].sort((a, b) => a.id.localeCompare(b.id)), machines, products: [...products].sort(), routes, blockers, omitted };
}
