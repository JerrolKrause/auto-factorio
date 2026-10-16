import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MachineFact, ProductionAvailability, ProductionCatalog, ProductionProduct, ProductionProfile, ProductionRequest, RecipeFact } from '@autofactorio/contracts';
import { calculatePlan } from '../packages/core/production/planner.js';
import { PLANNING_LIMITS } from '../packages/core/production/graph.js';
import { ProductionPlanService } from '../packages/core/production/service.js';
import { ProductionFacts } from '../packages/core/production/facts.js';
import type { FactAccess } from '../packages/core/production/facts.js';
import { SqliteJournal, entities } from '../packages/storage/src/journal.js';
import type { EventContext, Journal } from '../packages/core/execution/durable.js';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import { Coordinator } from '../packages/core/orchestration/coordinator.js';
import { team } from '../packages/core/orchestration/roles.js';
import { CoordinationGateway } from '../packages/tools/src/coordination.js';
import { PROBE_CAPS } from '../packages/codex/src/budget.js';

const item = (name: string): ProductionProduct => ({ kind: 'item', name, quality: 'normal', surface: 'nauvis' });
const fluid = (name: string): ProductionProduct => ({ kind: 'fluid', name, quality: 'normal', surface: 'nauvis' });
const flow = (id: string, amount: number, more: Record<string, unknown> = {}) => ({ type: id.startsWith('fluid:') ? 'fluid' as const : 'item' as const, name: id.slice(id.indexOf(':') + 1), amount, ...more });
const recipe = (name: string, ingredients: [string, number][], products: [string, number][], category = 'crafting', seconds = 1): RecipeFact => ({
  id: `recipe:${name}`, name, category, seconds, ingredients: ingredients.map(([id, n]) => flow(id, n)), products: products.map(([id, n]) => flow(id, n)), unlocks: [], surfaceConditions: [],
});
const machine = (name: string, categories: string[], energy: MachineFact['energy'] = { kind: 'electric', maxJoulesPerTick: 0, drainJoulesPerTick: 0 }, speed = 1, effects: Record<string, number> = {}): MachineFact => ({
  id: `machine:${name}`, name, type: 'assembling-machine', categories, speed, ingredientLimit: 20, collisionBox: [{ x: -1, y: -1 }, { x: 1, y: 1 }], fluidBoxes: Array.from({length:6},(_,i)=>({index:i+1,productionType:'input-output',volume:100,connections:[{connection_type:'pipe',direction:0,flow_direction:'input',positions:[{x:0,y:0},{x:0,y:1},{x:1,y:0},{x:1,y:1}],connection_category:['default']}]})), placementItems: [name], energy, baseEffects: effects, surfaceConditions: [],
});
const products = (...ids: string[]) => ids.map(id => ({ id, kind: id.startsWith('fluid:') ? 'fluid' as const : 'item' as const, name: id.slice(id.indexOf(':') + 1) }));
const catalog = (recipes: RecipeFact[], ids: string[], machines: MachineFact[] = [machine('assembler', ['crafting', 'oil-processing', 'chemistry', 'crafting-with-fluid'])], extra: Partial<ProductionCatalog> = {}): ProductionCatalog => ({ schema: 1, mods: { base: 'test' }, fingerprint: 'a'.repeat(64), products: products(...ids), recipes, machines, ...extra });
const availability = (recipes: RecipeFact[], disabled: string[] = [], productivity: string[] = []): ProductionAvailability => ({ tick: 100, force: 'player', researched: [], surfaceProperties: {}, recipes: Object.fromEntries(recipes.map(r => [r.name, { enabled: !disabled.includes(r.name), productivity: productivity.includes(r.name) ? 0.1 : 0 }])) });
const profile: ProductionProfile = { id: 'nauvis', revision: 1, fingerprint: 'profile-1', recipes: null, equipment: null };
const activeRuntimes: DurableRuntime[] = [];
const activeRoots: string[] = [];
afterEach(() => { for (const runtime of activeRuntimes.splice(0)) runtime.close(); for (const root of activeRoots.splice(0)) rmSync(root,{recursive:true,force:true}); });
const fingerprint = 'a'.repeat(64), availabilityRevision = 'b'.repeat(64);
const baseRequest = (target: ProductionProduct, mode: ProductionRequest['mode'] = 'rate', fields: Partial<ProductionRequest> = {}): ProductionRequest => ({
  schema: 1, target, mode, ...(mode === 'rate' ? { rate: { numerator: '1', denominator: '1', unit: target.kind === 'item' ? 'items-per-game-second' : 'units-per-game-second' } } : {}),
  ...(mode === 'quantity' ? { quantity: 1 } : {}), profile, facts: { schema: 1, id: `production.${fingerprint}`, fingerprint, availabilityRevision },
  externalInputs: [], initialStock: [], utilities: { electricityWatts: null }, constructionEquipment: { assembler: 100 }, sinks: [], routes: {}, machines: {}, fuels: {}, ...fields,
});
const calc = (c: ProductionCatalog, a: ProductionAvailability, r: ProductionRequest, limits?: Parameters<typeof calculatePlan>[4], now?: () => number) => calculatePlan(c, a, availabilityRevision, r, limits, now);
const exact = (n: number | string, d: number | string = 1) => ({ numerator: String(n), denominator: String(d) });

