import assert from 'node:assert/strict';
import type { BlueprintDocument, ProductionStatusPage } from '@autofactorio/contracts';
import type { InstalledChainContext } from '../../packages/core/workshop/installed-chain.js';
import { compileCharacterBlueprint, type ConstructionPlan } from '../../packages/core/workshop/construction.js';
import { billOfMaterials } from '../../packages/core/workshop/blueprint.js';
import { referenceBlueprint } from './production-chain-reference.js';
import type { CommandPort } from '../../packages/factorio/src/rcon.js';

/** Planning exports many pages before the first construction poll. Service the
 * existing watchdog between those requests on the same serialized connection.
 * The heartbeat callback must use the raw port to avoid recursion; deactivate
 * before pausing so no heartbeat can carry a superseded control revision. */
export function gameplayHeartbeatPort(port: CommandPort, heartbeat: () => Promise<void>, active: () => boolean, now: () => number = Date.now): CommandPort {
  let last = now();
  return {
    async command(command) {
      if (active() && now() - last >= 250) { await heartbeat(); last = now(); }
      return port.command(command);
    },
    close() { port.close(); },
  };
}

export function gameplayCase(args: string[]): void {
  if (args.length !== 2 || args[0] !== '--case' || args[1] !== 'sulfur-gameplay') throw new Error('Expected --case sulfur-gameplay; dedicated new game only');
}

/** Reuse the tested schematic, never workshop setup, materialization or grants.
 * All candidate entities are placed by the ordinary engineer task executor. */
export function gameplayConstruction(context: InstalledChainContext, connector: number): { document: BlueprintDocument; inventory: Record<string, number>; plans: ConstructionPlan[] } {
  const document = referenceBlueprint({ ports: [] }, 'sulfur-character', connector);
  // Ordinary consumption telemetry conservatively allows one prepaid craft per
  // machine at each endpoint. Two full-duty refineries put its lower bound at
  // demand before fluid rounding. A declared third machine leaves real margin;
  // do not weaken those honest public error bounds to make the reference pass.
  const add = (name: string, x: number, y: number, recipe?: string, direction = 0) => {
    assert(!document.entities.some(entity => entity.position.x === x && entity.position.y === y));
    const entityNumber = Math.max(0, ...document.entities.map(entity => entity.entityNumber)) + 1, id = `ordinary-extra-${entityNumber}`;
    document.entities.push({ id, entityNumber, name, position: { x, y }, direction, quality: 'normal', ...(recipe ? { recipe } : {}) }); return id;
  };
  add('oil-refinery', 3.5, 0.5, 'basic-oil-processing');
  for (let x = -4.5; x <= 4.5; x++) add('pipe', x, 4.5);
  add('pipe', 4.5, 3.5);
  for (let y = -2.5; y >= -4.5; y--) add('pipe', 5.5, y);
  const pole = add('medium-electric-pole', 3.5, 5.5);
  const upstreamPole = document.entities.find(entity => entity.name === 'medium-electric-pole' && entity.position.x === 0.5 && entity.position.y === 5.5); assert(upstreamPole);
  document.wires.push({ from: { entityId: upstreamPole.id, connector: String(connector) }, to: { entityId: pole, connector: String(connector) }, color: 'copper' });
  // The continuous header otherwise traps the builder between refinery2 and its
  // final inlet pipe. Preserve a walkable tile without interrupting crude flow.
  document.entities = document.entities.filter(entity => !(entity.name === 'pipe' && entity.position.y === 4.5 && [-8.5, -7.5, -6.5].includes(entity.position.x)));
  add('pipe-to-ground', -8.5, 4.5, undefined, 12);
  add('pipe-to-ground', -6.5, 4.5, undefined, 4);
  const centers = [{ x: -32.5, y: -12.5 }, { x: -32.5, y: -6.5 }, { x: 32.5, y: -12.5 }, { x: 0, y: 14 }];
  const canStand = (position: { x: number; y: number }) => centers.every(center =>
    Math.abs(position.x - center.x) >= 4 || Math.abs(position.y - center.y) >= 4
  ) && document.entities.every(entity => {
    const box = context.snapshot.catalog.machines.find(machine => machine.name === entity.name)?.collisionBox;
    const halfX = box ? Math.max(Math.abs(box[0].x), Math.abs(box[1].x)) + 0.3 : 1;
    const halfY = box ? Math.max(Math.abs(box[0].y), Math.abs(box[1].y)) + 0.3 : 1;
    return Math.abs(position.x - entity.position.x) >= halfX || Math.abs(position.y - entity.position.y) >= halfY;
  });
  const inventory = billOfMaterials(document);
  const refinery = { ...document, entities: document.entities.filter(entity => entity.name !== 'chemical-plant') };
  const sulfur = { ...document, entities: document.entities.filter(entity => entity.name === 'chemical-plant'), wires: [] };
  return { document, inventory, plans: [compileCharacterBlueprint(refinery, inventory, canStand), compileCharacterBlueprint(sulfur, inventory, canStand)] };
}

