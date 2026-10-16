import { open, link, readFile, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { digest } from '../../packages/core/production/graph.js';
import type { ResolvedWorkshopChain } from './workshop-chain-resolution.js';

/** Deterministic fault/barrier hooks for storage tests, never supplied by a run request. */
export interface ChainPublicationHooks {
  write?: (handle: FileHandle, bytes: string) => Promise<void>;
  beforePublish?: () => Promise<void>;
}

/** Publish complete bytes without ever replacing another session's immutable pin. */
export async function publishWorkshopChain(file: string, resolved: ResolvedWorkshopChain, hooks: ChainPublicationHooks = {}): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx');
  let closed = false;
  try {
    const bytes = JSON.stringify(resolved, null, 2);
    if (hooks.write) await hooks.write(handle, bytes);
    else await handle.writeFile(bytes, 'utf8');
    await handle.sync();
    await handle.close(); closed = true;
    await hooks.beforePublish?.();
    // A same-directory hard link atomically exposes the complete closed file and
    // fails on an existing destination. Rename would silently replace its pin.
    try { await link(temporary, file); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const prior = JSON.parse(await readFile(file, 'utf8')) as ResolvedWorkshopChain;
      if (digest(prior) !== digest(resolved)) throw new Error('Chain session already pins a different assignment or installed plan');
    }
  } finally {
    try { if (!closed) await handle.close(); }
    finally { await unlink(temporary); }
  }
}
