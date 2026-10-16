import assert from 'node:assert/strict';
import type { Batch, Receipt } from '@autofactorio/contracts';
import type { CommandPort } from '../../packages/factorio/src/rcon.js';

/** Managed load checks entity effects before a graphical client joins. Only
 * pre-join reads may omit the actor; capture and joined comparisons
 * still require the actual builder on the candidate surface. */
export function recoveryCheckpointWorld(world: Record<string, unknown>, entities: unknown, surface: string, allowDisconnected = false) {
  const actors = world.actors as Record<string, { surface: string }>;
  assert(actors && typeof actors === 'object' && !Array.isArray(actors));
  if (!allowDisconnected || actors['builder-1']) assert.equal(actors['builder-1']?.surface, surface);
  return { tick: world.tick, entities, actors };
}

/** Only a complete public submit RPC is eligible. Operator, receipt and console
 * requests pass through unchanged; no arbitrary Lua is interpreted as a batch. */
export function submittedBatch(lua: string): Batch | null {
  const encoded = /^\/silent-command rcon\.print\(remote\.call\("autofactorio_v1","rpc","((?:\\\d{3})+)"\)\)$/.exec(lua)?.[1];
  if (!encoded) return null;
  const bytes = encoded.match(/\d{3}/g)!.map(Number);
  if (bytes.some(value => value > 255)) return null;
  try {
    const value = JSON.parse(Buffer.from(bytes).toString('utf8'));
    return value?.op === 'submit' && value.batch && Array.isArray(value.batch.steps) && value.batch.steps.some((step: { kind?: string }) => step.kind === 'place') ? value.batch as Batch : null;
  } catch { return null; }
}

/** Forward one genuine batch, wait for observed native placement and a held
 * prefix, then discard its real acknowledgement. The borrowed port remains
 * owned by the probe. Retrying that uncertain command is always refused. */
export function placementAcknowledgementLoss(port: CommandPort, holdAfterPlacement: (batch: Batch) => Promise<Receipt>) {
  const state = { forwards: 0, losses: 0, commandId: null as string | null, heldReceipt: null as Receipt | null };
  return {
    state,
    port: {
      async command(lua: string) {
        const batch = submittedBatch(lua);
        if (batch && state.commandId === batch.commandId) throw new Error('Uncertain placement retry refused');
        const response = await port.command(lua);
        if (batch && state.forwards === 0) {
          assert.equal(JSON.parse(response).ok, true, 'Lose only an acknowledged native submit');
          state.forwards++; state.commandId = batch.commandId;
          const receipt = await holdAfterPlacement(batch);
          assert.equal(receipt.commandId, batch.commandId);
          assert.equal(receipt.status, 'suspended');
          assert(receipt.completed > 0 && receipt.completed < batch.steps.length);
          assert(batch.steps.slice(0, receipt.completed).some(step => step.kind === 'place'));
          state.heldReceipt = receipt; state.losses++;
          throw new Error('Diagnostic placement acknowledgement lost after native effects');
        }
        return response;
      },
      close() {},
    } satisfies CommandPort,
  };
}

/** Completed native steps debit the finite kit once. A cancelled suffix is
 * never charged, and a resumed batch must omit the completed prefix. */
export function requirePrefixInventory(batch: Batch, receipt: Receipt, initial: Record<string, number>, actual: Record<string, number>): void {
  assert.equal(receipt.commandId, batch.commandId);
  assert(receipt.completed > 0 && receipt.completed < batch.steps.length);
  // unexecuted counts never-started steps. Pause can also retain one started
  // cancelled walk, which must be retried without any material debit.
  assert.equal(receipt.steps.length + receipt.unexecuted, batch.steps.length);
  assert(receipt.steps.length === receipt.completed || receipt.steps.length === receipt.completed + 1);
  assert(receipt.steps.slice(0, receipt.completed).every(step => step.status === 'completed'));
  if (receipt.steps.length > receipt.completed) {
    assert.equal(batch.steps[receipt.completed]!.kind, 'walk');
    const interrupted = receipt.steps[receipt.completed]!;
    assert.equal(interrupted.status, 'cancelled'); assert.equal(Object.keys(interrupted.delta).length, 0);
    assert.deepEqual(interrupted.before, interrupted.after);
  }
  const expected = { ...initial };
  for (const step of batch.steps.slice(0, receipt.completed)) if (step.kind === 'place') {
    assert((expected[step.item] ?? 0) > 0); expected[step.item]!--;
    if (!expected[step.item]) delete expected[step.item];
  }
  assert.deepEqual(actual, expected, 'Native placement prefix must consume its kit exactly once');
}
