import { describe, expect, it } from 'vitest';
import type { ProductionStatusPage } from '@autofactorio/contracts';
import type { InstalledChainContext } from '../packages/core/workshop/installed-chain.js';
import { gameplayCase, gameplayConstruction, gameplayHeartbeatPort, gameplayWindow, requireSulfurWindow, type GameplayEndpoint } from '../scripts/dev/production-chain-gameplay.js';
import type { CommandPort } from '../packages/factorio/src/rcon.js';

const refineryBox = [{ x: -2.4, y: -2.4 }, { x: 2.4, y: 2.4 }] as const;
const plantBox = [{ x: -1.5, y: -1.5 }, { x: 1.5, y: 1.5 }] as const;
const context = {
  snapshot: { catalog: { machines: [
    { name: 'oil-refinery', collisionBox: refineryBox },
    { name: 'chemical-plant', collisionBox: plantBox },
  ] } },
} as unknown as InstalledChainContext;

const before: GameplayEndpoint = {
  tick: 10_000, delivered: 100, fluid: 0, crafts: { sulfur: 0 }, stock: 0,
  supplied: {}, inventory: {}, progress: 0,
};
const demand = (product: string, kind: 'production' | 'consumption', rate: number) => ({
  product, kind, rate: { numerator: String(rate), denominator: '1' },
});
const metric = (product: string, kind: 'production' | 'consumption', startTick: number, endTick: number, lower: number) => {
  const [productKind, name] = product.split(':') as ['item' | 'fluid', string];
  return {
    schema: 1 as const, scopeId: `scope-${name}`, scopeRevision: 1, epoch: 'epoch', kind,
    productKind, name, quality: 'normal' as const, surface: 'nauvis', quantity: lower * 60,
    rate: lower, rateBounds: { lower, upper: lower + 0.1 }, unit: productKind === 'fluid' ? 'units-per-game-second' as const : 'items-per-game-second' as const,
    startTick, endTick, ageTicks: 0, coverage: 'complete' as const, method: 'game-counter', evidence: ['counter-window'],
  };
};
const healthyStage = (id: string, planned: ReturnType<typeof demand>[], metrics = planned.map(row => metric(row.product, row.kind, before.tick, before.tick + 3600, Number(row.rate.numerator)))) => ({
  id, planId: 'plan', revision: 1, stage: id, recipe: id, machine: id, task: `task-${id}`, taskRevision: 1,
  progress: { stage: id, task: `task-${id}`, taskRevision: 1, current: true, construction: 'complete' as const, evidence: ['receipt'], commissioning: 'unknown' as const, health: 'unknown' as const, scenarioVerdict: 'not-evaluated' as const, suppliers: [] },
  planned, nominalCraftsPerSecond: { numerator: '1', denominator: '1' }, scope: { id: `scope-${id}`, revision: 1 }, tick: before.tick + 3600,
  metrics, health: 'healthy' as const, exceptions: [], hypotheses: [], stale: false, scenarioVerdict: 'not-evaluated' as const, omitted: 0,
});
const validStatus = (): ProductionStatusPage => ({ id: 'plan', revision: 1, next: null, omitted: 0, scenarioVerdict: 'not-evaluated', stages: [
  healthyStage('refining', [demand('fluid:petroleum-gas', 'production', 2), demand('fluid:water', 'consumption', 1)]),
  healthyStage('sulfur', [demand('item:sulfur', 'production', 1), demand('fluid:petroleum-gas', 'consumption', 2)]),
] });
const after: GameplayEndpoint = {
  ...before, tick: before.tick + 3600, delivered: 160, stock: 0, crafts: { sulfur: 30 },
};

function fakeWatchdog() {
  let ticks = 0;
  let lastHeartbeat = 0;
  let inFlight = false;
  let maximumInFlight = 0;
  const commands: string[] = [];
  const port: CommandPort = {
    async command(command: string) {
      if (inFlight) throw new Error('concurrent raw port command');
      inFlight = true;
      maximumInFlight = Math.max(maximumInFlight, 1);
      try {
        await Promise.resolve();
        if (command === 'heartbeat') lastHeartbeat = ticks;
        else if (ticks - lastHeartbeat >= 180) throw new Error('watchdog expired');
        commands.push(command);
        ticks += 18; // 300 ms of game time per exported fact page / heartbeat.
        return 'ok';
      } finally {
        inFlight = false;
      }
    },
    close() {},
  };
  return { port, commands, elapsedTicks: () => ticks, maximumInFlight: () => maximumInFlight };
}

