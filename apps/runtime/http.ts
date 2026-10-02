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
import type { InstalledWorkshopProfile } from '../../packages/factorio/src/workshop.js';
import { WorkspaceOwnershipConflict } from '../../packages/storage/src/workspace-catalog.js';
import { invocationFile, readInvocationPage } from './workshop-invocation.js';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object');
  return value as Record<string, unknown>;
}
const text = (v: unknown) => { if (typeof v !== 'string') throw new Error('Expected string'); return v; };
export type DashboardOptions=WorkshopCompositionOptions & { profileReader?:(profileId:string)=>Promise<InstalledWorkshopProfile> };
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
  app.setErrorHandler((error, _request, reply) => error instanceof WorkspaceOwnershipConflict
    ? reply.code(409).send({ error: error.message, owner: error.owner, runUrl: `/history/${encodeURIComponent(error.owner.id)}` })
    : reply.code(400).send({ error: error instanceof Error ? error.message : 'Request failed' }));
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
  const workspacePage = (query: unknown) => { const value = record(query); const raw = value.limit ?? '50';
    const limit = Number(raw); if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid workspace page size');
    return { limit, cursor: typeof value.cursor === 'string' ? value.cursor : undefined }; };
  app.get('/api/workspace/groups', request => { if (!options.workspaceCatalog) throw new Error('Workspace history unavailable');
      const page = workspacePage(request.query); return options.workspaceCatalog.pageGroups(page.limit, page.cursor); });
  app.get('/api/workspace/groups/:id', request => { if (!options.workspaceCatalog) throw new Error('Workspace history unavailable');
      const value=options.workspaceCatalog.group(text(record(request.params).id));if(!value)throw new Error('Workspace group unavailable');return value; });
  app.get('/api/workspace/groups/:id/summary', request => {if(!options.workspaceCatalog)throw new Error('Workspace history unavailable');
      return options.workspaceCatalog.groupSummary(text(record(request.params).id),{directory:runtime.directory,journal:runtime.journal});});
  app.get('/api/workspace/groups/:id/runs', request => { if (!options.workspaceCatalog) throw new Error('Workspace history unavailable');
    const page = workspacePage(request.query); return options.workspaceCatalog.pageRuns(text(record(request.params).id), page.limit, page.cursor); });
  app.get('/api/workspace/runs/:id', request => { if (!options.workspaceCatalog) throw new Error('Workspace history unavailable');
      const value = options.workspaceCatalog.run(text(record(request.params).id)); if (!value) throw new Error('Workspace run unavailable'); return value; });
  app.get('/api/workspace/runs/:id/detail', request => { if (!options.workspaceCatalog) throw new Error('Workspace history unavailable');
      return options.workspaceCatalog.detail(text(record(request.params).id), { directory: runtime.directory, journal: runtime.journal }); });
  app.get('/api/workspace/runs/:id/attempts', request => { if (!options.workspaceCatalog) throw new Error('Workspace history unavailable');
    const page = workspacePage(request.query); return options.workspaceCatalog.pageAttempts(text(record(request.params).id), page.limit, page.cursor); });
  app.get('/api/workspace/runs/:id/events', request => { if (!options.workspaceCatalog) throw new Error('Workspace history unavailable');
    const page = workspacePage(request.query); return options.workspaceCatalog.pageEvents(text(record(request.params).id), page.limit, page.cursor, { directory: runtime.directory, journal: runtime.journal }); });
  app.get('/api/workspace/runs/:id/evidence/:sequence', (request, reply) => { if (!options.workspaceCatalog) throw new Error('Workspace history unavailable');
    const params = record(request.params), sequence = Number(params.sequence); if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Invalid evidence reference');
    const page = options.workspaceCatalog.pageEvents(text(params.id), 1,
      Buffer.from(JSON.stringify({ v: 1, kind: 'events', scope: params.id, after: sequence - 1 })).toString('base64url'),
      { directory: runtime.directory, journal: runtime.journal });
    const value = page.items.find(event => event.sequence === sequence);
    return value ? value : reply.code(404).send({ unavailable: page.unavailable ?? 'evidence-not-retained' });
  });
  app.get('/api/workspace/runs/:id/invocations/:invocationId', (request,reply) => {if(!options.workspaceCatalog)throw new Error('Workspace history unavailable');
    const params=record(request.params),runId=text(params.id),invocationId=text(params.invocationId),query=record(request.query);
    const sourceId=options.workspaceCatalog.workshopSourceId(runId);if(!sourceId||!invocationId.startsWith(`${sourceId}:`))return reply.code(404).send({unavailable:'invocation-outside-run'});
    const directory=options.workspaceCatalog.sourceDirectory(runId);if(!directory)return reply.code(404).send({unavailable:'journal-missing'});
    const part=typeof query.part==='string'?query.part:'instructions';if(!['instructions','context','messages','output'].includes(part))throw new Error('Invalid invocation part');
    try{return readInvocationPage(invocationFile(directory,sourceId,invocationId),invocationId,part as 'instructions'|'context'|'messages'|'output',Number(query.offset??0),Number(query.limit??16000));}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return reply.code(404).send({unavailable:'not-retained'});throw error;}
  });
  app.get('/api/workshop/options', () => ({ provider:'openai', models:options.managedModels ?? [], profiles:['starter-assembly','advanced-assembly','electromagnetic-production'], presets:runtime.journal.list<Record<string,unknown>>(runtime.run,'workshopProfiles').filter(v=>v.kind==='preset'), defaults:{construction:'direct',attempts:5,earlyStop:true,requestedSpeed:'10',settlingTicks:600,windowTicks:3600,windows:5,checkpoints:{brief:false,afterScore:false,libraryAdmission:false,learningActivation:false},learning:{cadence:'after-session',candidateCap:3,attemptCap:2}} }));
  app.get('/api/workshop/profile', async (request,reply) => {if(!options.profileReader)return reply.code(503).send({unavailable:'installed-game-profile-unavailable'});const profileId=text(record(request.query).profileId);if(!['starter-assembly','advanced-assembly','electromagnetic-production'].includes(profileId))throw new Error('Unknown workshop profile');const installed=await options.profileReader(profileId);return{profileId:installed.profileId,profileRevision:installed.profileRevision,gameVersion:installed.gameVersion,allowedEquipment:installed.allowedEquipment,technologies:installed.technologies,modules:installed.modules,beacons:installed.beacons};});
  app.post('/api/workshop/preset',async request=>{if(!options.workshopHost)throw new Error('Workshop execution host unavailable');const input=record(request.body);const id=text(input.id);const assignment=validateWorkshopAssignment(await options.workshopHost.resolve(input.assignment));runtime.record('workshop/preset-saved',[{entity:'workshopProfiles',id:'preset-'+id,value:{id,kind:'preset',assignment}}]);return{id,assignment};});
  app.post('/api/workshop/launch', async (request,reply) => {if(!workshopRuntime)throw new Error('Workshop execution host unavailable');const input=record(request.body),raw=record(input.assignment);const supplied=raw.learning&&typeof raw.learning==='object'?record(raw.learning):{};const assignment={...raw,learning:{cadence:supplied.cadence??'after-session',batchSessions:supplied.batchSessions??5,candidateCap:supplied.candidateCap??3,attemptsPerCandidate:supplied.attemptsPerCandidate??2,autoActivate:supplied.autoActivate??true}},selectedGroupId=typeof input.selectedGroupId==='string'?input.selectedGroupId:null;
    const accepted=options.workspaceCatalog?workshopRuntime.accept(assignment,selectedGroupId):await workshopRuntime.launch(assignment,selectedGroupId);return reply.code(202).send(accepted);});
  app.get('/api/workspace/owner', () => { if (!options.workspaceCatalog) throw new Error('Workspace coordinator unavailable'); return { owner: options.workspaceCatalog.owner() }; });
  app.get('/api/workspace/requests/:id', request => { if (!options.workspaceCatalog) throw new Error('Workspace coordinator unavailable');
    const value = options.workspaceCatalog.request(text(record(request.params).id)); if (!value) throw new Error('Workspace request unavailable'); return { request: value, run: options.workspaceCatalog.run(value.id) }; });
  app.post('/api/workshop/steer',request=>{const input=record(request.body);const session=workshop.steer(text(input.sessionId),Number(input.revision),text(input.text));workshopRuntime?.resume(session.id);return session;});
  app.post('/api/workshop/checkpoint',request=>{if(!workshopRuntime)throw new Error('Workshop execution host unavailable');const input=record(request.body),action=text(input.action);if(action!=='continue'&&action!=='finish')throw new Error('Unknown checkpoint action');const session=workshop.resolveCheckpoint(text(input.sessionId),Number(input.revision),action,typeof input.text==='string'?input.text:'');workshopRuntime.resume(session.id);return session;});
  app.post('/api/workshop/stop',async request=>{
    const input=record(request.body),id=text(input.sessionId),reason=text(input.reason);
    const retired=options.workspaceCatalog?.stopRetiredWorkshop(id,reason,runtime.directory,runtime.run,runtime.journal);
    if(retired)return retired;
    return workshopRuntime?workshopRuntime.stop(id,reason):workshop.stop(id,reason);
  });
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
    const route = /^\/(?:workshop|scenarios|history(?:\/[\w.-]+)?|library)\/?$/.test(pathname);
    const file = path.resolve(assets, '.' + (pathname === '/' || route ? '/index.html' : pathname));
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
