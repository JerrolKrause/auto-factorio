import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Coordinator, SessionBinding } from '../../core/orchestration/coordinator.js';
import { object, string } from '../../codex/src/protocol.js';
import { CoordinationGateway, operations } from './coordination.js';
import { ContextAccounting } from '../../core/context/lifecycle.js';

const descriptions: Record<string, string> = {
  scenario: 'Read the public scenario briefing, finite kit, terminals, collector and rules.',
  observe: 'Read bounded durable objective, tasks, ownership, pending commands, receipts and messages.',
  propose: 'Create a task. task fields: id, goal, parent (null or id), dependencies (ids), scope (object), resources (item-count object), successCriteria (strings), deadline (game tick or null), committedPlan (string), actor (builder-1 or null), reservations (resource objects), criteria ({kind: command-completed or message-delivered, id}). Reserve character {kind:actor,actor:builder-1}, inventory {kind:items,actor:builder-1}, and area {kind:area,surface:nauvis,bounds:[{x,y},{x,y}]}. Inspect scenario for site bounds. A message-delivered criterion can name the engineer final report message id.',
  message: 'Send scoped message {id,recipient,task,revision,intent:handoff|report|assistance,content,evidence:[]}. Foreman assigns an unowned task to engineer with handoff. Deliveries are automatic.',
  build: 'Queue 1–100 legal character steps for an assigned task. Runtime supplies identity/fences. Use unique commandId, current revision and future game-tick deadline. Steps: {kind:walk,position:{x,y}}, {kind:place,position:{x,y},item,quality:normal,direction:0..15}, {kind:recipe,target:{name,quality,position,unit:null or observed id},recipe}, {kind:rotate|mine,target}. Walk within reach before placement; collision can block walking. Direction 0 north, 4 east, 8 south, 12 west. Read receipts before retrying any unknown outcome. Use observe/history/detail to inspect commands; repeated IDs never mean a fresh action.',
  world: 'Read a fresh bounded page of entities and own actor for an authorized task reservation; area is its zero-based area index and offset starts at 0.',
  metrics: 'Read deterministic scoped production, consumption, boundary-delivery and stock measurements. Units are items per game second; unknown/partial coverage is explicit. Use task, area, windowTicks and optional kinds/items.',
  inspect: 'Read one compact authorized view: actor, command, or machines. Machine filters and fields are applied before bounded snapshot pagination; continuations expire explicitly.',
  replacement: 'Reconstruct authorized durable work plus fresh world state after session replacement. Reconcile pending receipts before retrying effects.',
  recipe: 'Read installed recipe facts and current availability.',
  verify: 'Request independent scenario verification after construction is complete. Character mutations close during settling and five scored minutes. One attempt per trial; calling this is a claim, not success.',
  interpret: 'Acknowledge an operator hint with interpretation and resultingTasks/supersededTasks arrays. Exact advice remains recorded independently.',
  report: 'Request task completion using deterministic evidence IDs matching task criteria; this does not claim the scenario passed.',
};
const strings = new Set(['task', 'commandId', 'query', 'name', 'id', 'interpretation', 'view', 'cursor']);
const numbers = new Set(['revision', 'deadline', 'area', 'offset', 'windowTicks']);
const arrays = new Set(['steps', 'evidence', 'refs', 'resultingTasks', 'supersededTasks', 'types', 'names', 'fields', 'kinds', 'items', 'subarea']);
export function toolCatalog(c: Coordinator, role: string) {
  return Object.entries(operations).filter(([name, op]) => name !== 'submit' && c.agent(role).definition.tools.includes(op.group)).map(([name, op]) => ({
    name, description: descriptions[name] ?? `Bounded ${name} operation on authorized durable records.`,
    inputSchema: { type: 'object', properties: Object.fromEntries([...op.keys, ...(op.optional ?? [])].map(key => [key,
      key === 'task' && ['propose', 'revise'].includes(name) ? { type: 'object' } :
      strings.has(key) ? { type: 'string' } : numbers.has(key) ? { type: 'integer', minimum: 0 } :
      arrays.has(key) ? { type: 'array', items: ['evidence', 'resultingTasks', 'supersededTasks', 'types', 'names', 'fields', 'kinds', 'items'].includes(key) ? { type: 'string' } : { type: 'object' } } : { type: 'object' }])), required: op.keys, additionalProperties: false },
  }));
}

/** Catalog credentials exist before inference; game authority exists only after verified turn binding. */
export class CoordinationMcp {
  private grants = new Map<string, { role: string; token: string | null; revoked: boolean; binding?: SessionBinding }>();
  private accounting: ContextAccounting;
  constructor(private c: Coordinator, private gateway: CoordinationGateway,
    private observed: (binding: SessionBinding, name: string, args: unknown, result: unknown) => void = () => {}) { this.accounting = new ContextAccounting(c.runtime); }
  issue(role: string) { this.c.agent(role); const token = randomBytes(32).toString('hex'); this.grants.set(token, { role, token: null, revoked: false }); return token; }
  bind(token: string, binding: SessionBinding) {
    const grant = this.grants.get(token);
    if (!grant || grant.revoked || grant.token || grant.role !== binding.agent) throw new Error('Invalid MCP binding');
    grant.token = this.gateway.issue(binding); grant.binding = structuredClone(binding);
  }
  revoke(token: string) { const g = this.grants.get(token); if (g) { g.revoked = true; if (g.token) this.gateway.revoke(g.token); } }
  async call(token: string, name: string, args: unknown) {
    const g = this.grants.get(token);
    if (!g || g.revoked || !g.token) { this.c.budget.attempt(null); throw new Error('Turn not bound or revoked'); }
    if (g.binding) this.accounting.record(g.binding.agent, g.binding.session, g.binding.turn, 'tool-arguments', { name, args });
    try {
      const result = await this.gateway.call(g.token, name, args);
      if (g.binding) {
        const omissions = (value: unknown): number => value && typeof value === 'object' ? Object.entries(value).reduce((n, [k, v]) => n + (k === 'omitted' && typeof v === 'number' ? v : 0) + omissions(v), 0) : 0;
        this.accounting.record(g.binding.agent, g.binding.session, g.binding.turn, 'tool-result', { name, result }, omissions(result));
        this.observed(g.binding, name, args, result);
      }
      return result;
    } catch (error) {
      if (g.binding) this.accounting.record(g.binding.agent, g.binding.session, g.binding.turn, 'tool-result', { name, error: String(error) });
      throw error;
    }
  }
  async listen() {
    const server = createServer(async (req, res) => {
      const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
      const grant = this.grants.get(token);
      if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host ?? '') || req.headers.origin || req.url !== '/mcp' || !grant || grant.revoked) { res.writeHead(403).end(); return; }
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      try {
        let body = '';
        for await (const chunk of req) { body += String(chunk); if (body.length > 65_536) throw new Error('Request too large'); }
        const request = object(JSON.parse(body));
        if (request.id === undefined) { res.writeHead(202).end(); return; }
        const params = object(request.params ?? {}); let result: unknown;
        switch (request.method) {
          case 'initialize': result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'autofactorio', version: '0.1.0' } }; break;
          case 'ping': result = {}; break;
          case 'tools/list': result = { tools: toolCatalog(this.c, grant.role) }; break;
          case 'tools/call': {
            try { result = { content: [{ type: 'text', text: JSON.stringify(await this.call(token, string(params.name), params.arguments ?? {})) }], isError: false }; }
            catch (error) { result = { content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }], isError: true }; }
            break;
          }
          default: throw new Error('Method unavailable');
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
      } catch { res.writeHead(400).end(); }
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
  }
}
