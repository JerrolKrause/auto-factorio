import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  BlueprintDocument, MachineFact, ProductionAvailability, ProductionCatalog, ProductionProduct,
  RecipeFact, WorkshopAssignment, WorkshopEvaluationReport,
} from '@autofactorio/contracts';
import { effectReceipt } from '@autofactorio/contracts';
import { dashboard } from '../../apps/runtime/http.js';
import { LiveWorkshopHost } from '../../apps/runtime/workshop-live-host.js';
import type { WorkshopGame, WorkshopInference } from '../../apps/runtime/workshop-live-host.js';
import { bindChainStages, chainMeasurementRequirements } from '../../apps/runtime/workshop-chain-measurement.js';
import { prepareChainConstruction } from '../../apps/runtime/workshop-chain-construction.js';
import { dashboardFixture } from '../../scripts/dev/dashboard-fixture.js';
import { WorkspaceCatalog } from '../../packages/storage/src/workspace-catalog.js';
import { installedChainContext } from '../../packages/core/workshop/installed-chain.js';
import type { InstalledChainPreset } from '../../packages/core/workshop/installed-chain.js';
import type { InstalledWorkshopProfile } from '../../packages/factorio/src/workshop.js';
import type { WorkshopRuntimeServices } from '../../packages/core/workshop/runtime.js';

// This is a scripted acceptance adapter: it validates composition and durable evidence
// wiring, not factory connectivity or physical production success in Factorio.
const item = (name: string): ProductionProduct => ({ kind: 'item', name, quality: 'normal', surface: 'nauvis' });
const fluid = (name: string): ProductionProduct => ({ kind: 'fluid', name, quality: 'normal', surface: 'nauvis' });
const flow = (product: ProductionProduct, amount: number) => ({ type: product.kind, name: product.name, amount });
const pipe = { connection_type: 'pipe', direction: 0, flow_direction: 'input', positions: [{ x: 0, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }], connection_category: ['default'] };
const collisionBox: MachineFact['collisionBox'] = [{ x: -1, y: -1 }, { x: 1, y: 1 }];
const oilRecipe: RecipeFact = {
  id: 'recipe:basic-oil-processing', name: 'basic-oil-processing', category: 'oil-processing', seconds: 1,
  ingredients: [flow(fluid('crude-oil'), 100)], products: [flow(fluid('petroleum-gas'), 45)], unlocks: [], surfaceConditions: [],
};
const sulfurRecipe: RecipeFact = {
  id: 'recipe:sulfur', name: 'sulfur', category: 'chemistry', seconds: 1,
  ingredients: [flow(fluid('petroleum-gas'), 30), flow(fluid('water'), 30)], products: [flow(item('sulfur'), 2)], unlocks: [], surfaceConditions: [],
};
const machine = (name: string, category: string): MachineFact => ({
  id: `machine:${name}`, name, type: 'assembling-machine', categories: [category], speed: 1, ingredientLimit: 20,
  collisionBox,
  fluidBoxes: Array.from({ length: 6 }, (_, index) => ({ index: index + 1, productionType: 'input-output' as const, volume: 100, connections: [pipe] })),
  placementItems: [name], energy: { kind: 'electric', maxJoulesPerTick: 0, drainJoulesPerTick: 0 }, baseEffects: {}, surfaceConditions: [],
});
const catalog: ProductionCatalog = {
  schema: 1, mods: { base: '2.0.77' }, fingerprint: 'a'.repeat(64),
  products: [
    { id: 'fluid:crude-oil', kind: 'fluid', name: 'crude-oil' },
    { id: 'fluid:petroleum-gas', kind: 'fluid', name: 'petroleum-gas' },
    { id: 'fluid:water', kind: 'fluid', name: 'water' },
    { id: 'item:sulfur', kind: 'item', name: 'sulfur' },
    { id: 'item:oil-refinery', kind: 'item', name: 'oil-refinery' },
    { id: 'item:chemical-plant', kind: 'item', name: 'chemical-plant' },
  ], recipes: [oilRecipe, sulfurRecipe], machines: [machine('oil-refinery', 'oil-processing'), machine('chemical-plant', 'chemistry')],
};
const availability: ProductionAvailability = {
  tick: 0, force: 'fixture', researched: [], surfaceProperties: { pressure: 1000 },
  recipes: { 'basic-oil-processing': { enabled: true, productivity: 0 }, sulfur: { enabled: true, productivity: 0 } },
};
const preset: InstalledChainPreset = {
  schema: 1, gameVersion: '2.0.77', mods: { base: '2.0.77' }, profileId: 'production-chain', profileRevision: 1,
  surface: 'nauvis', technologies: ['sulfur-processing'], recipes: ['basic-oil-processing', 'sulfur'], allowedEquipment: ['chemical-plant', 'oil-refinery'],
};
const installed = () => installedChainContext(preset, { catalog, availability, availabilityRevision: 'fixture-availability' });
const inferenceResult = (text: string) => ({ text, usage: { turns: 1, tools: 1, elapsedMs: 1, tokens: 12 } });
function requiredPerWindow(rate: { numerator: string; denominator: string }, windowTicks: number) {
  let numerator = BigInt(rate.numerator) * BigInt(windowTicks), denominator = BigInt(rate.denominator) * 60n;
  let left = numerator < 0n ? -numerator : numerator, right = denominator;
  while (right) [left, right] = [right, left % right];
  const divisor = left || 1n;
  numerator /= divisor; denominator /= divisor;
  return { numerator: numerator.toString(), denominator: denominator.toString() };
}