// An intentionally separate BigInt oracle checks every returned equation without importing planner arithmetic.
const gcd = (a: bigint, b: bigint): bigint => b === 0n ? (a < 0n ? -a : a) : gcd(b, a % b);
function fraction(value: { numerator: string; denominator: string }) { let n = BigInt(value.numerator), d = BigInt(value.denominator); const g = gcd(n, d); n /= g; d /= g; return [n, d] as const; }
function add(a: readonly [bigint, bigint], b: readonly [bigint, bigint]) { const n = a[0] * b[1] + b[0] * a[1], d = a[1] * b[1], g = gcd(n, d); return [n / g, d / g] as const; }
function decimal(value: number): readonly [bigint,bigint] {
  const [whole, tail='']=String(value).split('.'); return fraction({numerator:`${whole}${tail}`,denominator:`1${'0'.repeat(tail.length)}`});
}
function multiply(a: readonly [bigint,bigint],b: readonly [bigint,bigint]) { const n=a[0]*b[0],d=a[1]*b[1],g=gcd(n,d); return [n/g,d/g] as const; }
function equal(a: readonly [bigint,bigint],b: readonly [bigint,bigint]) { return a[0]*b[1]===b[0]*a[1]; }
function assertBalanced(plan: ReturnType<typeof calculatePlan>, catalog: ProductionCatalog) {
  const computed=new Map<string,{produced:readonly [bigint,bigint];consumed:readonly [bigint,bigint]}>();
  const row=(id:string)=>{let value=computed.get(id);if(!value){value={produced:[0n,1n],consumed:[0n,1n]};computed.set(id,value);}return value;};
  for(const stage of plan.stages){
    if(!stage.crafts)continue;
    const crafts=fraction(stage.crafts),recipe=catalog.recipes.find(r=>r.id===stage.recipe)!;
    for(const f of recipe.ingredients){const value=row(`${f.type}:${f.name}`);value.consumed=add(value.consumed,multiply(decimal(f.amount!),crafts));}
    for(const f of recipe.products){const value=row(`${f.type}:${f.name}`);value.produced=add(value.produced,multiply(decimal(f.amount!),crafts));}
    if(stage.fuel){const fuel=row(stage.fuel.product);fuel.consumed=add(fuel.consumed,fraction(stage.fuel.operating));const burnt=catalog.products.find(p=>p.id===stage.fuel!.product)?.burntResult;if(burnt)row(`item:${burnt}`).produced=add(row(`item:${burnt}`).produced,fraction(stage.fuel.operating));}
  }
  for (const b of plan.balances) {
    const reconstructed=computed.get(b.product)??{produced:[0n,1n] as const,consumed:[0n,1n] as const};
    expect(equal(reconstructed.produced,fraction(b.produced)),`${b.product} production from recipe facts and crafts`).toBe(true);
    expect(equal(reconstructed.consumed,fraction(b.consumed)),`${b.product} consumption from recipe facts and crafts`).toBe(true);
    const lhs = add(add(add(fraction(b.produced), fraction(b.external)), b.stockUsed ? fraction(b.stockUsed) : [0n,1n]), fraction(b.residual));
    const rhs = add(add(add(fraction(b.consumed), fraction(b.delivered)), fraction(b.disposed)), b.accumulated ? fraction(b.accumulated) : [0n,1n]);
    expect(equal(lhs,rhs)).toBe(true);
    expect(fraction(b.residual)).toEqual([0n, 1n]);
  }
}

