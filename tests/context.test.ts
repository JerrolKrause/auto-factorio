import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DurableRuntime } from '../apps/runtime/durable-runtime.js';
import { GameClient } from '../packages/factorio/src/client.js';
import { Lifecycle } from '../packages/factorio/src/lifecycle.js';
import { Coordinator } from '../packages/core/orchestration/coordinator.js';
import type { TaskInput } from '../packages/core/orchestration/coordinator.js';
import { team, engineer } from '../packages/core/orchestration/roles.js';
import { CoordinationGateway } from '../packages/tools/src/coordination.js';
import { PROBE_CAPS } from '../packages/codex/src/budget.js';
import { ContextArchive, bytes, entityCost, paginate } from '../packages/core/context/archive.js';
import type { Page } from '../packages/core/context/archive.js';
import { AgentContext, RecipeCache } from '../packages/core/context/service.js';
import { permits, privateTo, taskVisibility } from '../packages/core/context/authorization.js';
import type { Principal } from '../packages/core/context/authorization.js';
import type { Reference, Visibility } from '../packages/core/execution/durable.js';
import type { Artifact } from '../packages/storage/src/artifacts.js';

const caps = { ...PROBE_CAPS, tools: 1000, turns: 30, runMs: 300000, turnMs: 300000 };
const runtimes: DurableRuntime[] = [];
afterEach(() => { for (const r of runtimes.splice(0)) r.close(); });
function fixture(directory = mkdtempSync(path.join(os.tmpdir(), 'af-context-')), tools = caps.tools) {
  const port = { command: async () => '{}', close() {} };
  const game = new GameClient(port, () => {}); const life = new Lifecycle(port, game, () => {});
  const runtime = new DurableRuntime(directory, 'run', 'epoch', game, life); runtimes.push(runtime);
  const c = new Coordinator(runtime, { ...caps, tools });
  if (!c.agents().length) team().map(a => ({ ...a, definition: { ...a.definition, limits: { tools: 1000 } } })).forEach(a => c.register(a));
  const gateway = new CoordinationGateway(c, { bytes: 4096, entities: 30 });
  const bind = (who = 'engineer') => { const turn = c.budget.admit(who); const b = c.bind(who, 'session-' + turn.id, turn.id, async () => {}); return { b, token: gateway.issue(b), context: new AgentContext(c, b, { bytes: 4096, entities: 30 }) }; };
  let p: Principal = { run: 'run', agent: 'engineer', role: 'engineer', tasks: ['work'] };
  const archive = new ContextArchive(runtime, () => p, { bytes: 1024, entities: 4 });
  return { directory, game, runtime, c, gateway, bind, archive, principal: (next: Principal) => { p = next; } };
}
const ref = (a: Artifact): Reference => ({ entity: 'artifacts', id: a.id });
function task(): TaskInput {
  return { id: 'work', goal: 'Repair the stalled gear assembler', parent: null, dependencies: [], scope: { surface: 'nauvis' }, resources: {}, successCriteria: ['receipt'], deadline: null, committedPlan: 'Restore input belt; verify receipt before retrying', actor: null,
    reservations: [], criteria: [{ kind: 'command-completed', id: 'pending-order' }] };
}
function assign(f: ReturnType<typeof fixture>) {
  f.c.propose('foreman', task());
  const t = f.c.task('work'); f.runtime.record('test/assignment', [{ entity: 'tasks', id: t.id, value: { ...t, owner: 'engineer', status: 'assigned' }, visibility: taskVisibility(t.id) }]);
}

