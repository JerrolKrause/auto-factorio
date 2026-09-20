import Fastify from 'fastify';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import type { Operator } from './operator.js';
import type { TaskInput } from '../../packages/core/orchestration/coordinator.js';
import { entities } from '../../packages/storage/src/journal.js';
import type { DashboardSnapshot } from './dashboard-types.js';
import { validateWorkshopAssignment } from '@autofactorio/contracts';
import { composeWorkshop } from './workshop-composition.js';
import type { WorkshopCompositionOptions } from './workshop-composition.js';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object');
  return value as Record<string, unknown>;
}
const text = (v: unknown) => { if (typeof v !== 'string') throw new Error('Expected string'); return v; };
export type DashboardOptions=WorkshopCompositionOptions;
export function dashboard(operator: Operator, assets = path.resolve('apps/dashboard/dist'), options:DashboardOptions = {}) {
  const app = Fastify({ logger: false, bodyLimit: 4*1024*1024 });
  const capability = randomBytes(32).toString('hex');
  const sessionCookie = `af_session=${capability}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`;
  const streams = new Set<ServerResponse>();
  let origin = '';
  const runtime = operator.coordinator.runtime;
  const composition=composeWorkshop(runtime,options),workshop=composition.orchestrator,learning=composition.learning,library=composition.library,workshopRuntime=composition.controller;
  const cookieCapability = (cookie: string | undefined) => cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('af_session='))?.slice('af_session='.length) ?? '';
  const validCapability = (request: { headers: { authorization?: string | undefined; cookie?: string | undefined } }) => {
    const supplied = Buffer.from(request.headers.authorization ?? `Bearer ${cookieCapability(request.headers.cookie)}`);
    const expected = Buffer.from('Bearer ' + capability);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  };
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer')
      .header('X-Content-Type-Options', 'nosniff').header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (!origin || request.headers.host !== new URL(origin).host) return reply.code(403).send({ error: 'Local host required' });
    const suppliedOrigin = request.headers.origin;
    if ((suppliedOrigin && suppliedOrigin !== origin) || request.headers['sec-fetch-site'] === 'cross-site') return reply.code(403).send({ error: 'Local origin required' });
    if (!request.url.startsWith('/api/')) { reply.header('Set-Cookie', sessionCookie); return; }
    if (!validCapability(request)) return reply.code(401).send({ error: 'Local session missing; reload http://localhost:3000 to start a new local session' });
    if (request.method !== 'GET' && suppliedOrigin !== origin) return reply.code(403).send({ error: 'Local origin required' });
  });
  app.setErrorHandler((error, _request, reply) => reply.code(400).send({ error: error instanceof Error ? error.message : 'Request failed' }));
  app.get('/health', (_request, reply) => reply.header('X-AutoFactorio-Service', 'dashboard').send({ status: 'ok', service: 'autofactorio-dashboard' }));
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
  app.get('/api/workshop/options', () => ({ provider:'openai', models:options.managedModels ?? [], profiles:['starter-assembly','advanced-assembly','electromagnetic-production'], presets:runtime.journal.list<Record<string,unknown>>(runtime.run,'workshopProfiles').filter(v=>v.kind==='preset'), defaults:{construction:'direct',attempts:5,earlyStop:true,requestedSpeed:'10',settlingTicks:600,windowTicks:3600,windows:5,checkpoints:{brief:false,afterScore:false,libraryAdmission:false,learningActivation:false},learning:{cadence:'after-session',candidateCap:3,attemptCap:2}} }));
  app.post('/api/workshop/preset',async request=>{if(!options.workshopHost)throw new Error('Workshop execution host unavailable');const input=record(request.body);const id=text(input.id);const assignment=validateWorkshopAssignment(await options.workshopHost.resolve(input.assignment));runtime.record('workshop/preset-saved',[{entity:'workshopProfiles',id:'preset-'+id,value:{id,kind:'preset',assignment}}]);return{id,assignment};});
  app.post('/api/workshop/launch', async (request,reply) => {if(!workshopRuntime)throw new Error('Workshop execution host unavailable');const input=record(request.body),raw=record(input.assignment);const supplied=raw.learning&&typeof raw.learning==='object'?record(raw.learning):{};const session=await workshopRuntime.launch({...raw,learning:{cadence:supplied.cadence??'after-session',batchSessions:supplied.batchSessions??5,candidateCap:supplied.candidateCap??3,attemptsPerCandidate:supplied.attemptsPerCandidate??2,autoActivate:supplied.autoActivate??true}});return reply.code(202).send(session);});
  app.post('/api/workshop/steer',request=>{const input=record(request.body);const session=workshop.steer(text(input.sessionId),Number(input.revision),text(input.text));workshopRuntime?.resume(session.id);return session;});
  app.post('/api/workshop/checkpoint',request=>{if(!workshopRuntime)throw new Error('Workshop execution host unavailable');const input=record(request.body),action=text(input.action);if(action!=='continue'&&action!=='finish')throw new Error('Unknown checkpoint action');const session=workshop.resolveCheckpoint(text(input.sessionId),Number(input.revision),action,typeof input.text==='string'?input.text:'');workshopRuntime.resume(session.id);return session;});
  app.post('/api/workshop/stop',async request=>{const input=record(request.body);return workshopRuntime?workshopRuntime.stop(text(input.sessionId),text(input.reason)):workshop.stop(text(input.sessionId),text(input.reason));});
  app.get('/api/workshop/library',request=>{const query=record(request.query);const search=typeof query.q==='string'?query.q.toLowerCase():'';const after=typeof query.after==='string'&&/^\d+$/.test(query.after)?Number(query.after):0;const rows=library.search({limit:100,offset:0}).map(value=>{const entry={...value} as Partial<typeof value>;delete entry.directory;return entry;}).filter(v=>!search||JSON.stringify(v).toLowerCase().includes(search));return{items:rows.slice(after,after+50),next:after+50<rows.length?after+50:null,total:rows.length};});
  app.get('/api/workshop/library/:id/export',request=>{const value=library.get(text(record(request.params).id));return{entry:{...value.entry,directory:undefined},blueprint:value.blueprint,portable:value.portable};});
  app.post('/api/workshop/learning',request=>{const input=record(request.body),action=text(input.action);if(action==='rollback')return learning.rollback(text(input.hash),text(input.operationId));if(action==='quarantine')return learning.quarantine(text(input.hash),text(input.reason));throw new Error('Unknown learning control');});
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
    async listen(port = 0) {
      const bound = await app.listen({ host: '127.0.0.1', port });
      origin = `http://localhost:${new URL(bound).port}`;
      return origin;
    },
    async close() { for (const s of streams) s.destroy(); await app.close(); await workshopRuntime?.close(); library.close(); },
  };
}
