import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateWorkshopAssignment } from '@autofactorio/contracts';
import type { BlueprintDocument, WorkshopAssignment, WorkshopEvaluationReport, WorkshopWindowMeasurement } from '@autofactorio/contracts';
import type { WorkshopIterationState, WorkshopSessionState, WorkshopStage } from '../packages/core/workshop/orchestrator.js';
import { blueprintContentHash } from '../packages/core/workshop/blueprint.js';
import type { InstalledWorkshopProfile } from '../packages/factorio/src/workshop.js';
import { LiveWorkshopHost } from '../apps/runtime/workshop-live-host.js';
import { summarizeDesignerDiagnostics } from '../apps/runtime/workshop-design.js';
import { workshopDesignPlan } from '../apps/runtime/workshop-design-plan.js';
import { cellDesignInstructions } from '../agents/workshop/designer.js';
import { WorkshopControl } from '../packages/factorio/src/workshop.js';
import { workshopReport, workshopTrialSession, writeWorkshopTrialReports } from '../scripts/dev/workshop-report.js';
import {
  captureLifecycleObservation, lifecycleFailureEvidence, measurementLifecycleCounterCommand,
  measurementLifecycleFixture, validateMeasurementLifecycleFixture,
} from '../scripts/dev/workshop-measure-fixture.js';
import type { LifecycleObservations } from '../scripts/dev/workshop-measure-fixture.js';

const rate = (numerator: number) => ({ numerator: String(numerator), denominator: '1' });

function planAssignment(options: { outputRate?: number; outputAmount?: number; oreSupply?: number; coalSupply?: number } = {}): WorkshopAssignment {
  const fixture = measurementLifecycleFixture();
  const outputRate = options.outputRate ?? 15;
  return validateWorkshopAssignment({
    ...fixture.assignment,
    id: 'design-plan', objective: `create ${outputRate} iron plates per second`,
    source: { kind: 'brief', id: null, numericTargetText: `${outputRate} per second` },
    ports: [
      { id: 'ore', direction: 'input', product: { kind: 'item', name: 'iron-ore', quality: 'normal', surface: 'nauvis' }, position: { x: -12.5, y: -4.5 }, facing: 4, transport: 'belt', rate: rate(options.oreSupply ?? 45), unit: 'units-per-game-second', required: true },
      { id: 'coal', direction: 'input', product: { kind: 'item', name: 'coal', quality: 'normal', surface: 'nauvis' }, position: { x: -12.5, y: -0.5 }, facing: 4, transport: 'belt', rate: rate(options.coalSupply ?? 45), unit: 'units-per-game-second', required: true },
      { id: 'plates', direction: 'output', product: { kind: 'item', name: 'iron-plate', quality: 'normal', surface: 'nauvis' }, position: { x: 12.5, y: 0.5 }, facing: 4, transport: 'belt', rate: rate(outputRate), unit: 'units-per-game-second', required: true },
    ],
    throughput: fixture.assignment.throughput.map(rule => ({ ...rule, maxStockDrawdown: rate(Math.ceil(outputRate)) })),
  });
}

function installedProfile(overrides: Partial<InstalledWorkshopProfile> = {}): InstalledWorkshopProfile {
  return {
    gameVersion: '2.0.77', mods: { base: '2.0.77' }, profileId: 'starter-assembly', profileRevision: 1,
    surface: 'nauvis', technologies: ['automation'], allowedEquipment: ['stone-furnace', 'yellow-belt', 'red-belt', 'blue-belt'],
    modules: [], beacons: [], recipe: { id: 'iron-plate', category: 'smelting', energy: 3.2,
      ingredients: [{ type: 'item', name: 'iron-ore', amount: 1 }], products: [{ type: 'item', name: 'iron-plate', amount: 1 }] },
    machine: 'stone-furnace', machineFacts: { craftingSpeed: 1, energyWatts: 90_000, burner: true, coalFuelJoules: 4_000_000 },
    equipmentFacts: [
      { name: 'yellow-belt', type: 'transport-belt', beltSpeed: 0.03125 },
      { name: 'red-belt', type: 'transport-belt', beltSpeed: 0.0625 },
      { name: 'blue-belt', type: 'transport-belt', beltSpeed: 0.09375 },
      { name: 'denied-belt', type: 'transport-belt', beltSpeed: 0.2 },
    ],
    ...overrides,
  };
}

