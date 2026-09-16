/** Evaluator/operator-only. Never include this plan or its receipts in gameplay context. */
import { randomUUID } from 'node:crypto';
import type { Batch, Step, Target } from '@autofactorio/contracts';
import { diagnosticGrants } from '@autofactorio/contracts';
import { GameClient } from '../../packages/factorio/src/client.js';
import type { Lifecycle, ControlState } from '../../packages/factorio/src/lifecycle.js';
import { waitFor } from './game-processes.js';
import type { FirstShiftManifest } from '../../packages/factorio/src/first-shift.js';

export function referencePlan(manifest: FirstShiftManifest): Step[] {
  const product = manifest.recipe.products[0]!;
  const perMinute = 60 * manifest.assemblerSpeed / manifest.recipe.energy * Number(product.amount);
  if (Math.ceil(36 / perMinute) !== 6) throw new Error('Installed capacity requires a new reference layout revision');
  const steps: Step[] = [];
  const place = (item: string, x: number, y: number, direction: number, standY: number) => { steps.push({ kind: 'walk', position: { x, y: standY } }, { kind: 'place', item, quality: 'normal', direction, position: { x, y } }); };
  // Build the empty cell's equipment first; supplies arrive through fixture belts only.
  for (const x of [-15.5, -9.5, -3.5, 2.5, 8.5, 14.5]) {
    place('assembling-machine-1', x, 0.5, 0, 5.5);
    place('inserter', x, 2.5, 8, 5.5);
    place('inserter', x + 2, 0.5, 12, 5.5);
    place('small-electric-pole', x + 2, 2.5, 0, 5.5);
    place('inserter', x, -1.5, 0, -4.5);
    place('small-electric-pole', x - 2, -1.5, 0, -4.5);
    for (const y of [0.5, -0.5]) place('transport-belt', x + 3, y, 0, 5.5);
    place('underground-belt', x + 3, -1.5, 0, -4.5);
    // Cursor direction faces the opening: the opposite direction completes the
    // existing northbound input as an output. Rotating a linked end reverses BOTH.
    place('underground-belt', x + 3, -3.5, 8, -4.5);
    place('transport-belt', x + 3, -4.5, 0, -7.5);
  }
  for (const y of [-2.5, 3.5]) for (let x = -20.5; x <= 16.5; x++) place('transport-belt', x, y, 4, y < 0 ? -4.5 : 6.5);
  for (let x = -12.5; x <= 21.5; x++) place('transport-belt', x, -5.5, 4, -8.5);
  place('small-electric-pole', 18.5, -3.5, 0, -8.5);
  place('small-electric-pole', 22.5, -7.5, 0, -9.5);
  place('inserter', 22.5, -5.5, 12, -9.5);
  return steps;
}
export async function executeReference(options: { game: GameClient; life: Lifecycle; control: ControlState; manifest: FirstShiftManifest; progress: (s: string) => void }) {
  const { game, life, manifest, progress } = options; let control = options.control;
  async function execute(steps: Step[]) {
    control = await life.heartbeat(control);
    const batch: Batch = { commandId: randomUUID(), epoch: control.epoch, session: control.session, task: 'phase03-actions', revision: 1, actor: 'builder-1', surface: 'nauvis', grants: diagnosticGrants(control.generation), deadline: control.tick + 36000, steps };
    await game.request({ op: 'submit', batch });
    const receipt = await waitFor('Reference batch', async () => { control = await life.heartbeat(control); const r = await game.receipt(batch.commandId); return r && !['accepted', 'running'].includes(r.status) ? r : undefined; }, 180000, 100);
    if (receipt.status !== 'completed') throw new Error('Legal reference failed: ' + JSON.stringify(receipt));
  }
  const plan = referencePlan(manifest);
  for (let i = 0; i < plan.length; i += 80) { await execute(plan.slice(i, i + 80)); progress(`Reference construction: ${Math.min(i + 80, plan.length)}/${plan.length} legal steps`); }
  for (const x of [-12.5, -6.5, -0.5, 5.5, 11.5, 17.5]) {
    const observed = await game.request({ op: 'observe', surface: 'nauvis', area: [{ x: x - 0.4, y: -3.9 }, { x: x + 0.4, y: -3.1 }], offset: 0, limit: 50 });
    const entity = (observed.entities as (Target & { direction: number; beltType: string; neighbour?: Target })[]).find(e => e.name === 'underground-belt');
    if (!entity || entity.beltType !== 'output' || entity.direction !== 0 || !entity.neighbour || entity.neighbour.position.y !== -1.5) throw new Error('Reference underground connection is not northbound');
  }
  for (const x of [-15.5, -9.5, -3.5, 2.5, 8.5, 14.5]) {
    const observed = await game.request({ op: 'observe', surface: 'nauvis', area: [{ x: x - 1.5, y: -1 }, { x: x + 1.5, y: 2 }], offset: 0, limit: 50 });
    const entity = (observed.entities as Target[]).find(e => e.name === 'assembling-machine-1'); if (!entity) throw new Error('Reference assembler missing');
    const target: Target = { name: entity.name, quality: entity.quality, position: entity.position, unit: entity.unit };
    await execute([{ kind: 'walk', position: { x, y: 5.5 } }, { kind: 'recipe', target, recipe: 'automation-science-pack' }]);
  }
  await execute([{ kind: 'walk', position: { x: 0, y: 12 } }]);
  return control;
}
