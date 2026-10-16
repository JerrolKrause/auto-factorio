import { describe, expect, it } from 'vitest';
import type { Batch, Receipt } from '@autofactorio/contracts';
import { wrapper, type CommandPort } from '../packages/factorio/src/rcon.js';
import { placementAcknowledgementLoss, recoveryCheckpointWorld, requirePrefixInventory, submittedBatch } from '../scripts/dev/production-chain-recovery.js';
import { verifyLoaded } from '../packages/factorio/src/lifecycle.js';
import type { Checkpoint, ControlState } from '../packages/factorio/src/lifecycle.js';

function batch(overrides: Partial<Batch> = {}): Batch {
  return {
    commandId: 'placement-1', epoch: 'epoch-1', session: 'session-1', task: 'workshop-build', revision: 1,
    actor: 'builder-1', surface: 'nauvis', grants: [{ id: 'area', generation: 1 }, { id: 'items', generation: 1 }, { id: 'actor', generation: 1 }], deadline: 1000,
    steps: [
      { kind: 'place', position: { x: 1, y: 0 }, item: 'pipe', quality: 'normal', direction: 0 },
      { kind: 'walk', position: { x: 2, y: 0 } },
      { kind: 'place', position: { x: 3, y: 0 }, item: 'medium-electric-pole', quality: 'normal', direction: 0 },
    ],
    ...overrides,
  };
}

function suspendedPrefix(value: Batch, changes: Partial<Receipt> = {}): Receipt {
  const completed = changes.completed ?? 2;
  const includeInterrupted = changes.steps?.length === completed + 1;
  const rows: Receipt['steps'] = value.steps.slice(0, completed).map((_, index) => ({
    index: index + 1, status: 'completed', startedTick: 10 + index, endedTick: 11 + index,
    before: [], after: [], delta: [],
  }));
  if (includeInterrupted) rows.push(changes.steps![completed]!);
  return { commandId: value.commandId, status: 'suspended', acceptedTick: 10, endedTick: 11, completed,
    unexecuted: value.steps.length - rows.length, steps: rows, ...changes };
}

const interruptedWalk = (index = 3, before: { name: string; quality: string; count: number }[] = []) => ({
  index, status: 'cancelled', startedTick: 12, endedTick: 13, before, after: structuredClone(before), delta: [],
});

function nativeSubmit(value: unknown): string {
  return wrapper(value);
}

function checkpointFixture() {
  const captured: ControlState = {
    ok: true, epoch: 'epoch-1', session: 'session-1', revision: 1, generation: 1,
    armed: false, ready: false, paused: true, neutral: true, ticksToRun: 0,
    tick: 100, ticksPlayed: 0, experimentTick: 100, scenarioElapsed: 100, injections: 0,
    checkpoint: 'checkpoint-1', ledger: {}, intents: {}, production: {}, mods: {},
  };
  const world = {
    tick: 100,
    entities: [{ type: 'assembling-machine', unit_number: 41, name: 'assembling-machine-1', position: { x: 4, y: 5 } }],
    actors: {
      'builder-1': { surface: 'nauvis', position: { x: 2, y: 3 }, inventory: { pipe: 2 }, crafting: [], walking: false, mining: false },
    },
  };
  const manifest: Checkpoint = {
    schema: 1, source: 'managed-disarmed', name: 'checkpoint-1', save: 'checkpoint-1.zip',
    sha256: 'fixture', size: 1, eventCursor: 1, captured, world, modHash: 'fixture-mod',
  };
  return { captured, world, manifest };
}