function headerCrossingExists(document: ReturnType<typeof gameplayConstruction>['document'], restoreCenterPipe = false): boolean {
  const blocked = new Set(document.entities
    .filter(entity => entity.position.y === 4.5 && (entity.name === 'pipe' || entity.name === 'pipe-to-ground'))
    .map(entity => `${entity.position.x},${entity.position.y}`));
  if (restoreCenterPipe) blocked.add('-7.5,4.5');
  const start = { x: -7.5, y: 3.5 }, goal = { x: -7.5, y: 5.5 };
  const queue = [start], visited = new Set([`${start.x},${start.y}`]);
  while (queue.length) {
    const current = queue.shift()!;
    if (current.x === goal.x && current.y === goal.y) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: current.x + dx!, y: current.y + dy! };
      if (next.x < -9.5 || next.x > -5.5 || next.y < 3.5 || next.y > 5.5) continue;
      const key = `${next.x},${next.y}`;
      if (blocked.has(key) || visited.has(key)) continue;
      visited.add(key); queue.push(next);
    }
  }
  return false;
}

describe('ordinary sulfur gameplay diagnostic', () => {
  it('accepts only the dedicated new-game sulfur case and rejects personal/save/extra arguments', () => {
    expect(() => gameplayCase(['--case', 'sulfur-gameplay'])).not.toThrow();
    for (const args of [[], ['--case', 'other'], ['--case', 'sulfur-gameplay', '--save', 'personal.zip'], ['--case', 'sulfur-gameplay', '--profile', 'personal'], ['--case', 'sulfur-gameplay', 'extra'], ['--host', 'localhost']]) {
      expect(() => gameplayCase(args)).toThrow();
    }
  });

  it('partitions the complete finite schematic into legal refinery and sulfur plans with safe approach positions', () => {
    const result = gameplayConstruction(context, 1);
    const [refining, chemistry] = result.plans;
    expect(result.document.entities.length).toBeGreaterThan(0);
    expect(result.document.entities.map(entity => entity.id)).toHaveLength(new Set(result.document.entities.map(entity => entity.id)).size);
    expect(result.document.entities.map(entity => entity.entityNumber)).toHaveLength(new Set(result.document.entities.map(entity => entity.entityNumber)).size);
    expect(result.document.entities.map(entity => `${entity.position.x},${entity.position.y}`)).toHaveLength(new Set(result.document.entities.map(entity => `${entity.position.x},${entity.position.y}`)).size);
    expect(refining!.document.entities.filter(entity => entity.name === 'oil-refinery')).toHaveLength(3);
    expect(refining!.document.entities.some(entity => entity.name === 'chemical-plant')).toBe(false);
    expect(chemistry!.document.entities.map(entity => entity.name)).toEqual(['chemical-plant']);
    expect(result.document.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'pipe', position: { x: 3.5, y: 4.5 } }),
      expect.objectContaining({ name: 'pipe', position: { x: 4.5, y: 3.5 } }),
      expect.objectContaining({ name: 'medium-electric-pole', position: { x: 3.5, y: 5.5 } }),
    ]));
    expect(result.document.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'pipe-to-ground', position: { x: -8.5, y: 4.5 }, direction: 12 }),
      expect.objectContaining({ name: 'pipe-to-ground', position: { x: -6.5, y: 4.5 }, direction: 4 }),
    ]));
    expect(result.document.entities.some(entity => entity.name === 'pipe' && entity.position.x === -7.5 && entity.position.y === 4.5)).toBe(false);
    expect(headerCrossingExists(result.document)).toBe(true);
    expect(headerCrossingExists(result.document, true)).toBe(false);
    const planned = [...refining!.document.entities, ...chemistry!.document.entities].map(entity => entity.id).sort();
    expect(planned).toEqual(result.document.entities.map(entity => entity.id).sort());
    for (const count of Object.values(result.inventory)) expect(Number.isFinite(count) && Number.isInteger(count) && count >= 0).toBe(true);
    const required = { ...refining!.required };
    for (const [name, count] of Object.entries(chemistry!.required)) required[name] = (required[name] ?? 0) + count;
    expect(required).toEqual(result.inventory);

    const fixtures = [{ x: -32.5, y: -12.5 }, { x: -32.5, y: -6.5 }, { x: 32.5, y: -12.5 }, { x: 0, y: 14 }];
    for (const plan of result.plans) {
      const placements = plan.steps.filter(step => step.kind === 'place');
      const walks = plan.steps.filter(step => step.kind === 'walk');
      expect(placements).toHaveLength(plan.document.entities.length);
      for (const step of walks) {
        for (const center of fixtures) expect(Math.abs(step.position.x - center.x) >= 4 || Math.abs(step.position.y - center.y) >= 4).toBe(true);
        for (const entity of plan.document.entities) {
          const box = entity.name === 'chemical-plant' ? plantBox : entity.name === 'oil-refinery' ? refineryBox : null;
          const halfX = box ? Math.max(Math.abs(box[0].x), Math.abs(box[1].x)) + 0.3 : 1;
          const halfY = box ? Math.max(Math.abs(box[0].y), Math.abs(box[1].y)) + 0.3 : 1;
          expect(Math.abs(step.position.x - entity.position.x) >= halfX || Math.abs(step.position.y - entity.position.y) >= halfY).toBe(true);
        }
      }
    }
  });

  it('accepts a complete exact 60-second window with fresh output, conservation, task receipts, and conservative upstream bounds', () => {
    expect(() => requireSulfurWindow(before, after, validStatus())).not.toThrow();
  });

  it('aligns five exact scored windows to the lagging public measurement cadence', async () => {
    const makeEndpoint = (tick: number): GameplayEndpoint => ({
      tick, delivered: tick / 60, fluid: 0, crafts: { sulfur: tick / 120 }, stock: 0,
      supplied: {}, inventory: {}, progress: 0,
    });
    const makeStatus = (sampleEnd: number): ProductionStatusPage => {
      const page = validStatus();
      for (const stage of page.stages) {
        stage.tick = sampleEnd;
        for (const value of stage.metrics) {
          value.startTick = sampleEnd - 3600;
          value.endTick = sampleEnd;
        }
      }
      return page;
    };

    // Before the observation-only second, public status still ends one second
    // before the held raw endpoint; that interval must fail exact reconciliation.
    const priorEndpoint = makeEndpoint(3600);
    const priorQuery = makeStatus(priorEndpoint.tick - 60);
    expect(priorEndpoint.tick - priorQuery.stages[0]!.metrics[0]!.endTick).toBe(60);
    expect(() => requireSulfurWindow(makeEndpoint(0), priorEndpoint, priorQuery)).toThrow();

    let currentTick = 60; // caller's one lookahead second after the baseline
    let scoredBefore = makeEndpoint(0);
    const windows: Array<{ before: GameplayEndpoint; after: GameplayEndpoint; status: ProductionStatusPage }> = [];
    const second = async () => { currentTick += 60; };
    for (let index = 0; index < 5; index++) {
      const window = await gameplayWindow(second, async () => makeEndpoint(currentTick), async () => makeStatus(currentTick - 60));
      expect(window.after.tick - scoredBefore.tick).toBe(3600);
      expect(window.status.stages[0]!.metrics[0]!.startTick).toBe(scoredBefore.tick);
      expect(window.status.stages[0]!.metrics[0]!.endTick).toBe(window.after.tick);
      expect(() => requireSulfurWindow(scoredBefore, window.after, window.status)).not.toThrow();
      windows.push({ before: scoredBefore, after: window.after, status: window.status });
      scoredBefore = window.after;
    }
    expect(windows).toHaveLength(5);
  });

  it('rejects apparent success supplied only by stored sulfur or inventory drawdown', () => {
    expect(() => requireSulfurWindow(before, { ...after, crafts: { sulfur: 0 }, stock: 60, delivered: 160 }, validStatus())).toThrow();
    expect(() => requireSulfurWindow(before, { ...after, crafts: { sulfur: 40 }, stock: 0, delivered: 160 }, validStatus())).toThrow();
  });

  it('rejects nonexact windows, delivery shortfalls, missing upstream supply, and uncertain conservative bounds', () => {
    expect(() => requireSulfurWindow(before, { ...after, tick: after.tick - 1 }, validStatus())).toThrow();
    expect(() => requireSulfurWindow(before, { ...after, delivered: 159 }, validStatus())).toThrow();
    const short = validStatus();
    short.stages[0]!.metrics[0] = metric('fluid:petroleum-gas', 'production', before.tick, after.tick, 1.99);
    expect(() => requireSulfurWindow(before, after, short)).toThrow();
    const uncertain = validStatus();
    uncertain.stages[0]!.metrics[0]!.rateBounds = { lower: 1.5, upper: 2.5 };
    uncertain.stages[0]!.metrics[0]!.rate = 2.1;
    expect(() => requireSulfurWindow(before, after, uncertain)).toThrow();
  });

  it('rejects incomplete, stale, or taskless stage evidence even when nominal values look sufficient', () => {
    const missing = validStatus();
    missing.stages[1]!.metrics = missing.stages[1]!.metrics.filter(value => value.name !== 'sulfur');
    expect(() => requireSulfurWindow(before, after, missing)).toThrow();
    const partial = validStatus();
    partial.stages[0]!.metrics[0]!.coverage = 'unknown';
    expect(() => requireSulfurWindow(before, after, partial)).toThrow();
    const stale = validStatus();
    stale.stages[0]!.metrics[0]!.startTick++;
    stale.stages[0]!.metrics[0]!.rate = 100;
    stale.stages[0]!.metrics[0]!.rateBounds = { lower: 100, upper: 100 };
    expect(() => requireSulfurWindow(before, after, stale)).toThrow();
    const noTask = validStatus();
    noTask.stages[1]!.progress = null;
    expect(() => requireSulfurWindow(before, after, noTask)).toThrow();
  });

  it('keeps a delayed serialized fact-page sequence alive with awaited watchdog heartbeats', async () => {
    const raw = fakeWatchdog();
    await expect(async () => {
      for (let page = 0; page < 12; page++) await raw.port.command(`fact-page-${page}`);
    }).rejects.toThrow('watchdog expired');
    expect(raw.elapsedTicks()).toBeGreaterThanOrEqual(180);
    expect(raw.commands).not.toContain('heartbeat');

    const delayed = fakeWatchdog();
    const active = true;
    let heartbeatCalls = 0;
    const decorated = gameplayHeartbeatPort(delayed.port, async () => {
      heartbeatCalls++;
      await delayed.port.command('heartbeat');
    }, () => active, () => delayed.elapsedTicks() * (1000 / 60));
    for (let page = 0; page < 12; page++) await decorated.command(`fact-page-${page}`);
    expect(delayed.elapsedTicks()).toBeGreaterThan(180);
    expect(heartbeatCalls).toBeGreaterThan(0);
    expect(delayed.commands.filter(command => command === 'heartbeat').length).toBe(heartbeatCalls);
    expect(delayed.maximumInFlight()).toBe(1);
  });

  it('deactivates heartbeat before pause and propagates heartbeat failure before sending the next request', async () => {
    const delayed = fakeWatchdog();
    let active = true;
    let heartbeatCalls = 0;
    const decorated = gameplayHeartbeatPort(delayed.port, async () => {
      heartbeatCalls++;
      await delayed.port.command('heartbeat');
    }, () => active, () => delayed.elapsedTicks() * (1000 / 60));
    await decorated.command('first-fact-page');
    active = false;
    const heartbeatCountBeforePause = heartbeatCalls;
    await decorated.command('pause');
    expect(heartbeatCalls).toBe(heartbeatCountBeforePause);
    expect(delayed.commands.at(-1)).toBe('pause');

    const failing = fakeWatchdog();
    let shouldFailHeartbeat = false;
    let factRequests = 0;
    const rawPort: CommandPort = {
      async command(command: string) {
        if (command === 'heartbeat' && shouldFailHeartbeat) throw new Error('stale_control_revision');
        if (command.startsWith('fact-page')) factRequests++;
        return failing.port.command(command);
      },
      close() {},
    };
    let now = 0;
    const guarded = gameplayHeartbeatPort(rawPort, async () => {
      await rawPort.command('heartbeat');
    }, () => true, () => now);
    await guarded.command('fact-page-1');
    now = 300;
    shouldFailHeartbeat = true;
    await expect(guarded.command('fact-page-2')).rejects.toThrow('stale_control_revision');
    expect(factRequests).toBe(1);
  });
});
