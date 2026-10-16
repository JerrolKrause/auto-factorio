import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import type { InstalledChainContext } from '../packages/core/workshop/installed-chain.js';
import { CHAIN_REFERENCE_CASES, referenceBlueprint, referenceCase, referenceRequest, type ChainReferenceCase } from '../scripts/dev/production-chain-reference.js';

// These compact installed-fact views let the reference cases prove their boundary
// semantics without making claims about a particular locally installed game build.
const recipes: Record<ChainReferenceCase, string[]> = {
  'sulfur-direct': ['basic-oil-processing', 'sulfur'],
  'sulfur-character': ['basic-oil-processing', 'sulfur'],
  'refining-cracking': ['advanced-oil-processing', 'light-oil-cracking'],
};
const contextFor = (selected: ChainReferenceCase) => ({
  profile: { id: `reference-${selected}`, revision: 4, fingerprint: 'a'.repeat(64), recipes: recipes[selected], allowedEquipment: ['oil-refinery', 'chemical-plant'] },
  snapshot: { catalog: { fingerprint: 'b'.repeat(64) }, availabilityRevision: 'c'.repeat(64) },
} as unknown as InstalledChainContext);
const portsFor = (selected: ChainReferenceCase) => selected === 'refining-cracking'
  ? [{ id: 'input-crude', direction: 'input', product: { kind: 'fluid', name: 'crude-oil', quality: 'normal', surface: 'nauvis' } }, { id: 'input-water', direction: 'input', product: { kind: 'fluid', name: 'water', quality: 'normal', surface: 'nauvis' } }, { id: 'output-gas', direction: 'output', product: { kind: 'fluid', name: 'petroleum-gas', quality: 'normal', surface: 'nauvis' } }, { id: 'byproduct-heavy', direction: 'byproduct', product: { kind: 'fluid', name: 'heavy-oil', quality: 'normal', surface: 'nauvis' } }]
  : [{ id: 'input-crude', direction: 'input', product: { kind: 'fluid', name: 'crude-oil', quality: 'normal', surface: 'nauvis' } }, { id: 'input-water', direction: 'input', product: { kind: 'fluid', name: 'water', quality: 'normal', surface: 'nauvis' } }, { id: 'output-sulfur', direction: 'output', product: { kind: 'item', name: 'sulfur', quality: 'normal', surface: 'nauvis' } }, { id: 'byproduct-heavy', direction: 'byproduct', product: { kind: 'fluid', name: 'heavy-oil', quality: 'normal', surface: 'nauvis' } }, { id: 'byproduct-light', direction: 'byproduct', product: { kind: 'fluid', name: 'light-oil', quality: 'normal', surface: 'nauvis' } }];

describe('production chain reference cases', () => {
  it('accepts only the closed case menu and rejects arbitrary launcher options', () => {
    expect(CHAIN_REFERENCE_CASES).toEqual(['sulfur-direct', 'sulfur-character', 'refining-cracking']);
    for (const selected of CHAIN_REFERENCE_CASES) expect(referenceCase(['--case', selected])).toBe(selected);
    for (const args of [[], ['--case', 'unknown'], ['--case', 'sulfur-direct', '--save', 'mine.zip'], ['--profile', 'personal'], ['--host', 'localhost'], ['--port', '1234'], ['--case', 'sulfur-direct', 'extra']]) {
      expect(() => referenceCase(args)).toThrow();
    }
  });

  it.each([
    ['save', ['--case', 'sulfur-direct', '--save', 'personal.zip']],
    ['host', ['--case', 'sulfur-direct', '--host', 'localhost']],
    ['profile', ['--profile', 'personal']],
    ['extra positional argument', ['--case', 'sulfur-direct', 'unexpected']],
  ])('rejects launcher %s before build or game startup', (_label, args) => {
    const result = spawnSync(process.execPath, ['scripts/production-chain-probe.mjs', ...args], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage: pnpm game:production-chain-probe');
    expect(result.stderr).toContain('dedicated new game only');
  });

  it.each(CHAIN_REFERENCE_CASES)('%s requests only process boundary feedstocks and the selected process', selected => {
    const request = referenceRequest(contextFor(selected), selected);
    expect(request.externalInputs.map(input => input.product.name).sort()).toEqual(['crude-oil', 'water']);
    expect(request.initialStock).toEqual([]);
    expect(request.profile.recipes).toEqual(recipes[selected]);
    expect(Object.values(request.routes)).toEqual(selected === 'refining-cracking'
      ? ['recipe:light-oil-cracking', 'recipe:advanced-oil-processing']
      : ['recipe:basic-oil-processing']);
    expect(request.externalInputs.some(input => ['petroleum-gas', 'light-oil', 'heavy-oil', 'sulfur'].includes(input.product.name))).toBe(false);
  });

  it.each(CHAIN_REFERENCE_CASES)('%s has a finite, physical schematic for the selected stages and boundary ports', selected => {
    const document = referenceBlueprint({ ports: portsFor(selected) } as never, selected, 1);
    const entities = document.entities;
    expect(entities.map(entity => entity.id).length).toBe(new Set(entities.map(entity => entity.id)).size);
    expect(entities.map(entity => entity.entityNumber).length).toBe(new Set(entities.map(entity => entity.entityNumber)).size);
    expect(entities.map(entity => `${entity.position.x},${entity.position.y}`).length).toBe(new Set(entities.map(entity => `${entity.position.x},${entity.position.y}`)).size);
    expect(entities.every(entity => Number.isFinite(entity.position.x) && Number.isFinite(entity.position.y))).toBe(true);
    const stages = entities.filter(entity => entity.recipe).map(entity => entity.recipe).sort();
    expect(stages).toEqual(selected === 'refining-cracking'
      ? ['advanced-oil-processing', 'light-oil-cracking']
      : ['basic-oil-processing', 'basic-oil-processing', 'sulfur']);
    expect(document.ports).toEqual(portsFor(selected));
    expect(entities.some(entity => ['infinity-chest', 'infinity-pipe', 'creative-chest', 'creative-provider-chest'].includes(entity.name))).toBe(false);
    expect(entities.filter(entity => entity.name === 'pipe').length).toBeGreaterThan(0);
    expect(entities.filter(entity => entity.name === 'pipe-to-ground').length).toBeGreaterThan(0);
    expect(entities.filter(entity => entity.name === 'medium-electric-pole').length).toBeGreaterThan(1);
    expect(document.wires.length).toBeGreaterThan(0);
    expect(document.wires.every(wire => wire.color === 'copper' && wire.from.connector === '1' && wire.to.connector === '1')).toBe(true);
    if (selected !== 'refining-cracking') {
      expect(entities.some(entity => entity.name === 'fast-inserter')).toBe(true);
      expect(entities.some(entity => entity.name === 'transport-belt')).toBe(true);
    }
  });
});
