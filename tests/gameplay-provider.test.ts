import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Coordinator } from '../packages/core/orchestration/coordinator.js';
import type { CoordinationMcp } from '../packages/tools/src/coordination-mcp.js';

const state = vi.hoisted(() => ({ next: 0, persisted: new Set<string>(), reconcile: null as null | (() => Promise<boolean>) }));
vi.mock('../packages/codex/src/rpc.js', () => ({ AppServerRpc: class {
  constructor(_exe: string, _cwd: string, private overrides: Record<string, unknown>) {}
  async call() {
    return { config: { features: Object.fromEntries(Object.entries(this.overrides).filter(([k]) => k.startsWith('features.')).map(([k, v]) => [k.slice(9), v])),
      mcp_servers: { autofactorio: { default_tools_approval_mode: 'approve' } } } };
  }
} }));
vi.mock('../packages/codex/src/provider.js', () => ({ Provider: class {
  session: string | null = null;
  constructor(...args: unknown[]) { state.reconcile = args[5] as () => Promise<boolean>; }
  async initialize() {}
  async catalog() {}
  async sessionStart(_cwd: string, resume?: string) {
    if (resume && !state.persisted.has(resume)) throw new Error('no rollout found');
    this.session = resume ?? 'session-' + ++state.next;
  }
  async start(_input: string, bind: (turn: string) => void) {
    state.persisted.add(this.session!); bind('turn-' + this.session);
  }
  close() {}
} }));
const { GameplayProvider } = await import('../apps/runtime/gameplay-provider.js');

it('discards empty preflight threads, resumes admitted history, and replaces only the requested role', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'af-gameplay-provider-'));
  const c = { agent: () => ({ definition: { instructions: '', tools: [] } }), bind: vi.fn(() => ({})), budget: {} } as unknown as Coordinator;
  const mcp = { issue: () => 'token', bind: vi.fn(), revoke: vi.fn() } as unknown as CoordinationMcp;
  const host = new GameplayProvider('unused', directory, c, mcp, 'http://127.0.0.1/mcp', [], () => {});
  try {
    const preflight = await host.prepare('engineer'); preflight.close();
    expect(host.sessions.has('engineer')).toBe(false);
    const first = await host.prepare('engineer'); await first.start('work'); first.close();
    const continued = await host.prepare('engineer');
    expect(continued.provider.session).toBe(first.provider.session); continued.close();
    const foreman = await host.prepare('foreman'); await foreman.start('plan'); foreman.close();
    const replaced = await host.prepare('engineer', true);
    expect(replaced.provider.session).not.toBe(first.provider.session);
    expect(host.sessions.get('engineer')).toBe(first.provider.session);
    await replaced.start('reconstruct'); replaced.close();
    expect(host.sessions.get('engineer')).toBe(replaced.provider.session);
    expect(host.sessions.get('foreman')).toBe(foreman.provider.session);
  } finally { host.close(); await rm(directory, { recursive: true, force: true }); }
});

it('late provider cancellation only observes ownership while operator recovery owns execution', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'af-gameplay-cancellation-'));
  let released = false;
  const pump = vi.fn(async () => { throw new Error('Execution operation in progress'); });
  const c = { agent: () => ({ definition: { instructions: '', tools: [] } }), budget: {}, pump,
    runtime: { ownership: { list: () => [{ owner: 'engineer', state: released ? 'released' : 'revoking' }] } } } as unknown as Coordinator;
  const mcp = { issue: () => 'token', revoke: vi.fn() } as unknown as CoordinationMcp;
  const host = new GameplayProvider('unused', directory, c, mcp, 'http://127.0.0.1/mcp', [], () => {});
  try {
    const prepared = await host.prepare('engineer');
    let resolveInterrupt!: () => void;
    const reply = new Promise<void>(resolve => { resolveInterrupt = resolve; });
    const cancelled = reply.then(() => state.reconcile!());
    // The operator has entered recovery before the provider RPC responds.
    resolveInterrupt(); expect(await cancelled).toBe(false); expect(pump).not.toHaveBeenCalled();
    released = true; expect(await state.reconcile!()).toBe(true); prepared.close();
  } finally { host.close(); await rm(directory, { recursive: true, force: true }); }
});
