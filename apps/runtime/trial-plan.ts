import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../../packages/factorio/src/lifecycle.js';
import type { Caps } from '../../packages/codex/src/budget.js';
import { fingerprint } from '../../packages/factorio/src/first-shift.js';

export const TRIAL_CAPS: Caps = { turns: 30, concurrency: 2, turnMs: 90_000, runMs: 45 * 60_000, tools: 20, tokens: 600_000 };
export const TRIAL_PLAN = { version: 's1-trials-v2', runs: ['unassisted-team-replacement', 'assisted-team'], caps: TRIAL_CAPS,
  replacementBoundary: 'First queued construction remains unsent until the fresh engineer session reconstructs it with an authorized world observation.',
  gameLimitTicks: 30 * 60 * 60, retries: 0, tokenEnforcement: 'Approximate, reported cumulative session usage only; absent telemetry remains unknown.' };
export async function referenceSources() {
  return ['scripts/game-first-shift-probe.ts', 'scripts/dev/first-shift-reference.ts', 'packages/factorio/src/first-shift.ts', 'packages/core/evaluation/engine.ts', ...(await readdir('mods/autofactorio')).map(f => 'mods/autofactorio/' + f)].sort();
}

/** Operator-only evidence. Nothing returned here enters the gameplay briefing. */
export async function referencePreflight(directory: string, fixtureHash?: string) {
  const result = JSON.parse(await readFile(path.join(directory, 'result.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  const sources = JSON.parse(await readFile(path.join(directory, 'sources.json'), 'utf8')) as Record<string, string>;
  if (result.passed !== true || result.failure !== null || result.modelInference !== false || result.checks?.length !== 9) throw new Error('Passing S1 reference and bypass evidence required');
  if (JSON.stringify(Object.keys(sources).sort()) !== JSON.stringify(await referenceSources())) throw new Error('Incomplete reference source fingerprints');
  for (const [file, hash] of Object.entries(sources)) {
    const resolved = path.resolve(file);
    if (!resolved.startsWith(path.resolve('.') + path.sep) || sha256(await readFile(resolved)) !== hash) throw new Error('Reference source changed: ' + file);
  }
  if (fixtureHash && manifest.fixtureHash !== fixtureHash) throw new Error('Reference fixture mismatch');
  const expected: Record<string, string> = { positive: 'passed', 'preloaded-input': 'failed', 'preloaded-output': 'failed', 'unrelated-upstream': 'failed', 'native-character-supply': 'invalid' };
  const checksums: Record<string, string> = {};
  for (const [file, state] of Object.entries(expected)) {
    const bytes = await readFile(path.join(directory, file + '.json')); const report = JSON.parse(bytes.toString());
    if (report.state !== state || report.manifest?.scope !== manifest.fixtureHash) throw new Error('Invalid reference control: ' + file);
    checksums[file] = sha256(bytes);
  }
  return { directory: path.resolve(directory), fixtureHash: manifest.fixtureHash as string, resultHash: fingerprint(result), sources, checksums };
}