export interface GameplayEndpoint {
  tick: number; delivered: number; fluid: number; crafts: Record<string, number>; stock: number;
  supplied: Record<string, number>; inventory: Record<string, number>; progress: number;
}

/** The ordinary sampler runs at tick callbacks; a held endpoint can be one
 * cadence ahead of its latest published sample. Capture the scored endpoint,
 * then advance one observation-only second to publish that exact tick. The
 * caller seeds one lookahead second after its baseline; scored windows remain
 * exactly 3600 ticks, with no stale/skewed interval accepted. */
export async function gameplayWindow(second: () => Promise<void>, endpoint: () => Promise<GameplayEndpoint>, status: () => Promise<ProductionStatusPage>): Promise<{ after: GameplayEndpoint; status: ProductionStatusPage }> {
  for (let index = 0; index < 59; index++) await second();
  const after = await endpoint();
  await second();
  return { after, status: await status() };
}

/** Independent verdict stays in this developer probe, outside gameplay tools.
 * Stock growth is allowed; stock drawdown cannot substitute for fresh output. */
export function requireSulfurWindow(before: GameplayEndpoint, after: GameplayEndpoint, status: ProductionStatusPage): void {
  assert.equal(after.tick - before.tick, 3600, 'Window must be exactly 60 game seconds');
  const produced = ((after.crafts.sulfur ?? 0) - (before.crafts.sulfur ?? 0)) * 2;
  const delivered = after.delivered - before.delivered;
  assert(produced >= 60 && delivered >= 60, 'Fresh sulfur production and delivery must each meet 60');
  assert(after.stock >= before.stock, 'Stored sulfur cannot conceal a production deficit');
  assert.equal(produced - delivered, after.stock - before.stock, 'Independent sulfur inventory conservation');
  assert.equal(status.scenarioVerdict, 'not-evaluated');
  assert.equal(status.stages.length, 2); assert.equal(status.next, null); assert.equal(status.omitted, 0);
  for (const stage of status.stages) {
    assert(stage.task && stage.progress?.construction === 'complete', 'Stage requires receipt-backed task completion');
    assert.equal(stage.health, 'healthy', JSON.stringify(stage.exceptions));
    for (const demand of stage.planned) {
      const [kind, name] = demand.product.split(':');
      const metric = stage.metrics.find(value => value.kind === demand.kind && value.name === name && (value.productKind ?? 'item') === kind);
      assert(metric && metric.coverage === 'complete' && metric.evidence.length, `Missing upstream ${demand.product}`);
      assert.equal(metric.startTick, before.tick); assert.equal(metric.endTick, after.tick);
      const required = Number(demand.rate.numerator) / Number(demand.rate.denominator);
      assert((metric.rateBounds?.lower ?? metric.rate ?? -1) >= required, `Upstream conservative rate below ${demand.product} demand`);
    }
  }
}