function installedFingerprint(installed: InstalledWorkshopProfile): string {
  return createHash('sha256').update(JSON.stringify({ gameVersion: installed.gameVersion, mods: installed.mods, profileId: installed.profileId,
    profileRevision: installed.profileRevision, surface: installed.surface, technologies: installed.technologies, allowedEquipment: installed.allowedEquipment,
    modules: installed.modules, beacons: installed.beacons, recipe: installed.recipe, machine: installed.machine, machineFacts: installed.machineFacts,
    equipmentFacts: installed.equipmentFacts })).digest('hex');
}

function measuredWindow(overrides: Partial<WorkshopWindowMeasurement> = {}): WorkshopWindowMeasurement {
  return {
    schema: 1, attemptId: 'report-attempt', index: 0, startTick: 0, endTick: 600, interval: '(startTick,endTick]',
    ports: [{ portId: 'plates', product: { kind: 'item', name: 'iron-plate', quality: 'normal', surface: 'nauvis' },
      production: rate(900), delivery: rate(900), openingStock: rate(8), closingStock: rate(0), residual: rate(0),
      productionAllocationId: 'candidate-1', coverage: 'complete', evidence: ['window-0'] }],
    stageCoverage: 'complete', energyCoverage: 'complete', contamination: [], mutationsFrozen: true, connected: true, evidence: ['raw-window'],
    ...overrides,
  };
}

function evaluation(passed: boolean, attemptId: string): WorkshopEvaluationReport {
  return { schema: 1, attemptId, valid: true, passed, reasons: passed ? [] : ['below_target'], ports: [{ portId: 'plates', windows: [{ index: 0, required: rate(900), productionLower: rate(passed ? 900 : 899), deliveryLower: rate(900), passed, reasons: passed ? [] : ['production_below_target'] }] }], evidence: ['test-evaluation'] };
}

function reportIteration(number: number, overrides: Partial<WorkshopIterationState> = {}): WorkshopIterationState {
  return { id: `report-session:${number}`, sessionId: 'report-session', number, stage: 'scoring',
    artifact: { sessionId: 'report-session', iteration: number, artifactHash: `candidate-${number}`, assignmentRevision: 1, bundleHash: 'baseline', evidence: [] },
    evaluation: evaluation(true, `report-attempt-${number}`), score: null, feedback: 'test iteration', operationIds: [], valid: true, ...overrides };
}

function sessionState(assignment: WorkshopAssignment, options: { id?: string; stage?: WorkshopStage; activeIteration?: number | null; iterations?: WorkshopIterationState[]; bestIteration?: number | null } = {}): WorkshopSessionState {
  const iterations = options.iterations ?? [];
  return {
    id: options.id ?? assignment.id, stage: options.stage ?? 'complete', assignment,
    selections: {
      designer: { provider: 'openai', modelId: 'gpt-6-astra', reasoningEffort: 'low' },
      scorer: { provider: 'openai', modelId: 'gpt-6-astra', reasoningEffort: 'low' },
      learnings: { provider: 'openai', modelId: 'gpt-6-astra', reasoningEffort: 'low' },
    },
    activeIteration: options.activeIteration ?? null, bestIteration: options.bestIteration === undefined ? 1 : options.bestIteration,
    validIterations: iterations.filter(iteration => iteration.valid).map(iteration => iteration.number), iterations,
    steeringRevision: 0, stopReason: null, checkpointDeadline: null, pinnedBundleHash: 'baseline', operationResults: {},
    checkpoint: null, checkpointDecisions: {}, operationIntents: {}, assistance: [], finalOutcome: null, stopRequested: false,
  };
}

