import { createHash } from 'node:crypto';
import { record, requirements } from '@autofactorio/contracts';
import type { RecipeFacts } from '@autofactorio/contracts';
import type { EvaluationManifest, Measurement, StageRequirement } from '../../core/evaluation/contracts.js';
import { VerificationEngine } from '../../core/evaluation/engine.js';
import type { CommandPort } from './rcon.js';
import { wrapper } from './rcon.js';
import { VerificationControl } from './verification.js';
import type { ControlState } from './lifecycle.js';

export interface FirstShiftManifest {
  id: '01-first-shift' | '02-some-assembly-required'; version: string; seed: number; mods: Record<string, string>;
  surface: 'nauvis'; quality: 'normal'; area: number[][]; grants: string[];
  kit: Record<string, number>; allowedActions: string[]; allowedRecipes: string[];
  rates: Record<string, number>; terminals: Record<string, unknown>; collector: unknown;
  settlingTicks: number; windowTicks: 3600; windows: 5; target: 30;
  gameLimitTicks: number; wallLimitMs: number; evaluator: string;
  recipe: Omit<RecipeFacts, 'category'>; gearRecipe?: Omit<RecipeFacts, 'category'>; assemblerSpeed: number;
}
export const commonKit = { 'assembling-machine-1': 12, 'transport-belt': 300, inserter: 60, 'long-handed-inserter': 12, 'underground-belt': 12, splitter: 6, 'small-electric-pole': 24, 'wooden-chest': 8 };
export const plateToScienceKit = { ...commonKit, 'underground-belt': 14 };
export function validateFirstShift(input: unknown): FirstShiftManifest {
  const m = record(input);
  if (!['01-first-shift', '02-some-assembly-required'].includes(String(m.id)) || m.surface !== 'nauvis' || m.quality !== 'normal' || m.windowTicks !== 3600 || m.windows !== 5 || m.target !== 30 || !Number.isSafeInteger(m.seed)) throw new Error('Invalid scenario identity or timing');
  for (const key of ['version', 'evaluator']) if (typeof m[key] !== 'string' || !m[key]) throw new Error('Missing scenario version');
  for (const key of ['settlingTicks', 'gameLimitTicks', 'wallLimitMs']) if (!Number.isSafeInteger(m[key]) || Number(m[key]) <= 0) throw new Error('Invalid scenario clock');
  const s2 = m.id === '02-some-assembly-required';
  if (JSON.stringify(m.area) !== (s2 ? '[[-40,-40],[40,40]]' : '[[-32,-32],[32,32]]')) throw new Error('Unexpected scenario site');
  const kit = record(m.kit);
  const expectedKit = s2 ? plateToScienceKit : commonKit;
  if (Object.keys(kit).length !== Object.keys(expectedKit).length || Object.entries(expectedKit).some(([name, count]) => kit[name] !== count)) throw new Error('Scenario finite kit mismatch');
  const rates = record(m.rates);
  if ((s2 ? rates['iron-plate'] !== 120 : rates['iron-gear-wheel'] !== 60) || rates['copper-plate'] !== 60 || Number(m.assemblerSpeed) <= 0) throw new Error('Invalid scenario feed or machine speed');
  const recipe = record(m.recipe);
  const amounts = requirements({ ...recipe, category: 'crafting' } as unknown as RecipeFacts, 'automation-science-pack', 150);
  if (!amounts.supported || amounts.ingredients.length !== 2 || !['iron-gear-wheel', 'copper-plate'].every(name => amounts.ingredients.some(i => i.name === name))) throw new Error('Unsupported installed science recipe');
  if (s2) {
    const gear = record(m.gearRecipe);
    const gearAmounts = requirements({ ...gear, category: 'crafting' } as unknown as RecipeFacts, 'iron-gear-wheel', 150);
    if (!gearAmounts.supported || gearAmounts.ingredients.length !== 1 || gearAmounts.ingredients[0]?.name !== 'iron-plate' || gearAmounts.ingredients[0].count !== 300) throw new Error('Unsupported installed gear recipe');
  }
  for (const key of ['grants', 'allowedActions', 'allowedRecipes']) if (!Array.isArray(m[key]) || !(m[key] as unknown[]).every(v => typeof v === 'string')) throw new Error('Missing S1 grants/policy');
  if (Object.values(record(m.mods)).some(v => typeof v !== 'string')) throw new Error('Invalid mod fingerprint');
  record(m.terminals); record(m.collector);
  return structuredClone(m) as unknown as FirstShiftManifest;
}
/** Canonical key ordering makes a fixture identity independent of Lua table serialization order. */
export function fingerprint(value: unknown): string {
  const ordered = (v: unknown): unknown => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, ordered(x)])) : v;
  return createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
}
export function evaluatorManifest(m: FirstShiftManifest, scope: string, originTick: number, originWallMs: number): EvaluationManifest {
  const amounts = requirements({ ...m.recipe, category: 'crafting' }, 'automation-science-pack', 150);
  if (!amounts.supported) throw new Error(amounts.reason);
  const stages: StageRequirement[] = amounts.ingredients.map(i => ({ id: i.name, source: 'terminal-' + i.name, boundary: 'science-input-' + i.name, consumer: 'collector-science-chain', item: { name: i.name, quality: 'normal', surface: 'nauvis' }, minimum: i.count, balanceTolerance: 0, maxDrawdown: 12 }));
  if (m.id === '02-some-assembly-required') {
    const gear = requirements({ ...m.gearRecipe!, category: 'crafting' }, 'iron-gear-wheel', 150);
    if (!gear.supported) throw new Error(gear.reason);
    const copper = amounts.ingredients.find(i => i.name === 'copper-plate')!;
    stages.splice(0, stages.length,
      { id: 'iron-plate', source: 'terminal-iron-plate', boundary: 'gear-input-iron-plate', consumer: 'connected-gear-machines', item: { name: 'iron-plate', quality: 'normal', surface: 'nauvis' }, minimum: gear.ingredients[0]!.count, balanceTolerance: 0, maxDrawdown: 12 },
      { id: 'iron-gear-wheel', source: 'connected-gear-machines', boundary: 'science-input-iron-gear-wheel', consumer: 'collector-science-chain', item: { name: 'iron-gear-wheel', quality: 'normal', surface: 'nauvis' }, minimum: 150, balanceTolerance: 4, maxDrawdown: 16 },
      { id: 'copper-plate', source: 'terminal-copper-plate', boundary: 'science-input-copper-plate', consumer: 'collector-science-chain', item: { name: 'copper-plate', quality: 'normal', surface: 'nauvis' }, minimum: copper.count, balanceTolerance: 0, maxDrawdown: 12 });
  }
  return { version: m.evaluator, scope, settlingTicks: m.settlingTicks, windowTicks: 3600, windows: 5, target: 30, originTick, originWallMs, gameLimitTicks: m.gameLimitTicks, wallLimitMs: m.wallLimitMs,
    toleranceVersion: m.id === '02-some-assembly-required' ? 's2-calibration-v5' : 's1-calibration-v1', stages: [...stages,
      { id: 'automation-science-pack', source: 'connected-science-machines', boundary: 'automatic-collector', consumer: 'collector-drain', item: { name: 'automation-science-pack', quality: 'normal', surface: 'nauvis' }, minimum: 150, balanceTolerance: 0, maxDrawdown: 12 }] };
}
export function briefing(m: FirstShiftManifest, roster: 'team' | 'solo') {
  return { scenario: m.id, version: m.version, roster, goal: 'Automatically produce and deliver at least 30 red science packs in each of five consecutive game minutes.', site: m.area, kit: m.kit, terminals: m.terminals, rates: m.rates, collector: m.collector, power: 'Protected supplied power; build local pole distribution.', rules: ['Normal character movement, reach, inventory and interaction timing.', `Build using the supplied finite kit; allowed recipes: ${m.allowedRecipes.join(', ')}.`, 'Request verification after the automatic chain runs. Verification cancels character mutations and uses 600 settling ticks, then five 3600-tick windows.', 'Fresh automatic terminal intake must support every scored production stage. Preloaded stock, disconnected production and character supply do not establish success.', 'Reset starts a separate run from the disarmed initial fixture and retains previous history.'], limits: { gameTicks: m.gameLimitTicks, wallMs: m.wallLimitMs } };
}
export class FirstShiftControl {
  constructor(private port: CommandPort) {}
  private async rpc(request: Record<string, unknown>) {
    const response = record(JSON.parse(await this.port.command(wrapper(request, true))));
    if (response.ok !== true) throw new Error(String(response.error ?? 'Unacknowledged S1 control'));
    return response;
  }
  async setup(scenario: FirstShiftManifest['id'] = '01-first-shift') { return validateFirstShift((await this.rpc({ op: 'scenario', action: 'setup', scenario })).manifest); }
  async inspect() { return validateFirstShift((await this.rpc({ op: 'scenario', action: 'inspect' })).manifest); }
  async measurements(after: number) {
    const raw = await this.rpc({ op: 'scenario-measurements', after });
    const samples = Array.isArray(raw.samples) ? raw.samples : Object.keys(record(raw.samples)).length === 0 ? [] : null;
    if (!samples || !Number.isSafeInteger(raw.tick) || typeof raw.guard !== 'string') throw new Error('Incomplete S1 measurement response');
    return { tick: Number(raw.tick), samples: samples as Measurement[], error: raw.error, guard: raw.guard };
  }
}
/** The caller persists the run origins before starting this adapter and keeps polling while paused. */
export class FirstShiftAttempt {
  readonly engine: VerificationEngine;
  private sequence = -1;
  constructor(readonly id: string, manifest: EvaluationManifest, private scenario: FirstShiftControl, private guard: VerificationControl, sink: (e: unknown) => void) { this.engine = new VerificationEngine(id, manifest, sink); }
  async admit(control: ControlState, now = Date.now()) {
    this.engine.request(control.tick, now);
    try {
      const ack = await this.guard.admit(control, this.id);
      const trace = await this.scenario.measurements(-1);
      const first = trace.samples[0]; if (!first) throw new Error('Missing exact admission sample');
      this.engine.acknowledge(ack, first, Date.now()); this.sequence = first.sequence;
      this.consume(trace, Date.now());
    } catch (error) { this.engine.invalidate('admission_unconfirmed:' + String(error)); throw error; }
  }
  private consume(trace: Awaited<ReturnType<FirstShiftControl['measurements']>>, now: number) {
    if (trace.error || trace.guard !== 'admitted') { this.engine.invalidate('game_measurement_invalid:' + String(trace.error ?? trace.guard)); return; }
    for (const sample of trace.samples) if (sample.sequence > this.sequence) { this.engine.sample(sample, now); this.sequence = sample.sequence; }
    // Capture boundary samples before advancing the clock to the current poll tick.
    this.engine.clock(trace.tick, now);
  }
  async poll(now = Date.now()) {
    try { this.consume(await this.scenario.measurements(this.sequence), now); }
    catch (error) { this.engine.invalidate('measurement_disconnect:' + String(error)); throw error; }
  }
  async repair(control: ControlState) { this.engine.repair(); await this.guard.repair(control, this.id); }
  stop(reason: string) { this.engine.stop(reason); }
}
