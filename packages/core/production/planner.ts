import type { Exact, MachineFact, ProductionAvailability, ProductionBalance, ProductionCatalog, ProductionPlan, ProductionRequest } from '@autofactorio/contracts';
import { digest, flowId, PLANNING_LIMITS, selectGraph } from './graph.js';
import type { PlanningLimits, SelectedGraph } from './graph.js';
import { ComputationLimit, ONE, Q, sum, ZERO } from './rational.js';
import { productId, validateRequest } from './request.js';
import { equality, solveRoutes } from './solver.js';
import type { LinearConstraint } from './solver.js';

const zeroBalance = (product: string): ProductionBalance => ({ product, produced: ZERO.json(), consumed: ZERO.json(), external: ZERO.json(), delivered: ZERO.json(), disposed: ZERO.json(), residual: ZERO.json() });
const craftLoad = (seconds: number, machine: MachineFact) => Q.from(seconds).div(Q.from(machine.speed));
const fullPower = (machine: MachineFact) => Q.from(machine.energy.maxJoulesPerTick).mul(new Q(60));
const fuelCost = (recipe: SelectedGraph['recipes'][number], machine: MachineFact, request: ProductionRequest, catalog: ProductionCatalog): Q => {
  const fuel = catalog.products.find(p => p.id === productId(request.fuels[recipe.id]!))!;
  return craftLoad(recipe.seconds, machine).mul(fullPower(machine)).div(Q.from(machine.energy.effectivity!)).div(Q.from(fuel.fuelValue!));
};

/** Pure bounded calculation. Persistence and authenticated delivery are separate adapters. */
export function calculatePlan(catalog: ProductionCatalog, availability: ProductionAvailability, availabilityRevision: string, raw: ProductionRequest, limits: PlanningLimits = PLANNING_LIMITS, now = Date.now): ProductionPlan {
  const request = validateRequest(raw);
  const plan: ProductionPlan = { schema: 1, id: '', revision: 0, request, fingerprint: catalog.fingerprint, availabilityRevision, status: 'incomplete', executable: false, routePolicy: 'ordinary-nauvis-available-before-recycling-or-barreling-stable-id/v1', routes: {}, stages: [], products: [], blockers: [], assumptions: ['Normal quality on Nauvis; no modules, beacons or research productivity.', 'Nominal craft capacity is not measured throughput, transport connectivity, layout validity or scenario success.', 'Extraction, electricity generation and construction equipment manufacture are supplied boundaries or unresolved prerequisites.', 'Finite stock never establishes a sustained supply or completion time.'], balances: [], transport: [], omitted: 0, invalidatedEvidence: [] };
  const block = (code: string, detail: string, stage?: string, product?: string) => plan.blockers.push({ code, detail, ...(stage ? { stage } : {}), ...(product ? { product } : {}) });
  if (request.facts.fingerprint !== catalog.fingerprint || request.facts.availabilityRevision !== availabilityRevision) {
    block('stale_facts', 'Refresh production_search facts and explicitly revalidate the request'); return plan;
  }
  try {
    const graph = selectGraph(catalog, availability, request, limits);
    Object.assign(plan, { routes: graph.routes, stages: graph.stages, products: graph.products, blockers: graph.blockers, omitted: graph.omitted });
    if (graph.blockers.length) return plan;
    if (request.mode === 'explore') { plan.status = 'exploration'; return plan; }
    if (request.mode === 'quantity') { quantity(plan, graph); return plan; }
    rate(plan, graph, catalog, limits, now);
  } catch (error) {
    if (!(error instanceof ComputationLimit)) throw error;
    block(error.message, 'Computation cap reached; narrow the boundary or request'); plan.status = 'incomplete'; plan.executable = false;
  }
  return plan;
}