async function waitForWorkshopOptions(page: Page) {
  await expect(page.getByLabel('Session model').locator('option[value="gpt-6-astra"]')).toHaveCount(1);
}

function composedHost(directory: string, facts = installed()) {
  const counts = { preflight: 0, build: 0, measure: 0, inference: [] as string[], stages: [] as { recipe: string; machine: string }[], library: { reads: 0, admissions: 0 } };
  const inference: WorkshopInference = {
    async invoke(_session, role, _selection, observation) {
      counts.inference.push(role);
      if (role === 'workshop-designer') {
        const assignment = (observation as { assignment: WorkshopAssignment }).assignment;
        const designPlan = (observation as { designPlan?: { plan?: { stages?: { id: string }[] }; stageInterfaces?: { id: string; recipe: string; machine: string }[] } }).designPlan;
        const plannedStages = designPlan?.plan?.stages;
        const stageInterfaces = designPlan?.stageInterfaces;
        if (!plannedStages?.length || !stageInterfaces?.length) throw new Error('Selected installed chain stage interfaces were not supplied');
        const stages = plannedStages.map(stage => {
          const selected = stageInterfaces.find(value => value.id === stage.id);
          if (!selected) throw new Error(`Selected stage interface missing for ${stage.id}`);
          const recipe = catalog.recipes.find(value => value.name === selected.recipe)?.name;
          const machineName = catalog.machines.find(value => value.name === selected.machine)?.name;
          if (!recipe || !machineName) throw new Error(`Selected stage uses unavailable installed facts: ${selected.recipe}/${selected.machine}`);
          counts.stages.push({ recipe, machine: machineName });
          return { recipe, machine: machineName };
        });
        const document: BlueprintDocument = {
          schema: 1, label: 'Scripted refinery acceptance layout',
          description: 'Disconnected scripted document; physical behavior is unverified.',
          entities: stages.map((stage, index) => ({ id: `stage-${index + 1}`, entityNumber: index + 1, name: stage.machine, position: { x: index * 80, y: 0 }, direction: 0, quality: 'normal' as const, recipe: stage.recipe })),
          wires: [], ports: assignment.ports, icons: [{ index: 1, name: 'sulfur' }], tiles: [],
        };
        return inferenceResult(JSON.stringify({ blueprint: document }));
      }
      if (role === 'workshop-scorer') return inferenceResult(JSON.stringify({ summary: 'Scripted measurement wired through finalization.' }));
      return inferenceResult(JSON.stringify({ decision: 'no-change', reason: 'No repeated failure', evidence: ['scripted-attempt'] }));
    },
    cancel: id => effectReceipt(`inference:${id}`, 'cancelled'),
    async close() {},
  };
  const game: WorkshopGame = {
    async resolveProfile() { throw new Error('Component profile should not be resolved for chain execution'); },
    async resolveChainProfile() { return structuredClone(facts); },
    async preflight() { counts.preflight++; },
    async build(session, document, profile) {
      counts.build++;
      const prepared = prepareChainConstruction(session.assignment, document, profile, facts);
      const requirements = chainMeasurementRequirements(session.assignment, prepared.resolved.chain);
      const inspected = document.entities.map((entity, index) => ({ unit: index + 101, name: entity.name, position: entity.position }));
      return {
        id: `${session.id}-${session.activeIteration}`, generation: 1, surface: 'scripted-chain-fixture', characterEvidence: null,
        chainMeasurement: {
          schema: 1, ...requirements,
          bindings: bindChainStages(prepared.resolved.chain.stages, document, inspected),
          boundaryFingerprint: prepared.boundaryFingerprint, candidateFingerprint: 'scripted-disconnected-candidate',
        },
      };
    },
    async measure(session): Promise<WorkshopEvaluationReport> {
      counts.measure++;
      const assignment = session.assignment, rule = assignment.throughput[0]!, port = assignment.ports.find(value => value.id === rule.portId)!;
      const required = requiredPerWindow(port.rate, rule.windowTicks);
      return {
        schema: 1, attemptId: `${session.id}:${session.activeIteration}`, valid: true, passed: true, reasons: [],
        ports: [{ portId: port.id, windows: Array.from({ length: rule.windows }, (_, index) => ({
          index, required, productionLower: required, deliveryLower: required, passed: true, reasons: [],
        })) }], evidence: ['scripted-measurement-wiring-only'],
      };
    },
    cancel: id => effectReceipt(`game:${id}`, 'cancelled'),
  };
  const host = new LiveWorkshopHost(directory, inference, game);
  const bindServices = host.bindServices.bind(host);
  host.bindServices = (services: WorkshopRuntimeServices) => {
    const search = services.library.search.bind(services.library), get = services.library.get.bind(services.library), admit = services.library.admit.bind(services.library);
    services.library.search = ((...args: Parameters<typeof services.library.search>) => { counts.library.reads++; return search(...args); }) as typeof services.library.search;
    services.library.get = ((...args: Parameters<typeof services.library.get>) => { counts.library.reads++; return get(...args); }) as typeof services.library.get;
    services.library.admit = ((...args: Parameters<typeof services.library.admit>) => { counts.library.admissions++; return admit(...args); }) as typeof services.library.admit;
    bindServices(services);
  };
  const profileReader = async (profileId: string): Promise<InstalledWorkshopProfile> => ({
    gameVersion: '2.0.77', mods: { base: '2.0.77' }, profileId, profileRevision: 1, surface: 'nauvis',
    technologies: ['automation'], allowedEquipment: ['assembling-machine-1', 'transport-belt', 'inserter'], modules: [], beacons: [],
    recipe: { id: 'electronic-circuit', category: 'crafting', energy: 0.5,
      ingredients: [{ type: 'item', name: 'iron-plate', amount: 1 }, { type: 'item', name: 'copper-cable', amount: 3 }],
      products: [{ type: 'item', name: 'electronic-circuit', amount: 1 }] }, machine: 'assembling-machine-1',
  });
  return { host, profileReader, counts };
}