describe('production planning S2', () => {
  it('balances complete sulfur, processing-unit, and utility-science chains against only declared raw inputs', () => {
    const rs = [recipe('make-coil', [['item:copper-plate', 2]], [['item:coil', 4]]), recipe('make-acid', [['item:iron-plate', 1], ['item:sulfur', 1], ['fluid:water', 1]], [['fluid:sulfuric-acid', 1]], 'chemistry'),
      recipe('make-sulfur', [['fluid:petroleum-gas', 1], ['fluid:water', 1]], [['item:sulfur', 1]], 'chemistry'), recipe('make-plastic', [['fluid:petroleum-gas', 1], ['item:coal', 1]], [['item:plastic', 2]], 'chemistry'),
      recipe('make-green', [['item:iron-plate', 1], ['item:copper-plate', 1]], [['item:electronic-circuit', 3]]), recipe('make-red', [['item:electronic-circuit', 2], ['item:plastic', 2]], [['item:advanced-circuit', 1]]),
      recipe('make-blue', [['item:advanced-circuit', 2], ['fluid:sulfuric-acid', 1]], [['item:processing-unit', 1]], 'crafting-with-fluid'), recipe('make-science', [['item:processing-unit', 1], ['item:advanced-circuit', 1], ['item:steel-plate', 1]], [['item:utility-science-pack', 1]])];
    const ids = ['item:copper-plate','item:iron-plate','item:steel-plate','item:sulfur','item:coal','item:coil','item:plastic','item:electronic-circuit','item:advanced-circuit','item:processing-unit','item:utility-science-pack','fluid:water','fluid:petroleum-gas','fluid:sulfuric-acid'];
    const c = catalog(rs, ids), a = availability(rs), supplied = ['item:copper-plate','item:iron-plate','item:steel-plate','item:coal','fluid:water','fluid:petroleum-gas'];
    for (const target of ['item:sulfur','item:processing-unit','item:utility-science-pack']) {
      const r = baseRequest(item(target.slice(5)), 'rate', { externalInputs: supplied.map(id => ({ product: id.startsWith('fluid:') ? fluid(id.slice(6)) : item(id.slice(5)), capacity: { kind: 'unlimited' as const } })) });
      const plan = calc(c, a, r);
      expect(plan.status, `${target}: ${JSON.stringify(plan.blockers)}`).toBe('feasible'); expect(plan.executable).toBe(true); expect(plan.stages.length).toBeGreaterThan(0); expect(plan.routes[target]).toBeDefined();
      expect(plan.balances.some(b => b.product === target && b.delivered.numerator === '1')).toBe(true); assertBalanced(plan,c);
      expect(plan.balances.filter(b => b.residual.numerator !== '0')).toHaveLength(0);
    }
    const incomplete = calc(c, a, baseRequest(item('utility-science-pack')));
    expect(incomplete.status).toBe('incomplete'); expect(incomplete.blockers.length).toBeGreaterThan(0);
  });

  it('selects and balances coupled refining and cracking with declared co-product destinations', () => {
    const rs = [recipe('refine', [['fluid:crude-oil', 10]], [['fluid:heavy-oil', 4], ['fluid:light-oil', 1], ['fluid:petroleum-gas', 1]], 'oil-processing'),
      recipe('crack-heavy', [['fluid:heavy-oil', 4], ['fluid:water', 1]], [['fluid:light-oil', 5]], 'chemistry'), recipe('crack-light', [['fluid:light-oil', 6]], [['fluid:petroleum-gas', 6]], 'chemistry')];
    const ids = ['fluid:crude-oil','fluid:heavy-oil','fluid:light-oil','fluid:petroleum-gas','fluid:water']; const c = catalog(rs, ids), a = availability(rs);
    const r = baseRequest(fluid('petroleum-gas'), 'rate', { externalInputs: [{ product: fluid('crude-oil'), capacity: { kind: 'unlimited' } }, { product: fluid('water'), capacity: { kind: 'unlimited' } }],
      routes: { 'fluid:heavy-oil': 'recipe:refine', 'fluid:light-oil': 'recipe:crack-heavy', 'fluid:petroleum-gas': 'recipe:crack-light' } });
    const plan = calc(c, a, r); expect(plan.status,JSON.stringify(plan.blockers)).toBe('feasible'); expect(plan.stages.map(s => s.recipe)).toEqual(['recipe:crack-heavy','recipe:crack-light','recipe:refine'].sort()); assertBalanced(plan,c);
    expect(plan.balances.find(b => b.product === 'fluid:heavy-oil')?.disposed).toEqual(exact(0));
  });

  it('exposes unknown, locked, denied, stochastic, cyclic, and missing routes as blockers', () => {
    const r1 = recipe('make-a', [['item:b', 1]], [['item:a', 1]]), r2 = recipe('make-b', [['item:a', 1]], [['item:b', 1]]);
    const c = catalog([r1, r2], ['item:a','item:b']);
    expect(calc(c, availability([r1,r2]), baseRequest(item('a'))).blockers.map(b => b.code)).toContain('selected_cycle');
    expect(calc(catalog([r1], ['item:a','item:b']), availability([r1]), baseRequest(item('a'))).blockers.map(b => b.code)).toContain('missing_producer');
    expect(calc(catalog([r1], ['item:a','item:b']), availability([r1], ['make-a']), baseRequest(item('a'))).blockers.map(b => b.code)).toContain('research_locked');
    const denied = baseRequest(item('a')); denied.profile = { ...profile, recipes: ['some-other-recipe'] };
    expect(calc(catalog([r1], ['item:a','item:b']), availability([r1]), denied).blockers.map(b => b.code)).toContain('profile_recipe_denied');
    const random = { ...r1, products: [{ ...r1.products[0]!, probability: 0.5 }] };
    expect(calc(catalog([random], ['item:a','item:b']), availability([random]), baseRequest(item('a'))).blockers.map(b => b.code)).toContain('unsupported_stochastic_or_spoilage');
    const spoils=catalog([r1],['item:a','item:b'],undefined,{products:products('item:a','item:b').map(p=>p.id==='item:b'?{...p,spoilage:true}:p)});
    expect(calc(spoils,availability([r1]),baseRequest(item('a'))).blockers.map(b=>b.code)).toContain('unsupported_stochastic_or_spoilage');
  });

  it('keeps supplied extraction, power, construction equipment, and unsupported equipment manufacture explicit', () => {
    const rs = [recipe('smelt', [['item:iron-ore', 1]], [['item:iron-plate', 1]], 'smelting'), recipe('wire', [['item:copper-plate', 1]], [['item:wire', 2]])];
    const c = catalog(rs, ['item:iron-ore','item:iron-plate','item:copper-plate','item:wire'],[machine('assembler',['crafting','smelting'])]);
    const r = baseRequest(item('iron-plate'), 'rate', { externalInputs: [{ product: item('iron-ore'), capacity: { kind: 'unlimited' } }], constructionEquipment: { assembler: 0 } });
    expect(calc(c, availability(rs), r).status).toBe('incomplete'); expect(calc(c, availability(rs), r).blockers.map(b => b.code)).toContain('equipment_prerequisite');
    const raw = baseRequest(item('iron-plate'), 'rate', { externalInputs: [{ product: item('iron-plate'), capacity: { kind: 'unlimited' } }] });
    expect(calc(c, availability(rs), raw).stages).toHaveLength(0);
  });

  it('blocks implicit raw extraction and barrel/ice conversions, but accepts an explicitly selected supplied conversion chain', () => {
    const acid=recipe('make-acid',[['fluid:crude-oil',1],['fluid:water',1]],[['item:sulfur',1]],'chemistry');
    const unbarrel=recipe('unbarrel-crude',[['item:crude-oil-barrel',1]],[['fluid:crude-oil',1]]);
    const melt=recipe('melt-ice',[['item:ice',1]],[['fluid:water',1]]);
    const rs=[acid,unbarrel,melt],c=catalog(rs,['fluid:crude-oil','fluid:water','item:sulfur','item:crude-oil-barrel','item:ice']);
    const blocked=calc(c,availability(rs),baseRequest(item('sulfur')));
    expect(blocked.status).toBe('incomplete'); expect(blocked.blockers.filter(b=>b.code==='unsupported_extraction').map(b=>b.product).sort()).toEqual(['fluid:crude-oil','fluid:water']);
    expect(blocked.routes['fluid:crude-oil']).toBeUndefined(); expect(blocked.routes['fluid:water']).toBeUndefined();
    const explicit=baseRequest(item('sulfur'),'rate',{routes:{'fluid:crude-oil':'recipe:unbarrel-crude','fluid:water':'recipe:melt-ice'},externalInputs:[{product:item('crude-oil-barrel'),capacity:{kind:'unlimited'}},{product:item('ice'),capacity:{kind:'unlimited'}}]});
    const converted=calc(c,availability(rs),explicit); expect(converted.status).toBe('feasible');
    expect(converted.routes).toMatchObject({'fluid:crude-oil':'recipe:unbarrel-crude','fluid:water':'recipe:melt-ice'});
  });

  it('enforces capped sources and sinks and does not let finite accumulation solve sustained demand', () => {
    const rcp = recipe('make', [['item:ore', 2]], [['item:plate', 1]]), c = catalog([rcp], ['item:ore','item:plate']), a = availability([rcp]);
    const r = baseRequest(item('plate'), 'rate', { externalInputs: [{ product: item('ore'), capacity: { kind: 'rate', numerator: '1', denominator: '1' } }] });
    expect(calc(c,a,r).status).toBe('infeasible');
    const coproduct = recipe('make-two', [['item:ore',1]], [['item:plate',1],['item:slag',1]]), cc = catalog([coproduct], ['item:ore','item:plate','item:slag']);
    const noSink = baseRequest(item('plate'), 'rate', { externalInputs: [{ product:item('ore'),capacity:{kind:'unlimited'} }] });
    expect(calc(cc,availability([coproduct]),noSink).status).toBe('infeasible');
    noSink.sinks = [{product:item('slag'),capacity:{kind:'rate',numerator:'0',denominator:'1'}}]; expect(calc(cc,availability([coproduct]),noSink).status).toBe('infeasible');
    const finite = { ...r, initialStock: [{ product:item('ore'),quantity:100 }] }; expect(calc(c,a,finite).status).toBe('infeasible');
    const unknown={...r,externalInputs:[{product:item('ore'),capacity:{kind:'unknown' as const}}]};
    const uncertain=calc(c,a,unknown); expect(uncertain.status).toBe('incomplete'); expect(uncertain.blockers.map(b=>b.code)).toContain('unknown_source_capacity');
  });

  it('caps the combined delivered and disposed transport flow and rounds selected lanes up', () => {
    const gear=recipe('gear-line',[['item:ore',1]],[['item:gear',3],['item:board',2]]),board=recipe('board',[['item:gear',2],['item:board',1]],[['item:board',1],['item:widget',1]]),c=catalog([gear,board],['item:ore','item:gear','item:board','item:widget']),a=availability([gear,board]);
    const request=baseRequest(item('widget'),'rate',{externalInputs:[{product:item('ore'),capacity:{kind:'unlimited'}}],sinks:[{product:item('board'),capacity:{kind:'unlimited'}}],routes:{'item:widget':'recipe:board','item:board':'recipe:gear-line','item:gear':'recipe:gear-line'},transport:[{product:item('board'),capacity:exact(6,5),laneCapacity:exact(1,2)}]});
    expect(calc(c,a,request).status).toBe('infeasible');
    request.transport![0]!.capacity=exact(7,3);
    const plan=calc(c,a,request); expect(plan.status).toBe('feasible'); expect(plan.transport.find(t=>t.product==='item:board')).toMatchObject({unitsPerSecond:exact(7,3),capacity:exact(7,3),lanes:5});
    const sameProductBoundary=structuredClone(request); delete sameProductBoundary.transport;
    sameProductBoundary.externalInputs=[{product:item('ore'),capacity:{kind:'unlimited'}}]; sameProductBoundary.sinks=[{product:item('board'),capacity:{kind:'unlimited'}},{product:item('ore'),capacity:{kind:'unlimited'}}];
    const coexist=calc(c,a,sameProductBoundary); expect(coexist.status).toBe('feasible'); assertBalanced(coexist,c);
  });

  it('rounds machine counts up, applies headroom once, and rejects unsupported machine bonuses', () => {
    const rcp = recipe('slow', [['item:ore',1]], [['item:plate',3]], 'crafting', 2), c = catalog([rcp], ['item:ore','item:plate']), a = availability([rcp]);
    const r = baseRequest(item('plate'), 'rate', { rate:{numerator:'1',denominator:'1',unit:'items-per-game-second'}, headroom:0.25, externalInputs:[{product:item('ore'),capacity:{kind:'unlimited'}}] });
    const plan=calc(c,a,r); expect(plan.status).toBe('feasible'); expect(plan.targetDemand).toEqual(exact(1)); expect(plan.headroomDemand).toEqual(exact(1,4)); expect(plan.stages[0]).toMatchObject({crafts:exact(5,12),fractionalMachines:exact(5,6),machines:1});
    const bad=catalog([rcp],['item:ore','item:plate'],[machine('assembler',['crafting'],undefined,1,{productivity:0.1})]); expect(calc(bad,a,r).blockers.map(b=>b.code)).toContain('unsupported_machine_bonus');
  });

  it('combines recipe coal and burner fuel under one cap and reports missing compatible fuel', () => {
    const burn = recipe('plastic', [['item:coal',1]], [['item:plastic',1]]), c = catalog([burn], ['item:coal','item:plastic']);
    c.products.find(p=>p.id==='item:coal')!.fuelValue=1; c.products.find(p=>p.id==='item:coal')!.fuelCategory='chemical';
    c.machines[0]!.energy={kind:'burner',maxJoulesPerTick:1,effectivity:1,fuelCategories:['chemical']};
    const req=baseRequest(item('plastic'),'rate',{rate:{numerator:'1',denominator:'1000',unit:'items-per-game-second'},externalInputs:[{product:item('coal'),capacity:{kind:'rate',numerator:'1',denominator:'20'}}],fuels:{'recipe:plastic':item('coal')}});
    const plan=calc(c,availability([burn]),req); expect(plan.status).toBe('infeasible'); expect(plan.blockers.map(b=>b.code)).toContain('material_or_utility_capacity');
    const absent={...req,fuels:{}}; expect(calc(c,availability([burn]),absent).blockers.map(b=>b.code)).toContain('fuel_prerequisite');
  });

  it('classifies bounded utility demand as below, between, or above the validated interval', () => {
    const rcp=recipe('electric',[],[['item:plate',3]]), m=machine('assembler',['crafting'],{kind:'electric',maxJoulesPerTick:10,drainJoulesPerTick:0});
    const c=catalog([rcp],['item:plate'],[m]),a=availability([rcp]);
    const run=(watts:number|null)=>calc(c,a,baseRequest(item('plate'),'rate',{utilities:{electricityWatts:watts}}));
    expect(run(199).status).toBe('infeasible'); expect(run(200).status).toBe('incomplete'); expect(run(600).status).toBe('feasible');
    const p=run(200); expect(p.stages[0]!.power).toMatchObject({lowerWatts:exact(200),upperWatts:exact(600)});
    const unknownDrain=catalog([rcp],['item:plate'],[machine('assembler',['crafting'],{kind:'electric',maxJoulesPerTick:10})]);
    const drainPlan=calc(unknownDrain,a,baseRequest(item('plate'),'rate',{utilities:{electricityWatts:null}}));
    expect(drainPlan.status).toBe('incomplete'); expect(drainPlan.blockers.map(b=>b.code)).toContain('unknown_idle_drain');
  });

  it('supports unsized exploration, whole-craft quantities with stock and leftovers, and rejects coupled quantities', () => {
    const rcp=recipe('batch',[['item:ore',2]],[['item:plate',3]]), c=catalog([rcp],['item:ore','item:plate']), a=availability([rcp]);
    const exploration=calc(c,a,baseRequest(item('plate'),'explore',{externalInputs:[{product:item('ore'),capacity:{kind:'unlimited'}}]})); expect(exploration.status,JSON.stringify(exploration.blockers)).toBe('exploration');
    const q=baseRequest(item('plate'),'quantity',{quantity:8,externalInputs:[{product:item('ore'),capacity:{kind:'unlimited'}}],initialStock:[{product:item('plate'),quantity:3}]});
    const batch=calc(c,a,q); expect(batch.status).toBe('feasible'); expect(batch.stages[0]!.crafts).toEqual(exact(2)); expect(batch.leftovers?.['item:plate']).toEqual(exact(1)); expect(batch.stockUsed?.['item:plate']).toEqual(exact(3)); expect(batch.executable).toBe(false); assertBalanced(batch,c);
    const shared=[recipe('shared-board',[['item:ore',1]],[['item:board',2]]),recipe('red',[['item:board',1]],[['item:red',1]]),recipe('green',[['item:board',1]],[['item:green',1]]),recipe('final',[['item:red',1],['item:green',1]],[['item:final',1]])];
    const sharedCatalog=catalog(shared,['item:ore','item:board','item:red','item:green','item:final']);
    const sharedPlan=calc(sharedCatalog,availability(shared),baseRequest(item('final'),'quantity',{quantity:1,externalInputs:[{product:item('ore'),capacity:{kind:'unlimited'}}],initialStock:[{product:item('board'),quantity:1}]}));
    expect(sharedPlan.status).toBe('feasible'); expect(sharedPlan.stages.find(s=>s.recipe==='recipe:shared-board')?.crafts).toEqual(exact(1)); expect(sharedPlan.stockUsed?.['item:board']).toEqual(exact(1)); expect(sharedPlan.leftovers?.['item:board']).toEqual(exact(1)); assertBalanced(sharedPlan,sharedCatalog);
    const rawBatch=recipe('iron-batch',[['item:iron-ore',2]],[['item:plate',3]]),rawCatalog=catalog([rawBatch],['item:iron-ore','item:plate']),rawAvailability=availability([rawBatch]);
    const stockOnly=calc(rawCatalog,rawAvailability,baseRequest(item('plate'),'quantity',{quantity:3,initialStock:[{product:item('iron-ore'),quantity:10}]}));
    expect(stockOnly.status).toBe('feasible'); expect(stockOnly.stages).toHaveLength(1); expect(stockOnly.stages[0]!.crafts).toEqual(exact(1)); expect(stockOnly.stockUsed?.['item:iron-ore']).toEqual(exact(2)); expect(stockOnly.leftovers?.['item:plate']).toEqual(exact(0)); assertBalanced(stockOnly,rawCatalog);
    const insufficient=calc(rawCatalog,rawAvailability,baseRequest(item('plate'),'quantity',{quantity:6,initialStock:[{product:item('iron-ore'),quantity:3}]}));
    expect(insufficient.status).toBe('incomplete'); expect(insufficient.executable).toBe(false); expect(insufficient.blockers.map(b=>b.code)).toContain('unsupported_extraction');
    const intermediate=[recipe('plate-from-ore',[['item:ore',2]],[['item:plate',3]]),recipe('gear-from-plate',[['item:plate',2]],[['item:gear',1]])];
    const intermediateCatalog=catalog(intermediate,['item:ore','item:plate','item:gear']),intermediateAvailability=availability(intermediate,['plate-from-ore']);
    const fullyStocked=calc(intermediateCatalog,intermediateAvailability,baseRequest(item('gear'),'quantity',{quantity:1,initialStock:[{product:item('plate'),quantity:2}]}));
    expect(fullyStocked.status).toBe('feasible'); expect(fullyStocked.stages.map(s=>s.recipe)).toEqual(['recipe:gear-from-plate']); expect(fullyStocked.blockers).toHaveLength(0); expect(fullyStocked.stockUsed?.['item:plate']).toEqual(exact(2));
    const partiallyStocked=calc(intermediateCatalog,availability(intermediate),baseRequest(item('gear'),'quantity',{quantity:2,initialStock:[{product:item('plate'),quantity:1}],externalInputs:[{product:item('ore'),capacity:{kind:'unlimited'}}]}));
    expect(partiallyStocked.status).toBe('feasible'); expect(partiallyStocked.stages.find(s=>s.recipe==='recipe:plate-from-ore')?.crafts).toEqual(exact(1)); expect(partiallyStocked.stockUsed?.['item:plate']).toEqual(exact(1)); expect(partiallyStocked.leftovers?.['item:plate']).toEqual(exact(0));
    const targetStock=calc(c,a,baseRequest(item('plate'),'quantity',{quantity:3,initialStock:[{product:item('plate'),quantity:3}]}));
    expect(targetStock.status).toBe('feasible'); expect(targetStock.stages).toHaveLength(0); expect(targetStock.stockUsed?.['item:plate']).toEqual(exact(3)); assertBalanced(targetStock,c);
    const coupled=recipe('coupled',[['item:ore',1]],[['item:plate',1],['item:slag',1]]), cc=catalog([coupled],['item:ore','item:plate','item:slag']);
    expect(calc(cc,availability([coupled]),{...q,initialStock:[]}).status).toBe('unsupported');
    const ongoing=baseRequest(item('plate'),'rate',{initialStock:[{product:item('iron-ore'),quantity:100}]});
    const sustained=calc(rawCatalog,rawAvailability,ongoing); expect(sustained.status).toBe('incomplete'); expect(sustained.blockers.map(b=>b.code)).toContain('unsupported_extraction');
  });

  it('returns deterministic capped results and exact arithmetic independent of solver work order', () => {
    const rs=[recipe('a-route',[['item:ore',1]],[['item:plate',1]]),recipe('b-route',[['item:ore',2]],[['item:plate',2]])], c=catalog(rs,['item:ore','item:plate']),a=availability(rs);
    const r=baseRequest(item('plate'),'rate',{externalInputs:[{product:item('ore'),capacity:{kind:'unlimited'}}]});
    const first=calc(c,a,r), second=calc({...c,recipes:[...rs].reverse()},a,r); expect(first.routes).toEqual(second.routes); expect(first.balances).toEqual(second.balances);
    const limits={...PLANNING_LIMITS,pivots:1};
    const capped=calc(c,a,r,limits,()=>0); expect(capped.status).toBe('incomplete'); expect(capped.executable).toBe(false); expect(capped.blockers.map(b=>b.code)).toContain('solver_exhausted');
  });

  it('stores immutable revisions, preserves stable stage identity, invalidates dependent evidence, bounds access, and rechecks revocation', async () => {
    expect(entities).toContain('productionPlans');
    const root=mkdtempSync(path.join(os.tmpdir(),'af-production-plan-')), journal=new SqliteJournal(path.join(root,'run.sqlite'));
    const records: {type:string;changes:Parameters<Journal['append']>[2]}[]=[];
    const store={run:'test-run',journal,record(type:string,changes:Parameters<Journal['append']>[2]){records.push({type,changes}); journal.append(context(),type,changes);}};
    const rs=[recipe('plate',[['item:ore',1]],[['item:plate',1]]),recipe('gear',[['item:plate',2]],[['item:gear',1]])];
    const mutable=availability(rs), data=makeFacts(rs,mutable); let authorized=true;
    const service=new ProductionPlanService(store as never,data.facts, { ...PLANNING_LIMITS, pageStages:1,revisions:2 },()=>100);
    const auth:FactAccess & {owner:string}={owner:'worker',key:'worker',authorize(){if(!authorized)throw new Error('revoked');},query:async req=>data.query(req)};
    try {
      const req=baseRequest(item('gear'),'rate',{externalInputs:[{product:item('ore'),capacity:{kind:'unlimited'}}],constructionEquipment:{assembler:100,...Object.fromEntries(Array.from({length:70},(_,i)=>[`permit-${i}-${'x'.repeat(75)}`,1]))}});
      expect(JSON.stringify(req).length).toBeGreaterThan(4000);
      const snapshot=await data.facts.snapshot(auth); req.facts={schema:1,id:`production.${snapshot.catalog.fingerprint}`,fingerprint:snapshot.catalog.fingerprint,availabilityRevision:snapshot.availabilityRevision};
      const first=await service.plan(auth,{request:req}); expect(first.revision).toBe(1); expect(first).toMatchObject({mode:'rate',target:item('gear'),targetDemand:exact(1),headroomDemand:exact(0)});
      const detail=await service.inspect(auth,{id:first.id,revision:1}); expect(detail.stages).toHaveLength(1); expect(detail.status).toBe('partial');
      const continuation=await service.inspect(auth,{id:first.id,revision:1,cursor:detail.next!}); expect(continuation.stages).toHaveLength(1); expect(continuation.status).toBe('complete');
      const otherKey={...auth,key:'other-session'}; expect(await service.inspect(otherKey,{id:first.id,revision:1,cursor:detail.next!})).toMatchObject({status:'expired',stages:[]});
      await expect(service.inspect({...auth,owner:'another-worker'},{id:first.id,revision:1})).rejects.toThrow('Plan unavailable');
      const requestPage=await service.inspect(auth,{id:first.id,revision:1,view:'request'}); expect(requestPage.status).toBe('partial'); expect(requestPage.requestChunk?.offset).toBe(0); expect(requestPage.requestChunk?.totalCharacters).toBe(JSON.stringify(req).length);
      expect((await service.inspect(otherKey,{id:first.id,revision:1,view:'request',cursor:requestPage.next!})).status).toBe('expired');
      expect((await service.inspect(auth,{id:first.id,revision:1,view:'stages',cursor:requestPage.next!})).status).toBe('expired');
      let page=requestPage, requestText=page.requestChunk!.text, cursor=page.next, pages=1;
      while(cursor){page=await service.inspect(auth,{id:first.id,revision:1,view:'request',cursor}); expect(page.requestChunk?.offset).toBe(requestText.length); requestText+=page.requestChunk?.text; cursor=page.next; pages++; if(pages>10)throw new Error('Unexpected request paging loop');}
      expect(page.status).toBe('complete'); expect(JSON.parse(requestText)).toEqual(req);
      const prior=journal.get<{plan:ReturnType<typeof calculatePlan>}>('test-run','productionPlans',`${first.id}.1`)!.plan;
      prior.stages.find(s=>s.recipe==='recipe:plate')!.evidence=['observation:plate'];
      journal.append(context(),'test/evidence',[{entity:'productionPlans',id:`${first.id}.1`,value:{...journal.get('test-run','productionPlans',`${first.id}.1`),plan:prior}}]);
      const revised={...req,headroom:0.5};
      const second=await service.plan(auth,{request:revised,prior:{id:first.id,revision:1}}); expect(second.revision).toBe(2); expect(second.invalidatedEvidence).toContain('observation:plate'); expect(journal.get('test-run','productionPlans',`${first.id}.1`)).toBeDefined();
      const revisionTwo=journal.get<{plan:ReturnType<typeof calculatePlan>}>('test-run','productionPlans',`${first.id}.2`)!.plan;
      expect(revisionTwo.stages.map(s=>s.id)).toEqual(prior.stages.map(s=>s.id));
      const old=await service.inspect(auth,{id:first.id,revision:1}); expect(old.summary.revision).toBe(1); expect(old.stale).toBe(false);
      await expect(service.plan(auth,{request:revised,prior:{id:first.id,revision:2}})).rejects.toThrow('retention cap');
      authorized=false; await expect(service.inspect(auth,{id:first.id,revision:1})).rejects.toThrow('revoked');
      expect(records.every(x=>x.type==='production/plan-calculated')).toBe(true);
    } finally { journal.close(); rmSync(root,{recursive:true,force:true}); }
  });

  it('serves production_plan and production_inspect through the authenticated gateway without creating tasks', async () => {
    const port={command:async()=> '{}',close(){}};
    const game=new GameClient(port,()=>{});
    const root=mkdtempSync(path.join(os.tmpdir(),'af-production-gateway-'));
    const runtime=new DurableRuntime(root,'gateway-run','epoch',game,new Lifecycle(port,game,()=>{})); activeRuntimes.push(runtime); activeRoots.push(root);
    const coordinator=new Coordinator(runtime,{...PROBE_CAPS,tools:100,turns:10,runMs:300000,turnMs:300000}); team().forEach(a=>coordinator.register(a));
    const gateway=new CoordinationGateway(coordinator),turn=coordinator.budget.admit('engineer');
    const binding=coordinator.bind('engineer',`session-${turn.id}`,turn.id,async()=>{}),token=gateway.issue(binding);
    const rs=[recipe('plate',[['item:ore',1]],[['item:plate',1]]),recipe('gear',[['item:plate',2]],[['item:gear',1]])],av=availability(rs),data=makeFacts(rs,av);
    game.request=async request=>data.query(request as Extract<import('@autofactorio/contracts').GameRequest,{op:'production-facts'}>);
    const search=await gateway.call(token,'production_search',{query:'',product:'item:gear'}) as {facts:{schema:1;id:string;fingerprint:string;availabilityRevision:string}};
    const request=baseRequest(item('gear'),'rate',{externalInputs:[{product:item('ore'),capacity:{kind:'unlimited'}}],facts:search.facts});
    const summary=await gateway.call(token,'production_plan',{request}) as {id:string;revision:number;status:string};
    expect(summary).toMatchObject({revision:1,status:'feasible'});
    const detail=await gateway.call(token,'production_inspect',{id:summary.id,revision:1}) as {stages:unknown[];status:string};
    expect(detail.status).toBe('complete'); expect(detail.stages.length).toBeGreaterThan(0);
    expect(runtime.journal.list('gateway-run','tasks')).toHaveLength(0);
  });
});

