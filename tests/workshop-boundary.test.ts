import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BlueprintDocument, ProductionPlan, ProductionRequest, WorkshopAssignment } from '@autofactorio/contracts';
import { BlueprintLibrary } from '../packages/core/workshop/library.js';
import type { LibraryAdmission } from '../packages/core/workshop/library.js';
import { blueprintContentHash } from '../packages/core/workshop/blueprint.js';
import { evaluationBoundary } from '../packages/core/workshop/boundary.js';
import { workshopRubricHash } from '../packages/core/workshop/scoring.js';

const directory = () => mkdtempSync(path.join(process.cwd(), '.runtime', 'test-workshop-boundary-'));
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const product = (name: string) => ({ kind: 'item' as const, name, quality: 'normal' as const, surface: 'nauvis' });
const ports = [
  { id: 'input-iron', direction: 'input' as const, product: product('iron-plate'), position: { x: 0, y: 0 }, facing: 0, transport: 'belt' as const, rate: { numerator: '1', denominator: '1' }, unit: 'units-per-game-second' as const, required: true },
  { id: 'output-circuit', direction: 'output' as const, product: product('electronic-circuit'), position: { x: 8, y: 0 }, facing: 4, transport: 'belt' as const, rate: { numerator: '1', denominator: '1' }, unit: 'units-per-game-second' as const, required: true },
];
const rubric = { version: 'r1', weights: { throughput: { numerator: '1', denominator: '1' } }, materiality: { throughput: { numerator: '0', denominator: '1' } }, directions: { throughput: 'maximize' as const } };
const assignment = (overrides: Partial<WorkshopAssignment> = {}): WorkshopAssignment => ({
  schema: 1, id: 'boundary-session', revision: 1, comparisonSeries: 'series', objective: 'Produce circuits', source: { kind: 'brief', id: null }, ports,
  profileId: 'starter-assembly', profileRevision: 1, gameFingerprint: 'a'.repeat(64), footprint: { width: 16, height: 12, clearance: 2, maxTiles: 192 },
  construction: 'direct', libraryAccess: true, improveRevision: null, requestedSpeed: { numerator: '1', denominator: '1' }, settlingTicks: 0,
  throughput: [{ portId: 'output-circuit', windowTicks: 60, windows: 1, quantum: { numerator: '1', denominator: '1' }, productionError: { numerator: '0', denominator: '1' }, deliveryError: { numerator: '0', denominator: '1' }, maxStockDrawdown: { numerator: '0', denominator: '1' }, maxResidual: { numerator: '0', denominator: '1' }, interval: '(startTick,endTick]' }],
  rubric, iterations: { attempts: 1, mode: 'exact', earlyStop: false, plateauRounds: 1 }, checkpoints: { brief: false, afterScore: false, libraryAdmission: false, learningActivation: false, timeoutMs: 1000, timeoutAction: 'finish' },
  budgets: { wallMs: 60000, gameTicks: 600, turns: 3, toolCalls: 8, reportedTokens: 1000, learningReservedTurns: 0, learningReservedTools: 0 },
  models: { sessionDefault: { provider: 'openai', modelId: 'gpt-6-astra', reasoningEffort: 'low' }, overrides: {} },
  learning: { cadence: 'off', batchSessions: 1, candidateCap: 1, attemptsPerCandidate: 1, autoActivate: false }, ...overrides,
});
const request = (changes: Partial<ProductionRequest> = {}): ProductionRequest => ({
  schema: 1, target: product('electronic-circuit'), mode: 'rate', rate: { numerator: '1', denominator: '1', unit: 'items-per-game-second' },
  profile: { id: 'starter-assembly', revision: 1, fingerprint: 'profile-fingerprint', recipes: ['circuit'], equipment: ['assembler'] },
  facts: { schema: 1, id: 'production.facts', fingerprint: 'b'.repeat(64), availabilityRevision: 'c'.repeat(64) },
  externalInputs: [{ product: product('iron-plate'), capacity: { kind: 'unlimited' } }], initialStock: [], utilities: { electricityWatts: 1000 }, constructionEquipment: { assembler: 1 }, sinks: [],
  routes: { 'item:electronic-circuit': 'recipe:circuit' }, machines: { 'recipe:circuit': 'machine:assembler' }, fuels: {}, ...changes,
});
const document = (): BlueprintDocument => ({ schema: 1, label: 'Circuit', description: 'fixture', entities: [{ id: 'assembler', entityNumber: 1, name: 'assembling-machine-1', position: { x: 1, y: 1 }, direction: 0, quality: 'normal', recipe: 'electronic-circuit' }], wires: [], ports: structuredClone(ports), icons: [], tiles: [] });
const proof = (a: WorkshopAssignment, doc: BlueprintDocument, provenance?: LibraryAdmission['proof']['provenance']): LibraryAdmission['proof'] => {
  const hash = blueprintContentHash(doc), rubricHash = workshopRubricHash(a.rubric);
  return { score: { schema: 1, candidate: { sessionId: a.id, iteration: 1, artifactHash: hash, assignmentRevision: a.revision, bundleHash: 'bundle', evidence: ['candidate'] }, rubricVersion: a.rubric.version, eligible: true, dimensions: {}, feedback: '', interactionFeedback: '', invalidReasons: [] },
    evaluation: { schema: 1, attemptId: `${a.id}:1`, valid: true, passed: true, reasons: [], ports: [], evidence: ['measurement'] }, rubric: structuredClone(a.rubric), rubricHash, profileId: a.profileId, gameFingerprint: a.gameFingerprint,
    outputPortId: 'output-circuit', exportValid: true, characterBuildEvidence: null, compatibilityEvidence: ['installed profile'], distinctionEvidence: ['boundary fixture'], admit: true, ...(provenance ? { provenance } : {}) };
};
const admission = (a: WorkshopAssignment, doc: BlueprintDocument, operationId: string, p?: LibraryAdmission['proof']): LibraryAdmission => ({ identity: { familyId: 'circuits', variantId: 'starter', parentHash: null, label: doc.label }, document: doc, proof: p ?? proof(a, doc), operationId });
const planFor = (request: ProductionRequest, changes: Partial<ProductionPlan> = {}): ProductionPlan => ({ schema: 1, id: 'plan-fixture', revision: 1, request, fingerprint: request.facts.fingerprint, availabilityRevision: request.facts.availabilityRevision,
  status: 'feasible', executable: true, routePolicy: 'selected', routes: request.routes, stages: [], products: [], blockers: [], assumptions: [], balances: [], transport: [], omitted: 0, invalidatedEvidence: [], ...changes });

