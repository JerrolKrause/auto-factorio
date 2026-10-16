import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MachineFact, ProductionAvailability, ProductionCatalog, ProductionProduct, RecipeFact } from '@autofactorio/contracts';
import type { BlueprintDocument } from '@autofactorio/contracts';
import { installedChainContext, type InstalledChainPreset } from '../packages/core/workshop/installed-chain.js';
import { resolveInstalledWorkshopChain } from '../apps/runtime/workshop-chain-resolution.js';
import { LiveWorkshopGame, LiveWorkshopHost } from '../apps/runtime/workshop-live-host.js';
import type { WorkshopGame, WorkshopInference } from '../apps/runtime/workshop-live-host.js';
import { chainMeasurementRequirements } from '../apps/runtime/workshop-chain-measurement.js';
import { prepareChainConstruction } from '../apps/runtime/workshop-chain-construction.js';
import { evaluationBoundary } from '../packages/core/workshop/boundary.js';
import { workshopRubricHash } from '../packages/core/workshop/scoring.js';

const item = (name: string): ProductionProduct => ({ kind: 'item', name, quality: 'normal', surface: 'nauvis' });
const fluid = (name: string): ProductionProduct => ({ kind: 'fluid', name, quality: 'normal', surface: 'nauvis' });
const flow = (p: ProductionProduct, amount: number) => ({ type: p.kind, name: p.name, amount });
const recipe = (name: string, category: string, ingredients: [ProductionProduct, number][], products: [ProductionProduct, number][]): RecipeFact => ({ id: `recipe:${name}`, name, category, seconds: 1, ingredients: ingredients.map(([p, n]) => flow(p, n)), products: products.map(([p, n]) => flow(p, n)), unlocks: [], surfaceConditions: [] });
const pipe = { connection_type: 'pipe', direction: 0, flow_direction: 'input', positions: [{ x: 0, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }], connection_category: ['default'] };
const machine = (name: string, category: string): MachineFact => ({ id: `machine:${name}`, name, type: 'assembling-machine', categories: [category], speed: 1, ingredientLimit: 20, collisionBox: [{ x: -1, y: -1 }, { x: 1, y: 1 }], fluidBoxes: Array.from({ length: 6 }, (_, index) => ({ index: index + 1, productionType: 'input-output' as const, volume: 100, connections: [pipe] })), placementItems: [name], energy: { kind: 'electric', maxJoulesPerTick: 0, drainJoulesPerTick: 0 }, baseEffects: {}, surfaceConditions: [] });