describe('production-chain recovery checkpoint actor transition', () => {
  it('allows only the pre-join observation to omit the builder while retaining strict candidate effects', () => {
    const { captured, world, manifest } = checkpointFixture();
    const preJoin = { ...world, actors: {} };

    expect(recoveryCheckpointWorld(preJoin, world.entities, 'nauvis', true)).toEqual({ tick: 100, entities: world.entities, actors: {} });
    expect(() => recoveryCheckpointWorld(preJoin, world.entities, 'nauvis')).toThrow();
    expect(() => verifyLoaded(manifest, captured, preJoin, true)).not.toThrow();
    expect(() => verifyLoaded(manifest, captured, preJoin)).toThrow('Restored world differs from checkpoint');
  });

  it('rejects a present builder on the wrong surface even during the disconnected transition', () => {
    const { world } = checkpointFixture();
    const wrongSurface = { ...world, actors: { 'builder-1': { ...world.actors['builder-1'], surface: 'vulcanus' } } };

    expect(() => recoveryCheckpointWorld(wrongSurface, world.entities, 'nauvis', true)).toThrow();
    expect(() => recoveryCheckpointWorld(wrongSurface, world.entities, 'nauvis')).toThrow();
  });

  it.each([
    ['unit number', { ...checkpointFixture().world.entities[0]!, unit_number: 42 }],
    ['position', { ...checkpointFixture().world.entities[0]!, position: { x: 4, y: 6 } }],
  ])('rejects a changed candidate entity %s while the builder is disconnected', (_label, entity) => {
    const { captured, world, manifest } = checkpointFixture();
    const disconnected = { ...world, actors: {} };
    expect(() => verifyLoaded(manifest, captured, { ...disconnected, entities: [entity] }, true)).toThrow('Restored world differs from checkpoint');
  });

  it.each([
    ['inventory', { inventory: { pipe: 1 } }],
    ['position', { position: { x: 9, y: 3 } }],
  ])('still rejects a changed present builder %s while allowDisconnected is enabled', (_label, change) => {
    const { captured, world, manifest } = checkpointFixture();
    const changedActor = { ...world.actors['builder-1'], ...change };
    const changedWorld = { ...world, actors: { 'builder-1': changedActor } };
    expect(() => recoveryCheckpointWorld(changedWorld, world.entities, 'nauvis', true)).not.toThrow();
    expect(() => verifyLoaded(manifest, captured, changedWorld, true)).toThrow('Restored world differs from checkpoint');
  });

  it('keeps capture and joined observations strict and verifies all restored actor effects', () => {
    const { captured, world, manifest } = checkpointFixture();
    const capture = recoveryCheckpointWorld(world, world.entities, 'nauvis');
    const joined = recoveryCheckpointWorld(world, world.entities, 'nauvis');

    expect(capture).toEqual({ tick: 100, entities: world.entities, actors: world.actors });
    expect(joined).toEqual(capture);
    expect(() => verifyLoaded(manifest, captured, joined)).not.toThrow();
  });
});

