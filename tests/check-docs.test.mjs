import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const checker = path.resolve('scripts/check-docs.mjs');
const evidenceRoot = path.resolve('.runtime/handoff-cap/checker-fixtures');
mkdirSync(evidenceRoot, { recursive: true });

function fixture() {
  // Keep diagnostic fixtures inside ignored project evidence, including their Git inventory.
  const cwd = mkdtempSync(path.join(evidenceRoot, 'check-'));
  execFileSync('git', ['init', '--quiet'], { cwd });
  mkdirSync(path.join(cwd, 'docs'));
  return cwd;
}

function check(cwd, text) {
  if (text !== null) writeFileSync(path.join(cwd, 'docs/IMPLEMENTATION_HANDOFF.md'), text);
  return spawnSync(process.execPath, [checker], { cwd, encoding: 'utf8' });
}

// Exercise the actual check:docs CLI so a disconnected helper cannot make the cap look enforced.
describe('documentation snapshot cap', () => {
  it.each(['\n', '\r\n'])('accepts both exact limits with %j line endings and a final newline', newline => {
    const text = Array.from({ length: 80 }, () => Array(10).fill('word').join(' ')).join(newline) + newline;
    const result = check(fixture(), text);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PASS:');
  });

  it('rejects 801 words even on one line', () => {
    const result = check(fixture(), Array(801).fill('word').join(' '));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('801/800 words, 1/80 lines');
  });

  it('rejects 81 lines even below the word cap', () => {
    const result = check(fixture(), Array(81).fill('word').join('\n'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('81/800 words, 81/80 lines');
  });

  it('counts blank lines instead of allowing them to bypass the line cap', () => {
    const result = check(fixture(), 'word' + '\n'.repeat(81));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('1/800 words, 81/80 lines');
  });

  it('rejects deleting the required snapshot', () => {
    const result = check(fixture(), null);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('required current snapshot is missing');
  });

  it('still rejects broken documentation links below the cap', () => {
    const result = check(fixture(), '[missing](missing.md)');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing local link missing.md');
  });
});