// Synthetic deterministic fixture for host boundary tests; these are not claims about installed Factorio recipes.
const recipes = [recipe('basic-oil-processing', 'oil-processing', [[fluid('crude-oil'), 100]], [[fluid('petroleum-gas'), 45], [fluid('light-oil'), 25], [fluid('heavy-oil'), 10]]), recipe('sulfur', 'chemistry', [[fluid('petroleum-gas'), 30], [fluid('water'), 30]], [[item('sulfur'), 2]])];
const catalog: ProductionCatalog = { schema: 1, mods: { base: '2.0.77', space_age: '2.0.77' }, fingerprint: 'a'.repeat(64), products: [...['crude-oil', 'petroleum-gas', 'light-oil', 'heavy-oil', 'water'].map(name => ({ id: `fluid:${name}`, kind: 'fluid' as const, name })), ...['sulfur', 'oil-refinery', 'chemical-plant'].map(name => ({ id: `item:${name}`, kind: 'item' as const, name }))], recipes, machines: [machine('oil-refinery', 'oil-processing'), machine('chemical-plant', 'chemistry')] };
const availability: ProductionAvailability = { tick: 14, force: 'player', researched: ['unrelated-tech'], surfaceProperties: { pressure: 1000 }, recipes: { sulfur: { enabled: false, productivity: 0.2 }, 'basic-oil-processing': { enabled: true, productivity: 0.5 } } };
const snapshot = { catalog, availability, availabilityRevision: 'b'.repeat(64) };
const preset = (changes: Partial<InstalledChainPreset> = {}): InstalledChainPreset => ({ schema: 1, gameVersion: '2.0.77', mods: { space_age: '2.0.77', base: '2.0.77' }, profileId: 'production-chain', profileRevision: 3, surface: 'nauvis', technologies: ['sulfur-processing'], recipes: ['sulfur', 'basic-oil-processing'], allowedEquipment: ['chemical-plant', 'oil-refinery'], ...changes });
const context = (p = preset(), s = snapshot) => installedChainContext(p, s);
const chainRequest = (ctx = context()) => ({ schema: 1 as const, target: item('sulfur'), mode: 'rate' as const, rate: { numerator: '2', denominator: '1', unit: 'items-per-game-second' as const }, profile: { id: ctx.profile.id, revision: ctx.profile.revision, fingerprint: ctx.profile.fingerprint, recipes: ctx.profile.recipes, equipment: ctx.profile.allowedEquipment }, facts: { schema: 1 as const, id: `production.${catalog.fingerprint}`, fingerprint: catalog.fingerprint, availabilityRevision: ctx.snapshot.availabilityRevision }, externalInputs: [{ product: fluid('crude-oil'), capacity: { kind: 'unlimited' as const } }, { product: fluid('water'), capacity: { kind: 'unlimited' as const } }], initialStock: [], utilities: { electricityWatts: 100000 }, constructionEquipment: { 'oil-refinery': 1, 'chemical-plant': 1 }, sinks: [{ product: fluid('light-oil'), capacity: { kind: 'unlimited' as const } }, { product: fluid('heavy-oil'), capacity: { kind: 'unlimited' as const } }], routes: { 'fluid:petroleum-gas': 'recipe:basic-oil-processing', 'item:sulfur': 'recipe:sulfur' }, machines: { 'recipe:basic-oil-processing': 'machine:oil-refinery', 'recipe:sulfur': 'machine:chemical-plant' }, fuels: {} });
const rawAssignment = (id: string, ctx = context(), changes: Record<string, unknown> = {}) => ({ schema: 1, id, revision: 1, comparisonSeries: `series-${id}`, objective: 'Produce sulfur from the selected installed chain', source: { kind: 'brief', id: null }, profileId: ctx.profile.id, productionMode: 'chain', chainRequest: chainRequest(ctx), construction: 'direct', libraryAccess: false, improveRevision: null, requestedSpeed: { numerator: '10', denominator: '1' }, settlingTicks: 0, windowTicks: 60, windows: 1, rubric: { version: 'rubric-1', weights: { throughput: { numerator: '1', denominator: '1' } }, materiality: { throughput: { numerator: '0', denominator: '1' } }, directions: { throughput: 'maximize' } }, iterations: { attempts: 1, mode: 'exact', earlyStop: false, plateauRounds: 1 }, checkpoints: { brief: false, afterScore: false, libraryAdmission: false, learningActivation: false, timeoutMs: 1000, timeoutAction: 'finish' }, budgets: { wallMs: 60000, gameTicks: 600, turns: 3, toolCalls: 8, reportedTokens: 1000, learningReservedTurns: 0, learningReservedTools: 0 }, models: { sessionDefault: { provider: 'openai', modelId: 'gpt-6-astra', reasoningEffort: 'low' }, overrides: {} }, learning: { cadence: 'off', batchSessions: 2, candidateCap: 2, attemptsPerCandidate: 1, autoActivate: false }, ...changes });

