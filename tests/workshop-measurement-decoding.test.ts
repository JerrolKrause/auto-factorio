import { describe, expect, it } from 'vitest';
import { WorkshopControl } from '../packages/factorio/src/workshop.js';
import type { CommandPort } from '../packages/factorio/src/rcon.js';

const sample = (contamination: unknown = []) => ({
  schema: 1,
  attemptId: 'measure-7',
  index: 0,
  startTick: 120,
  endTick: 180,
  interval: '(startTick,endTick]',
  ports: [{
    portId: 'circuits',
    product: { kind: 'item', name: 'electronic-circuit', quality: 'normal', surface: 'nauvis' },
    production: { numerator: '60', denominator: '1' },
    delivery: { numerator: '58', denominator: '1' },
    openingStock: { numerator: '2', denominator: '1' },
    closingStock: { numerator: '1', denominator: '1' },
    residual: { numerator: '0', denominator: '1' },
    productionAllocationId: 'cell-0',
    coverage: 'complete',
    evidence: ['port-circuits-window-0'],
  }],
  stageCoverage: 'complete',
  energyCoverage: 'complete',
  contamination,
  mutationsFrozen: true,
  connected: true,
  evidence: ['window-0'],
});

const readWith = async (samples: unknown) => {
  const payload = { ok: true, tick: 180, state: 'scoring', finished: false, samples, requestedSpeed: 1, achievedSpeed: 0.95 };
  const port: CommandPort = { async command() { return JSON.stringify(payload); }, close() {} };
  return new WorkshopControl(port).measureRead('workshop-1', 'measure-7', -1);
};

describe('WorkshopControl measurement response decoding', () => {
  it("normalizes Factorio's empty Lua contamination table to an empty array", async () => {
    const result = await readWith([sample({})]);
    expect(result.samples[0]?.contamination).toEqual([]);
  });

  it('preserves empty and nonempty contamination arrays', async () => {
    const empty = await readWith([sample([])]);
    const marked = await readWith([sample(['manual-output', 'external-insertion'])]);
    expect(empty.samples[0]?.contamination).toEqual([]);
    expect(marked.samples[0]?.contamination).toEqual(['manual-output', 'external-insertion']);
  });

  it.each([
    ['a nonempty object', { forged: true }],
    ['a missing field', undefined],
    ['null', null],
    ['a nonstring array entry', ['manual-output', 3]],
  ])('rejects contamination supplied as %s', async (_description, contamination) => {
    const malformed = sample(contamination);
    if (contamination === undefined) delete (malformed as { contamination?: unknown }).contamination;
    await expect(readWith([malformed])).rejects.toThrow(/measurement sequence|measurement contamination/);
  });

  it('keeps the no-samples response compatible with an empty Lua table', async () => {
    const result = await readWith({});
    expect(result.samples).toEqual([]);
  });
});
