import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { appendFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Budget, PROBE_CAPS } from '../packages/codex/src/budget.js';
import { AppServerRpc } from '../packages/codex/src/rpc.js';
import { Provider } from '../packages/codex/src/provider.js';
import { profileOverrides } from '../packages/codex/src/preflight.js';
import { object } from '../packages/codex/src/protocol.js';
import type { Activity, Sink } from '../packages/codex/src/protocol.js';
import { Gateway } from '../packages/tools/src/gateway.js';
import type { Role } from '../packages/tools/src/gateway.js';

const executable = process.argv[process.argv.indexOf('--codex') + 1];
if (!process.argv.includes('--codex') || !executable || !path.isAbsolute(executable)) throw new Error('Usage: provider-probe --codex <absolute pinned executable> [--live]');
const live = process.argv.includes('--live');
function capArgument(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag); if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid declared cap: ' + flag);
  return value;
}
const caps = { ...PROBE_CAPS, turns: capArgument('--turn-cap', PROBE_CAPS.turns), tokens: capArgument('--token-cap', PROBE_CAPS.tokens!) };
const base = path.resolve('.runtime/phase02'); await mkdir(base, { recursive: true });
const evidence = await mkdtemp(path.join(base, 'probe-'));
const events: Activity[] = [];
const sink: Sink = event => { events.push(event); const line = JSON.stringify(event); appendFileSync(path.join(evidence, 'events.jsonl'), line + '\n'); console.log(line); };
const providers = new Map<string, Provider>();
const allProviders: Provider[] = [];
const controls: Promise<void>[] = [];

