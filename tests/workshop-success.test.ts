import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LiveWorkshopGame, LiveWorkshopHost } from '../apps/runtime/workshop-live-host.js';
import type { WorkshopInference } from '../apps/runtime/workshop-live-host.js';
import type { InstalledWorkshopProfile, WorkshopFixture } from '../packages/factorio/src/workshop.js';
import type { BlueprintDocument } from '@autofactorio/contracts';
import { assignDesignerIdentities, expandDesignerEntities } from '../apps/runtime/workshop-design.js';

const installed: InstalledWorkshopProfile = {
  gameVersion: '2.0.77', mods: { base: '2.0.77' }, profileId: 'starter-assembly', profileRevision: 1,
  surface: 'nauvis', technologies: ['automation'], allowedEquipment: ['stone-furnace'], modules: [], beacons: [],
  recipe: { id: 'iron-plate', category: 'smelting', energy: 0.5,
    ingredients: [{ type: 'item', name: 'iron-ore', amount: 1 }],
    products: [{ type: 'item', name: 'iron-plate', amount: 1 }] },
  machine: 'stone-furnace', machineFacts: { craftingSpeed: 1, energyWatts: 90_000, burner: true, coalFuelJoules: 4_000_000 },
};

const briefRequest = (id: string, objective = 'create 15 iron plates per second') => ({
  schema: 1, id, revision: 1, comparisonSeries: `series-${id}`, objective,
  source: { kind: 'brief', id: null }, profileId: 'starter-assembly', construction: 'direct',
  libraryAccess: false, improveRevision: null, requestedSpeed: { numerator: '10', denominator: '1' },
  settlingTicks: 0, windowTicks: 60, windows: 1,
  rubric: { version: 'rubric-1', weights: { throughput: { numerator: '1', denominator: '1' } }, materiality: { throughput: { numerator: '0', denominator: '1' } }, directions: { throughput: 'maximize' } },
  iterations: { attempts: 1, mode: 'exact', earlyStop: false, plateauRounds: 1 },
  checkpoints: { brief: false, afterScore: false, libraryAdmission: false, learningActivation: false, timeoutMs: 1000, timeoutAction: 'finish' },
  budgets: { wallMs: 60_000, gameTicks: 600, turns: 3, toolCalls: 8, reportedTokens: 1000, learningReservedTurns: 0, learningReservedTools: 0 },
  models: { sessionDefault: { provider: 'openai', modelId: 'gpt-6-astra', reasoningEffort: 'low' }, overrides: {} },
  learning: { cadence: 'off', batchSessions: 1, candidateCap: 1, attemptsPerCandidate: 1, autoActivate: false },
});

const inference: WorkshopInference = { async invoke() { return '{}'; }, async close() {} };

