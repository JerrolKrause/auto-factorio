import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { object, string } from '../../codex/src/protocol.js';
import type { Budget } from '../../codex/src/budget.js';
import type { Sink } from '../../codex/src/protocol.js';
export type Role = 'foreman' | 'engineer' | 'workshop-designer' | 'workshop-scorer' | 'workshop-learnings';
interface Grant { role: Role; turn: string | null; revoked: boolean }
const names: Record<Role, string[]> = { foreman: ['observe', 'handoff'], engineer: ['observe', 'report', 'checkpoint'], 'workshop-designer':['observe','checkpoint'], 'workshop-scorer':['observe'], 'workshop-learnings':['observe'] };
export class Gateway {
  private readonly grants = new Map<string, Grant>();
  private readonly waits = new Map<string, () => void>();
  readonly messages: { from: Role; to: Role; text: string }[] = [];
  readonly attempts: { role: Role; tool: string; allowed: boolean; reason: string | null }[] = [];
  private readonly observations = new Map<Role, unknown>();
  constructor(private readonly budget: Budget, private readonly sink: Sink) {}
  issue(role: Role): string {
    const token = randomBytes(32).toString('hex'); this.grants.set(token, { role, turn: null, revoked: false }); return token;
  }
  bind(token: string, turn: string): void {
    const grant = this.grants.get(token);
    if (!grant || grant.turn || grant.revoked || this.budget.get(turn).role !== grant.role) throw new Error('Invalid gateway binding');
    grant.turn = turn;
  }
  revoke(token: string): void {
    const grant = this.grants.get(token); if (grant) grant.revoked = true;
    this.waits.get(token)?.(); this.waits.delete(token);
  }
  revokeTurn(turn: string): void { for (const [token, grant] of this.grants) if (grant.turn === turn) this.revoke(token); }
  setObservation(role:Role,value:unknown):void{this.observations.set(role,structuredClone(value));}
  authenticated(token: string): boolean { return this.grants.has(token); }
  catalog(token: string): unknown[] {
    const grant = this.grants.get(token); if (!grant) throw new Error('Unauthenticated MCP identity');
    return names[grant.role].map(name => ({ name, description: name === 'checkpoint' ? 'Synthetic lifecycle checkpoint; waits for operator cancellation or at most 25 seconds.' : `Synthetic ${name} operation. No game or filesystem access.`,
      inputSchema: { type: 'object', properties: name === 'handoff' || name === 'report' ? { text: { type: 'string', maxLength: 500 } } : {},
        required: name === 'handoff' || name === 'report' ? ['text'] : [], additionalProperties: false } }));
  }
  async call(token: string, tool: string, args: unknown): Promise<unknown> {
    const grant = this.grants.get(token);
    if (!grant) { this.budget.attempt(null); throw new Error('Unauthenticated MCP identity'); }
    const admitted = this.budget.attempt(grant.turn);
    let error: string | null = null;
    if (!admitted || grant.revoked) error = 'Turn admission closed';
    else if (!names[grant.role].includes(tool)) error = 'Role/tool forbidden';
    let input: Record<string, unknown> = {};
    try { input = object(args); } catch { error ??= 'Invalid arguments'; }
    const expected = tool === 'handoff' || tool === 'report' ? ['text'] : [];
    if (Object.keys(input).some(k => !expected.includes(k))) error ??= 'Identity spoofing or unsupported argument';
    if (expected.length && (typeof input.text !== 'string' || input.text.length > 500)) error ??= 'Invalid message';
    this.attempts.push({ role: grant.role, tool, allowed: error === null, reason: error });
    this.sink({ at: new Date().toISOString(), role: grant.role, session: null, turn: grant.turn, kind: 'tool/attempt', data: { tool, args, error }, late: grant.revoked });
    let result: unknown;
    try {
      if (error) throw new Error(error);
      if (tool === 'observe') result = { identity: grant.role, messages: this.messages.filter(m => m.to === grant.role), state:structuredClone(this.observations.get(grant.role)??null), synthetic: true };
      else if (tool === 'handoff' || tool === 'report') {
        if(grant.role!=='foreman'&&grant.role!=='engineer')throw new Error('Workshop roles cannot message gameplay roles');
        const message = { from: grant.role, to: grant.role === 'foreman' ? 'engineer' as const : 'foreman' as const, text: string(input.text) };
        this.messages.push(message); result = message;
      } else {
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => { this.waits.delete(token); resolve(); }, 25_000);
          this.waits.set(token, () => { clearTimeout(timer); resolve(); });
        });
        if (grant.revoked || !grant.turn || this.budget.get(grant.turn).closed) throw new Error('Checkpoint cancelled');
        result = { checkpoint: 'elapsed' };
      }
      return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false };
    } catch (cause) {
      result = { error: String(cause) }; return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: true };
    } finally {
      this.sink({ at: new Date().toISOString(), role: grant.role, session: null, turn: grant.turn, kind: 'tool/result', data: { tool, result }, late: grant.revoked });
      if (grant.turn) this.budget.afterAttempt(grant.turn);
    }
  }
  async listen(): Promise<{ url: string; close: () => Promise<void> }> {
    // Stateless Streamable HTTP MCP; capabilities deliberately exclude resources/prompts/admin operations.
    const server = createServer(async (req, res) => {
      const host = req.headers.host ?? '';
      const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
      if (!/^127\.0\.0\.1:\d+$/.test(host) || req.headers.origin || req.url !== '/mcp' || !this.authenticated(token)) {
        res.writeHead(403).end(); return;
      }
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      let text = '';
      try {
        for await (const chunk of req) { text += String(chunk); if (text.length > 16_384) throw new Error('Request too large'); }
        const request = object(JSON.parse(text));
        if (request.id === undefined) { res.writeHead(202).end(); return; }
        const params = object(request.params ?? {}); let result: unknown;
        switch (request.method) {
          case 'initialize': result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'autofactorio-synthetic', version: '0.1.0' } }; break;
          case 'ping': result = {}; break;
          case 'tools/list': result = { tools: this.catalog(token) }; break;
          case 'tools/call': result = await this.call(token, string(params.name), params.arguments ?? {}); break;
          case 'resources/list': result = { resources: [] }; break;
          case 'resources/templates/list': result = { resourceTemplates: [] }; break;
          default: res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method unavailable' } })); return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
      } catch { res.writeHead(400).end(); }
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
  }
}
