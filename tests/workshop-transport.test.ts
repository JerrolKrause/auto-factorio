import { Agent, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { Budget, PROBE_CAPS } from '../packages/codex/src/budget.js';
import { Gateway } from '../packages/tools/src/gateway.js';

function post(url: string, token: string, body: unknown, agent: import('node:http').Agent) {
  return new Promise<{ status: number; json: unknown; socket: import('node:net').Socket }>((resolve, reject) => {
    const target = new URL(url);
    const req = httpRequest({ hostname: target.hostname, port: Number(target.port), path: target.pathname, method: 'POST', agent,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        try { const text = Buffer.concat(chunks).toString('utf8'); resolve({ status: response.statusCode ?? 0, json: text ? JSON.parse(text) : null, socket: req.socket! }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

describe('workshop MCP HTTP transport', () => {
  it('keeps the authenticated connection alive through idle model reasoning and closes it with the invocation', async () => {
    const budget = new Budget(PROBE_CAPS, () => 0, () => {});
    const gateway = new Gateway(budget, () => {});
    const token = gateway.issue('workshop-designer');
    const turn = budget.admit('workshop-designer');
    gateway.bind(token, turn.id);
    gateway.setObservation('workshop-designer', { attempt: 1, status: 'design-ready' });
    const server = await gateway.listen();
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    let serverClosed = false;
    try {
      const initialized = await post(server.url, token, { jsonrpc: '2.0', id: 1, method: 'initialize' }, agent);
      expect(initialized.status).toBe(200);
      const socket = initialized.socket;
      await new Promise(resolve => setTimeout(resolve, 6_600));
      expect(socket.destroyed).toBe(false);

      const observed = await post(server.url, token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'observe', arguments: {} } }, agent);
      expect(observed.status).toBe(200);
      expect(observed.socket).toBe(socket);
      expect(observed.json).toMatchObject({ id: 2, result: { content: [{ text: expect.stringContaining('design-ready') }], isError: false } });
      expect(turn.attempts).toBe(1);

      const closed = once(socket, 'close');
      await server.close();
      serverClosed = true;
      await closed;
      expect(socket.destroyed).toBe(true);
    } finally {
      agent.destroy();
      if (!serverClosed) await server.close();
    }
  }, 15_000);

  it('continues to reject unauthenticated HTTP requests and role-forbidden workshop tools', async () => {
    const budget = new Budget(PROBE_CAPS, () => 0, () => {});
    const gateway = new Gateway(budget, () => {});
    const token = gateway.issue('workshop-scorer');
    const turn = budget.admit('workshop-scorer');
    gateway.bind(token, turn.id);
    const server = await gateway.listen();
    const agent = new Agent({ keepAlive: true });
    try {
      const unauthenticated = await post(server.url, 'invalid-token', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, agent);
      expect(unauthenticated.status).toBe(403);
      const forbidden = await post(server.url, token, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'report', arguments: { text: 'cross-role message' } } }, agent);
      expect(forbidden.json).toMatchObject({ result: { isError: true } });
      expect(gateway.messages).toEqual([]);
    } finally { agent.destroy(); await server.close(); }
  });
});