describe('installed workshop chain resolution', () => {
  it('derives all selected stages and exposes only external boundary ports', () => {
    const resolved = resolveInstalledWorkshopChain(rawAssignment('sulfur') as Record<string, unknown>, context());
    expect(resolved.chain.stages.map(stage => stage.recipe).sort()).toEqual(['basic-oil-processing', 'sulfur']);
    expect(resolved.assignment.ports.map(port => `${port.direction}:${port.product.name}`).sort()).toEqual(['byproduct:heavy-oil', 'byproduct:light-oil', 'input:crude-oil', 'input:water', 'output:sulfur']);
    expect(resolved.assignment.ports.some(port => port.product.name === 'petroleum-gas')).toBe(false);
  });

  it('gives a fluid target a declared-equipment drain bound independent of candidate layout', () => {
    const ctx = context();
    const fluidRequest = (refineries: number) => ({ ...chainRequest(ctx), target: fluid('petroleum-gas'),
      rate: { numerator: '10', denominator: '1', unit: 'units-per-game-second' as const },
      externalInputs: [{ product: fluid('crude-oil'), capacity: { kind: 'rate' as const, numerator: '100', denominator: '1' } },
        { product: fluid('water'), capacity: { kind: 'rate' as const, numerator: '100', denominator: '1' } }],
      sinks: [{ product: fluid('light-oil'), capacity: { kind: 'rate' as const, numerator: '55', denominator: '1' } },
        { product: fluid('heavy-oil'), capacity: { kind: 'rate' as const, numerator: '66', denominator: '1' } }],
      constructionEquipment: { 'oil-refinery': refineries, 'chemical-plant': 1 },
      routes: { 'fluid:petroleum-gas': 'recipe:basic-oil-processing' },
      machines: { 'recipe:basic-oil-processing': 'machine:oil-refinery' },
    });
    const prepare = (refineries: number, x: number) => {
      const raw = rawAssignment(`fluid-target-${refineries}-${x}`, ctx, { chainRequest: fluidRequest(refineries) });
      const resolved = resolveInstalledWorkshopChain(raw as Record<string, unknown>, ctx);
      const document: BlueprintDocument = { schema: 1, label: 'single refinery', description: 'fluid target regression',
        entities: [{ id: 'refinery', entityNumber: 1, name: 'oil-refinery', position: { x, y: 0 }, direction: 0,
          quality: 'normal', recipe: 'basic-oil-processing' }], wires: [], ports: resolved.assignment.ports, icons: [], tiles: [] };
      return prepareChainConstruction(resolved.assignment, document, ctx.profile, ctx);
    };
    const oneAtOrigin = prepare(1, 0), oneMoved = prepare(1, 40), twoDeclared = prepare(2, 0);
    const fixtureMap = (prepared: ReturnType<typeof prepareChainConstruction>) => new Map(prepared.fixtures.map(value => [value.id, value.rate]));
    const originRates = fixtureMap(oneAtOrigin), movedRates = fixtureMap(oneMoved), expandedRates = fixtureMap(twoDeclared);
    expect(originRates.get('output-fluid-petroleum-gas')).toBe(45);
    expect(movedRates.get('output-fluid-petroleum-gas')).toBe(45);
    expect(expandedRates.get('output-fluid-petroleum-gas')).toBe(90);
    expect(originRates.get('output-fluid-petroleum-gas')).toBeGreaterThan(10);
    expect(oneAtOrigin.fixtures.filter(value => value.kind === 'source').map(value => value.id).sort())
      .toEqual(['input-fluid-crude-oil', 'input-fluid-water']);
    expect(oneAtOrigin.fixtures.some(value => value.kind === 'source' && value.product.name === 'petroleum-gas')).toBe(false);
    for (const id of ['input-fluid-crude-oil', 'input-fluid-water', 'byproduct-fluid-light-oil', 'byproduct-fluid-heavy-oil']) {
      expect(originRates.get(id)).toBe(movedRates.get(id));
      expect(originRates.get(id)).toBe(expandedRates.get(id));
      const port = oneAtOrigin.resolved.chain.ports.find(value => value.id === id)!;
      expect(originRates.get(id)).toBe(Number(port.rate.numerator) / Number(port.rate.denominator));
    }
  });

  it('keeps character work positions outside every installed-chain fixture', () => {
    const facts = { ...snapshot, catalog: { ...catalog, products: [...catalog.products, { id: 'item:pipe', kind: 'item' as const, name: 'pipe' }] } };
    const ctx = context(preset({ allowedEquipment: ['chemical-plant', 'oil-refinery', 'pipe'] }), facts);
    const baseRequest = chainRequest(ctx);
    const request = { ...baseRequest, constructionEquipment: { ...baseRequest.constructionEquipment, pipe: 2 } };
    const raw = rawAssignment('fixture-clearance', ctx, { construction: 'character', chainRequest: request });
    const resolved = resolveInstalledWorkshopChain(raw as Record<string, unknown>, ctx);
    const document: BlueprintDocument = { schema: 1, label: 'fixture clearance', description: 'pipes beside a pinned source tank',
      entities: [
        { id: 'refinery', entityNumber: 1, name: 'oil-refinery', position: { x: -16.5, y: 0.5 }, direction: 0, quality: 'normal', recipe: 'basic-oil-processing' },
        { id: 'chemical', entityNumber: 2, name: 'chemical-plant', position: { x: 14.5, y: 0.5 }, direction: 0, quality: 'normal', recipe: 'sulfur' },
        { id: 'near-water-pipe', entityNumber: 3, name: 'pipe', position: { x: -34.5, y: -5.5 }, direction: 0, quality: 'normal' },
        { id: 'outer-water-pipe', entityNumber: 4, name: 'pipe', position: { x: -36.5, y: -5.5 }, direction: 0, quality: 'normal' },
      ], wires: [], ports: resolved.assignment.ports, icons: [], tiles: [] };
    const prepared = prepareChainConstruction(resolved.assignment, document, ctx.profile, ctx);
    expect(prepared.character?.required).toMatchObject({ pipe: 2, 'oil-refinery': 1, 'chemical-plant': 1 });
    const fixtureCenters = prepared.fixtures.map(fixture => fixture.position);
    const clearance = Math.max(3, resolved.assignment.footprint.clearance);
    const walks = prepared.character?.steps.filter(step => step.kind === 'walk') ?? [];
    expect(walks.length).toBeGreaterThan(0);
    expect(walks.every(step => fixtureCenters.every(center =>
      Math.abs(step.position.x - center.x) >= clearance || Math.abs(step.position.y - center.y) >= clearance
    ))).toBe(true);
    expect(walks.some(step => Math.abs(step.position.x + 32.5) < clearance && Math.abs(step.position.y + 6.5) < clearance)).toBe(false);
  });

  it.each([
    ['malformed request', { chainRequest: null }],
    ['oversize request', { chainRequest: { payload: 'x'.repeat(131073) } }],
  ])('rejects a %s before producing a plan', (_label, change) => {
    expect(() => resolveInstalledWorkshopChain(rawAssignment('bad', context(), change) as Record<string, unknown>, context())).toThrow();
  });

  it.each([
    ['stale profile revision', (ctx: ReturnType<typeof context>) => ({ ...chainRequest(ctx), profile: { ...chainRequest(ctx).profile, revision: ctx.profile.revision - 1 } })],
    ['stale catalog facts', (ctx: ReturnType<typeof context>) => ({ ...chainRequest(ctx), facts: { ...chainRequest(ctx).facts, fingerprint: 'f'.repeat(64) } })],
    ['denied refinery profile pin', () => { const denied = context(preset({ allowedEquipment: ['chemical-plant'] })); return chainRequest(denied); }],
    ['nonzero initial stock', (ctx: ReturnType<typeof context>) => ({ ...chainRequest(ctx), initialStock: [{ product: fluid('petroleum-gas'), quantity: 1 }] })],
  ])('rejects %s', (_label, alter) => {
    const ctx = context();
    expect(() => resolveInstalledWorkshopChain(rawAssignment('invalid', ctx, { chainRequest: alter(ctx) }) as Record<string, unknown>, ctx)).toThrow();
  });

  it('rejects a refinery excluded by the actual installed profile and valid nonzero stock', () => {
    const denied = context(preset({ allowedEquipment: ['chemical-plant'] }));
    expect(() => resolveInstalledWorkshopChain(rawAssignment('refinery-denied', denied), denied)).toThrow('Chain plan is not executable');
    const ctx = context();
    expect(() => resolveInstalledWorkshopChain(rawAssignment('stock', ctx, { chainRequest: { ...chainRequest(ctx), initialStock: [{ product: fluid('petroleum-gas'), quantity: 1 }] } }), ctx)).toThrow('zero initial process stock');
  });

  it('rejects caller-added internal ports and mismatched profile pins', () => {
    const ctx = context(), resolved = resolveInstalledWorkshopChain(rawAssignment('forged', ctx) as Record<string, unknown>, ctx);
    expect(resolveInstalledWorkshopChain({ ...resolved.assignment } as Record<string, unknown>, ctx).assignment.ports).toEqual(resolved.assignment.ports);
    expect(() => resolveInstalledWorkshopChain({ ...resolved.assignment, ports: [...resolved.assignment.ports, { ...resolved.assignment.ports[0]!, id: 'input-fluid-petroleum-gas', product: fluid('petroleum-gas') }] }, ctx)).toThrow('boundary');
    expect(() => resolveInstalledWorkshopChain({ ...resolved.assignment, profileRevision: ctx.profile.revision + 1 }, ctx)).toThrow('installed facts');
    expect(() => resolveInstalledWorkshopChain(rawAssignment('wrong-profile', ctx, { profileId: 'starter-assembly' }) as Record<string, unknown>, ctx)).toThrow();
  });
});

