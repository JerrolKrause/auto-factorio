import { describe, expect, it } from 'vitest';
import { cleanupAll } from '../scripts/dev/cleanup.js';

describe('issue 2 best-effort cleanup', () => {
  it('continues through browser and server failures to run the game cleanup and returns every receipt', async () => {
    const calls: string[] = [];
    const receipts = await cleanupAll([
      { id: 'browser', run: () => { calls.push('browser'); throw new Error('browser close failed'); } },
      { id: 'server', run: async () => { calls.push('server'); await Promise.reject(new Error('server close failed')); } },
      { id: 'game', run: async () => { calls.push('game'); } }
    ]);

    expect(calls).toEqual(['browser', 'server', 'game']);
    expect(receipts).toEqual([
      { id: 'browser', completed: false, failure: 'Error: browser close failed' },
      { id: 'server', completed: false, failure: 'Error: server close failed' },
      { id: 'game', completed: true, failure: null }
    ]);
    const aggregateComplete = receipts.every(receipt => receipt.completed);
    expect(aggregateComplete).toBe(false);
  });

  it('attempts cleanup for every profile after an earlier profile fails', async () => {
    const calls: string[] = [];
    const receipts = await cleanupAll([
      { id: 'profile-a', run: async () => { calls.push('profile-a'); throw new Error('stop failed'); } },
      { id: 'profile-b', run: async () => { calls.push('profile-b'); } }
    ]);

    expect(calls).toEqual(['profile-a', 'profile-b']);
    expect(receipts).toEqual([
      { id: 'profile-a', completed: false, failure: 'Error: stop failed' },
      { id: 'profile-b', completed: true, failure: null }
    ]);
    expect(receipts.every(receipt => receipt.completed)).toBe(false);
  });
});