const budget = new Budget(caps, () => performance.now(), turn => {
  gateway.revokeTurn(turn.id);
  sink({ at: new Date().toISOString(), role: turn.role, session: providers.get(turn.role)?.session ?? null, turn: turn.id, kind: 'budget/closed', data: { reason: turn.reason, interrupt: turn.interrupt, cancellation: turn.cancellation }, late: false });
  const provider = providers.get(turn.role); if (provider) controls.push(provider.interrupt());
});
const gateway = new Gateway(budget, sink);
const server = await gateway.listen();
const timer = setInterval(() => budget.tick(), 100);
const bootstrap = new AppServerRpc(executable, evidence, { forced_login_method: 'chatgpt', model_provider: 'openai', 'features.apps': false, 'features.plugins': false });
let failure: string | null = null;
const sessions: Partial<Record<Role, string>> = {};
const histories: Partial<Record<Role, unknown>> = {};
async function waitFor(predicate: () => boolean, timeout = 65_000): Promise<void> {
  const deadline = performance.now() + timeout;
  while (!predicate()) {
    if (performance.now() > deadline || budget.state.closed) throw new Error(`Probe wait failed; ${budget.state.reason ?? 'timeout'}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
try {
  await bootstrap.call('initialize', { clientInfo: { name: 'autofactorio_catalog', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  const config = object(object(await bootstrap.call('config/read', { cwd: evidence })).config);
  const mcpNames = Object.keys(object(config.mcp_servers ?? {}));
  bootstrap.close();
  console.log(JSON.stringify({ mode: live ? 'live' : 'no-inference', caps, evidence }));
  async function prepare(role: Role, resume = false): Promise<{ provider: Provider; token: string; rpc: AppServerRpc }> {
    const cwd = path.join(evidence, `${role}-${allProviders.length}`); await mkdir(cwd);
    const token = gateway.issue(role);
    const overrides = profileOverrides(mcpNames, path.join(cwd, 'logs'));
    // Token stays in process-local config and never enters agent arguments or evidence.
    overrides['mcp_servers.autofactorio.url'] = server.url;
    overrides['mcp_servers.autofactorio.http_headers.Authorization'] = `Bearer ${token}`;
    overrides['mcp_servers.autofactorio.enabled'] = true;
    overrides['mcp_servers.autofactorio.default_tools_approval_mode'] = 'approve';
    const rpc = new AppServerRpc(executable!, cwd, overrides);
    const provider = new Provider(role, rpc, budget, sink, () => gateway.revoke(token), async () => { gateway.revoke(token); return true; });
    allProviders.push(provider); providers.set(role, provider);
    await provider.initialize();
    const effective = object(object(await rpc.call('config/read', { cwd })).config);
    if (object(object(effective.mcp_servers).autofactorio).default_tools_approval_mode !== 'approve') throw new Error('Synthetic MCP approval policy not effective');
    for (const [key, expected] of Object.entries(overrides)) {
      if (key.startsWith('features.')) {
        if (object(effective.features)[key.slice(9)] !== expected) throw new Error(`Ineffective role feature ${key}`);
      }
    }
    sink({ at: new Date().toISOString(), role, session: null, turn: null, kind: 'tools/effectiveConfig', data: { features: Object.fromEntries(Object.keys(overrides).filter(k => k.startsWith('features.')).map(k => [k, overrides[k]])), disabledInheritedMcp: mcpNames }, late: false });
    await provider.sessionStart(cwd, resume ? sessions[role] : undefined);
    sessions[role] = provider.session!;
    await provider.catalog((role === 'foreman' ? ['observe', 'handoff'] : ['observe', 'report', 'checkpoint']).map(name => `autofactorio:${name}`));
    return { provider, token, rpc };
  }
  const foreman = await prepare('foreman');
  const engineer = await prepare('engineer');
  if (sessions.foreman === sessions.engineer) throw new Error('Role histories share an identity');
  if (live) {
    // Four planned turns; six remains a hard ceiling, never an automatic retry allowance.
    const starts = await Promise.allSettled([
      foreman.provider.start('Private foreman marker: FOREMAN_PRIVATE_27. Call handoff with text "Compute 20 + 22 and report the result." Then explain the handoff in one sentence. Do not include the private marker in tools.', id => gateway.bind(foreman.token, id)),
      engineer.provider.start('Private engineer marker: ENGINEER_PRIVATE_53. Call checkpoint now so the operator can test steering and interruption. Do not finish before that call. Do not include the private marker in tools.', id => gateway.bind(engineer.token, id)),
    ]);
    const rejected = starts.find(result => result.status === 'rejected');
    if (rejected?.status === 'rejected') throw rejected.reason;
    await waitFor(() => {
      if (engineer.provider.turn!.finished) throw new Error('Engineer completed without reaching checkpoint');
      return gateway.attempts.some(a => a.role === 'engineer' && a.tool === 'checkpoint' && a.allowed);
    });
    for (const [name, args] of [['handoff', { text: 'forbidden engineer assignment' }], ['observe', { agent_id: 'foreman' }]] as const) {
      const response = await fetch(server.url, { method: 'POST', headers: { authorization: "Bearer " + engineer.token, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: name, method: 'tools/call', params: { name, arguments: args } }) });
      const body = object(await response.json());
      if (object(body.result).isError !== true) throw new Error('Live gateway bypass accepted');
    }
    await engineer.provider.steer('After resumption, observe the foreman handoff and report the arithmetic result. This message tests acknowledged steering.');
    budget.closeTurn(engineer.provider.turn!, 'probe_interrupt');
    await waitFor(() => engineer.provider.turn!.finished && engineer.provider.turn!.interrupt === 'confirmed');
    await waitFor(() => foreman.provider.turn!.finished);
    if (!gateway.messages.some(m => m.from === 'foreman')) throw new Error('Missing synthetic handoff');
    foreman.provider.close(); engineer.provider.close();
    const resumed = await prepare('engineer', true);
    await resumed.provider.start('Resume the synthetic task: observe your messages, compute the requested sum, report the answer with report, then finish in one sentence.', id => gateway.bind(resumed.token, id));
    await waitFor(() => resumed.provider.turn!.finished);
    if (!gateway.messages.some(m => m.from === 'engineer' && /42/.test(m.text))) throw new Error('Engineer report missing');
    const final = await prepare('foreman', true);
    await final.provider.start('Observe the engineer report and acknowledge completion in one sentence.', id => gateway.bind(final.token, id));
    await waitFor(() => final.provider.turn!.finished);
    for (const [role, session] of Object.entries(sessions)) {
      const active = role === 'foreman' ? final : resumed;
      histories[role as Role] = await active.rpc.call('thread/read', { threadId: session, includeTurns: true });
    }
    if (!JSON.stringify(histories.foreman).includes('FOREMAN_PRIVATE_27') || !JSON.stringify(histories.engineer).includes('ENGINEER_PRIVATE_53')) throw new Error('Resumed original history missing');
    if (JSON.stringify(histories.foreman).includes('ENGINEER_PRIVATE_53') || JSON.stringify(histories.engineer).includes('FOREMAN_PRIVATE_27')) throw new Error('Private role history leaked');
  }
} catch (error) { failure = String(error); console.error(failure); process.exitCode = 1; }
finally {
  if (failure) budget.closeRun('probe_failed');
  await Promise.allSettled(controls);
  for (const provider of allProviders) provider.close();
  bootstrap.close(); clearInterval(timer); await server.close();
  await writeFile(path.join(evidence, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n');
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ live, caps, failure, sessions, budget: budget.snapshot(), messages: gateway.messages, attempts: gateway.attempts, histories }, null, 2));
  console.log(JSON.stringify({ evidence, failure, spentTurns: budget.state.spentTurns }));
}