const context = (): EventContext => ({run:'test-run',epoch:'epoch',wallTime:new Date().toISOString(),gameTick:null,actor:'test',task:null,causation:null,correlation:null,visibility:{kind:'operator'}});
function makeFacts(rs: RecipeFact[], av: ProductionAvailability) {
  const ids=[...new Set([...rs.flatMap(r=>[...r.ingredients,...r.products].map(f=>`${f.type}:${f.name}`)),...rs.flatMap(r=>r.ingredients).map(f=>`${f.type}:${f.name}`)])];
  const c=catalog(rs,ids);
  const query: FactAccess['query']=async request=>{
    const section=request.section, rows=section==='products'?c.products:section==='recipes'?c.recipes:section==='machines'?c.machines:Object.entries(av.recipes).map(([name,v])=>({name,...v}));
    return {ok:true,schema:1,section,mods:c.mods,tick:av.tick,total:rows.length,items:rows.slice(request.offset,request.offset+request.limit),next:request.offset+request.limit<rows.length?request.offset+request.limit:null,contentIdentity:'fixture-content',...(section==='availability'?{availabilityIdentity:JSON.stringify(av.recipes),force:av.force,researched:av.researched,surfaceProperties:av.surfaceProperties}:{})};
  };
  return { facts: new ProductionFacts(), query };
}