describe('production-chain recovery fault controls', () => {
  it('recognizes only a genuine public submit wrapper containing placement', () => {
    const placing = batch();
    expect(submittedBatch(nativeSubmit({ op: 'submit', batch: placing }))).toEqual(placing);
    expect(submittedBatch(wrapper({ op: 'submit', batch: placing }, true))).toBeNull();
    expect(submittedBatch(nativeSubmit({ op: 'receipt', commandId: placing.commandId }))).toBeNull();
    expect(submittedBatch(nativeSubmit({ op: 'submit', batch: batch({ steps: [{ kind: 'walk', position: { x: 0, y: 0 } }] }) }))).toBeNull();
    expect(submittedBatch('/silent-command game.print("submit placement-1")')).toBeNull();
    expect(submittedBatch('/silent-command rcon.print(remote.call("autofactorio_v1","rpc","\\300"))')).toBeNull();
    expect(submittedBatch('/silent-command rcon.print(remote.call("autofactorio_v1","rpc","\\123oops"))')).toBeNull();
  });

  it('forwards one genuine placement submit, waits for a held native prefix, then loses its acknowledgement and refuses retry', async () => {
    const value = batch();
    const command = nativeSubmit({ op: 'submit', batch: value });
    const calls: string[] = [];
    const underlying: CommandPort = { command: async lua => { calls.push(lua); return JSON.stringify({ ok: true, receipt: { commandId: value.commandId } }); }, close() {} };
    let callbackCount = 0;
    const fault = placementAcknowledgementLoss(underlying, async received => {
      callbackCount++;
      expect(received).toEqual(value);
      return suspendedPrefix(received);
    });

    await expect(fault.port.command(command)).rejects.toThrow('Diagnostic placement acknowledgement lost after native effects');
    expect(fault.state).toMatchObject({ forwards: 1, losses: 1, commandId: value.commandId, heldReceipt: suspendedPrefix(value) });
    expect(callbackCount).toBe(1);
    await expect(fault.port.command(command)).rejects.toThrow('Uncertain placement retry refused');
    expect(calls).toEqual([command]);
    expect(fault.state.forwards).toBe(1);
  });

  it('passes unrelated requests through and leaves a native rejected submit acknowledged', async () => {
    const placement = batch();
    const unrelated = ['/silent-command rcon.print("ordinary-console")', nativeSubmit({ op: 'receipt', commandId: placement.commandId })];
    const responses = ['console-ok', JSON.stringify({ ok: true, receipt: { commandId: placement.commandId } })];
    const calls: string[] = [];
    const underlying: CommandPort = { command: async lua => { calls.push(lua); return responses[calls.length - 1]!; }, close() {} };
    const fault = placementAcknowledgementLoss(underlying, async () => { throw new Error('must not hold unrelated request'); });
    for (const [index, lua] of unrelated.entries()) await expect(fault.port.command(lua)).resolves.toBe(responses[index]);

    const badSubmit = nativeSubmit({ op: 'submit', batch: placement });
    let nativeCalls = 0;
    const rejectedPort: CommandPort = { command: async () => { nativeCalls++; return JSON.stringify({ ok: false, error: 'stale_epoch_or_session' }); }, close() {} };
    const rejectedFault = placementAcknowledgementLoss(rejectedPort, async () => { throw new Error('rejected native submit has no placement effects'); });
    await expect(rejectedFault.port.command(badSubmit)).rejects.toThrow('Lose only an acknowledged native submit');
    expect(nativeCalls).toBe(1);
    expect(rejectedFault.state).toMatchObject({ forwards: 0, losses: 0, commandId: null, heldReceipt: null });
  });

  it('does not lose acknowledgements when there is no placed prefix or the receipt is not a held partial prefix', async () => {
    const noPlacement = batch({ steps: [{ kind: 'walk', position: { x: 1, y: 0 } }] });
    const noPlacementCalls: string[] = [];
    const noPlacementPort: CommandPort = { command: async lua => { noPlacementCalls.push(lua); return JSON.stringify({ ok: true }); }, close() {} };
    const noPlacementFault = placementAcknowledgementLoss(noPlacementPort, async () => { throw new Error('no placement should be selected'); });
    const noPlacementCommand = nativeSubmit({ op: 'submit', batch: noPlacement });
    await expect(noPlacementFault.port.command(noPlacementCommand)).resolves.toBe(JSON.stringify({ ok: true }));
    expect(noPlacementFault.state).toMatchObject({ forwards: 0, losses: 0 });

    for (const invalidReceipt of [
      suspendedPrefix(batch(), { completed: 0, unexecuted: 3 }),
      suspendedPrefix(batch(), { completed: 3, unexecuted: 0 }),
      suspendedPrefix(batch(), { status: 'running' }),
      suspendedPrefix(batch(), { status: 'completed' }),
    ]) {
      const value = batch();
      const response = JSON.stringify({ ok: true });
      const port: CommandPort = { command: async () => response, close() {} };
      const fault = placementAcknowledgementLoss(port, async () => ({ ...invalidReceipt, commandId: value.commandId }));
      await expect(fault.port.command(nativeSubmit({ op: 'submit', batch: value }))).rejects.toThrow();
      expect(fault.state.losses).toBe(0);
    }
  });

  it('accepts an actually started cancelled walk after the completed placement prefix', () => {
    const value = batch();
    const receipt = suspendedPrefix(value, { completed: 1, steps: [
      { index: 1, status: 'completed', startedTick: 10, endedTick: 11, before: [], after: [], delta: [] },
      interruptedWalk(2),
    ] });
    expect(receipt).toMatchObject({ completed: 1, unexecuted: 1, steps: [{ status: 'completed' }, { status: 'cancelled' }] });
    expect(() => requirePrefixInventory(value, receipt, { pipe: 2, 'medium-electric-pole': 1 }, { pipe: 1, 'medium-electric-pole': 1 })).not.toThrow();
  });

});

