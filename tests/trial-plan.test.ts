import { expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { referencePreflight, referenceSources, TRIAL_PLAN } from '../apps/runtime/trial-plan.js';
import { sha256 } from '../packages/factorio/src/lifecycle.js';

it('fails closed on missing, stale, incomplete and failed reference evidence before model admission', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'af-trial-preflight-'));
  const save = (name: string, data: unknown) => writeFile(path.join(directory, name + '.json'), JSON.stringify(data));
  try {
    await expect(referencePreflight(directory)).rejects.toThrow();
    const result = { passed: true, failure: null, modelInference: false, checks: Array.from({ length: 9 }, (_, i) => String(i)) };
    await save('result', result); await save('manifest', { fixtureHash: 'fixture' });
    const sources = Object.fromEntries(await Promise.all((await referenceSources()).map(async f => [f, sha256(await readFile(f))])));
    await save('sources', sources);
    for (const [name, state] of Object.entries({ positive: 'passed', 'preloaded-input': 'failed', 'preloaded-output': 'failed', 'unrelated-upstream': 'failed', 'native-character-supply': 'invalid' })) await save(name, { state, manifest: { scope: 'fixture' } });
    expect((await referencePreflight(directory, 'fixture')).fixtureHash).toBe('fixture');
    await expect(referencePreflight(directory, 'different')).rejects.toThrow('fixture mismatch');
    await save('sources', {}); await expect(referencePreflight(directory)).rejects.toThrow('Incomplete');
    await save('sources', { ...sources, 'packages/core/evaluation/engine.ts': '0'.repeat(64) });
    await expect(referencePreflight(directory)).rejects.toThrow('source changed');
    await save('sources', sources); await save('preloaded-input', { state: 'passed', manifest: { scope: 'fixture' } });
    await expect(referencePreflight(directory)).rejects.toThrow('control');
    await save('result', { ...result, passed: false }); await expect(referencePreflight(directory)).rejects.toThrow('reference');
    expect(TRIAL_PLAN.runs).toHaveLength(2); expect(TRIAL_PLAN.retries).toBe(0); expect(TRIAL_PLAN.caps.turns).toBe(30);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
