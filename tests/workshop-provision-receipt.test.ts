import { describe, expect, it } from 'vitest';
import { WorkshopControl } from '../packages/factorio/src/workshop.js';

const operationId = 'provision-receipt-1';
const kit = [{ name: 'assembling-machine-1', quality: 'normal' as const, count: 1 }];

function controlFor(receipt: Record<string, unknown>) {
  const port = {
    command: async () => JSON.stringify(receipt),
    close: () => {},
  };
  return new WorkshopControl(port);
}

describe('native workshop provision receipts', () => {
  it('accepts Lua empty inventory before provisioning and populated kit after', async () => {
    const control = controlFor({
      ok: true,
      operationId,
      tick: 42,
      before: {},
      after: [{ name: kit[0]!.name, quality: 'normal', count: 1 }],
    });

    await expect(control.provision('workshop', 'builder-1', operationId, kit)).resolves.toMatchObject({
      operationId,
      tick: 42,
      before: [],
      after: kit,
    });
  });

  it.each([
    ['empty after inventory', {}, []],
    ['both empty inventories', {}, {}],
  ])('accepts Lua empty-table encoding for %s', async (_label, before, after) => {
    const control = controlFor({ ok: true, operationId, tick: 43, before, after });

    await expect(control.provision('workshop', 'builder-1', operationId, [])).resolves.toMatchObject({
      before: [],
      after: [],
    });
  });

  it('preserves native array inventories', async () => {
    const before = [{ name: 'iron-plate', quality: 'normal', count: 4 }];
    const after = [...before, { name: 'assembling-machine-1', quality: 'normal', count: 1 }];
    const control = controlFor({ ok: true, operationId, tick: 44, before, after });

    await expect(control.provision('workshop', 'builder-1', operationId, kit)).resolves.toMatchObject({ before, after });
  });

  it.each([
    ['nonempty object before', { before: { 'iron-plate': 4 }, after: [] }],
    ['nonempty object after', { before: [], after: { 'assembling-machine-1': 1 } }],
    ['null before', { before: null, after: [] }],
    ['null after', { before: [], after: null }],
    ['missing before', { after: [] }],
    ['missing after', { before: [] }],
  ])('rejects malformed successful native receipt with %s', async (_label, inventories) => {
    const control = controlFor({ ok: true, operationId, tick: 45, ...inventories });

    await expect(control.provision('workshop', 'builder-1', operationId, kit)).rejects.toThrow('Incomplete provision receipt');
  });

  it.each([
    ['operation ID mismatch', { operationId: 'different-operation', tick: 46 }],
    ['invalid tick', { operationId, tick: Number.NaN }],
  ])('rejects successful native receipt with %s', async (_label, identity) => {
    const control = controlFor({ ok: true, ...identity, before: [], after: [] });

    await expect(control.provision('workshop', 'builder-1', operationId, kit)).rejects.toThrow('Incomplete provision receipt');
  });
});