describe('phase 08 authorized bounded context', () => {
  it.each([undefined, {}, { kind: 'operator' }, { kind: 'restricted', agents: ['engineer'] }])('denies absent, invalid and operator labels: %j', label => {
    expect(permits(label, { run: 'run', agent: 'engineer', role: 'engineer', tasks: ['work'] })).toBe(false);
  });
  it.each(['reference plan', 'fault seed', 'fault injection receipt', 'operator export'])('denies private %s across ID, search, pagination and payload', secret => {
    const f = fixture(); const artifact = f.runtime.evidence('public-transcript', { secret }, { kind: 'operator' });
    expect(f.archive.get(ref(artifact))).toBeNull(); expect(f.archive.detail(ref(artifact)).items).toEqual([]);
    expect(f.archive.download(ref(artifact))).toEqual({ available: false }); expect(f.archive.search(secret)).toEqual({ items: [], total: 0, omitted: 0, next: null, truncated: false });
    expect(f.archive.download({ entity: 'artifacts', id: 'unknown' })).toEqual(f.archive.download(ref(artifact)));
  });
  it('excludes saves, checkpoint manifests and full telemetry even with a shared label', () => {
    const f = fixture();
    for (const purpose of ['save', 'checkpoint', 'operator-telemetry'] as const) {
      const artifact = f.runtime.evidence(purpose, { secret: 'answer' }, { kind: 'shared' });
      expect(f.archive.get(ref(artifact))).toBeNull();
      expect(f.runtime.readArtifact(artifact.id, { kind: 'agent', run: 'run', agent: 'engineer', role: 'engineer', task: 'work' }).available).toBe(false);
    }
  });
  it('rechecks agent, role, task and run scope on every request', () => {
    const f = fixture();
    const labels: Visibility[] = [privateTo('engineer'), { kind: 'restricted', agents: [], roles: ['engineer'], tasks: [] }, taskVisibility('work')];
    const artifacts = labels.map(v => f.runtime.evidence('public-transcript', { fact: 'permitted' }, v));
    for (const a of artifacts) expect(f.archive.get(ref(a))).not.toBeNull();
    f.principal({ run: 'run', agent: 'foreman', role: 'foreman', tasks: [] });
    for (const a of artifacts) expect(f.archive.get(ref(a))).toBeNull();
    f.principal({ run: 'another-run', agent: 'engineer', role: 'engineer', tasks: ['work'] }); expect(() => f.archive.search('')).toThrow('Run scope');
  });
  it('filters transitive links, legacy payload IDs and evidence without exposing child IDs', () => {
    const f = fixture(); const hidden = f.runtime.evidence('public-transcript', { secret: 'fault-cause' }, { kind: 'operator' });
    const middle = f.runtime.evidence('public-transcript', { link: { ref: ref(hidden) }, telemetry: hidden.id, evidence: [hidden.id], useful: 'belt stopped' }, { kind: 'shared' });
    const parent = f.runtime.evidence('public-transcript', { link: { ref: ref(middle) } }, { kind: 'shared' });
    const value = JSON.stringify(f.archive.get(ref(parent)));
    expect(value).toContain('belt stopped'); expect(value).not.toContain(hidden.id); expect(value).not.toContain('fault-cause');
    expect(f.archive.search('fault-cause').total).toBe(0);
  });
  it('denies derived content with any unauthorized source, including cycles and a permitted envelope', () => {
    const f = fixture(); const hidden = f.runtime.evidence('public-transcript', { secret: 'answer' }, { kind: 'operator' });
    const visible = f.runtime.evidence('public-transcript', { text: 'contains derived answer' }, { kind: 'shared' });
    f.runtime.record('public-event', [{ entity: 'artifacts', id: visible.id, value: { ...visible }, sources: [ref(hidden)] }], { kind: 'shared' });
    expect(f.archive.get(ref(visible))).toBeNull(); expect(f.archive.search('derived answer').total).toBe(0); expect(f.archive.entries('events')).toHaveLength(0);
    f.runtime.record('cycle', [{ entity: 'artifacts', id: visible.id, value: { ...visible }, sources: [ref(visible)] }], { kind: 'shared' }); expect(f.archive.get(ref(visible))).toBeNull();
  });
  it('summarizes only authorized sources and retains restrictions across task replacement', () => {
    const f = fixture(); const allowed = f.runtime.evidence('public-transcript', { fact: 'visible symptom' }, taskVisibility('work'));
    const hidden = f.runtime.evidence('public-transcript', { secret: 'private fault' }, { kind: 'operator' });
    const summary = f.archive.summarize([ref(allowed), ref(hidden)]);
    expect(JSON.stringify(f.archive.get(summary))).toContain('visible symptom'); expect(JSON.stringify(f.archive.get(summary))).not.toContain('private fault');
    f.principal({ run: 'run', agent: 'engineer', role: 'engineer', tasks: [] }); expect(f.archive.get(summary)).toBeNull();
  });
  it('computes counts and pages from authorized data only, unaffected by hidden inserts', () => {
    const f = fixture(); for (let i = 0; i < 7; i++) f.runtime.evidence('public-transcript', { symptom: i }, { kind: 'shared' });
    const before = f.archive.search('symptom', 4, 'artifacts');
    for (let i = 0; i < 12; i++) f.runtime.evidence('public-transcript', { symptom: 'secret' }, { kind: 'operator' });
    expect(f.archive.search('symptom', 4, 'artifacts')).toEqual(before); expect(before.total).toBe(7); expect(before.items).toHaveLength(3);
  });
  it('enforces UTF-8 bytes, nested entity caps and progress past oversized records', () => {
    const f = fixture(); const a = f.runtime.evidence('public-transcript', { text: '🚂'.repeat(4000) }, { kind: 'shared' });
    const detail = f.archive.detail(ref(a)); expect(bytes(detail)).toBeLessThanOrEqual(1024); expect(detail.items[0]!.value).toHaveProperty('omitted', 'byte-limit');
    const huge = f.runtime.evidence('public-transcript', { entities: Array(50).fill({ x: 1 }) }, { kind: 'shared' });
    expect(f.archive.detail(ref(huge)).items[0]!.value).toHaveProperty('omitted', 'entity-limit');
    let start = 0, text = '';
    do { const page = f.archive.download(ref(a), start); expect(bytes(page)).toBeLessThanOrEqual(1024); if (!page.available) throw new Error('Missing payload'); text += page.text; if (page.next === null) break; expect(page.next).toBeGreaterThan(start); start = page.next; } while (start < 30000);
    expect(JSON.parse(text)).toEqual({ text: '🚂'.repeat(4000) });
    expect(() => f.archive.download(ref(a), 12)).toThrow('offset');
    expect(() => paginate([], -1, { bytes: 1024, entities: 4 })).toThrow();
  });
  it('reconstructs durable task, pending intent, reservation and unresolved steering after restart', () => {
    const f = fixture(); assign(f);
    f.runtime.record('pending', [{ entity: 'commands', id: 'pending-order', value: { state: 'unknown', batch: { task: 'work', commandId: 'pending-order' }, reason: 'verify before retry' } }], taskVisibility('work'));
    f.runtime.record('steering', [{ entity: 'interventions', id: 'steering', value: { text: 'Keep room for a second assembler', recipient: 'engineer', delivery: 'pending' } }], privateTo('engineer'));
    f.runtime.record('reservation', [{ entity: 'reservations', id: 'reservation', value: { id: 'reservation', task: 'work', owner: 'engineer', state: 'active', revision: 1, resources: [] } }]);
    f.runtime.evidence('public-transcript', { secret: 'private reference layout' }, { kind: 'operator' });
    f.runtime.close(); runtimes.splice(runtimes.indexOf(f.runtime), 1);
    const next = fixture(f.directory); const session = next.bind(); const page = next.gateway.call(session.token, 'observe', {}) as Page;
    const text = JSON.stringify(page); expect(bytes(page)).toBeLessThanOrEqual(4096);
    for (const fact of ['Repair the stalled', 'Restore input belt', 'pending-order', 'unknown', 'Keep room', 'reservation']) expect(text).toContain(fact);
    expect(text).not.toContain('private reference layout'); expect(next.runtime.execution.pending()).toHaveLength(1);
    expect(next.runtime.journal.events().filter(e => e.type === 'command/intent')).toHaveLength(0);
  });
  it('records exact bounded output apart from telemetry and excludes another role transcript', () => {
    const f = fixture(); assign(f); const session = f.bind();
    f.c.activity('foreman', 'explanation', { text: 'private foreman deliberation' });
    const output = f.gateway.call(session.token, 'observe', {});
    expect(JSON.stringify(output)).not.toContain('private foreman deliberation');
    const observation = f.runtime.journal.list<{ response: string; telemetry: string }>('run', 'observations').at(-1)!;
    const exact = f.runtime.readArtifact(observation.response, { kind: 'operator' }); if (!exact.available) throw new Error('Missing exact observation');
    expect(JSON.parse(exact.bytes.toString())).toEqual(output); expect(f.archive.get({ entity: 'artifacts', id: observation.telemetry })).toBeNull();
  });
  it('serves scoped world symptoms and refreshes after replacement without returning hidden raw telemetry', async () => {
    const f = fixture(); assign(f); const t = f.c.task('work');
    t.actor = 'builder-1'; t.reservations = [{ kind: 'area', surface: 'nauvis', bounds: [{ x: 0, y: 0 }, { x: 4, y: 4 }] }];
    f.runtime.record('test/area', [{ entity: 'tasks', id: t.id, value: { ...t } }], taskVisibility(t.id));
    let calls = 0; f.game.request = async request => {
      calls++; expect(request).toMatchObject({ area: t.reservations[0]!.kind === 'area' ? t.reservations[0]!.bounds : [], limit: 30 });
      return { tick: calls, entities: [{ name: 'transport-belt', position: { x: 1, y: 1 }, inventories: {}, faultSeed: 'SECRET' }], actors: { 'builder-1': { position: { x: 1, y: 1 }, inventory: [] }, 'builder-2': { inventory: ['SECRET'] } }, total: 1, truncated: false, evaluator: 'SECRET' };
    };
    const first = f.bind(); const result = await f.gateway.call(first.token, 'world', { task: 'work', area: 0, offset: 0 });
    expect(JSON.stringify(result)).toContain('transport-belt'); expect(JSON.stringify(result)).not.toContain('SECRET');
    f.c.finish(first.b.turn); const second = f.bind(); await f.gateway.call(second.token, 'world', { task: 'work', area: 0, offset: 0 }); expect(calls).toBe(2);
    await expect(second.context.world('hidden-task', 0, 0)).rejects.toThrow('scope');
  });
  it('rejects a late world observation when ownership changes during the query', async () => {
    const f = fixture(); assign(f); const t = f.c.task('work'); t.reservations = [{ kind: 'area', surface: 'nauvis', bounds: [{ x: 0, y: 0 }, { x: 4, y: 4 }] }];
    f.runtime.record('area', [{ entity: 'tasks', id: t.id, value: { ...t } }], taskVisibility(t.id));
    f.game.request = async () => { f.runtime.record('reassigned', [{ entity: 'tasks', id: t.id, value: { ...t, owner: 'foreman' } }], taskVisibility(t.id)); return { entities: [], actors: {} }; };
    await expect(f.bind().context.world('work', 0, 0)).rejects.toThrow('changed');
    expect(f.runtime.journal.list('run', 'observations')).toHaveLength(0);
  });
  it('checks current authenticated role scopes for archive tools and rejects spoofed or replaced sessions', () => {
    const f = fixture(); assign(f); const first = f.bind();
    expect(() => f.gateway.call(first.token, 'history', { query: '', offset: 0, agent: 'foreman' })).toThrow('spoofing');
    expect(() => f.gateway.call(first.token, 'detail', { ref: { entity: '../files', id: 'secret' } })).toThrow('reference');
    f.c.finish(first.b.turn); const second = f.bind();
    expect(() => first.context.briefing()).toThrow('closed'); expect(() => second.context.briefing()).not.toThrow();
    f.c.register({ id: 'limited', definition: { ...engineer, id: 'limited', observations: ['messages'] }, actors: [] });
    const limited = f.bind('limited'); expect(JSON.stringify(limited.context.briefing())).not.toContain('Restore input belt');
  });
  it('keys recipe facts by every active mod and separates freshly queried availability', () => {
    const cache = new RecipeCache(); const recipe = { name: 'gear', energy: 1, category: 'crafting', ingredients: [], products: [], enabled: false };
    const a = cache.read({ base: '2.0.77', quality: '2.0.77', custom: '1' }, recipe, 1);
    const b = cache.read({ custom: '1', quality: '2.0.77', base: '2.0.77' }, { ...recipe, enabled: true }, 2);
    expect(a.fingerprint).toBe(b.fingerprint); expect(b.facts).not.toHaveProperty('enabled'); expect(b.availability).toEqual({ enabled: true, tick: 2 });
    const c = cache.read({ base: '2.0.77', quality: '2.0.77', custom: '2' }, { ...recipe, energy: 2 }, 3); expect(c.fingerprint).not.toBe(a.fingerprint);
    expect(() => cache.read({ custom: '1' }, recipe, 4)).toThrow('fingerprint');
    expect(() => cache.read({ base: '2.0.77', quality: '2.0.77', custom: '1' }, { ...recipe, energy: 3 }, 5)).toThrow('changed');
  });
  it('queries dynamic recipe availability on every gateway call and records exact results', async () => {
    const f = fixture(); let tick = 0;
    f.game.request = async input => { expect(input).toEqual({ op: 'recipe', name: 'gear' }); return { tick: ++tick, mods: { base: '2.0.77' }, recipe: { name: 'gear', energy: 1, enabled: tick > 1 } }; };
    const session = f.bind();
    expect(JSON.stringify(await f.gateway.call(session.token, 'recipe', { name: 'gear' }))).toContain('"enabled":false');
    expect(JSON.stringify(await f.gateway.call(session.token, 'recipe', { name: 'gear' }))).toContain('"enabled":true'); expect(tick).toBe(2);
  });
  it('does not release ordinary-gateway evaluator commands after assigning their task to gameplay', () => {
    const f = fixture(); assign(f);
    f.runtime.execution.intent({ commandId: 'hidden-reference', task: 'work', epoch: 'epoch', session: 'session', actor: 'builder-1', revision: 1, surface: 'nauvis', grants: [], deadline: 1000, steps: [] });
    const session = f.bind(); expect(JSON.stringify(session.context.briefing())).not.toContain('hidden-reference');
    expect(session.context.archive.get({ entity: 'commands', id: 'hidden-reference' })).toBeNull();
  });
  it('rechecks source restrictions on exact detail and payload artifacts after source access changes', () => {
    const f = fixture(); assign(f); const session = f.bind();
    const fact = f.runtime.evidence('public-transcript', { fact: 'task-local-fact' }, taskVisibility('work'));
    session.context.detail(ref(fact)); session.context.download(ref(fact), 0);
    const exact = f.runtime.journal.list<{ response: string }>('run', 'observations').map(o => o.response);
    const t = f.c.task('work'); f.runtime.record('reassigned', [{ entity: 'tasks', id: t.id, value: { ...t, owner: 'foreman' } }], taskVisibility(t.id));
    for (const id of exact) expect(session.context.archive.get({ entity: 'artifacts', id })).toBeNull();
    expect(session.context.archive.search('task-local-fact').total).toBe(0);
  });
  it('retains transitive provenance when search and download flatten child facts into text', () => {
    const f = fixture(); assign(f); const session = f.bind();
    const child = f.runtime.evidence('public-transcript', { fact: 'restricted-child-fact' }, taskVisibility('work'));
    const parent = f.runtime.evidence('public-transcript', { link: { ref: ref(child) } }, { kind: 'shared' });
    session.context.search('restricted-child-fact', 0); session.context.download(ref(parent), 0);
    const summary = session.context.archive.summarize([ref(parent)]);
    const exact = f.runtime.journal.list<{ response: string }>('run', 'observations').map(o => o.response);
    const t = f.c.task('work'); f.runtime.record('reassigned', [{ entity: 'tasks', id: t.id, value: { ...t, owner: 'foreman' } }], taskVisibility(t.id));
    for (const id of exact) expect(session.context.archive.get({ entity: 'artifacts', id })).toBeNull();
    expect(session.context.archive.get(summary)).toBeNull(); expect(session.context.archive.get(ref(parent))).not.toBeNull();
    expect(session.context.archive.search('restricted-child-fact').total).toBe(0);
  });
  it('returns the last admitted asynchronous tool result before closing its budget', async () => {
    const f = fixture(undefined, 1); let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
    f.game.request = async () => { await waiting; return { tick: 1, mods: { base: '2.0.77' }, recipe: { name: 'gear', enabled: true } }; };
    const session = f.bind(); const response = f.gateway.call(session.token, 'recipe', { name: 'gear' });
    expect(f.c.budget.get(session.b.turn).closed).toBe(false); release();
    expect(JSON.stringify(await response)).toContain('"enabled":true'); expect(f.c.budget.get(session.b.turn).closed).toBe(true);
    expect(() => f.gateway.call(session.token, 'observe', {})).toThrow('closed');
  });
  it('applies one aggregate entity budget across records and nested world inventories', async () => {
    const entries = Array.from({ length: 4 }, (_, i) => ({ ref: { entity: 'observations' as const, id: String(i) }, value: { entities: [{ x: 1 }, { x: 2 }, { x: 3 }] } }));
    const page = paginate(entries, 0, { bytes: 4096, entities: 4 }); expect(entityCost(page)).toBe(4); expect(page.next).toBe(1);
    const f = fixture(); assign(f); const t = f.c.task('work'); t.reservations = [{ kind: 'area', surface: 'nauvis', bounds: [{ x: 0, y: 0 }, { x: 4, y: 4 }] }];
    f.runtime.record('area', [{ entity: 'tasks', id: t.id, value: { ...t } }], taskVisibility(t.id));
    f.game.request = async () => ({ tick: 1, total: 1, entities: [{ name: 'chest', inventories: { chest: Array(100).fill({ name: 'plate', count: 1 }) } }], actors: {} });
    const output = await f.bind().context.world('work', 0, 0); expect(entityCost(output)).toBeLessThanOrEqual(30); expect(output).toMatchObject({ entities: [], next: 1, truncated: true }); expect(JSON.stringify(output)).toContain('Oversized entity');
  });
  it('replacement refreshes scoped world before returning durable work, without dispatch', async () => {
    const f = fixture(); assign(f); const t = f.c.task('work'); t.reservations = [{ kind: 'area', surface: 'nauvis', bounds: [{ x: 0, y: 0 }, { x: 4, y: 4 }] }];
    f.runtime.record('area', [{ entity: 'tasks', id: t.id, value: { ...t } }], taskVisibility(t.id));
    let queries = 0; f.game.request = async input => { expect(input).toMatchObject({ op: 'observe' }); queries++; return { tick: 999, total: 1, entities: [{ name: 'belt', position: { x: 1, y: 1 } }], actors: {} }; };
    const session = f.bind(); const result = await f.gateway.call(session.token, 'replacement', { task: 'work', area: 0, offset: 0 });
    expect(queries).toBe(1); expect(bytes(result)).toBeLessThanOrEqual(4096); expect(entityCost(result)).toBeLessThanOrEqual(30);
    expect(JSON.stringify(result)).toContain('999'); expect(JSON.stringify(result)).toContain('Restore input belt'); expect(f.runtime.execution.pending()).toHaveLength(0);
    expect(f.runtime.journal.list('run', 'observations')).toHaveLength(1);
  });
  it('preserves replacement component continuations and records only one actual delivery', async () => {
    const f = fixture(); assign(f);
    for (let i = 0; i < 15; i++) f.runtime.record('steering', [{ entity: 'interventions', id: 'steering-' + i, value: { text: `steering ${i}: ` + 'x'.repeat(200), recipient: 'engineer', delivery: 'pending' } }], privateTo('engineer'));
    const session = f.bind(); const result = await session.context.replacement('work', 0, 0) as { briefing: Page; briefingNext: { tool: string; offset: number } | null; worldNext: unknown };
    expect(bytes(result)).toBeLessThanOrEqual(4096); expect(result.briefing.omitted).toBeGreaterThan(0); expect(result.briefingNext?.tool).toBe('briefing'); expect(result.worldNext).toBeNull();
    expect(f.runtime.journal.list('run', 'observations')).toHaveLength(1);
    const all = [...result.briefing.items]; let cursor = result.briefingNext?.offset ?? null;
    while (cursor !== null) { const page = session.context.briefing(cursor) as Page; all.push(...page.items); cursor = page.next; }
    expect(all.filter(i => i.ref.entity === 'interventions')).toHaveLength(15);
  });
  it('keeps a new assignment and unresolved steering ahead of completed long-run history', () => {
    const f = fixture();
    for (let i = 0; i < 40; i++) f.runtime.record('old/task', [{ entity: 'tasks', id: 'old-' + i, value: { ...task(), id: 'old-' + i, status: 'succeeded', owner: 'engineer', manager: 'foreman', revision: 1, committedPlan: 'obsolete-layout-' + i } }], taskVisibility('old-' + i));
    assign(f); f.runtime.record('steering', [{ entity: 'interventions', id: 'advice', value: { text: 'Keep the new area clear', recipient: 'engineer', delivery: 'pending' } }], privateTo('engineer'));
    const session = f.bind(); const output = JSON.stringify(session.context.briefing());
    expect(output).toContain('Restore input belt'); expect(output).toContain('Keep the new area clear'); expect(output).not.toContain('obsolete-layout');
    expect(session.context.archive.search('obsolete-layout', 0, 'tasks').total).toBe(40);
  });
  it('retains pending effects and acknowledged-release warnings from terminal tasks alongside new work', () => {
    const f = fixture(); assign(f); f.c.cancel('foreman', 'work', 1);
    f.runtime.record('pending', [{ entity: 'commands', id: 'uncertain-command', value: { state: 'unknown', batch: { task: 'work' }, reason: 'inspect before retry' } }], taskVisibility('work'));
    f.runtime.record('revoking', [{ entity: 'reservations', id: 'old-reservation', value: { id: 'old-reservation', task: 'work', state: 'revoking', revision: 1, resources: [] } }]);
    f.runtime.record('new', [{ entity: 'tasks', id: 'new-work', value: { ...task(), id: 'new-work', goal: 'New objective', owner: 'engineer', manager: 'foreman', status: 'proposed' } }], taskVisibility('new-work'));
    const text = JSON.stringify(f.bind().context.briefing());
    for (const required of ['New objective', 'awaiting acknowledged release', 'uncertain-command', 'old-reservation', 'unknown']) expect(text).toContain(required);
  });
});