test('real dashboard chain launch finalizes durably, exposes evidence after reload, and keeps component draft', async ({ page }) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'af-ui-chain-launch-'));
  const fixture = await dashboardFixture(path.join(root, 'dashboard', 'run-fixture'), true);
  const catalog = new WorkspaceCatalog(root);
  const scripted = composedHost(fixture.runtime.directory);
  const server = dashboard(fixture.operator, undefined, {
    workspaceCatalog: catalog,
    managedModels: [{ id: 'gpt-6-astra', displayName: 'Astra', efforts: ['low'] }],
    workshopHost: scripted.host,
    profileReader: scripted.profileReader,
  });
  const origin = await server.listen();
  const draftKey = 'autofactorio.workshop.draft.v1';
  try {
    await page.goto(`${origin}/workshop`);
    const panel = page.getByTestId('workshop');
    await waitForWorkshopOptions(page);
    const objective = 'Produce sulfur from crude oil and water';
    await panel.locator('textarea[data-launch-field="brief"]').fill(objective);
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).values.objective, draftKey)).toBe(objective);
    await panel.getByLabel('Production mode').selectOption('chain');
    await panel.getByLabel('Capability profile').selectOption('production-chain');
    await panel.getByLabel('Target product').fill('sulfur');
    await panel.getByLabel('Target units per game second').fill('1');
    await panel.getByLabel('External input rates').fill('crude-oil 100\nwater 100');
    await panel.getByLabel('Co-product destination rates').fill('');
    await panel.getByLabel('Supplied electricity (MW)').fill('10');
    await panel.getByLabel('Construction equipment').fill('oil-refinery 1\nchemical-plant 1');
    await expect(panel.getByLabel('Allow library access')).toBeEnabled();
    await panel.getByLabel('Allow library access').check();
    await panel.getByLabel('Attempts', { exact: true }).fill('1');
    await panel.getByLabel('Stop early after a plateau').uncheck();
    await page.getByText('Advanced settings').click();
    await panel.getByLabel('Improvement cadence').selectOption('off');

    const customRubric: WorkshopAssignment['rubric'] = { version: 'test-custom-rubric', weights: { throughput: { numerator: '2', denominator: '3' } }, materiality: { throughput: { numerator: '1', denominator: '7' } }, directions: { throughput: 'maximize' } };
    let originalCallerJSON: { assignment: Record<string, unknown> } | null = null;
    let customRubricInjected = false;
    await page.route('**/api/workshop/launch', async route => {
      if (customRubricInjected) { await route.continue(); return; }
      const body = route.request().postDataJSON() as { assignment: Record<string, unknown> };
      originalCallerJSON = structuredClone(body);
      customRubricInjected = true;
      await route.continue({ postData: JSON.stringify({ ...body, assignment: { ...body.assignment, rubric: customRubric, requestedSpeed: { numerator: '1', denominator: '3' } } }) });
    });
    const launchResponse = page.waitForResponse(response => response.url().endsWith('/api/workshop/launch') && response.request().method() === 'POST');
    await panel.getByRole('button', { name: 'Launch workshop' }).click();
    expect((await launchResponse).status()).toBe(202);
    await page.unroute('**/api/workshop/launch');
    expect(originalCallerJSON).toMatchObject({ assignment: { rubric: { version: 'rubric-1' } } });
    expect(customRubricInjected).toBe(true);
    await expect(page).toHaveURL(/\/history\//);
    const runId = new URL(page.url()).pathname.split('/').at(-1)!;
    await expect.poll(() => catalog.request(runId)?.state).toBe('completed');
    const request = catalog.request(runId);
    expect(request).toMatchObject({ id: runId, kind: 'workshop', state: 'completed' });
    const session = fixture.runtime.journal.get<{ stage: string; finalOutcome: string; assignment: WorkshopAssignment; iterations: { artifact?: { artifactHash: string }; evaluation?: { attemptId: string; passed: boolean; ports: { windows: { required: { numerator: string; denominator: string } }[] }[] } }[] }>(fixture.runtime.run, 'workshopSessions', runId);
    expect(session).toMatchObject({ stage: 'complete', finalOutcome: 'best-valid', assignment: { productionMode: 'chain', libraryAccess: true, improveRevision: null }, iterations: [{ evaluation: { attemptId: `${runId}:1`, passed: true } }] });
    expect(session!.assignment.rubric).toEqual(customRubric);
    expect(session!.assignment.requestedSpeed).toEqual({ numerator: '1', denominator: '3' });
    const output = session!.assignment.ports.find(value => value.direction === 'output')!;
    const rule = session!.assignment.throughput.find(value => value.portId === output.id)!;
    expect(session?.iterations[0]?.evaluation?.ports[0]?.windows[0]?.required).toEqual(requiredPerWindow(output.rate, rule.windowTicks));
    expect(session?.iterations[0]?.artifact?.artifactHash).toBeTruthy();
    expect(scripted.counts).toMatchObject({ preflight: 1, build: 1, measure: 1, inference: ['workshop-designer', 'workshop-scorer'], library: { reads: 1, admissions: 1 } });
    expect(scripted.counts.stages).toHaveLength(2);
    expect(scripted.counts.stages).toEqual(expect.arrayContaining([
      { recipe: 'basic-oil-processing', machine: 'oil-refinery' }, { recipe: 'sulfur', machine: 'chemical-plant' },
    ]));
    expect(fixture.runtime.journal.list(fixture.runtime.run, 'libraryEntries')).toHaveLength(1);
    expect(catalog.run(runId)).toBeTruthy();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Build progression' })).toBeVisible();
    const attempt = page.getByRole('button', { name: new RegExp(`Attempt 1 · ${runId}:1`) });
    await attempt.click();
    await expect(page.locator('.history-row pre').first()).toContainText(session!.iterations[0]!.artifact!.artifactHash);
    await expect(page.locator('.history-row pre').first()).toContainText('scripted-measurement-wiring-only');
    await page.getByRole('button', { name: 'Designer output' }).click();
    await expect(page.locator('.evidence-inspector pre')).toContainText('Scripted refinery acceptance layout');
    await page.getByRole('link', { name: 'Run History' }).click();
    await expect(page.getByRole('button', { name: new RegExp('Produce sulfur from crude oil and water') })).toBeVisible();
    await page.getByRole('button', { name: new RegExp('Produce sulfur from crude oil and water') }).click();
    const historyRun = page.locator('a.history-row').filter({ hasText: runId });
    await expect(historyRun).toBeVisible();
    await historyRun.click();
    await expect(page).toHaveURL(new RegExp(`/history/${runId}$`));
    await page.getByRole('button', { name: new RegExp(`Attempt 1 · ${runId}:1`) }).click();
    await page.getByRole('button', { name: 'Scorer output' }).click();
    await expect(page.locator('.evidence-inspector pre')).toContainText('Scripted measurement wired through finalization');

    // Rejected raw requests go through Fastify and host resolution, before inference/game effects.
    const before = structuredClone(scripted.counts);
    const raw = session!.assignment as unknown as Record<string, unknown>;
    for (const bad of [
      { ...raw, id: `${runId}-improve-denial`, source: { kind: 'revision', id: 'source-revision' }, improveRevision: 'source-revision' },
    ]) {
      const result = await page.evaluate(async assignment => {
        const response = await fetch('/api/workshop/launch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assignment }) });
        return { status: response.status, body: await response.text() };
      }, bad);
      expect(result.status).toBe(202);
      await expect.poll(()=>catalog.request(String(bad.id))?.state).toBe('failed');
    }
    expect(scripted.counts.preflight).toBe(before.preflight);expect(scripted.counts.build).toBe(before.build);expect(scripted.counts.measure).toBe(before.measure);expect(scripted.counts.inference).toEqual(before.inference);
    expect(fixture.runtime.journal.list(fixture.runtime.run, 'libraryEntries')).toHaveLength(1);

    await page.goto(origin+'/library');
    await page.getByRole('button',{name:'Search',exact:true}).click();
    const row=page.locator('.workshop-library .workshop-row').first();
    await expect(row).toContainText('Boundary:');
    const entries=await (await page.request.get(origin+'/api/workshop/library')).json() as {items:{attestationId:string;boundaryHash:string}[]};
    const original=entries.items[0]!;
    const provenance=await (await page.request.get(origin+'/api/workshop/library/'+original.attestationId)).json();
    expect(provenance.provenance.chain.plan.id).toBe('plan.'+runId);
    await row.getByRole('button',{name:'Improve',exact:true}).click();
    await expect(page.getByLabel('Production mode')).toHaveValue('chain');
    await expect(page.getByText('Exact boundary restored.',{exact:false})).toBeVisible();
    await expect(page.getByLabel('External input rates')).toHaveValue('crude-oil 100\nwater 100');
    await expect(page.getByLabel('External input rates')).toBeDisabled();
    await page.getByLabel('Attempts',{exact:true}).fill('1');
    await page.getByLabel('Stop early after a plateau').uncheck();
    const improvedResponse=page.waitForResponse(response=>response.url().endsWith('/api/workshop/launch')&&response.request().method()==='POST');
    await page.getByRole('button',{name:'Launch workshop'}).click();
    expect((await improvedResponse).status()).toBe(202);
    await expect(page).toHaveURL(/\/history\//);
    const improvedId=new URL(page.url()).pathname.split('/').at(-1)!;
    await expect.poll(()=>catalog.request(improvedId)?.state).toBe('completed');
    const improved=fixture.runtime.journal.get<{assignment:WorkshopAssignment}>(fixture.runtime.run,'workshopSessions',improvedId)!;
    expect(improved.assignment.chainRequest).toEqual(session!.assignment.chainRequest);
    expect(improved.assignment.improveRevision).toBe(original.attestationId);
    expect(improved.assignment.rubric).toEqual(customRubric);
    expect(improved.assignment.requestedSpeed).toEqual({ numerator: '1', denominator: '3' });
    // A changed boundary requires an explicit new evaluation in both entrypoints.
    const effects=structuredClone(scripted.counts);
    const denied=await page.request.post(origin+'/api/workshop/launch',{headers:{origin},data:{assignment:{...session!.assignment,id:runId+'-changed',source:{kind:'revision',id:original.attestationId},improveRevision:original.attestationId,chainRequest:{...session!.assignment.chainRequest,utilities:{electricityWatts:20000000}}}}});
    expect(denied.status()).toBe(202);await expect.poll(()=>catalog.request(runId+'-changed')?.state).toBe('failed');expect(catalog.request(runId+'-changed')?.reason).toMatch(/boundary.*changed/i);expect(scripted.counts.build).toBe(effects.build);expect(scripted.counts.inference).toEqual(effects.inference);
    await page.goto(origin+'/workshop?improve='+original.attestationId);
    await expect(page.getByText('Exact boundary restored.',{exact:false})).toBeVisible();
    await page.getByRole('button',{name:'Start new evaluation',exact:true}).click();
    await expect(page.getByLabel('External input rates')).toBeEnabled();
    await page.getByLabel('Supplied electricity (MW)').fill('20');
    await page.getByLabel('Attempts',{exact:true}).fill('1');await page.getByLabel('Stop early after a plateau').uncheck();
    await page.getByRole('button',{name:'Launch workshop'}).click();
    await expect(page).toHaveURL(/\/history\//);
    const freshId=new URL(page.url()).pathname.split('/').at(-1)!;
    await expect.poll(()=>catalog.request(freshId)?.state).toBe('completed');
    const after=await (await page.request.get(origin+'/api/workshop/library')).json() as {items:{attestationId:string;boundaryHash:string;revisionHash:string}[]};
    expect(after.items).toHaveLength(2);expect(new Set(after.items.map(entry=>entry.boundaryHash)).size).toBe(2);expect(new Set(after.items.map(entry=>entry.revisionHash)).size).toBe(1);
    expect(fixture.runtime.journal.list(fixture.runtime.run, 'libraryEntries')).toHaveLength(2);
    const admissionEvents = fixture.runtime.journal.events().filter(event => event.type === 'workshop/library-admitted');
    expect(admissionEvents).toHaveLength(2);
    const admittedAttestations = admissionEvents.flatMap(event => event.changes.filter(change => change.entity === 'libraryEntries').map(change => change.id));
    expect(new Set(admittedAttestations).size).toBe(2);

    // Select boundary B through the visible Library destination while source A is saved.
    const secondBoundary = after.items.find(entry => entry.attestationId !== original.attestationId)!;
    await page.goto(origin + '/workshop?improve=' + original.attestationId);
    await expect(page.getByText('Exact boundary restored.', { exact: false })).toBeVisible();
    await page.goto(origin + '/library');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const secondBoundaryRow = page.locator('.workshop-library .workshop-row').filter({ hasText: secondBoundary.boundaryHash });
    await expect(secondBoundaryRow).toBeVisible();
    await secondBoundaryRow.getByRole('button', { name: 'Improve', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`improve=${secondBoundary.attestationId}`));
    await expect(page.getByText('Exact boundary restored.', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Supplied electricity (MW)')).toHaveValue('20');

    // Saved Improve provenance also restores when the page has no improve query.
    await page.goto(origin + '/workshop');
    await expect(page).toHaveURL(origin + '/workshop');
    await expect(page.getByText('Exact boundary restored.', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Supplied electricity (MW)')).toHaveValue('20');
    const improveBRequest = page.waitForRequest(request => request.url().endsWith('/api/workshop/launch') && request.method() === 'POST');
    const improveBResponse = page.waitForResponse(response => response.url().endsWith('/api/workshop/launch') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Launch workshop' }).click();
    expect((await improveBResponse).status()).toBe(202);
    const improveBPayload = (await improveBRequest).postDataJSON() as { assignment: WorkshopAssignment };
    expect(improveBPayload.assignment.source).toEqual({ kind: 'revision', id: secondBoundary.attestationId });
    expect(improveBPayload.assignment.improveRevision).toBe(secondBoundary.attestationId);
    await expect(page).toHaveURL(/\/history\//);
    const improveBId = new URL(page.url()).pathname.split('/').at(-1)!;
    await expect.poll(() => catalog.request(improveBId)?.state).toBe('completed');
    const improvedB = fixture.runtime.journal.get<{ assignment: WorkshopAssignment }>(fixture.runtime.run, 'workshopSessions', improveBId)!;
    expect(improvedB.assignment.source).toEqual({ kind: 'revision', id: secondBoundary.attestationId });
    expect(improvedB.assignment.improveRevision).toBe(secondBoundary.attestationId);
    const boundaryBProvenance = await (await page.request.get(origin + '/api/workshop/library/' + secondBoundary.attestationId)).json() as { provenance: { assignment: WorkshopAssignment } };
    expect(improvedB.assignment.rubric).toEqual(boundaryBProvenance.provenance.assignment.rubric);
    expect(improvedB.assignment.requestedSpeed).toEqual(boundaryBProvenance.provenance.assignment.requestedSpeed);

    await page.goto(origin + '/workshop?improve=' + secondBoundary.attestationId);
    await expect(page.getByText('Exact boundary restored.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Start new evaluation', exact: true }).click();
    await expect(page).toHaveURL(origin + '/workshop');
    await expect(page.getByLabel('External input rates')).toBeEnabled();
    await page.getByLabel('Supplied electricity (MW)').fill('30');
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).values.chainSetup.electricityMW, draftKey)).toBe('30');
    await page.reload();
    await expect(page).toHaveURL(origin + '/workshop');
    await expect(page.getByLabel('Production mode')).toHaveValue('chain');
    await expect(page.getByLabel('Supplied electricity (MW)')).toHaveValue('30');
    await expect(page.getByLabel('External input rates')).toBeEnabled();
    await page.goto(origin+'/workshop');
    await expect(page.getByLabel('Production mode')).toHaveValue('chain');
    await page.getByLabel('Production mode').selectOption('component');
    await expect(panel.locator('textarea[data-launch-field="brief"]')).toHaveValue(objective);
    await page.reload();
    await expect(page.getByLabel('Production mode')).toHaveValue('component');
    await expect(page.getByTestId('workshop').locator('textarea[data-launch-field="brief"]')).toHaveValue(objective);
  } finally {
    await server.close();
    catalog.close();
    fixture.close();
    rmSync(root, { recursive: true, force: true });
  }
});