describe('canonical workshop evaluation boundaries', () => {
  it('keeps equivalent set ordering and rational spellings on one canonical identity', () => {
    const base = assignment({ ports: [ports[0]!, ports[1]!] });
    const reordered = assignment({ ports: [{ ...ports[1]!, rate: { numerator: '2', denominator: '2' } }, { ...ports[0]!, rate: { numerator: '3', denominator: '3' } }] });
    expect(evaluationBoundary(base).hash).toBe(evaluationBoundary(reordered).hash);
    const chain = assignment({ productionMode: 'chain', chainRequest: request() });
    const equivalentChain = assignment({ productionMode: 'chain', chainRequest: request({ headroom: 0, transport: [] }) });
    expect(evaluationBoundary(chain).hash).toBe(evaluationBoundary(equivalentChain).hash);
  });

  it.each([
    ['mode', (a: WorkshopAssignment) => ({ ...a, productionMode: 'chain' as const, chainRequest: request() })],
    ['target rate', (a: WorkshopAssignment) => ({ ...a, ports: a.ports.map(p => p.id === 'output-circuit' ? { ...p, rate: { numerator: '2', denominator: '1' } } : p) })],
    ['external identity', (a: WorkshopAssignment) => ({ ...a, ports: a.ports.map(p => p.id === 'input-iron' ? { ...p, product: product('copper-plate') } : p) })],
    ['finite stock policy', (a: WorkshopAssignment) => ({ ...a, productionMode: 'chain' as const, chainRequest: request({ initialStock: [{ product: product('iron-plate'), quantity: 1 }], externalInputs: [{ product: product('iron-plate'), capacity: { kind: 'rate', numerator: '2', denominator: '1' } }] }) })],
    ['utilities and fuel allowance', (a: WorkshopAssignment) => ({ ...a, productionMode: 'chain' as const, chainRequest: request({ utilities: { electricityWatts: 2000 }, fuels: { 'recipe:circuit': product('coal') } }) })],
    ['co-product destination', (a: WorkshopAssignment) => ({ ...a, productionMode: 'chain' as const, chainRequest: request({ sinks: [{ product: product('copper-plate'), capacity: { kind: 'unlimited' } }] }) })],
    ['surface and quality', (a: WorkshopAssignment) => ({ ...a, ports: a.ports.map(p => p.id === 'output-circuit' ? { ...p, product: { ...p.product, quality: 'normal' as const, surface: 'vulcanus' } } : p) })],
    ['profile and bonuses', (a: WorkshopAssignment) => ({ ...a, profileRevision: 2 })],
    ['construction and evaluation conditions', (a: WorkshopAssignment) => ({ ...a, construction: 'character' as const, settlingTicks: 5 })],
    ['measurement rule', (a: WorkshopAssignment) => ({ ...a, throughput: a.throughput.map(rule => ({ ...rule, windows: 2 })) })],
  ])('distinguishes changes to %s', (_label, alter) => {
    const base = assignment();
    expect(evaluationBoundary(base).hash).not.toBe(evaluationBoundary(alter(base)).hash);
  });
});

