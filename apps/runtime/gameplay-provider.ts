import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { AppServerRpc } from '../../packages/codex/src/rpc.js';
import { Provider } from '../../packages/codex/src/provider.js';
import { profileOverrides } from '../../packages/codex/src/preflight.js';
import { object } from '../../packages/codex/src/protocol.js';
import type { Sink } from '../../packages/codex/src/protocol.js';
import type { Coordinator } from '../../packages/core/orchestration/coordinator.js';
import { CoordinationMcp, toolCatalog } from '../../packages/tools/src/coordination-mcp.js';
import { ContextAccounting, SessionLifecycle } from '../../packages/core/context/lifecycle.js';

export const gameplayInstructions = 'You control a real Factorio character through only the supplied gameplay MCP tools. Use scenario for the public briefing and observe for durable work. Use metrics for scoped rates/stock/target demand and inspect for actor, compact command or selected machine symptoms before requesting bulk world/history detail. Treat partial/unknown coverage as uncertainty, not zero, and do not infer evaluator success from operational health. Explain material decisions briefly. Do not assume completion: read command receipts and fresh world state. No filesystem, shell, images or external tools are available. Use deterministic batches, not one turn per placement or polling. The foreman must propose tasks and hand them to the engineer; the engineer designs and builds. End your turn while a submitted batch executes; the controller wakes you on meaningful changes. On a fresh replacement call replacement before changing the world. Interpret any operator hint explicitly using interpret. Only foreman requests verify when the automated chain is ready. A failed command is evidence to diagnose, not permission to retry unknown effects.';

/** Transport replacement retains the controller budget and isolated role history. */
export class GameplayProvider {
  readonly sessions = new Map<string, string>();
  readonly active = new Map<string, Provider>();
  private generation = 0;
  private readonly accounting?: ContextAccounting;
  private readonly lifecycle?: SessionLifecycle;
  constructor(private executable: string, private directory: string, private c: Coordinator,
    private mcp: CoordinationMcp, private url: string, private inheritedMcp: string[], private sink: Sink) {
    if (c.runtime?.journal) { this.accounting = new ContextAccounting(c.runtime); this.lifecycle = new SessionLifecycle(c.runtime, this.accounting); }
  }
  static async inherited(executable: string, directory: string) {
    const rpc = new AppServerRpc(executable, directory, { forced_login_method: 'chatgpt', model_provider: 'openai', 'features.apps': false, 'features.plugins': false });
    try {
      await rpc.call('initialize', { clientInfo: { name: 'autofactorio_preflight', version: '0.1.0' }, capabilities: { experimentalApi: true } });
      const config = object(object(await rpc.call('config/read', { cwd: directory })).config);
      return Object.keys(object(config.mcp_servers ?? {}));
    } finally { rpc.close(); }
  }
  async prepare(role: string, fresh = false) {
    const priorSession = this.sessions.get(role);
    if (!fresh && priorSession && this.lifecycle) {
      const admittedTurns = this.c.agent(role).lineage.filter(value => value.session === priorSession).length;
      const policy = this.lifecycle.due(role, priorSession, admittedTurns);
      if (policy.due) {
        const activeWork = this.c.runtime.execution.pending().some(command => {
          const task = this.c.tasks().find(value => value.id === command.batch.task);
          return task?.owner === role && !['completed', 'failed', 'partial', 'cancelled'].includes(command.receipt?.status ?? '');
        });
        if (activeWork) { if (this.lifecycle.get(role)?.state !== 'deferred-active-work') this.lifecycle.request(role, priorSession, true); throw new Error('Context rotation waiting for a safe deterministic-work boundary'); }
        fresh = true;
      }
    }
    const cwd = path.join(this.directory, 'provider-' + role + '-' + ++this.generation); await mkdir(cwd);
    const token = this.mcp.issue(role);
    const overrides = profileOverrides(this.inheritedMcp, path.join(cwd, 'logs'));
    Object.assign(overrides, { 'mcp_servers.autofactorio.url': this.url, 'mcp_servers.autofactorio.http_headers.Authorization': `Bearer ${token}`,
      'mcp_servers.autofactorio.enabled': true, 'mcp_servers.autofactorio.default_tools_approval_mode': 'approve' });
    const rpc = new AppServerRpc(this.executable, cwd, overrides);
    const provider = new Provider(role, rpc, this.c.budget, event => {
      this.sink(event);
      const value = event as unknown as { session?: string | null; turn?: string | null };
      if (value.session) this.accounting?.record(role, value.session, value.turn ?? null, 'provider-output', event);
    }, () => this.mcp.revoke(token), async () => {
      // The operator owns reconciliation. A delayed provider interrupt response
      // must not start a competing pump while pause/stop is recovering execution.
      return !this.c.runtime.ownership.list().some(r => r.owner === role && r.state !== 'released');
    });
    this.active.set(role, provider);
    try {
      await provider.initialize();
      const effective = object(object(await rpc.call('config/read', { cwd })).config);
      if (object(object(effective.mcp_servers).autofactorio).default_tools_approval_mode !== 'approve') throw new Error('Gameplay MCP approval policy not effective');
      for (const [key, expected] of Object.entries(overrides)) if (key.startsWith('features.') && object(effective.features)[key.slice(9)] !== expected) throw new Error('Ineffective isolation: ' + key);
      const instructions = gameplayInstructions + '\n' + this.c.agent(role).definition.instructions;
      await provider.sessionStart(cwd, fresh ? undefined : this.sessions.get(role), instructions);
      const catalog = toolCatalog(this.c, role); await provider.catalog(catalog.map(t => 'autofactorio:' + t.name));
      this.accounting?.record(role, provider.session!, null, 'catalog', catalog);
      const previous = this.sessions.get(role);
      if (fresh && previous === provider.session) throw new Error('Replacement reused old context');
      if (fresh) this.lifecycle?.begin(role, previous ?? null, provider.session!);
      return { provider, start: (input: string, onBound: (() => void) = () => {}) => {
        if (fresh && previous) input = 'This is a fresh role session. Read observe, then call replacement for the current task before any mutation; reconcile uncertain effects and preserve existing budgets and command IDs.\n' + input;
        this.accounting?.record(role, provider.session!, null, 'prompt', { instructions, input });
        return provider.start(input, turn => {
        // Codex does not persist an empty thread. Catalog-only preflight must never
        // make that disposable thread the next transport's resume target.
        this.sessions.set(role, provider.session!);
        onBound();
          this.mcp.bind(token, this.c.bind(role, provider.session!, turn, () => provider.interrupt()));
        });
      }, close: () => { provider.close(); this.active.delete(role); } };
    } catch (error) { provider.close(); this.active.delete(role); throw error; }
  }
  close() { for (const p of this.active.values()) p.close(); this.active.clear(); }
}
