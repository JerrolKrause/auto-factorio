import { setTimeout as delay } from 'node:timers/promises';
import { ASTRA, object, string } from './protocol.js';
import type { RpcPort, Sink } from './protocol.js';
import { checkAllowance, discover } from './preflight.js';
import type { Budget, TurnBudget } from './budget.js';

/** One transport/credential generation per turn. Resume uses a replacement instance. */
export class Provider {
  session: string | null = null;
  wireTurn: string | null = null;
  turn: TurnBudget | null = null;
  private used = false;
  private sessionVerified = false;
  private catalogVerified = false;
  private readonly unsubscribe;
  constructor(readonly role: string, private readonly rpc: RpcPort, private readonly budget: Budget, private readonly sink: Sink,
    private readonly revoke: () => void, private readonly reconcile: () => Promise<boolean>) {
    this.unsubscribe = rpc.onEvent((method, params) => this.event(method, params));
  }
  private emit(kind: string, data: unknown, late = this.turn?.closed === true || this.turn?.finished === true): void {
    this.sink({ at: new Date().toISOString(), role: this.role, session: this.session, turn: this.turn?.id ?? null,
      kind, data, late });
  }
  async initialize(): Promise<void> {
    await this.rpc.call('initialize', { clientInfo: { name: 'autofactorio', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.emit('provider/ready', await discover(this.rpc));
  }
  async sessionStart(cwd: string, resumeId?: string, instructions?: string): Promise<void> {
    if (this.session) throw new Error('Session already selected');
    const common = { cwd, model: ASTRA, modelProvider: 'openai', approvalPolicy: 'never', sandbox: 'read-only',
      baseInstructions: instructions ?? `You are AutoFactorio's synthetic ${this.role}. Use only the supplied gameplay MCP tools. Explain decisions briefly. No real game is connected.`,
      developerInstructions: `Identity is assigned by the runtime. Never submit identity arguments. Role: ${this.role}.` };
    const response = object(await this.rpc.call(resumeId ? 'thread/resume' : 'thread/start', resumeId ? { ...common, threadId: resumeId } : { ...common, environments: [] }));
    this.session = string(object(response.thread).id);
    const environments = object(response.thread).environments;
    if (!resumeId && (!Array.isArray(environments) || environments.length !== 0)) throw new Error('Gameplay environment selection unverified');
    if (resumeId && this.session !== resumeId) throw new Error('Resume session mismatch');
    if (response.model !== ASTRA || response.modelProvider !== 'openai' || response.reasoningEffort !== 'low') throw new Error('Actual model/provider/effort mismatch');
    if (!resumeId && (!Array.isArray(response.runtimeWorkspaceRoots) || response.runtimeWorkspaceRoots.length !== 0)) throw new Error('Gameplay local environment is still enabled');
    if (!Array.isArray(response.instructionSources) || response.instructionSources.length !== 0) throw new Error('Unscoped instruction source loaded');
    this.sessionVerified = true;
    this.emit(resumeId ? 'session/resumed' : 'session/started', { id: this.session, model: response.model, effort: response.reasoningEffort, workspaceRoots: response.runtimeWorkspaceRoots, instructionSources: response.instructionSources });
  }
  async catalog(expected: string[]): Promise<void> {
    const result = object(await this.rpc.call('mcpServerStatus/list', { threadId: this.session, detail: 'full' }));
    if (!Array.isArray(result.data) || result.nextCursor) throw new Error('Incomplete effective MCP catalog');
    const servers = result.data.map(object);
    const actual = servers.flatMap(server => Object.keys(object(server.tools ?? {})).map(tool => `${String(server.name)}:${tool}`));
    if (actual.slice().sort().join('|') !== expected.slice().sort().join('|')) throw new Error(`Effective MCP catalog mismatch: ${actual.join(',')}`);
    this.catalogVerified = true;
    this.emit('tools/catalog', { actual, nativeControls: 'No local environments; pinned feature restrictions required' });
  }
  async start(input: string, bind: (id: string) => void): Promise<void> {
    if (!this.session || this.used) throw new Error('New transport/credential required for each provider turn');
    if (!this.sessionVerified || !this.catalogVerified) throw new Error('Session/catalog isolation has not passed');
    await discover(this.rpc); // Check managed auth and included allowance again at admission.
    this.used = true; this.turn = this.budget.admit(this.role);
    this.emit('turn/submitted', { input });
    try {
      const result = object(await this.rpc.call('turn/start', { threadId: this.session, input: [{ type: 'text', text: input, text_elements: [] }], environments: [], model: ASTRA, effort: 'low' }));
      this.wireTurn = string(object(result.turn).id);
      const actual = await this.turnEnvironments();
      if (!Array.isArray(actual) || actual.length !== 0) throw new Error('Turn environment isolation unverified');
      this.emit('turn/environmentVerified', { environments: actual });
      if (!this.turn.closed && !this.turn.finished) bind(this.turn.id);
      if (this.turn.closed) await this.interrupt();
    } catch (error) { this.budget.closeTurn(this.turn, 'start_unconfirmed'); this.emit('turn/startUnconfirmed', { error: String(error) }); throw error; }
  }
  private async turnEnvironments(): Promise<unknown> {
    // The pinned server can acknowledge turn/start before its rollout metadata is readable.
    // Retry only this read, never the accepted turn, with tools still unbound.
    for (let attempt = 0; ; attempt++) {
      try {
        return object(object(await this.rpc.call('thread/read', { threadId: this.session, includeTurns: false })).thread).environments;
      } catch (error) {
        if (attempt >= 20 || this.turn?.closed || !/failed to read session metadata.*rollout.*is empty/.test(String(error))) throw error;
        this.emit('turn/environmentReadPending', { attempt: attempt + 1 });
        await delay(100);
      }
    }
  }
  async steer(text: string): Promise<void> {
    if (!this.session || !this.wireTurn || !this.turn || this.turn.closed || this.turn.finished) throw new Error('No steerable turn');
    this.emit('steer/submitted', { text });
    try { this.emit('steer/acknowledged', await this.rpc.call('turn/steer', { threadId: this.session, expectedTurnId: this.wireTurn, input: [{ type: 'text', text, text_elements: [] }] })); }
    catch (error) { this.emit('steer/unconfirmed', { error: String(error) }); throw error; }
  }
  async interrupt(): Promise<void> {
    this.revoke();
    if (!this.turn) return;
    if (!this.turn.closed && !this.turn.finished) { this.budget.closeTurn(this.turn, 'operator_interrupt'); return; }
    if (this.wireTurn && this.session && !this.turn.finished) {
      try { await this.rpc.call('turn/interrupt', { threadId: this.session, turnId: this.wireTurn }); this.emit('interrupt/acknowledged', { confirmedCompletion: false }); }
      catch (error) { this.emit('interrupt/unconfirmed', { error: String(error) }); }
    }
    // Callback is synthetic cancellation now; a real game must supply acknowledged reconciliation later.
    try { if (await this.reconcile()) this.budget.confirmCancellation(this.turn.id); }
    catch { /* Retain unconfirmed cancellation. */ }
    this.emit('cancellation/status', { status: this.turn.cancellation });
  }
  private event(method: string, value: unknown): void {
    const late = this.turn?.closed === true || this.turn?.finished === true;
    const params = value && typeof value === 'object' ? object(value) : {};
    const session = params.threadId;
    if (method === 'model/rerouted' && params.toModel !== ASTRA) this.budget.closeRun('model_substitution');
    if (method === 'account/updated' && params.authMode !== 'chatgpt') this.budget.closeRun('authentication_changed');
    if (method === 'error' && ['usageLimitExceeded', 'rateLimitExceeded', 'unauthorized'].includes(String(object(params.error).codexErrorInfo))) this.budget.closeRun('account_or_auth_error');
    if (typeof session === 'string' && this.session && session !== this.session) return;
    if (method === 'turn/started' && this.turn) this.wireTurn = string(object(params.turn).id);
    if (method === 'thread/tokenUsage/updated' && this.session) {
      const total = object(object(params.tokenUsage).total).totalTokens;
      if (typeof total === 'number') this.budget.usage(this.session, total);
    }
    if (method === 'account/rateLimits/updated') {
      try { checkAllowance(params); } catch { this.budget.closeRun('account_allowance'); }
    }
    if (method === 'transport/disconnected' && this.turn && !this.turn.finished) this.budget.closeTurn(this.turn, 'disconnected');
    if (method === 'turn/completed' && this.turn && string(object(params.turn).id) === this.wireTurn) {
      this.revoke(); this.budget.finish(this.turn.id, object(params.turn).status === 'interrupted');
    }
    if (method.startsWith('codex/event/') || method.includes('raw') || method.includes('Raw')) return;
    if (method === 'item/started' && ['commandExecution', 'fileChange', 'webSearch', 'dynamicToolCall', 'collabToolCall', 'imageGeneration', 'imageView'].includes(String(object(params.item).type))) this.budget.closeRun('forbidden_native_tool');
    const publicMethod = /^(warning$|deprecationNotice$|mcpServer\/startupStatus\/updated$|turn\/|thread\/tokenUsage|item\/(started|completed|agentMessage\/delta|reasoning\/summaryTextDelta|mcpToolCall\/)|error$)/.test(method);
    if ((method === 'item/started' || method === 'item/completed') && object(params.item).type === 'reasoning') {
      this.emit(method, { item: { type: 'reasoning', id: object(params.item).id, summary: object(params.item).summary } }); return;
    }
    this.emit(method, publicMethod ? params : { keys: Object.keys(params) }, late);
  }
  close(): void { this.revoke(); this.unsubscribe(); this.rpc.close(); }
}