function reportSession(options: { stage?: WorkshopStage; iterations?: WorkshopIterationState[]; bestIteration?: number | null } = {}): WorkshopSessionState {
  return sessionState(planAssignment(), { id: 'report-session', ...options });
}

describe('workshop retrospective engineering guidance', () => {
  it('sizes a 15/s iron brief from installed recipe, machine, burner and belt facts', () => {
    const plan = workshopDesignPlan(planAssignment(), installedProfile());
    expect(plan.sizing).toMatchObject({ minimumMachines: 48, recommendedMachines: 60, plannedOutputPerSecond: 18.75, outputPerMachineSecond: 0.3125 });
    expect(plan.fuel).toMatchObject({ product: 'coal', requiredPerSecond: 1.08, plannedPerSecond: 1.35 });
    expect(plan.inputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ product: 'iron-ore', requiredPerSecond: 15, plannedPerSecond: 18.75, declaredSupplyPerSecond: 45 }),
      expect.objectContaining({ product: 'coal', requiredPerSecond: 1.08, plannedPerSecond: 1.35, declaredSupplyPerSecond: 45 }),
    ]));
    expect(plan.belts).toEqual([
      { name: 'yellow-belt', totalPerSecond: 15, perLanePerSecond: 7.5 },
      { name: 'red-belt', totalPerSecond: 30, perLanePerSecond: 15 },
      { name: 'blue-belt', totalPerSecond: 45, perLanePerSecond: 22.5 },
    ]);
    expect(plan.outputBelts).toEqual(['red-belt', 'blue-belt']);
  });

  it('accounts for non-unit output yield and changes machine sizing when crafting speed changes', () => {
    const assignment = planAssignment();
    const yielded = installedProfile({ recipe: { ...installedProfile().recipe, energy: 4, ingredients: [{ type: 'item', name: 'iron-ore', amount: 3 }], products: [{ type: 'item', name: 'iron-plate', amount: 2 }] } });
    const yieldPlan = workshopDesignPlan(assignment, yielded);
    expect(yieldPlan.sizing).toMatchObject({ minimumMachines: 30, recommendedMachines: 38, outputPerMachineSecond: 0.5, plannedOutputPerSecond: 19 });
    expect(yieldPlan.inputs.find(input => input.product === 'iron-ore')).toMatchObject({ requiredPerSecond: 22.5, plannedPerSecond: 28.5 });

    const faster = workshopDesignPlan(assignment, installedProfile({ machineFacts: { craftingSpeed: 2, energyWatts: 90_000, burner: true, coalFuelJoules: 4_000_000 } }));
    expect(faster.sizing).toMatchObject({ minimumMachines: 24, recommendedMachines: 30, outputPerMachineSecond: 0.625 });
  });

  it('omits fuel for electric machines, warns on supply shortfalls and excludes disallowed belts', () => {
    const electric = installedProfile({ allowedEquipment: ['stone-furnace', 'yellow-belt'], machineFacts: { craftingSpeed: 1, energyWatts: 90_000, burner: false, coalFuelJoules: 4_000_000 } });
    const electricPlan = workshopDesignPlan(planAssignment(), electric);
    expect(electricPlan.fuel).toBeNull();
    expect(electricPlan.inputs.map(input => input.product)).toEqual(['iron-ore']);
    expect(electricPlan.belts.map(belt => belt.name)).toEqual(['yellow-belt']);
    expect(electricPlan.outputBelts).toEqual([]);
    expect(electricPlan.warnings).toContain('No known allowed single belt exceeds planned output. Reconcile capacity and lane routing; do not claim a static throughput proof.');

    const constrained = workshopDesignPlan(planAssignment({ oreSupply: 5, coalSupply: 0 }), installedProfile());
    expect(constrained.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('iron-ore: declared supply 5/s is below planned 18.75/s'),
      expect.stringContaining('coal: declared supply 0/s is below planned 1.35/s'),
    ]));
  });

  it('returns unknown sizing instead of inventing machine throughput when installed facts are absent', () => {
    const withoutFacts = installedProfile();
    delete withoutFacts.machineFacts;
    const plan = workshopDesignPlan(planAssignment(), withoutFacts);
    expect(plan.sizing).toBeNull();
    expect(plan.warnings[0]).toContain('Sizing unavailable');
  });

  it('passes installed sizing into the actual designer observation through LiveWorkshopHost', async () => {
    const assignment = planAssignment(), installed = installedProfile({ profileId: assignment.profileId });
    let captured: unknown;
    const inference = { async invoke(_session: unknown, _role: unknown, _selection: unknown, observation: unknown) {
      captured = observation;
      const ports = (observation as { assignment: WorkshopAssignment }).assignment.ports;
      return { text: JSON.stringify({ schema: 1, label: 'Installed plan candidate', description: 'One legal furnace',
        entities: [{ id: 'furnace', entityNumber: 1, name: 'stone-furnace', position: { x: 0, y: 0 }, direction: 0, quality: 'normal', recipe: 'iron-plate' }],
        wires: [], ports, icons: [{ index: 1, name: 'iron-plate' }], tiles: [] }), usage: { turns: 1, tools: 1, elapsedMs: 5, tokens: 10 } };
    }, async close() {} };
    const game = { async resolveProfile() { return installed; }, async build() { throw new Error('unused'); }, async measure() { throw new Error('unused'); } };
    const root = mkdtempSync(path.join(os.tmpdir(), 'af-retro-design-plan-'));
    try {
      const host = new LiveWorkshopHost(root, inference, game);
      const resolved = await host.resolve({ ...assignment, gameFingerprint: installedFingerprint(installed) });
      const candidate = await host.design(sessionState(resolved, { stage: 'designing', activeIteration: 1 }), 1);
      expect(candidate.artifactHash).toMatch(/^[a-f0-9]{64}$/);
      expect(captured).toMatchObject({ designPlan: { sizing: { minimumMachines: 48, recommendedMachines: 60, plannedOutputPerSecond: 18.75 } } });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('keeps practical cell guidance explicit and treats prioritized diagnostics as triage, not verdicts', () => {
    expect(cellDesignInstructions).toContain('perLanePerSecond');
    expect(cellDesignInstructions).toContain('only the host\'s physical measurements establish success');
    const diagnostics = Array.from({ length: 20 }, (_, index) => ({ name: `wait-${index}`, status: 'waiting_for_source_items' }))
      .concat([{ name: 'late-no-fuel', status: 'no_fuel' }, { name: 'late-no-power', status: 'no_power' }]);
    const summary = summarizeDesignerDiagnostics({ diagnostics }) as { totalRows: number; groups: { name: string; status: string }[]; omittedGroups: number; interpretation: string };
    expect(summary).toMatchObject({ totalRows: 22, omittedGroups: 2 });
    expect(summary.groups.slice(0, 2).map(group => ({ name: group.name, status: group.status }))).toEqual([{ name: 'late-no-fuel', status: 'no_fuel' }, { name: 'late-no-power', status: 'no_power' }]);
    expect(summary.interpretation).toContain('waiting can be normal');
  });
});

describe('workshop report evidence boundaries', () => {
  it.each(['deadline', 'request'])('retains the observed session and raw sample from a %s envelope', kind => {
    const session = reportSession({ stage: 'held', iterations: [reportIteration(1)] });
    const envelope = kind === 'deadline' ? { deadline: true, stopStatus: 202, session } : { request: { state: 'failed' }, session };
    const raw = measuredWindow();
    expect(workshopReport(workshopTrialSession(envelope), { 1: [raw] })).toMatchObject({ stage: 'held', targetPassed: false, iterations: [{ measurements: [raw] }] });
    expect(workshopTrialSession(session)).toBe(session);
  });

  it.each(['read', 'write', 'none'])('persists authoritative acceptance after %s reporting failure', async fault => {
    const session = reportSession({ bestIteration: 1, iterations: [reportIteration(1)] });
    const written: { name: string; value: unknown }[] = [];
    const result = await writeWorkshopTrialReports({ failure: null, cleanup: true, recovery: { passed: true }, cleanupReceipts: [{ completed: true }] }, session,
      async () => { if (fault === 'read') throw new SyntaxError('malformed measurement'); return workshopReport(session, { 1: [measuredWindow()] }); },
      async (name, value) => { if (fault === 'write' && name === 'summary.json') throw new Error('unwritable summary'); written.push({ name, value }); }, {});
    expect(result).toMatchObject({ targetPassed: true, passed: fault === 'none', harnessPassed: fault === 'none', cleanupReceipts: [{ completed: true }] });
    expect(written.at(-1)).toEqual({ name: 'result.json', value: result });
    if (fault !== 'none') expect(result.failure).toContain(fault === 'read' ? 'malformed measurement' : 'unwritable summary');
  });

  it('marks a missing session as preparing with no inferred pass', () => {
    expect(workshopReport(null)).toMatchObject({ schema: 1, stage: 'preparing', targetPassed: false, iterations: [], distinctCandidates: 0 });
  });

  it('counts repeated hashes once and does not call a stopped run passed despite its prior best', () => {
    const successfulIteration = reportIteration(1, { artifact: { sessionId: 'report-session', iteration: 1, artifactHash: 'same-hash', assignmentRevision: 1, bundleHash: 'baseline', evidence: [] }, evaluation: evaluation(true, 'pass') });
    const repeatedIteration = reportIteration(2, { artifact: { sessionId: 'report-session', iteration: 2, artifactHash: 'same-hash', assignmentRevision: 1, bundleHash: 'baseline', evidence: [] }, evaluation: evaluation(false, 'fail'), valid: false });
    const report = workshopReport(reportSession({ stage: 'stopped', iterations: [successfulIteration, repeatedIteration], bestIteration: 1 }));
    expect(report).toMatchObject({ stage: 'stopped', bestIteration: 1, targetPassed: false, distinctCandidates: 1 });
    expect(report.iterations).toHaveLength(2);
  });

  it('keeps a held run without an evaluation unpassed and preserves raw windows separately from bounds', () => {
    const raw = measuredWindow();
    const held = workshopReport(reportSession({ stage: 'held', bestIteration: null, iterations: [reportIteration(1, { stage: 'measuring', valid: null, feedback: 'measurement interrupted', evaluation: null })] }), { 1: [raw] });
    expect(held).toMatchObject({ stage: 'held', targetPassed: false, iterations: [{ passed: null, ports: [], measurements: [raw] }] });

    const evaluated = evaluation(true, 'completed');
    const completed = workshopReport(reportSession({ stage: 'complete', iterations: [reportIteration(1, { evaluation: evaluated, feedback: 'pass' })] }), { 1: [raw] });
    expect(completed.targetPassed).toBe(true);
    expect(completed.iterations[0]?.ports[0]?.windows[0]).toMatchObject({ productionLower: rate(900), deliveryLower: rate(900) });
    expect(completed.iterations[0]?.measurements?.[0]?.ports[0]).toMatchObject({ openingStock: rate(8), closingStock: rate(0), production: rate(900) });
  });
});

describe('measurement lifecycle fixture safety', () => {
  it('validates input, sink, power and entity geometry against shared fixture coordinates', () => {
    const fixture = measurementLifecycleFixture();
    expect(validateMeasurementLifecycleFixture(fixture)).toBeUndefined();
    expect(fixture.positions).toMatchObject({ output: { x: 1.5, y: 0.5 }, sink: { x: 2.5, y: 0.5 }, pole: { x: 1.5, y: 2.5 } });
    const command = measurementLifecycleCounterCommand(fixture);
    expect(command).toContain('Expected lifecycle output inserter');
    expect(command).toContain('Expected lifecycle output belt');
    expect(command).toContain('x=1.5,y=0.5');
    expect(command).toContain('x=2.5,y=0.5');
    expect(() => validateMeasurementLifecycleFixture({ ...fixture, positions: { ...fixture.positions, output: { x: 2, y: 0 } } })).toThrow('Lifecycle geometry disagrees for plate-output');
    expect(() => validateMeasurementLifecycleFixture({ ...fixture, assignment: { ...fixture.assignment, ports: fixture.assignment.ports.filter(port => port.id !== 'preloaded-ore') } })).toThrow();
  });

  it('bounds the timeline while retaining the first and most recent real observations', () => {
    let observations: LifecycleObservations = { timeline: [], samples: [] };
    for (let index = 0; index < 132; index++) observations = captureLifecycleObservation(observations, {
      manufactured: index, productsFinished: index, activeFurnaces: 1, furnaceCount: 2, delivered: index,
      scopeStock: 0, spare: { energy: 0, productsFinished: 0, hasRecipe: false },
    });
    expect(observations.timeline).toHaveLength(128);
    expect(observations.timeline[0]?.manufactured).toBe(0);
    expect(observations.timeline.at(-1)?.manufactured).toBe(131);
  });

  it('records only observed partial evidence when the lifecycle aborts before a baseline exists', () => {
    const fixture = measurementLifecycleFixture();
    const observed = { manufactured: 1, productsFinished: 1, activeFurnaces: 1, furnaceCount: 2, delivered: 0,
      scopeStock: 1, spare: { energy: 0, productsFinished: 0, hasRecipe: false } };
    const observations = captureLifecycleObservation({ timeline: [], samples: [] }, observed);
    const evidence = lifecycleFailureEvidence('waiting-for-first-delivery', new Error('sink not advancing'), observations);
    expect(evidence).toMatchObject({ passed: false, stage: 'waiting-for-first-delivery', modelInference: false, observations: { latest: observed, timeline: [observed], samples: [] } });
    expect(evidence.observations).not.toHaveProperty('baseline');
    expect(fixture.id).toBe('measure-furnace-idle');
  });
});

describe('persisted partial measurement evidence', () => {
  it('retains a raw sample when the game adapter fails before producing an evaluation', async () => {
    const fixture = measurementLifecycleFixture();
    const installed = installedProfile({ profileId: fixture.assignment.profileId, surface: fixture.surface, allowedEquipment: fixture.capability.allowedEquipment,
      recipe: { id: 'iron-plate', category: 'smelting', energy: 0.5, ingredients: [{ type: 'item', name: 'iron-ore', amount: 1 }], products: [{ type: 'item', name: 'iron-plate', amount: 1 }] }, machine: 'stone-furnace',
      equipmentFacts: [], machineFacts: { craftingSpeed: 1, energyWatts: 90_000, burner: true, coalFuelJoules: 4_000_000 } });
    const fingerprint = installedFingerprint(installed);
    const assignment = await (async () => {
      const root = mkdtempSync(path.join(os.tmpdir(), 'af-retro-measure-'));
      const directory = path.join(root, 'root');
      const sample = measuredWindow({ attemptId: `${fixture.id}:1`, ports: [{ ...measuredWindow().ports[0]!, portId: 'plates', product: { kind: 'item', name: 'iron-plate', quality: 'normal', surface: fixture.surface } }] });
      const game = {
        async resolveProfile() { return installed; }, async build() { return { id: 'unused', generation: 1, surface: fixture.surface, characterEvidence: null }; },
        async measure(_session: unknown, _built: unknown, onSample?: (value: WorkshopWindowMeasurement) => Promise<void>): Promise<never> { await onSample?.(sample); throw new Error('measurement poll interrupted'); },
      };
      const inference = { async invoke() { return '{}'; }, async close() {} };
      const host = new LiveWorkshopHost(directory, inference, game);
      try {
        const resolved = await host.resolve({ ...fixture.assignment, gameFingerprint: fingerprint });
        const document: BlueprintDocument = { ...fixture.document, ports: resolved.ports };
        const hash = blueprintContentHash(document);
        const sessionDirectory = path.join(directory, 'workshop-live', resolved.id);
        mkdirSync(sessionDirectory, { recursive: true });
        writeFileSync(path.join(sessionDirectory, `${hash}.built.json`), JSON.stringify({ id: fixture.id, generation: 1, surface: fixture.surface, characterEvidence: null }));
        const candidate = { sessionId: resolved.id, iteration: 1, artifactHash: hash, assignmentRevision: resolved.revision, bundleHash: 'baseline', evidence: [] };
        const session = sessionState(resolved, { stage: 'measuring', activeIteration: 1, bestIteration: null });
        await expect(host.measure(session, candidate)).rejects.toThrow('measurement poll interrupted');
        const lines = readFileSync(path.join(sessionDirectory, 'iteration-1.measurements.jsonl'), 'utf8').trim().split('\n');
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0]!)).toEqual(sample);
        const failedIteration: WorkshopIterationState = { id: `${resolved.id}:1`, sessionId: resolved.id, number: 1, stage: 'measuring', valid: null,
          artifact: candidate, evaluation: null, score: null, feedback: 'measurement interrupted', operationIds: [] };
        const report = workshopReport(sessionState(resolved, { stage: 'held', activeIteration: 1, bestIteration: null, iterations: [failedIteration] }), { 1: [JSON.parse(lines[0]!) as WorkshopWindowMeasurement] });
        expect(report).toMatchObject({ targetPassed: false, iterations: [{ valid: null, passed: null, ports: [], measurements: [sample] }] });
      } finally { rmSync(root, { recursive: true, force: true }); }
      return fixture.assignment;
    })();
    expect(assignment.id).toBe(fixture.assignment.id);
  });
});

