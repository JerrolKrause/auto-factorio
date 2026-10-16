import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { publishWorkshopChain } from '../apps/runtime/workshop-chain-store.js';
import type { ResolvedWorkshopChain } from '../apps/runtime/workshop-chain-resolution.js';

const resolved = (id: string, objective = 'synthetic plan'): ResolvedWorkshopChain => ({
  schema: 1,
  assignment: { id, objective, ports: [] },
  profile: { id: 'test-profile', revision: 1, fingerprint: 'a'.repeat(64) },
  chain: { plan: { id: `plan-${id}` }, stages: [{ id: 'stage-1', recipe: 'synthetic-recipe' }] },
} as unknown as ResolvedWorkshopChain);

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'af-chain-store-'));
  return { directory, file: path.join(directory, 'chain-resolved.json'), close: () => rm(directory, { recursive: true, force: true }) };
}

describe('atomic workshop chain publication', () => {
  it('keeps partial temp bytes private while an identical writer publishes, then lets both complete', async () => {
    const f = await fixture();
    let markPartial!: () => void, releaseFirst!: () => void;
    const partial = new Promise<void>(resolve => { markPartial = resolve; });
    const release = new Promise<void>(resolve => { releaseFirst = resolve; });
    let first: Promise<void> | undefined;
    try {
      const value = resolved('same'), expected = JSON.stringify(value, null, 2);
      first = publishWorkshopChain(f.file, value, { write: async (handle, bytes) => {
        await handle.writeFile(bytes.slice(0, 24), 'utf8');
        markPartial();
        await release;
        await handle.writeFile(bytes.slice(24), 'utf8');
      } });
      await partial;
      await expect(readFile(f.file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await publishWorkshopChain(f.file, value);
      releaseFirst();
      await first;
      expect(await readFile(f.file, 'utf8')).toBe(expected);
      expect(await readdir(f.directory)).toEqual(['chain-resolved.json']);
    } finally { releaseFirst(); await first?.catch(() => {}); await f.close(); }
  });

  it('removes a partially written temp after write failure and permits a fresh publication', async () => {
    const f = await fixture();
    try {
      const value = resolved('write-failure');
      await expect(publishWorkshopChain(f.file, value, { write: async (handle, bytes) => {
        await handle.writeFile(bytes.slice(0, 18), 'utf8');
        throw new Error('injected write failure');
      } })).rejects.toThrow('injected write failure');
      expect(await readdir(f.directory)).toEqual([]);
      await expect(stat(f.file)).rejects.toMatchObject({ code: 'ENOENT' });
      await publishWorkshopChain(f.file, value);
      expect(JSON.parse(await readFile(f.file, 'utf8'))).toMatchObject({ assignment: { id: 'write-failure' } });
      expect(await readdir(f.directory)).toEqual(['chain-resolved.json']);
    } finally { await f.close(); }
  });

  it('removes the closed temp when the pre-publish hook fails', async () => {
    const f = await fixture();
    try {
      await expect(publishWorkshopChain(f.file, resolved('before-publish'), { beforePublish: async () => { throw new Error('injected publication barrier failure'); } })).rejects.toThrow('injected publication barrier failure');
      expect(await readdir(f.directory)).toEqual([]);
      await expect(stat(f.file)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await f.close(); }
  });

  it('allows exactly one concurrent changed record and preserves the winning complete bytes', async () => {
    const f = await fixture();
    try {
      const left = resolved('conflict', 'left'), right = resolved('conflict', 'right');
      const results = await Promise.allSettled([publishWorkshopChain(f.file, left), publishWorkshopChain(f.file, right)]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
      const winner = JSON.parse(await readFile(f.file, 'utf8')) as ResolvedWorkshopChain;
      expect(['left', 'right']).toContain((winner.assignment as { objective: string }).objective);
      const permanentBytes = await readFile(f.file, 'utf8');
      const loser = (winner.assignment as { objective: string }).objective === 'left' ? right : left;
      await expect(publishWorkshopChain(f.file, loser)).rejects.toThrow('different assignment or installed plan');
      expect(await readFile(f.file, 'utf8')).toBe(permanentBytes);
      expect(await readdir(f.directory)).toEqual(['chain-resolved.json']);
    } finally { await f.close(); }
  });

  it('accepts an exact repeat without rewriting the immutable file', async () => {
    const f = await fixture();
    try {
      const value = resolved('repeat');
      await publishWorkshopChain(f.file, value);
      const before = await stat(f.file, { bigint: true }), bytes = await readFile(f.file, 'utf8');
      await publishWorkshopChain(f.file, value);
      const after = await stat(f.file, { bigint: true });
      expect(await readFile(f.file, 'utf8')).toBe(bytes);
      expect(after.mtimeNs).toBe(before.mtimeNs);
      expect(await readdir(f.directory)).toEqual(['chain-resolved.json']);
    } finally { await f.close(); }
  });
});