describe('immutable boundary attestations', () => {
  it('keeps same-product component and chain admissions separate when profile names match', () => {
    const root = directory(); dirs.push(root); const library = new BlueprintLibrary(root), doc = document();
    const component = assignment(), chain = assignment({ productionMode: 'chain', chainRequest: request() });
    const componentProof = proof(component, doc, { assignment: component, evaluationReference: `${component.id}:1` });
    const chainProof = proof(chain, doc, { assignment: chain, evaluationReference: `${chain.id}:1`, chain: { request: chain.chainRequest!, plan: planFor(chain.chainRequest!) } });
    const componentEntry = library.admit(admission(component, doc, 'component-operation', componentProof));
    const chainEntry = library.admit(admission(chain, doc, 'chain-operation', chainProof));
    expect(componentEntry.product.name).toBe(chainEntry.product.name);
    expect(componentEntry.profileId).toBe(chainEntry.profileId);
    expect(componentEntry.revisionHash).toBe(chainEntry.revisionHash);
    expect(componentEntry.attestationId).not.toBe(chainEntry.attestationId);
    expect(library.search({ boundaryHash: componentEntry.boundaryHash! }).map(entry => entry.attestationId)).toEqual([componentEntry.attestationId]);
    expect(library.search({ boundaryHash: chainEntry.boundaryHash! }).map(entry => entry.attestationId)).toEqual([chainEntry.attestationId]);
    library.close();
  });

  it('retains identical native content under distinct capacity attestations and rebuilds/retries immutably', async () => {
    const root = directory(); dirs.push(root); const library = new BlueprintLibrary(root), doc = document();
    const first = assignment({ productionMode: 'chain', chainRequest: request() });
    const secondRequest = request({ externalInputs: [{ product: product('iron-plate'), capacity: { kind: 'rate', numerator: '20', denominator: '1' } }] });
    const second = assignment({ id: 'boundary-session-two', productionMode: 'chain', chainRequest: secondRequest });
    const plan = planFor(first.chainRequest!);
    const firstProof = proof(first, doc, { assignment: first, evaluationReference: `${first.id}:1`, chain: { request: first.chainRequest!, plan } });
    const secondProof = proof(second, doc, { assignment: second, evaluationReference: `${second.id}:1`, chain: { request: second.chainRequest!, plan: planFor(second.chainRequest!) } });
    const one = library.admit(admission(first, doc, 'operation-one', firstProof));
    const two = library.admit(admission(second, doc, 'operation-two', secondProof));
    expect(two.revisionHash).toBe(one.revisionHash);
    expect(two.attestationId).not.toBe(one.attestationId);
    expect(two.boundaryHash).not.toBe(one.boundaryHash);
    expect(library.search({ boundaryHash: one.boundaryHash! }).map(entry => entry.attestationId)).toEqual([one.attestationId]);
    expect(library.get(one.attestationId!).evidence.provenance?.evaluationReference).toBe(`${first.id}:1`);
    expect(library.get(two.attestationId!).evidence.provenance?.evaluationReference).toBe(`${second.id}:1`);
    const bytesBefore = readFileSync(path.join(one.directory, 'evidence.json'), 'utf8');
    expect(library.admit(admission(first, doc, 'operation-one', firstProof))).toMatchObject({ attestationId: one.attestationId });
    await library.rebuild();
    expect(library.search({ boundaryHash: two.boundaryHash! }).map(entry => entry.attestationId)).toEqual([two.attestationId]);
    expect(readFileSync(path.join(one.directory, 'evidence.json'), 'utf8')).toBe(bytesBefore);
    library.close();
  });

  it('keeps legacy proof readable as unknown and excludes it from boundary filters', async () => {
    const root = directory(); dirs.push(root); const library = new BlueprintLibrary(root), a = assignment(), doc = document();
    const legacy = library.admit(admission(a, doc, 'legacy-operation'));
    expect(legacy.boundaryStatus).toBe('unknown');
    expect(library.get(legacy.revisionHash).entry.boundaryHash).toBeNull();
    expect(library.search({ boundaryHash: evaluationBoundary(a).hash })).toEqual([]);
    expect(await library.rebuild()).toBe(1);
    expect(library.search()).toHaveLength(1);
    library.close();
  });

  it.each(['assignment identity', 'plan request', 'executable plan', 'blueprint ports'] as const)('rejects invalid %s provenance', (kind) => {
    const root = directory(); dirs.push(root); const library = new BlueprintLibrary(root), a = assignment({ productionMode: 'chain', chainRequest: request() }), doc = document();
    const plan = planFor(a.chainRequest!);
    const p = proof(a, doc, { assignment: a, evaluationReference: `${a.id}:1`, chain: { request: a.chainRequest!, plan } });
    if (kind === 'assignment identity') p.provenance!.assignment = { ...a, id: 'forged' };
    if (kind === 'plan request') p.provenance!.chain!.plan = planFor(request({ rate: { numerator: '3', denominator: '1', unit: 'items-per-game-second' } }));
    if (kind === 'executable plan') p.provenance!.chain!.plan = planFor(a.chainRequest!, { executable: false });
    if (kind === 'blueprint ports') p.provenance!.assignment = { ...a, ports: [ports[0]!] };
    expect(() => library.admit(admission(a, doc, `invalid-${kind}`, p))).toThrow();
    library.close();
  });
});