describe('Factorio workshop inspection protocol', () => {
  it('normalizes empty Lua sequences while preserving fixture records and nonempty arrays', async () => {
    const control = new WorkshopControl({ async command() { return JSON.stringify({ ok: true, fixtures: { 'plate-sink': { delivered: 0 } }, diagnostics: [
      { name: 'empty-furnace', status: 'no_fuel', contents: {}, outputContents: [], fuel: {} },
      { name: 'loaded-furnace', status: 'working', contents: [{ name: 'iron-ore', count: 2 }], outputContents: [{ name: 'iron-plate', count: 1 }], fuel: [{ name: 'coal', count: 1 }] },
    ] }); }, close() {} } as never);
    const result = await control.inspect('inspection-test');
    expect(result.diagnostics).toEqual([
      { name: 'empty-furnace', status: 'no_fuel', contents: [], outputContents: [], fuel: [] },
      { name: 'loaded-furnace', status: 'working', contents: [{ name: 'iron-ore', count: 2 }], outputContents: [{ name: 'iron-plate', count: 1 }], fuel: [{ name: 'coal', count: 1 }] },
    ]);
    expect(result.fixtures).toEqual({ 'plate-sink': { delivered: 0 } });
    expect(Array.isArray(result.fixtures)).toBe(false);
  });

  it('leaves absent diagnostic fields absent', async () => {
    const control = new WorkshopControl({ async command() { return JSON.stringify({ ok: true, fixtures: {} }); }, close() {} } as never);
    const result = await control.inspect('no-diagnostics');
    expect(result).not.toHaveProperty('diagnostics');
    expect(result.fixtures).toEqual({});
  });

  it.each([
    { name: 'diagnostics', response: { ok: true, diagnostics: { unexpected: 1 } } },
    { name: 'contents', response: { ok: true, diagnostics: [{ name: 'furnace', status: 'working', contents: { unexpected: 1 } }] } },
    { name: 'outputContents', response: { ok: true, diagnostics: [{ name: 'furnace', status: 'working', outputContents: { unexpected: 1 } }] } },
    { name: 'fuel', response: { ok: true, diagnostics: [{ name: 'furnace', status: 'working', fuel: { unexpected: 1 } }] } },
  ])('rejects a nonempty object in the $name sequence field', async ({ response }) => {
    const control = new WorkshopControl({ async command() { return JSON.stringify(response); }, close() {} } as never);
    await expect(control.inspect('malformed-diagnostics')).rejects.toThrow('Incomplete workshop diagnostic sequence');
  });
});
