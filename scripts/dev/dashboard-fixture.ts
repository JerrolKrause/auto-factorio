import { DurableRuntime } from '../../apps/runtime/durable-runtime.js';
import { Coordinator } from '../../packages/core/orchestration/coordinator.js';
import { Operator } from '../../apps/runtime/operator.js';
import { GameClient } from '../../packages/factorio/src/client.js';
import { Lifecycle } from '../../packages/factorio/src/lifecycle.js';
import type { ControlState } from '../../packages/factorio/src/lifecycle.js';
import { PROBE_CAPS } from '../../packages/codex/src/budget.js';
import { team } from '../../packages/core/orchestration/roles.js';
/** Explicit synthetic game, for repeatable UI/failure checks; never reported as live game evidence. */
export async function dashboardFixture(directory: string, seed = false) {
  const state: ControlState = { ok: true, epoch: 'fixture', session: 'fixture', revision: 1, generation: 1, armed: false, ready: false, paused: true, neutral: true, ticksToRun: 0, tick: 100, ticksPlayed: 100, experimentTick: 100, scenarioElapsed: 100, injections: 0, checkpoint: false, ledger: {}, intents: {}, production: { 'automation-science-pack': 12 }, mods: {} };
  let disconnected = false; let now = 0;
  const port = { command: async () => { throw new Error('Unexpected fixture RPC'); }, close() {} };
  const game = new GameClient(port, () => {}); const life = new Lifecycle(port, game, () => {});
  life.inspect = async () => { if (disconnected) throw new Error('Game disconnected'); if (!state.paused) state.tick++; return structuredClone(state); };
  life.pause = async () => { if (disconnected) throw new Error('Game disconnected'); state.armed = false; state.paused = true; for (const r of Object.values(state.ledger)) if (['running', 'accepted'].includes(r.status)) { r.status = 'cancelled'; r.endedTick = state.tick; } return structuredClone(state); };
  life.reconcile = async () => { state.epoch += '-next'; return structuredClone(state); };
  life.arm = async () => { state.armed = true; state.paused = false; return structuredClone(state); };
  life.heartbeat = life.inspect;
  life.edits = async () => ({ events: [], overflow: false, coverage: 'synthetic fixture' });
  life.ownership = async request => {
    if (disconnected) throw new Error('Game disconnected');
    if (request.session !== state.session || request.epoch !== state.epoch) throw new Error('Stale game identity');
    return { request, tick: state.tick, receipts: [] };
  };
  const runtime = new DurableRuntime(directory, 'dashboard-fixture', state.epoch, game, life);
  const c = new Coordinator(runtime, { ...PROBE_CAPS, turns: 40, tools: 100, runMs: 3600000 }, () => now);
  if (!c.agents().length) team().forEach(a => c.register(a));
  const operator = new Operator(c); await operator.control('resume');
  if (seed && !c.tasks().length) {
    const common = { parent: null, scope: {}, resources: {}, successCriteria: ['Evidence recorded'], deadline: null, committedPlan: 'Inspect supplied materials and plan the production chain.', actor: null, reservations: [], criteria: [{ kind: 'message-delivered' as const, id: 'report' }] };
    c.propose('foreman', { ...common, id: 'survey', goal: 'Survey the starting construction kit', dependencies: [] });
    c.send('foreman', { id: 'assignment', recipient: 'engineer', task: 'survey', revision: 1, intent: 'handoff', content: 'Inspect supplies and report the layout constraints.', evidence: [] });
    c.propose('foreman', { ...common, id: 'science', goal: 'Plan a steady red science supply', dependencies: ['survey'] });
    c.activity('foreman', 'explanation', { text: 'Inspect the available construction kit before committing materials to a layout.', synthetic: true });
    c.activity('engineer', 'tool-result', { tool: 'observe', result: { supplies: 'Available in fixture', synthetic: true } });
  }
  await operator.poll();
  return { runtime, c, operator, state, life, game, disconnect(v = true) { disconnected = v; }, advance(ms: number) { now += ms; }, close() { runtime.close(); } };
}
