import { describe, expect, it, vi } from 'vitest';
import { Budget, PROBE_CAPS } from '../packages/codex/src/budget.js';
import { discover, profileOverrides, checkAllowance } from '../packages/codex/src/preflight.js';
import { cleanEnvironment } from '../packages/codex/src/rpc.js';
import { Provider } from '../packages/codex/src/provider.js';
import { Gateway } from '../packages/tools/src/gateway.js';
import type { Activity, RpcPort } from '../packages/codex/src/protocol.js';
import { trialFailure } from '../apps/runtime/trial-state.js';
class FakeRpc implements RpcPort {
  calls: { method: string; params: unknown }[] = [];
  listeners = new Set<(method: string, params: unknown) => void>();
  replies: Record<string, unknown> = {
    'initialize': {}, 'account/read': { account: { type: 'chatgpt', planType: 'plus' } },
    'getAuthStatus': { authMethod: 'chatgpt' },
    'model/list': { data: [{ model: 'gpt-6-astra', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] }], nextCursor: null },
    'account/rateLimits/read': { ordinaryUsageAllowed: true, rateLimits: { primary: null, secondary: null } },
    'thread/start': { thread: { id: 's1', environments: [] }, model: 'gpt-6-astra', modelProvider: 'openai', reasoningEffort: 'low', runtimeWorkspaceRoots: [], instructionSources: [] },
    'thread/resume': { thread: { id: 's1', environments: [] }, model: 'gpt-6-astra', modelProvider: 'openai', reasoningEffort: 'low', runtimeWorkspaceRoots: [], instructionSources: [] },
    'mcpServerStatus/list': { data: [{ name: 'autofactorio', tools: { observe: {} } }], nextCursor: null },
    'thread/read': { thread: { environments: [] } },
    'turn/start': { turn: { id: 'w1' } }, 'turn/steer': { turnId: 'w1' }, 'turn/interrupt': {},
  };
  async call(method: string, params?: unknown): Promise<unknown> {
    this.calls.push({ method, params }); const value = this.replies[method]; if (value instanceof Error) throw value; return value;
  }
  onEvent(fn: (method: string, params: unknown) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(method: string, params: unknown): void { for (const fn of this.listeners) fn(method, params); }
  close(): void {}
}
function budgetHarness(caps = PROBE_CAPS) {
  let now = 0; const stopped: string[] = [];
  const budget = new Budget(caps, () => now, turn => stopped.push(turn.id));
  return { budget, stopped, advance: (ms: number) => { now += ms; budget.tick(); } };
}
describe('managed provider admission', () => {
  it('retains spent budget and reports a mid-run allowance refusal without a retry or integration-failure claim', async () => {
    const rpc = new FakeRpc(); const { budget } = budgetHarness(); const prior = budget.admit('foreman'); budget.finish(prior.id); budget.usage('foreman-session', 100);
    const p = new Provider('engineer', rpc, budget, () => {}, () => {}, async () => true);
    await p.initialize(); await p.sessionStart('isolated'); await p.catalog(['autofactorio:observe']);
    rpc.replies['account/rateLimits/read'] = { ordinaryUsageAllowed: false, rateLimits: {} };
    let caught: unknown; try { await p.start('continue', () => {}); } catch (e) { caught = e; }
    const outcome = trialFailure(caught); expect(outcome).toMatchObject({ reason: 'provider_allowance_stop', failure: null });
    expect(outcome.providerStop).toContain('exhausted'); budget.closeRun(outcome.reason);
    expect(budget.state.spentTurns).toBe(1); expect(budget.state.reportedTokens).toBe(100);
    expect(rpc.calls.some(c => c.method === 'turn/start')).toBe(false);
    expect(trialFailure(caught, false)).toMatchObject({ reason: 'provider_preflight_failure', providerStop: expect.stringContaining('exhausted'), failure: expect.stringContaining('exhausted') });
    expect(trialFailure(new Error('catalog mismatch')).reason).toBe('integration_failure'); p.close();
  });
  it('passes explicit gameplay instructions while withholding inference on a wrong catalog', async () => {
    const rpc = new FakeRpc(); const { budget } = budgetHarness();
    const p = new Provider('engineer', rpc, budget, () => {}, () => {}, async () => true);
    await p.initialize(); await p.sessionStart('isolated', undefined, 'Real game; scoped tools only.');
    expect(rpc.calls.find(c => c.method === 'thread/start')?.params).toMatchObject({ baseInstructions: 'Real game; scoped tools only.' });
    await expect(p.catalog(['autofactorio:build'])).rejects.toThrow('catalog mismatch');
    await expect(p.start('build', () => {})).rejects.toThrow('isolation');
    expect(budget.state.spentTurns).toBe(0); expect(rpc.calls.some(c => c.method === 'turn/start')).toBe(false); p.close();
  });
  it('retains exact model/effort and unknown usage without inventing allowance', async () => {
    const result = await discover(new FakeRpc()); expect(result.model).toBe('gpt-6-astra'); expect(result.effort).toBe('low'); expect(result.usage).toMatchObject({ primary: null });
    expect(checkAllowance({ rateLimits: {} })).toBeNull();
  });
  it.each(['apiKey', 'amazonBedrock', null])('rejects %s authentication before model work', async type => {
    const rpc = new FakeRpc(); rpc.replies['account/read'] = { account: type ? { type } : null };
    await expect(discover(rpc)).rejects.toThrow('Managed ChatGPT'); expect(rpc.calls.map(c => c.method)).not.toContain('model/list');
  });
  it('rejects external authentication, absent Astra and unsupported effort', async () => {
    const rpc = new FakeRpc(); rpc.replies['getAuthStatus'] = { authMethod: 'chatgptAuthTokens' };
    await expect(discover(rpc)).rejects.toThrow('Externally'); rpc.replies['getAuthStatus'] = { authMethod: 'chatgpt' };
    rpc.replies['model/list'] = { data: [{ model: 'gpt-5.6-sol' }], nextCursor: null };
    await expect(discover(rpc)).rejects.toThrow('Astra unavailable');
    rpc.replies['model/list'] = { data: [{ model: 'gpt-6-astra', supportedReasoningEfforts: [] }], nextCursor: null };
    await expect(discover(rpc)).rejects.toThrow('effort');
  });
  it.each([false, null])('withholds inference when included usage is %s even if credits exist', async allowed => {
    const rpc = new FakeRpc(); rpc.replies['account/rateLimits/read'] = { ordinaryUsageAllowed: allowed, rateLimits: { credits: { hasCredits: true, unlimited: true } } };
    await expect(discover(rpc)).rejects.toThrow(); expect(rpc.calls.some(c => /consume|credits|turn\/start/.test(c.method))).toBe(false);
  });
  it.each([{ primary: { usedPercent: 100 } }, { secondary: { usedPercent: 100 } }, { spendControlReached: true }, { rateLimitReachedType: 'weekly' }])('rejects exhaustion %j', limits => {
    expect(() => checkAllowance({ ordinaryUsageAllowed: true, rateLimits: limits })).toThrow('exhausted');
  });
  it('strips inherited API credentials and pins restrictive launch settings', () => {
    expect(cleanEnvironment({ OPENAI_API_KEY: 'secret', OPENAI_BASE_URL: 'https://custom', PATH: 'path' })).toEqual({ PATH: 'path' });
    expect(profileOverrides(['node_repl'], 'logs')).toMatchObject({ forced_login_method: 'chatgpt', model_provider: 'openai', 'features.multi_agent_v2': false, 'features.shell_tool': false, 'features.apps': false, 'mcp_servers.node_repl.enabled': false });
  });
});
describe('roster budgets without inference', () => {
  it('lets the final admitted turn finish under its other limits', () => {
    const { budget } = budgetHarness({ ...PROBE_CAPS, turns: 1 }); const t = budget.admit('engineer');
    expect(() => budget.admit('foreman')).toThrow('admission'); expect(budget.attempt(t.id)).toBe(true); expect(t.closed).toBe(false);
  });
  it('stops one long turn independently of missing usage', () => {
    const { budget, advance, stopped } = budgetHarness(); const turn = budget.admit('engineer'); advance(60_000);
    expect(stopped).toEqual([turn.id]); expect(budget.attempt(turn.id)).toBe(false); expect(budget.state.reportedTokens).toBe(0); expect(budget.state.usageBySession).toEqual({});
  });
  it('closes both turns atomically and keeps cancellation unconfirmed', () => {
    const denied: boolean[] = [];
    const budget: Budget = new Budget(PROBE_CAPS, () => 0, turn => { denied.push(budget.attempt(turn.id)); });
    const a = budget.admit('foreman'); const b = budget.admit('engineer'); budget.closeRun('account'); budget.closeRun('duplicate');
    expect(denied).toEqual([false, false]); expect(a.cancellation).toBe('unconfirmed'); expect(b.interrupt).toBe('unconfirmed');
    expect(() => budget.admit('replacement')).toThrow('Run closed');
  });
  it.each(['time', 'tokens'])('stops active roster on run %s', kind => {
    const { budget, advance, stopped } = budgetHarness({ ...PROBE_CAPS, turnMs: 400_000 });
    budget.admit('foreman'); budget.admit('engineer');
    if (kind === 'time') advance(300_000); else budget.usage('a', 30_000);
    expect(stopped).toHaveLength(2); expect(budget.state.closed).toBe(true);
  });
  it('deduplicates cumulative usage across resume and counts new sessions', () => {
    const { budget } = budgetHarness(); budget.usage('s1', 100); budget.usage('s1', 100); budget.usage('s1', 90); budget.usage('s1', 120); budget.usage('s2', 50);
    expect(budget.state.reportedTokens).toBe(170);
    const replacement = new Budget(PROBE_CAPS, () => 9999, () => {}, budget.snapshot()); replacement.usage('s1', 130);
    expect(replacement.state.reportedTokens).toBe(180);
  });
  it('retains time/turns on controller replacement and requires reconciliation', () => {
    const { budget, advance } = budgetHarness(); budget.admit('engineer'); advance(200);
    const replacement = new Budget(PROBE_CAPS, () => 0, () => {}, budget.snapshot());
    expect(replacement.state.spentTurns).toBe(1); expect(replacement.state.elapsedMs).toBe(200);
    expect(() => replacement.admit('engineer')).toThrow('reconciliation');
  });
  it('counts rejected tool attempts and enforces a cap inside one turn', async () => {
    const { budget } = budgetHarness({ ...PROBE_CAPS, tools: 2 }); const gateway = new Gateway(budget, () => {});
    const token = gateway.issue('engineer'); const turn = budget.admit('engineer'); gateway.bind(token, turn.id);
    await gateway.call(token, 'handoff', { text: 'forbidden' }); await gateway.call(token, 'observe', { agent_id: 'foreman' });
    expect(turn.closed).toBe(true); expect(turn.attempts).toBe(2);
    await gateway.call(token, 'observe', {}); expect(turn.attempts).toBe(3); expect(budget.state.attempts).toBe(3);
    expect(gateway.messages).toEqual([]);
  });
});
describe('authenticated MCP boundary', () => {
  it.each(['exec_command', 'apply_patch', 'browser', 'connector', 'spawn_agent', 'raw_rcon', 'admin', 'handoff'])('denies engineer bypass %s', async tool => {
    const { budget } = budgetHarness(); const gateway = new Gateway(budget, () => {}); const token = gateway.issue('engineer'); gateway.bind(token, budget.admit('engineer').id);
    const result = await gateway.call(token, tool, {}); expect(result).toMatchObject({ isError: true }); expect(JSON.stringify(gateway.catalog(token))).not.toContain(`"name":"${tool}"`);
  });
  it('authenticates runtime identity and never reopens revoked credentials', async () => {
    const { budget } = budgetHarness(); const gateway = new Gateway(budget, () => {});
    const token = gateway.issue('foreman'); const turn = budget.admit('foreman'); gateway.bind(token, turn.id);
    await expect(gateway.call('fake-token', 'observe', {})).rejects.toThrow('Unauthenticated');
    expect(await gateway.call(token, 'handoff', { text: 'Compute 42', agent_id: 'engineer' })).toMatchObject({ isError: true });
    expect(await gateway.call(token, 'handoff', { text: 'Compute 42' })).toMatchObject({ isError: false });
    budget.finish(turn.id); gateway.revoke(token); const next = budget.admit('foreman');
    expect(() => gateway.bind(token, next.id)).toThrow(); expect(await gateway.call(token, 'handoff', { text: 'late' })).toMatchObject({ isError: true }); expect(gateway.messages).toHaveLength(1);
  });
  it('serves a real authenticated MCP transport and rejects browser origins', async () => {
    const { budget } = budgetHarness(); const gateway = new Gateway(budget, () => {}); const token = gateway.issue('engineer');
    const server = await gateway.listen();
    try {
      expect((await fetch(server.url, { method: 'POST' })).status).toBe(403);
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      expect((await fetch(server.url, { method: 'POST', headers: { ...headers, origin: 'https://evil.invalid' } })).status).toBe(403);
      const response = await fetch(server.url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
      expect(await response.json()).toMatchObject({ id: 1, result: { tools: [{ name: 'observe' }, { name: 'report' }, { name: 'checkpoint' }] } });
    } finally { await server.close(); }
  });
});
describe('correlated public lifecycle', () => {
  async function harness(reconcile = true) {
    const rpc = new FakeRpc(); const events: Activity[] = [];
    const controls: Promise<void>[] = [];
    const budget = new Budget(PROBE_CAPS, () => 0, () => { controls.push(provider.interrupt()); });
    let revoked = false;
    const provider: Provider = new Provider('engineer', rpc, budget, event => events.push(event), () => { revoked = true; }, async () => reconcile);
    await provider.initialize(); await provider.sessionStart('workspace'); await provider.catalog(['autofactorio:observe']); await provider.start('hello', () => {});
    return { rpc, events, provider, budget, controls, revoked: () => revoked };
  }
  it.each(['recovers', 'persistent', 'other-error', 'unsafe-environment'])('keeps tools closed during metadata verification: %s', async mode => {
    const rpc = new FakeRpc(); const events: Activity[] = []; const bind = vi.fn();
    const provider = new Provider('engineer', rpc, budgetHarness().budget, event => events.push(event), () => {}, async () => true);
    await provider.initialize(); await provider.sessionStart('workspace'); await provider.catalog(['autofactorio:observe']);
    const call = rpc.call.bind(rpc); let reads = 0;
    vi.spyOn(rpc, 'call').mockImplementation(async (method, params) => {
      if (method !== 'thread/read') return call(method, params);
      expect(bind).not.toHaveBeenCalled(); reads++;
      if (mode === 'other-error') throw new Error('permission denied');
      if (mode === 'persistent' || reads === 1) throw new Error('failed to read session metadata: rollout file is empty');
      return { thread: { environments: mode === 'unsafe-environment' ? ['local'] : [] } };
    });
    if (mode === 'recovers') {
      await provider.start('hello', bind); expect(bind).toHaveBeenCalledOnce(); expect(reads).toBe(2);
      expect(events.some(event => event.kind === 'turn/environmentVerified')).toBe(true);
    } else {
      await expect(provider.start('hello', bind)).rejects.toThrow(); expect(bind).not.toHaveBeenCalled();
      expect(provider.turn?.closed).toBe(true); expect(reads).toBe(mode === 'persistent' ? 21 : mode === 'other-error' ? 1 : 2);
    }
    expect(rpc.calls.filter(call => call.method === 'turn/start')).toHaveLength(1);
  });
  it('correlates start/steer/interrupt and requires a terminal interruption event', async () => {
    const h = await harness(); await h.provider.steer('change'); h.budget.closeRun('stop'); await Promise.all(h.controls);
    expect(await h.provider.interruptStatus()).toMatchObject({schema:1,outcome:'cancelled',failures:[]});expect(h.provider.turn!.interrupt).toBe('unconfirmed'); expect(h.revoked()).toBe(true);
    h.rpc.emit('turn/completed', { threadId: 's1', turn: { id: 'w1', status: 'interrupted' } });
    expect(h.provider.turn!.interrupt).toBe('confirmed'); expect(h.events.find(e => e.kind === 'steer/acknowledged')).toMatchObject({ role: 'engineer', session: 's1', turn: 'turn-1' });
    await expect(h.provider.start('retry', () => {})).rejects.toThrow('New transport');
  });
  it('fences a turn cancelled before provider admission',async()=>{const rpc=new FakeRpc(),provider=new Provider('engineer',rpc,budgetHarness().budget,()=>{},()=>{},async()=>false);await provider.initialize();await provider.sessionStart('workspace');await provider.catalog(['autofactorio:observe']);expect(await provider.interruptStatus()).toMatchObject({schema:1,outcome:'cancelled',failures:[]});await expect(provider.start('must not start',()=>{})).rejects.toThrow('cancelled before admission');expect(rpc.calls.filter(call=>call.method==='turn/start')).toHaveLength(0);});
  it('returns one consistent confirmed receipt when reconciliation supersedes an interrupt RPC failure',async()=>{const h=await harness(true);h.rpc.replies['turn/interrupt']=new Error('lost acknowledgement');h.budget.closeRun('stop');await Promise.all(h.controls);expect(await h.provider.interruptStatus()).toMatchObject({schema:1,outcome:'cancelled',failures:[]});});
  it('retains late output, rejects late tools and exposes unconfirmed controls', async () => {
    const h = await harness(false); h.rpc.replies['turn/interrupt'] = new Error('timeout'); h.budget.closeRun('stop'); await Promise.all(h.controls);
    h.rpc.emit('item/agentMessage/delta', { threadId: 's1', turnId: 'w1', delta: 'late action' });
    expect(h.events.at(-1)).toMatchObject({ late: true, data: { delta: 'late action' } }); expect(h.budget.attempt('turn-1')).toBe(false);
    expect(await h.provider.interruptStatus()).toMatchObject({schema:1,outcome:'unknown',failures:[expect.stringContaining('provider_interrupt:'),expect.stringContaining('provider_reconciliation:unconfirmed')]});expect(h.provider.turn!.cancellation).toBe('unconfirmed'); expect(h.provider.turn!.interrupt).toBe('unconfirmed');
  });
  it('resumes the same history using a replacement transport with spent budget intact', async () => {
    const h = await harness(); h.rpc.emit('turn/completed', { threadId: 's1', turn: { id: 'w1', status: 'completed' } }); h.provider.close();
    const rpc = new FakeRpc(); const replacement = new Provider('engineer', rpc, h.budget, event => h.events.push(event), () => {}, async () => true);
    await replacement.initialize(); await replacement.sessionStart('other-workspace', 's1'); await replacement.catalog(['autofactorio:observe']); await replacement.start('resume', () => {});
    expect(h.budget.state.spentTurns).toBe(2); expect(replacement.session).toBe('s1'); expect(h.events.some(e => e.kind === 'session/resumed')).toBe(true);
  });
  it.each(['localEnvironment', 'wrongModel', 'instructions'])('blocks unverified session %s', async failure => {
    const rpc = new FakeRpc(); const response = rpc.replies['thread/start'] as Record<string, unknown>;
    if (failure === 'localEnvironment') response.runtimeWorkspaceRoots = ['C:/'];
    if (failure === 'wrongModel') response.model = 'other';
    if (failure === 'instructions') response.instructionSources = ['AGENTS.md'];
    const provider = new Provider('engineer', rpc, budgetHarness().budget, () => {}, () => {}, async () => true);
    await expect(provider.sessionStart('workspace')).rejects.toThrow(); await expect(provider.start('unsafe', () => {})).rejects.toThrow('isolation'); expect(rpc.calls.some(c => c.method === 'turn/start')).toBe(false);
  });
  it.each(['model/rerouted', 'account/updated', 'error'])('closes admission on %s', async kind => {
    const h = await harness(); h.rpc.emit(kind, { threadId: 's1', toModel: 'other', authMode: 'apikey', error: { codexErrorInfo: 'usageLimitExceeded' } });
    expect(h.budget.state.closed).toBe(true); await Promise.all(h.controls);
  });
  it('deduplicates real usage notifications and omits private/raw reasoning', async () => {
    const h = await harness(); const data = { threadId: 's1', turnId: 'w1', tokenUsage: { total: { totalTokens: 50 } } };
    h.rpc.emit('thread/tokenUsage/updated', data); h.rpc.emit('thread/tokenUsage/updated', data);
    h.rpc.emit('item/completed', { threadId: 's1', item: { id: 'reason', type: 'reasoning', summary: ['public'], content: 'private' } });
    h.rpc.emit('rawResponseItem/completed', { text: 'private' });
    expect(h.budget.state.reportedTokens).toBe(50); expect(JSON.stringify(h.events)).not.toContain('private'); expect(JSON.stringify(h.events)).toContain('public');
  });
});