describe('production-chain completed placement inventory reconciliation', () => {
  const original = batch();
  const prefix = suspendedPrefix(original);
  const initial = { pipe: 2, 'medium-electric-pole': 1 };
  const correct = { pipe: 1, 'medium-electric-pole': 1 };

  it('accepts and preserves an exact completed placement-prefix debit', () => {
    const before = structuredClone({ original, prefix, initial, correct });
    expect(() => requirePrefixInventory(original, prefix, initial, correct)).not.toThrow();
    expect({ original, prefix, initial, correct }).toEqual(before);
  });

  it('accepts the empty object form of a native empty debit delta', () => {
    const receipt = suspendedPrefix(original, { completed: 1, steps: [
      { index: 1, status: 'completed', startedTick: 10, endedTick: 11, before: [], after: [], delta: [] },
      { ...interruptedWalk(2), delta: {} as unknown as Receipt['steps'][number]['delta'] },
    ] });
    expect(() => requirePrefixInventory(original, receipt, initial, correct)).not.toThrow();
  });

  it.each([
    ['duplicate debit', { pipe: 0, 'medium-electric-pole': 1 }],
    ['missing debit', { pipe: 2, 'medium-electric-pole': 1 }],
    ['wrong item debit', { pipe: 2 }],
  ])('rejects %s in the observed inventory', (_label, actual) => {
    expect(() => requirePrefixInventory(original, prefix, initial, actual)).toThrow('Native placement prefix must consume its kit exactly once');
  });

  it('rejects mismatched command identity', () => {
    expect(() => requirePrefixInventory(original, prefix, initial, correct)).not.toThrow();
    expect(() => requirePrefixInventory(original, { ...prefix, commandId: 'other-command' }, initial, correct)).toThrow();
  });

  it.each([
    ['zero completed steps', { completed: 0, unexecuted: 3 }],
    ['complete batch with no suffix', { completed: 3, unexecuted: 0 }],
    ['negative completed count', { completed: -1, unexecuted: 4 }],
    ['unexecuted count mismatch', { completed: 2, unexecuted: 2 }],
  ])('rejects invalid prefix: %s', (_label, changes) => {
    expect(() => requirePrefixInventory(original, { ...prefix, ...changes }, initial, correct)).toThrow();
  });

  it('rejects an interrupted material step after a completed placement', () => {
    const value = batch({ steps: [original.steps[0]!, original.steps[2]!, original.steps[1]!] });
    const receipt = suspendedPrefix(value, { completed: 1, steps: [
      { index: 1, status: 'completed', startedTick: 10, endedTick: 11, before: [], after: [], delta: [] },
      { index: 2, status: 'cancelled', startedTick: 11, endedTick: 12, before: [], after: [], delta: [] },
    ] });
    expect(() => requirePrefixInventory(value, receipt, initial, { pipe: 1, 'medium-electric-pole': 1 })).toThrow();
  });

  it.each([
    ['changed before/after inventory', { ...interruptedWalk(2, [{ name: 'pipe', quality: 'normal', count: 1 }]), after: [] }],
    ['nonempty material debit delta', { ...interruptedWalk(2), delta: [{ name: 'pipe', quality: 'normal', count: 1 }] }],
  ])('rejects an interrupted walk with %s', (_label, interrupted) => {
    const receipt = suspendedPrefix(original, { completed: 1, steps: [
      { index: 1, status: 'completed', startedTick: 10, endedTick: 11, before: [], after: [], delta: [] },
      interrupted,
    ] });
    expect(() => requirePrefixInventory(original, receipt, initial, correct)).toThrow();
  });
});