describe('live host chain resolution boundary', () => {
  const inference: WorkshopInference = { async invoke() { throw new Error('chain resolution must not infer'); }, async close() {} };

  it('persists a full plan before inference, then serves an exact retry unchanged after host replacement', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'af-chain-resolution-'));
    const ctx = context(); let profileCalls = 0, preflightCalls = 0;
    const game: WorkshopGame = { async resolveProfile() { throw new Error('component resolver must not run'); }, async resolveChainProfile() { profileCalls++; return structuredClone(ctx); }, async preflight() { preflightCalls++; }, async build() { throw new Error('build must not run'); }, async measure() { throw new Error('measure must not run'); } };
    try {
      const host = new LiveWorkshopHost(root, inference, game);
      const raw = rawAssignment('persisted');
      const assignment = await host.resolve(raw);
      const file = path.join(root, 'workshop-live', 'persisted', 'chain-resolved.json');
      const content = readFileSync(file, 'utf8'), mtime = statSync(file).mtimeMs;
      expect(JSON.parse(content)).toMatchObject({ schema: 1, assignment: { id: 'persisted' }, profile: { id: 'production-chain' }, chain: { stages: expect.any(Array), plan: { executable: true } } });
      expect(assignment.ports.map(port => port.product.name)).toContain('sulfur');
      const replacement = new LiveWorkshopHost(root, inference, game);
      await expect(replacement.resolve(raw)).resolves.toEqual(assignment);
      expect(readFileSync(file, 'utf8')).toBe(content);
      expect(statSync(file).mtimeMs).toBe(mtime);
      expect(profileCalls).toBe(2);
      expect(preflightCalls).toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('conflicts on changed assignment or installed pins without overwriting the first plan', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'af-chain-conflict-'));
    const ctx = context(); let current = structuredClone(ctx);
    const game: WorkshopGame = { async resolveProfile() { throw new Error('component resolver must not run'); }, async resolveChainProfile() { return structuredClone(current); }, async build() { throw new Error('build must not run'); }, async measure() { throw new Error('measure must not run'); } };
    try {
      const host = new LiveWorkshopHost(root, inference, game), original = rawAssignment('conflict');
      await host.resolve(original);
      const file = path.join(root, 'workshop-live', 'conflict', 'chain-resolved.json'), first = readFileSync(file, 'utf8');
      await expect(host.resolve({ ...original, objective: 'Changed objective' })).rejects.toThrow('different assignment or installed plan');
      current = context(preset({ profileRevision: 4 }));
      await expect(host.resolve(original)).rejects.toThrow('does not match the authorized installed profile');
      expect(readFileSync(file, 'utf8')).toBe(first);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('permits ordinary chain preflight after rechecking the immutable installed plan', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'af-chain-preflight-')), ctx = context();
    let preflightCalls = 0, profileCalls = 0;
    const game: WorkshopGame = { async resolveProfile() { throw new Error('component resolver must not run'); }, async resolveChainProfile() { profileCalls++; return structuredClone(ctx); }, async preflight() { preflightCalls++; }, async build() { throw new Error('unused'); }, async measure() { throw new Error('unused'); } };
    try {
      const host = new LiveWorkshopHost(root, inference, game), assignment = await host.resolve(rawAssignment('preflight-ready'));
      await host.preflight(assignment);
      expect({ preflightCalls, profileCalls }).toEqual({ preflightCalls: 1, profileCalls: 2 });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('enforces exact Improve source identity and rejects changed boundaries before build or inference', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'af-chain-policy-')), ctx = context();
    let profileCalls = 0, buildCalls = 0, inferenceCalls = 0;
    const base = rawAssignment('improve-chain');
    const baseAssignment = resolveInstalledWorkshopChain(base as Record<string, unknown>, ctx).assignment;
    const library = { get(id: string) { if (id !== 'attestation-known') throw new Error('unknown attestation'); return { entry: { attestationId: id, boundaryStatus: 'known', boundaryHash: evaluationBoundary(baseAssignment).hash, gameFingerprint: baseAssignment.gameFingerprint }, document: { schema: 1, label: 'prior', description: 'prior fixture', entities: [{ id: 'assembler', entityNumber: 1, name: 'chemical-plant', position: { x: 0, y: 0 }, direction: 0, quality: 'normal', recipe: 'sulfur' }], wires: [], ports: baseAssignment.ports, icons: [], tiles: [] }, evidence: { provenance: { assignment: baseAssignment }, rubricHash: workshopRubricHash(baseAssignment.rubric) } }; } };
    const game: WorkshopGame = { async resolveProfile() { throw new Error('component resolver must not run'); }, async resolveChainProfile() { profileCalls++; return structuredClone(ctx); }, async preflight() { throw new Error('preflight must not run'); }, async build() { buildCalls++; throw new Error('build must not run'); }, async measure() { throw new Error('measure must not run'); } };
    const host = new LiveWorkshopHost(root, { async invoke() { inferenceCalls++; return '{}'; }, async close() {} }, game);
    host.bindServices({ library } as never);
    try {
      await expect(host.resolve({ ...base, source: { kind: 'revision', id: 'other' }, improveRevision: 'attestation-known' })).rejects.toThrow('exact revision source');
      const restored = await host.resolve({ id: 'improve-restored', source: { kind: 'revision', id: 'attestation-known' }, improveRevision: 'attestation-known', libraryAccess: true, productionMode: 'chain' });
      expect(restored.chainRequest).toEqual(baseAssignment.chainRequest);
      expect(JSON.parse(readFileSync(path.join(root, 'workshop-live', restored.id, 'chain-resolved.json'), 'utf8')).chain.request).toEqual(baseAssignment.chainRequest);
      const changed = { ...base, source: { kind: 'revision', id: 'attestation-known' }, improveRevision: 'attestation-known', libraryAccess: true, chainRequest: chainRequest(ctx) };
      changed.chainRequest = { ...changed.chainRequest, utilities: { electricityWatts: 2_000_000 } };
      await expect(host.resolve(changed)).rejects.toThrow(/boundary unknown or changed|boundary identity|boundary differs/i);
      expect({ buildCalls, inferenceCalls }).toEqual({ buildCalls: 0, inferenceCalls: 0 });
      const fresh = await host.resolve({ ...base, id: 'fresh-chain-request', chainRequest: chainRequest(ctx) });
      expect(fresh.id).toBe('fresh-chain-request');
      expect(profileCalls).toBe(3);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.each(['direct', 'character'] as const)('rechecks visible readiness for %s chain mode and retains the measurement manifest fence', async construction => {
    const ctx = context(), assignment = resolveInstalledWorkshopChain(rawAssignment(`game-${construction}`, ctx, { construction }) as Record<string, unknown>, ctx).assignment;
    let visibleCalls = 0, inspected = 0;
    const port = { command() { throw new Error('no game command expected during readiness'); }, close() {} };
    const client = { async request(){ return {actors:{'builder-1':{connected:true}}}; } };
    const lifecycle = new Proxy({}, { get() { return () => { throw new Error('no lifecycle effect expected'); }; } });
    const game = new LiveWorkshopGame(port as never, client as never, lifecycle as never, () => {}, async () => () => {}, undefined, null, async () => { visibleCalls++; });
    (game as unknown as { resolveChainProfile: (id: string) => Promise<ReturnType<typeof context>> }).resolveChainProfile = async () => structuredClone(ctx);
    (game as unknown as { control: { inspect: () => Promise<Record<string, unknown>> } }).control = { async inspect() { inspected++; return { candidateFingerprint: 'candidate', boundaryFingerprint: 'boundary' }; } };
    const session = { id: assignment.id, assignment, activeIteration: 1 } as never;
    const built = { id: `${assignment.id}-1`, generation: 1, surface: 'nauvis', characterEvidence: null } as never;
    await expect(game.preflight(assignment)).resolves.toBeUndefined();
    await expect(game.measure(session, built)).rejects.toThrow(/manifest|candidate/i);
    expect({ visibleCalls, inspected }).toEqual({ visibleCalls: 1, inspected: 0 });
  });

  it.each(['omitted manifest', 'changed assignment pin', 'changed candidate pin', 'changed installed profile', 'changed stage binding', 'missing unit binding', 'duplicate unit bindings'] as const)('rejects a %s before game measurement configuration', async mismatch => {
    const ctx = context(), assignment = resolveInstalledWorkshopChain(rawAssignment('manifest-pins') as Record<string, unknown>, ctx).assignment;
    const resolved = resolveInstalledWorkshopChain(assignment as unknown as Record<string, unknown>, ctx);
    const requirements = chainMeasurementRequirements(assignment, resolved.chain);
    let installed = structuredClone(ctx), configureCalls = 0;
    const game = new LiveWorkshopGame({ command() { throw new Error('unexpected control command'); }, close() {} }, {} as never, {} as never, () => {}, async () => () => {});
    (game as unknown as { resolveChainProfile: (id: string) => Promise<ReturnType<typeof context>> }).resolveChainProfile = async () => structuredClone(installed);
    (game as unknown as { control: { inspect: () => Promise<Record<string, unknown>>; measureConfigure: () => Promise<void> } }).control = {
      async inspect() { return { candidateFingerprint: 'candidate-current', boundaryFingerprint: 'boundary-current' }; },
      async measureConfigure() { configureCalls++; },
    };
    const chainMeasurement = {
      schema: 1, ...requirements, boundaryFingerprint: 'boundary-current', candidateFingerprint: 'candidate-current',
      bindings: resolved.chain.stages.map((stage, index) => ({ id: stage.id, recipe: stage.recipe, machine: stage.machine, units: [index + 10] })),
    };
    const session = { id: assignment.id, assignment, activeIteration: 1 } as never;
    const built = { id: `${assignment.id}-1`, generation: 1, surface: 'nauvis', characterEvidence: null, chainMeasurement } as never;
    if (mismatch === 'omitted manifest') delete (built as { chainMeasurement?: unknown }).chainMeasurement;
    if (mismatch === 'changed assignment pin') chainMeasurement.assignmentFingerprint = 'forged-assignment';
    if (mismatch === 'changed candidate pin') chainMeasurement.candidateFingerprint = 'candidate-stale';
    if (mismatch === 'changed installed profile') installed = context(preset({ profileRevision: 4 }));
    if (mismatch === 'changed stage binding') chainMeasurement.bindings[0]!.id = 'forged-stage';
    if (mismatch === 'missing unit binding') chainMeasurement.bindings[0]!.units = [];
    if (mismatch === 'duplicate unit bindings') chainMeasurement.bindings[1]!.units = chainMeasurement.bindings[0]!.units;
    await expect(game.measure(session, built)).rejects.toThrow(/manifest|candidate|profile|installed|bindings|unit/i);
    expect(configureCalls).toBe(0);
  });

  it('builds only the pinned resolved candidate and rejects changed assignment or installed plan', async () => {
    const root=mkdtempSync(path.join(os.tmpdir(),'af-chain-host-build-')),initial=context();let installed=structuredClone(initial),buildCalls=0;
    const game:WorkshopGame={async resolveProfile(){throw new Error('component profile must not run');},async resolveChainProfile(){return structuredClone(installed);},async build(){buildCalls++;return{id:'host-build-1',generation:1,surface:'test',characterEvidence:null};},async measure(){throw new Error('measurement must not run');}};
    const host=new LiveWorkshopHost(root,inference,game),assignment=await host.resolve(rawAssignment('host-build'));
    const artifactHash='c'.repeat(64),candidate={sessionId:assignment.id,iteration:1,artifactHash,assignmentRevision:assignment.revision,bundleHash:'bundle',evidence:['fixture']} as never;
    const document={schema:1,label:'pinned sulfur chain',description:'fixture',entities:[{id:'refinery',entityNumber:1,name:'oil-refinery',position:{x:0,y:0},direction:0,quality:'normal',recipe:'basic-oil-processing'},{id:'chemical',entityNumber:2,name:'chemical-plant',position:{x:8,y:0},direction:0,quality:'normal',recipe:'sulfur'}],wires:[],ports:assignment.ports,icons:[],tiles:[]};
    const directory=path.join(root,'workshop-live',assignment.id);mkdirSync(directory,{recursive:true});
    writeFileSync(path.join(directory,`${artifactHash}.json`),JSON.stringify(document));
    const session={id:assignment.id,assignment,activeIteration:1,pinnedBundleHash:'bundle'};
    try{
      await host.build(session as never,candidate);
      expect(buildCalls).toBe(1);
      await expect(host.build({...session,assignment:{...assignment,objective:'changed after pin'}} as never,candidate)).rejects.toThrow('candidate or assignment differs');
      installed=context(preset({profileRevision:4}));
      await expect(host.build(session as never,candidate)).rejects.toThrow();
      expect(buildCalls).toBe(1);
    }finally{rmSync(root,{recursive:true,force:true});}
  });
});
