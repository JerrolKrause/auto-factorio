import Fastify from 'fastify';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import type { Operator } from './operator.js';
import type { TaskInput } from '../../packages/core/orchestration/coordinator.js';
import { entities } from '../../packages/storage/src/journal.js';
import type { DashboardSnapshot } from './dashboard-types.js';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object');
  return value as Record<string, unknown>;
}
const text = (v: unknown) => { if (typeof v !== 'string') throw new Error('Expected string'); return v; };
export function dashboard(operator: Operator, assets = path.resolve('apps/dashboard/dist')) {
  const app = Fastify({ logger: false, bodyLimit: 32768 });
  const capability = randomBytes(32).toString('hex');
  const streams = new Set<ServerResponse>();
  let origin = '';
  const runtime = operator.coordinator.runtime;
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer')
      .header('X-Content-Type-Options', 'nosniff').header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (!origin || request.headers.host !== new URL(origin).host) return reply.code(403).send({ error: 'Local host required' });
    const suppliedOrigin = request.headers.origin;
    if ((suppliedOrigin && suppliedOrigin !== origin) || request.headers['sec-fetch-site'] === 'cross-site') return reply.code(403).send({ error: 'Local origin required' });
    if (!request.url.startsWith('/api/')) return;
    const supplied = Buffer.from(request.headers.authorization ?? ''); const expected = Buffer.from('Bearer ' + capability);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply.code(401).send({ error: 'Local capability required' });
    if (request.method !== 'GET' && suppliedOrigin !== origin) return reply.code(403).send({ error: 'Local origin required' });
  });
  app.setErrorHandler((error, _request, reply) => reply.code(400).send({ error: error instanceof Error ? error.message : 'Request failed' }));
  app.get('/api/snapshot', () => {
    // No await between projections and cursor: one Node writer gives an atomic read boundary.
    const cursor = runtime.journal.cursor();
    const projections = Object.fromEntries(entities.map(e => [e, runtime.journal.rows(runtime.run, e)]));
    const snapshot: DashboardSnapshot = { run: runtime.run, cursor, control: operator.state(), projections, events: runtime.journal.page(runtime.run, Math.max(0, cursor - 100), 100) };
    return snapshot;
  });
  const cursor = (query: unknown) => {
    const raw = record(query).after ?? '0';
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) throw new Error('Invalid cursor');
    const n = Number(raw); if (!Number.isSafeInteger(n) || n > runtime.journal.cursor()) throw new Error('Cursor outside journal'); return n;
  };
  app.get('/api/history', request => runtime.journal.page(runtime.run, cursor(request.query)));
  app.get('/api/events', (request, reply) => {
    let after = cursor(request.query);
    reply.hijack();
    const stream = reply.raw; streams.add(stream);
    stream.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
    stream.write(': connected\n\n');
    let blocked = false;
    const send = () => {
      if (stream.destroyed || blocked) return;
      try {
        const events = runtime.journal.page(runtime.run, after);
        for (const event of events) {
          const accepted = stream.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`);
          after = event.sequence;
          if (!accepted) { blocked = true; break; }
        }
        if (!events.length) stream.write(': heartbeat\n\n');
      } catch { stream.destroy(); }
    };
    stream.on('drain', () => { blocked = false; send(); });
    const timer = setInterval(send, 250);
    stream.on('close', () => { clearInterval(timer); streams.delete(stream); });
    send();
  });
  app.get('/api/artifacts/:id', (request, reply) => {
    const id = text(record(request.params).id); const evidence = runtime.readArtifact(id, { kind: 'operator' });
    if (!evidence.available) return reply.code(404).send(evidence);
    return reply.type('application/json').send(evidence.bytes);
  });
  app.post('/api/advice', request => {
    const input = record(request.body);
    const advice = operator.interventions.advice(text(input.id), text(input.recipient), text(input.text), operator.state().connected ? operator.state().gameTick : null);
    operator.interventions.deliver(); return advice;
  });
  app.post('/api/control', async request => {
    const action = record(request.body).action;
    if (action !== 'pause' && action !== 'stop' && action !== 'resume') throw new Error('Unknown control');
    return operator.control(action);
  });
  app.post('/api/reprioritize', async request => {
    const input = record(request.body); const task = text(input.task);
    const current = operator.coordinator.task(task);
    if (!Number.isSafeInteger(input.revision) || input.revision !== current.revision) throw new Error('Stale revision');
    const goal = text(input.goal); const committedPlan = text(input.committedPlan);
    if (!goal.trim() || goal.length > 4000 || committedPlan.length > 8000) throw new Error('Invalid plan');
    await operator.reprioritize(task, current.revision, { ...current, goal, committedPlan } as TaskInput);
    return { revised: true, task };
  });
  app.get('/*', async (request, reply) => {
    const pathname = new URL(request.url, origin).pathname;
    const file = path.resolve(assets, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(path.resolve(assets) + path.sep)) return reply.code(404).send();
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)];
    if (!mime) return reply.code(404).send();
    try { return reply.type(mime).send(await readFile(file)); } catch { return reply.code(404).send(); }
  });
  return {
    app, capability,
    async listen(port = 0) { origin = await app.listen({ host: '127.0.0.1', port }); return origin; },
    async close() { for (const s of streams) s.destroy(); await app.close(); },
  };
}