function rate(plan: ProductionPlan, graph: SelectedGraph, catalog: ProductionCatalog, limits: PlanningLimits, now: () => number) {
  const request = plan.request, target = productId(request.target), targetDemand = Q.from(request.rate!);
  const headroom = targetDemand.mul(Q.from(request.headroom ?? 0)), sized = targetDemand.add(headroom);
  plan.targetDemand = targetDemand.json(); plan.headroomDemand = headroom.json();
  plan.assumptions.push('Headroom applies once to target delivery before rebalancing.', 'Utility operating lower bounds use continuous working load; rounded installed machines define conservative full-duty upper bounds. Idle drain is added when known. Between-bound supplies remain incomplete.', 'Transport reports item/fluid flow only; belt lanes, inserters, pipes and connectivity require a physical design.');
  const sources = request.externalInputs.filter(e => graph.products.includes(productId(e.product))).sort((a, b) => productId(a.product).localeCompare(productId(b.product)));
  const sinks = request.sinks.filter(e => graph.products.includes(productId(e.product))).sort((a, b) => productId(a.product).localeCompare(productId(b.product)));
  const n = graph.recipes.length + sources.length + sinks.length;
  const constraints: LinearConstraint[] = [], coefficients = new Map<string, Q[]>();
  const production = new Map<string, Q[]>(), consumption = new Map<string, Q[]>();
  for (const id of graph.products) { coefficients.set(id, Array.from({ length: n }, () => ZERO)); production.set(id, Array.from({ length: graph.recipes.length }, () => ZERO)); consumption.set(id, Array.from({ length: graph.recipes.length }, () => ZERO)); }
  const add = (id: string, i: number, amount: Q, output: boolean) => {
    const row = coefficients.get(id)!; row[i] = row[i]!.add(output ? amount : amount.neg());
    const aggregate = (output ? production : consumption).get(id)!; aggregate[i] = aggregate[i]!.add(amount);
  };
  graph.recipes.forEach((recipe, i) => {
    recipe.ingredients.forEach(f => add(flowId(f), i, Q.from(f.amount!), false));
    recipe.products.forEach(f => add(flowId(f), i, Q.from(f.amount!), true));
    const machine = graph.machines.get(recipe.id)!;
    if (machine.energy.kind === 'burner') {
      const fuel = catalog.products.find(p => p.id === productId(request.fuels[recipe.id]!))!;
      const usage = fuelCost(recipe, machine, request, catalog); add(fuel.id, i, usage, false);
      if (fuel.burntResult) add(`item:${fuel.burntResult}`, i, usage, true);
    }
  });
  sources.forEach((source, i) => {
    const index = graph.recipes.length + i, id = productId(source.product); coefficients.get(id)![index] = ONE;
    if (source.capacity.kind === 'rate') constraints.push({ coefficients: Array.from({ length: n }, (_, j) => j === index ? ONE : ZERO), bound: Q.from(source.capacity), label: `source_capacity:${id}` });
    if (source.capacity.kind === 'unknown') plan.blockers.push({ code: 'unknown_source_capacity', product: id, detail: 'Declare a sustained cap or explicitly unlimited supply' });
  });
  sinks.forEach((sink, i) => {
    const index = graph.recipes.length + sources.length + i, id = productId(sink.product); coefficients.get(id)![index] = ONE.neg();
    if (sink.capacity.kind === 'rate') constraints.push({ coefficients: Array.from({ length: n }, (_, j) => j === index ? ONE : ZERO), bound: Q.from(sink.capacity), label: `sink_capacity:${id}` });
  });
  for (const [id, row] of coefficients) constraints.push(...equality(row, id === target ? sized : ZERO, `balance:${id}`));
  for (const t of request.transport ?? []) {
    const id = productId(t.product); if (!coefficients.has(id)) continue;
    const row = Array.from({ length: n }, (_, i) => i < graph.recipes.length ? consumption.get(id)![i]! : ZERO);
    const sinkIndex = sinks.findIndex(s => productId(s.product) === id);
    if (sinkIndex !== -1) row[graph.recipes.length + sources.length + sinkIndex] = ONE;
    constraints.push({ coefficients: row, bound: Q.from(t.capacity).sub(id === target ? sized : ZERO), label: `transport_capacity:${id}` });
  }
  const electricLower = Array.from({ length: n }, () => ZERO);
  graph.recipes.forEach((recipe, i) => { const m = graph.machines.get(recipe.id)!; if (m.energy.kind === 'electric') electricLower[i] = craftLoad(recipe.seconds, m).mul(fullPower(m)); });
  if (request.utilities.electricityWatts !== null) constraints.push({ coefficients: electricLower, bound: Q.from(request.utilities.electricityWatts), label: 'electricity_working_lower' });
  const budget = { pivots: 0, maxPivots: limits.pivots, deadline: now() + limits.solverMs, now };
  const result = solveRoutes(constraints, n, graph.recipes.length, budget);
  if (result.status !== 'optimal') {
    plan.status = result.status === 'infeasible' ? 'infeasible' : 'incomplete';
    plan.blockers.push({ code: result.status === 'infeasible' ? 'material_or_utility_capacity' : 'unbounded_solver', detail: `Selected balances cannot meet target under declared sources/sinks, transport and working utility limits: ${constraints.filter(c => c.label.startsWith('source_') || c.label.startsWith('sink_') || c.label.startsWith('balance:') || c.label.startsWith('electricity_') || c.label.startsWith('transport_')).map(c => c.label).join(', ')}` }); return;
  }
  const x = result.values, sourceAmount = new Map<string, Q>();
  sources.forEach((source, i) => sourceAmount.set(productId(source.product), x[graph.recipes.length + i]!));
  const fuelLower = new Map<string, Q>(), fuelUpper = new Map<string, Q>(); let lowerPower = ZERO, upperPower = ZERO;
  const equipment = new Map<string, number>();
  graph.recipes.forEach((recipe, i) => {
    const stage = plan.stages.find(s => s.recipe === recipe.id)!, m = graph.machines.get(recipe.id)!, crafts = x[i]!, load = crafts.mul(craftLoad(recipe.seconds, m));
    const count = Number(load.ceil()); if (!Number.isSafeInteger(count)) throw new ComputationLimit('machine_count_limit');
    stage.crafts = crafts.json(); stage.fractionalMachines = load.json(); stage.machines = count;
    stage.nominalCraftsPerSecond = new Q(count).mul(Q.from(m.speed)).div(Q.from(recipe.seconds)).json();
    const item = m.placementItems.find(p => (request.constructionEquipment[p] ?? 0) > 0) ?? m.placementItems[0];
    if (!item && count) plan.blockers.push({ code: 'equipment_prerequisite', stage: stage.id, detail: 'Machine has no supplied placement item' });
    else if (item) equipment.set(item, (equipment.get(item) ?? 0) + count);
    if (m.energy.kind === 'electric') {
      const drain = m.energy.drainJoulesPerTick;
      if (drain === undefined && count) plan.blockers.push({ code: 'unknown_idle_drain', stage: stage.id, detail: 'No validated upper bound for idle drain' });
      const idle = Q.from(drain ?? 0).mul(new Q(60 * count));
      const lower = load.mul(fullPower(m)).add(idle), upper = new Q(count).mul(fullPower(m)).add(idle);
      lowerPower = lowerPower.add(lower); upperPower = upperPower.add(upper);
      stage.power = { lowerWatts: lower.json(), upperWatts: upper.json(), fullDutyWatts: upper.json(), basis: 'Continuous working-load lower bound plus known installed idle drain; rounded full-duty upper bound' };
    } else if (m.energy.kind === 'burner') {
      const fuel = catalog.products.find(p => p.id === productId(request.fuels[recipe.id]!))!, lower = crafts.mul(fuelCost(recipe, m, request, catalog));
      const upper = new Q(count).mul(fullPower(m)).div(Q.from(m.energy.effectivity!)).div(Q.from(fuel.fuelValue!));
      stage.fuel = { product: fuel.id, operating: lower.json(), fullDuty: upper.json() };
      fuelLower.set(fuel.id, (fuelLower.get(fuel.id) ?? ZERO).add(lower)); fuelUpper.set(fuel.id, (fuelUpper.get(fuel.id) ?? ZERO).add(upper));
    }
    stage.meaning = digest({ definition: stage.meaning, crafts: stage.crafts, machines: stage.machines, fuel: stage.fuel ?? null, power: stage.power ?? null });
  });
  for (const [item, count] of equipment) if ((request.constructionEquipment[item] ?? 0) < count) plan.blockers.push({ code: 'equipment_prerequisite', product: `item:${item}`, detail: `Supply ${count} construction ${item}; equipment manufacture is unsupported` });
  let infeasible = false;
  const checkBound = (supplied: Q | null, lower: Q, upper: Q, id: string) => {
    if (upper.cmp(ZERO) === 0) return;
    if (supplied === null) plan.blockers.push({ code: 'utility_prerequisite', product: id, detail: 'Declare a compatible sustained utility allowance' });
    else if (supplied.cmp(lower) < 0) { infeasible = true; plan.blockers.push({ code: 'utility_capacity', product: id, detail: `Supply below validated operating lower bound ${JSON.stringify(lower.json())}` }); }
    else if (supplied.cmp(upper) < 0) plan.blockers.push({ code: 'utility_between_bounds', product: id, detail: `Supply between operating ${JSON.stringify(lower.json())} and rounded full-duty ${JSON.stringify(upper.json())}; physical duty remains unresolved` });
  };
  checkBound(request.utilities.electricityWatts === null ? null : Q.from(request.utilities.electricityWatts), lowerPower, upperPower, 'electricity');
  // Recipe coal and all burner coal are one capacity, never independently credited.
  for (const [id, lower] of fuelLower) {
    const source = sources.find(s => productId(s.product) === id);
    if (source?.capacity.kind === 'rate') checkBound(Q.from(source.capacity), sourceAmount.get(id)!, sourceAmount.get(id)!.sub(lower).add(fuelUpper.get(id)!), id);
    else if (!source) {
      // Internally produced fuel is balanced at working demand, but the unvalidated
      // rounded-duty margin cannot silently become a sustained feasibility claim.
      if (fuelUpper.get(id)!.cmp(lower) > 0) plan.blockers.push({ code: 'internal_fuel_between_bounds', product: id, detail: 'Selected internal fuel route balances working load only; validate rounded duty or revise supply' });
    }
  }
  plan.balances = graph.products.map(id => {
    const produced = sum(production.get(id)!.map((a, i) => a.mul(x[i]!))), consumed = sum(consumption.get(id)!.map((a, i) => a.mul(x[i]!)));
    const external = sourceAmount.get(id) ?? ZERO, delivered = id === target ? sized : ZERO;
    const sinkIndex = sinks.findIndex(s => productId(s.product) === id), disposed = sinkIndex === -1 ? ZERO : x[graph.recipes.length + sources.length + sinkIndex]!;
    const residual = produced.add(external).sub(consumed).sub(delivered).sub(disposed);
    if (residual.cmp(ZERO) !== 0) throw new Error('Independent material residual invariant failed');
    return { product: id, produced: produced.json(), consumed: consumed.json(), external: external.json(), delivered: delivered.json(), disposed: disposed.json(), residual: residual.json() };
  });
  plan.transport = plan.balances.filter(b => Q.from(b.consumed).add(Q.from(b.delivered)).add(Q.from(b.disposed)).cmp(ZERO) > 0).map(b => {
    const flow = Q.from(b.consumed).add(Q.from(b.delivered)).add(Q.from(b.disposed)), constraint = request.transport?.find(t => productId(t.product) === b.product);
    const lanes = constraint?.laneCapacity ? Number(flow.div(Q.from(constraint.laneCapacity)).ceil()) : undefined;
    if (lanes !== undefined && !Number.isSafeInteger(lanes)) throw new ComputationLimit('transport_lane_limit');
    return { product: b.product, unitsPerSecond: flow.json(), kind: b.product.startsWith('item:') ? 'belt' as const : 'fluid' as const, connectivity: 'unverified' as const, ...(constraint ? { capacity: constraint.capacity } : {}), ...(lanes === undefined ? {} : { lanes }) };
  });
  plan.status = infeasible ? 'infeasible' : plan.blockers.length ? 'incomplete' : 'feasible'; plan.executable = plan.status === 'feasible';
}