describe('workshop success regressions', () => {
  it('resolves an iron-per-second brief with ingredient and burner-fuel headroom on east-facing half-tile ports', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'af-workshop-success-'));
    const host = new LiveWorkshopHost(directory, inference, { async resolveProfile() { return structuredClone(installed); }, async build() { throw new Error('unused'); }, async measure() { throw new Error('unused'); } });
    try {
      const assignment = await host.resolve(briefRequest('iron-brief'));
      expect(assignment.objective).toBe('create 15 iron plates per second');
      expect(assignment.source).toMatchObject({ kind: 'brief', numericTargetText: '15 per second' });
      expect(assignment.throughput[0]?.maxStockDrawdown).toEqual({ numerator: '15', denominator: '1' });
      const inputs = assignment.ports.filter(port => port.direction === 'input');
      expect(inputs.map(port => port.product.name)).toEqual(['iron-ore', 'coal']);
      expect(Number(inputs[0]!.rate.numerator) / Number(inputs[0]!.rate.denominator)).toBe(45);
      expect(Number(inputs[1]!.rate.numerator) / Number(inputs[1]!.rate.denominator)).toBe(45);
      expect(assignment.ports).toHaveLength(3);
      for (const port of assignment.ports) {
        expect(port.facing).toBe(4);
        expect(Math.abs(port.position.x % 1)).toBe(0.5);
        expect(Math.abs(port.position.y % 1)).toBe(0.5);
      }
      const electricProfile: InstalledWorkshopProfile = {
        ...structuredClone(installed), machine: 'assembling-machine-1', allowedEquipment: ['assembling-machine-1'],
        machineFacts: { craftingSpeed: 0.5, energyWatts: 75_000, burner: false, coalFuelJoules: 1_000_000 },
      };
      const electricHost = new LiveWorkshopHost(directory, inference, { async resolveProfile() { return electricProfile; }, async build() { throw new Error('unused'); }, async measure() { throw new Error('unused'); } });
      const electric = await electricHost.resolve(briefRequest('electric-machine'));
      expect(electric.ports.filter(port => port.direction === 'input').map(port => port.product.name)).toEqual(['iron-ore']);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it.each([
    { name: 'item ingredient demand', objective: 'create 60 iron plates per second', profile: installed, message: '45 items/s capacity' },
    { name: 'item output demand', objective: 'create 60 iron plates per second', profile: { ...installed, recipe: { ...installed.recipe, ingredients: [{ type: 'item' as const, name: 'iron-ore', amount: 0.5 }] } }, message: '45 items/s capacity' },
    { name: 'burner fuel demand', objective: 'create 15 iron plates per second', profile: { ...installed, machineFacts: { craftingSpeed: 1, energyWatts: 10_000_000, burner: true, coalFuelJoules: 1_000_000 } }, message: '45 items/s workshop fuel belt capacity' },
  ])('rejects $name above physical fixture capacity before inference', async ({ name, objective, profile, message }) => {
    const directory = mkdtempSync(path.join(os.tmpdir(), `af-workshop-${name.replaceAll(' ', '-')}-`));
    const host = new LiveWorkshopHost(directory, inference, { async resolveProfile() { return structuredClone(profile); }, async build() { throw new Error('unused'); }, async measure() { throw new Error('unused'); } });
    try { await expect(host.resolve(briefRequest(`over-capacity-${name}`, objective))).rejects.toThrow(message); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('changes the assignment game fingerprint when installed crafting speed changes', async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'af-workshop-fingerprint-'));
    let current = structuredClone(installed);
    const host = new LiveWorkshopHost(directory, inference, { async resolveProfile() { return structuredClone(current); }, async build() { throw new Error('unused'); }, async measure() { throw new Error('unused'); } });
    try {
      const original = await host.resolve(briefRequest('fingerprint-original'));
      current = { ...current, machineFacts: { ...current.machineFacts!, craftingSpeed: 2 } };
      const changed = await host.resolve(briefRequest('fingerprint-speed-changed'));
      expect(changed.gameFingerprint).not.toBe(original.gameFingerprint);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('passes each declared port transport and facing into real game setup fixtures', async () => {
    const fixtures: WorkshopFixture[] = [];
    const game = new LiveWorkshopGame({ async command() { throw new Error('unused'); }, close() {} } as never,
      { async request() { return { actors: {} }; } } as never, {} as never);
    Object.assign(game, { control: {
      async setup(input: { fixtures: WorkshopFixture[] }) { fixtures.push(...input.fixtures); return { generation: 1 }; },
      async materialize() { return {}; },
    } });
    const ports = [
      { id: 'input-ore', direction: 'input', product: { kind: 'item', name: 'iron-ore', quality: 'normal', surface: 'nauvis' }, position: { x: -12.5, y: -4.5 }, facing: 4, transport: 'belt', lane: 1, rate: { numerator: '18', denominator: '1' }, unit: 'units-per-game-second', required: true },
      { id: 'output-iron', direction: 'output', product: { kind: 'item', name: 'iron-plate', quality: 'normal', surface: 'nauvis' }, position: { x: 12.5, y: 0.5 }, facing: 4, transport: 'belt', lane: 1, rate: { numerator: '15', denominator: '1' }, unit: 'units-per-game-second', required: true },
    ] as BlueprintDocument['ports'];
    await game.build({ id: 'fixture-pass-through', activeIteration: 1, assignment: { construction: 'direct', ports, footprint: { maxTiles: 100 } } } as never,
      { schema: 1, label: 'fixture test', description: '', entities: [], wires: [], ports, icons: [{ index: 1, name: 'iron-plate' }], tiles: [] },
      { fingerprint: 'test', technologies: [], recipes: [], allowedEquipment: [] } as never);
    expect(fixtures).toContainEqual(expect.objectContaining({ id: 'input-ore', kind: 'source', transport: 'belt', facing: 4, position: { x: -12.5, y: -4.5 } }));
    expect(fixtures).toContainEqual(expect.objectContaining({ id: 'output-iron', kind: 'sink', transport: 'belt', facing: 4, position: { x: 12.5, y: 0.5 } }));
  });

  it('expands bounded declarative groups with exact stepped positions and never evaluates payload text', () => {
    const marker = '__autofactorio_repetition_payload_executed__';
    delete (globalThis as Record<string, unknown>)[marker];
    const expanded = expandDesignerEntities({ entities: [{ name: 'small-electric-pole', position: { x: 8, y: 2 } }], entityGroups: [{
      count: 3, step: { x: 2.5, y: -1 }, entities: [{ id: 'template', entityNumber: 99, name: 'transport-belt', position: { x: -1.5, y: 4.5 }, payload: `globalThis.${marker}=true` }],
    }] });
    expect(expanded).toHaveLength(4);
    expect(expanded.slice(1).map(value => (value as { position: { x: number; y: number } }).position)).toEqual([
      { x: -1.5, y: 4.5 }, { x: 1, y: 3.5 }, { x: 3.5, y: 2.5 },
    ]);
    expect(expanded.slice(1).every(value => !('id' in (value as object)) && !('entityNumber' in (value as object)))).toBe(true);
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
    delete (globalThis as Record<string, unknown>)[marker];
  });

  it('reserves native identities before assigning unused IDs and numbers to expanded group rows', () => {
    const expanded = expandDesignerEntities({
      entities: [
        { id: 'native-nine', entity_number: 9, name: 'small-electric-pole', position: { x: 0, y: 0 } },
        { id: 'entity-2', name: 'small-electric-pole', position: { x: 4, y: 0 } },
      ],
      entityGroups: [{ count: 2, step: { x: 4, y: 0 }, entities: [{ name: 'small-electric-pole', position: { x: 8, y: 0 } }] }],
    });
    const rows = assignDesignerIdentities(expanded);
    expect(rows.map(row => row.entityNumber)).toEqual([9, 1, 2, 3]);
    expect(rows.map(row => row.id)).toEqual(['native-nine', 'entity-2', 'entity-2-1', 'entity-3']);
  });

  it('rejects duplicate native entity numbers before wiring can resolve ambiguously', () => {
    expect(() => assignDesignerIdentities([
      { id: 'first', entityNumber: 4 },
      { id: 'second', entity_number: 4 },
    ])).toThrow('Invalid or duplicate designer entity number');
  });

  it('allocates the lowest unused native numbers around explicit reservations', () => {
    const rows = assignDesignerIdentities([
      { id: 'explicit-one', entity_number: 1 },
      { id: 'explicit-three', entityNumber: 3 },
      { name: 'generated-first' },
      { name: 'generated-second' },
    ]);
    expect(rows.map(row => row.entityNumber)).toEqual([1, 3, 2, 4]);
  });

  it.each([
    { name: 'zero count', group: { count: 0, step: { x: 1, y: 0 }, entities: [{ name: 'transport-belt', position: { x: 0, y: 0 } }] } },
    { name: 'fractional count', group: { count: 1.5, step: { x: 1, y: 0 }, entities: [{ name: 'transport-belt', position: { x: 0, y: 0 } }] } },
    { name: 'invalid step', group: { count: 2, step: { x: Number.NaN, y: 0 }, entities: [{ name: 'transport-belt', position: { x: 0, y: 0 } }] } },
    { name: 'invalid position', group: { count: 2, step: { x: 1, y: 0 }, entities: [{ name: 'transport-belt', position: { x: Number.NaN, y: 0 } }] } },
    { name: 'oversize expansion', group: { count: 2000, step: { x: 1, y: 0 }, entities: Array.from({ length: 6 }, () => ({ name: 'transport-belt', position: { x: 0, y: 0 } })) } },
  ])('rejects $name', ({ group }) => {
    expect(() => expandDesignerEntities({ entities: [], entityGroups: [group] })).toThrow();
  });
});