function quantity(plan: ProductionPlan, graph: SelectedGraph) {
  if (graph.recipes.some(r => r.products.filter(f => (f.amount ?? 0) > 0).length !== 1)) {
    plan.status = 'unsupported'; plan.blockers.push({ code: 'unsupported_quantity_balance', detail: 'Coupled co-product whole-craft quantity calculations are unsupported' }); return;
  }
  plan.assumptions.push('Whole crafts and finite starting stock; utility totals and elapsed completion time are unknown. Supply rates do not establish finite-batch duration.');
  const demand = new Map<string, Q>([[productId(plan.request.target), Q.from(plan.request.quantity!)]]), leftovers: Record<string, Exact> = {}, stockUsed: Record<string, Exact> = {};
  const stock = new Map(plan.request.initialStock.map(e => [productId(e.product), Q.from(e.quantity)]));
  const takeStock = (id: string, need: Q) => { const have = stock.get(id) ?? ZERO, take = have.cmp(need) < 0 ? have : need; stock.set(id, have.sub(take)); stockUsed[id] = take.json(); return need.sub(take); };
  // Consumer-first topological ordering aggregates shared intermediate demand before rounding.
  const pending = [...graph.recipes]; const done = new Set<string>();
  while (pending.length) {
    const index = pending.findIndex(r => !graph.recipes.some(other => !done.has(other.id) && other.id !== r.id && other.ingredients.some(f => r.products.some(out => flowId(out) === flowId(f)))));
    if (index === -1) throw new Error('Quantity graph cycle');
    const recipe = pending.splice(index, 1)[0]!, output = recipe.products.find(f => (f.amount ?? 0) > 0)!, id = flowId(output), need = takeStock(id, demand.get(id) ?? ZERO);
    const crafts = new Q(need.div(Q.from(output.amount!)).ceil()), made = crafts.mul(Q.from(output.amount!));
    leftovers[id] = made.sub(need).json();
    const stage = plan.stages.find(s => s.recipe === recipe.id)!; stage.crafts = crafts.json(); stage.meaning = digest({ definition: stage.meaning, crafts: stage.crafts });
    for (const f of recipe.ingredients) demand.set(flowId(f), (demand.get(flowId(f)) ?? ZERO).add(crafts.mul(Q.from(f.amount!))));
    done.add(recipe.id);
  }
  plan.balances = graph.products.map(id => {
    const b = zeroBalance(id);
    if (!graph.recipes.some(r => r.products.some(f => flowId(f) === id && (f.amount ?? 0) > 0))) {
      const remainder = takeStock(id, demand.get(id) ?? ZERO);
      if (plan.request.externalInputs.some(s => productId(s.product) === id)) b.external = remainder.json();
      else if (remainder.cmp(ZERO) > 0) throw new Error('Quantity expansion left an unsupplied stock remainder');
    }
    const produced = sum(graph.recipes.map(r => sum(r.products.filter(f => flowId(f) === id).map(f => Q.from(f.amount!).mul(Q.from(plan.stages.find(s => s.recipe === r.id)!.crafts!)))))),
      consumed = sum(graph.recipes.map(r => sum(r.ingredients.filter(f => flowId(f) === id).map(f => Q.from(f.amount!).mul(Q.from(plan.stages.find(s => s.recipe === r.id)!.crafts!))))));
    b.produced = produced.json(); b.consumed = consumed.json(); b.delivered = (id === productId(plan.request.target) ? Q.from(plan.request.quantity!) : ZERO).json();
    b.stockUsed = stockUsed[id] ?? ZERO.json(); b.accumulated = leftovers[id] ?? ZERO.json();
    b.residual = produced.add(Q.from(b.external)).add(Q.from(b.stockUsed)).sub(consumed).sub(Q.from(b.delivered)).sub(Q.from(b.accumulated)).json();
    if (Q.from(b.residual).cmp(ZERO) !== 0) throw new Error('Whole-craft residual invariant failed');
    return b;
  });
  plan.leftovers = leftovers; plan.stockUsed = stockUsed; plan.status = 'feasible';
  // Material-only batch estimates do not authorize physical execution without rate/utility sizing.
  plan.executable = false;
}
