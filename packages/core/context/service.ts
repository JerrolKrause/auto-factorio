import { createHash } from 'node:crypto';
import type { CoordinatedTask, InterventionRecord, RunManifest } from '@autofactorio/contracts';
import type { Coordinator, SessionBinding } from '../orchestration/coordinator.js';
import { privateTo } from './authorization.js';
import { ContextArchive, DEFAULT_LIMITS, bytes, entityCost, limits, offset, paginate } from './archive.js';
import type { Entry, Limits, Page } from './archive.js';
import type { Reference } from '../execution/durable.js';

// Module map, policy rationale and regression tests: ./README.md.
const pick = (v: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter(k => k in v).map(k => [k, v[k]]));
/** Instance survives session replacement; facts never include force/research availability. */
export class RecipeCache {
  private facts = new Map<string, unknown>();
  read(mods: unknown, recipe: Record<string, unknown>, tick: unknown) {
    if (!mods || typeof mods !== 'object' || Array.isArray(mods)) throw new Error('Missing complete game/mod fingerprint');
    const entries = Object.entries(mods).sort(([a], [b]) => a.localeCompare(b));
    if (!entries.some(([name]) => name === 'base') || entries.some(([name, version]) => !name || typeof version !== 'string' || !version)) throw new Error('Missing complete game/mod fingerprint');
    if (typeof recipe.name !== 'string' || typeof recipe.enabled !== 'boolean' || !Number.isSafeInteger(tick)) throw new Error('Invalid current recipe availability');
    const fingerprint = createHash('sha256').update(JSON.stringify(entries)).digest('hex');
    const key = fingerprint + '/' + recipe.name;
    const facts = pick(recipe, ['name', 'energy', 'category', 'ingredients', 'products']);
    // The ordinary query currently returns both. Reject silent prototype drift under a pinned fingerprint.
    if (this.facts.has(key) && JSON.stringify(this.facts.get(key)) !== JSON.stringify(facts)) throw new Error('Recipe facts changed under the same fingerprint');
    this.facts.set(key, structuredClone(facts));
    return { fingerprint, mods: Object.fromEntries(entries), facts: structuredClone(this.facts.get(key)), availability: { enabled: recipe.enabled, tick } };
  }
}

/** Only the authenticated gateway constructs this service; every operation rechecks current identity. */
export class AgentContext {
  readonly archive: ContextArchive;
  private telemetry: unknown[] = [];
  constructor(private coordinator: Coordinator, private binding: SessionBinding, readonly cap: Limits = DEFAULT_LIMITS, private recipes = new RecipeCache(), private recordDelivery = true) {
    limits(cap); this.archive = new ContextArchive(coordinator.runtime, () => this.principal(), cap);
  }
  private principal() { this.coordinator.authenticate(this.binding, 'observe'); return this.coordinator.principal(this.binding.agent); }
  private delivered(value: unknown, telemetry: unknown = value, sources: Reference[] = []) {
    const p = this.principal();
    if (bytes(value) > this.cap.bytes || entityCost(value) > this.cap.entities) throw new Error('Context response exceeds limit');
    // Replacement components are internal evidence, not separate observations delivered to an agent.
    // recordDelivery=false buffers them as telemetry; only the final bounded composite is recorded.
    if (!this.recordDelivery) {
      this.telemetry.push({ value, telemetry });
      return value;
    }
    return this.coordinator.runtime.observation(value, telemetry, privateTo(p.agent), this.archive.provenance(sources));
  }
  briefing(start = 0) {
    const p = this.principal();
    const runtime = this.coordinator.runtime;
    const manifest = runtime.journal.get<RunManifest>(runtime.run, 'runs', runtime.run);
    const visibleTasks = this.archive.entries('tasks');
    const visibleCommands = this.archive.entries('commands');
    const isPending = (e: Entry) => {
      const c = e.value as { state: string; receipt?: { status: string } };
      return c.state !== 'rolled_back' && !['completed', 'failed', 'partial', 'cancelled'].includes(c.receipt?.status ?? '');
    };
    // Terminal task status does not settle game effects or release ownership. Keep that work visible
    // until reconciliation finishes, even when a newer active task would otherwise displace it.
    const unsettled = new Set([
      ...visibleCommands.filter(isPending).map(e => String((e.value as { batch?: { task?: string } }).batch?.task)),
      ...runtime.ownership.list().filter(r => r.state !== 'released').map(r => r.task),
    ]);
    const activeTasks = visibleTasks.filter(e => !['succeeded', 'failed', 'cancelled', 'superseded'].includes(String((e.value as Record<string, unknown>).status)));
    const currentTasks = [...activeTasks, ...visibleTasks.filter(e => unsettled.has(e.ref.id) && !activeTasks.includes(e))];
    const tasks = currentTasks.length ? currentTasks : visibleTasks.slice(-1);
    // Purpose-built release of the public objective; seed, reference plans and operator manifest stay private.
    const objective: Entry = { ref: { entity: 'runs', id: runtime.run }, value: { objective: manifest?.objective ?? 'Complete assigned tasks', scenario: manifest?.scenario ?? null } };
    const work = tasks.map(e => ({ ref: e.ref, value: pick(e.value as Record<string, unknown>, ['id', 'goal', 'owner', 'manager', 'revision', 'committedPlan', 'status', 'wait', 'scope', 'reservations', 'dependencies', 'evidence']) }));
    // Release ownership status/grants for an already visible current task, excluding raw requests and receipts.
    const reservations: Entry[] = runtime.ownership.list().filter(r => tasks.some(t => t.ref.id === r.task)).map(r => ({ ref: { entity: 'tasks', id: r.task }, value: { kind: 'reservation', id: r.id, state: r.state, revision: r.revision, actor: r.actor, resources: r.resources } }));
    const steering = this.archive.entries('interventions').filter(e => {
      const i = e.value as InterventionRecord; return (i.recipient === p.agent || i.recipient === p.role || i.recipient === 'all') && !['resolved', 'superseded'].includes(i.delivery);
    });
    const relevant = new Set(tasks.map(t => t.ref.id));
    const commands = visibleCommands.filter(e => relevant.has(String((e.value as { batch?: { task?: string } }).batch?.task)));
    const pending = commands.filter(isPending);
    const outcomes = commands.filter(e => !pending.includes(e)).slice(-5).reverse();
    const messages = this.archive.entries('messages').filter(e => relevant.has(String((e.value as { task?: string }).task))).slice(-5);
    const page = paginate([objective, ...work, ...steering, ...reservations, ...pending, ...outcomes, ...messages], start, this.cap);
    // Objective and reservation projections are explicit declassifications; provenance stays in operator telemetry.
    return this.delivered(page, { kind: 'replacement-briefing', page, epoch: runtime.context().epoch }, [...tasks, ...commands, ...steering, ...messages].map(t => t.ref));
  }
  search(query: string, start: number) { const page = this.archive.search(query, start); return this.delivered(page, page, page.items.map(i => i.ref)); }
  detail(ref: Reference) { const page = this.archive.detail(ref); return this.delivered(page, page, page.items.map(i => i.ref)); }
  download(ref: Reference, start: number) { const result = this.archive.download(ref, start); return this.delivered(result, result, result.available ? [ref] : []); }
  summary(refs: Reference[]) { const ref = this.archive.summarize(refs); return this.delivered({ ref }, { ref }, [ref]); }
  /** Replacement needs current world evidence as well as durable memory; neither step dispatches actions. */
  async replacement(taskId: string, areaIndex: number, start: number) {
    this.principal();
    const task = this.archive.get({ entity: 'tasks', id: taskId })?.value as CoordinatedTask | undefined;
    if (!task) throw new Error('Replacement scope forbidden');
    const child = new AgentContext(this.coordinator, this.binding, this.cap, this.recipes, false);
    const hasArea = task.reservations.some(r => r.kind === 'area');
    const world = hasArea ? await child.world(taskId, areaIndex, start) as Record<string, unknown> : { omitted: 'No world area assigned' };
    // Rebuild after the asynchronous refresh so assignment and pending-intent state are current.
    const briefing = child.briefing() as Page;
    const continuation = (position: unknown) => hasArea && typeof position === 'number' ? { tool: 'world', task: taskId, area: areaIndex, offset: position } : null;
    const result = { briefing, world, briefingNext: briefing.next === null ? null : { tool: 'briefing', offset: briefing.next }, worldNext: continuation(world.next) };
    const exceeds = () => bytes(result) > this.cap.bytes || entityCost(result) > this.cap.entities;
    // Prefer a useful durable briefing over a large first world page; the fresh tick and valid replay scope remain explicit.
    if (exceeds()) {
      result.world = { tick: world.tick, omitted: hasArea ? 'Combined response limit; retrieve the refreshed scope with worldNext.' : 'No world area assigned' };
      result.worldNext = continuation(start);
    }
    while (exceeds() && briefing.items.length) {
      briefing.items.pop();
      briefing.next = briefing.items.length;
      briefing.omitted = briefing.total - briefing.items.length;
      briefing.truncated = true;
      result.briefingNext = { tool: 'briefing', offset: briefing.next };
    }
    return this.delivered(result, { kind: 'replacement-with-world', components: child.telemetry }, [{ entity: 'tasks', id: taskId }, ...briefing.items.map(t => t.ref)]);
  }
  async world(taskId: string, areaIndex: number, start: number) {
    const p = this.principal();
    offset(start);
    offset(areaIndex);
    const task = this.archive.get({ entity: 'tasks', id: taskId })?.value as CoordinatedTask | undefined;
    const area = task?.reservations.filter(r => r.kind === 'area')[areaIndex];
    if (!task || !p.tasks.includes(taskId) || !area || area.kind !== 'area') throw new Error('World scope forbidden');
    const response = await this.coordinator.runtime.query({ op: 'observe', surface: area.surface, area: area.bounds, offset: start, limit: this.cap.entities });
    // A role/task/session may change while the game query is in flight.
    this.principal();
    const current = this.archive.get({ entity: 'tasks', id: taskId })?.value as CoordinatedTask | undefined;
    if (!current || current.revision !== task.revision || JSON.stringify(current.reservations) !== JSON.stringify(task.reservations)) throw new Error('World scope changed');
    const entities = (response.entities as Record<string, unknown>[]).map(e => pick(e, ['name', 'quality', 'position', 'unit', 'direction', 'type', 'protected', 'inventories', 'recipe', 'craftingSpeed']));
    const receivedCount = entities.length;
    const actors = response.actors as Record<string, Record<string, unknown>>;
    const ownActors = this.coordinator.agent(p.agent).actors.filter(a => a === task.actor && actors[a]).map(a => ({ id: a, ...pick(actors[a]!, ['position', 'surface', 'inventory', 'walking', 'mining', 'crafting', 'connected', 'buildDistance', 'reachDistance', 'runningSpeed', 'miningSpeed', 'craftingSpeed']) }));
    const output = { tick: response.tick, surface: area.surface, scope: { from: area.bounds[0], to: area.bounds[1] }, entities, actors: ownActors, total: response.total, next: response.nextOffset ?? null, truncated: response.truncated === true, omitted: '', freshness: 'Independent live page; refresh after replacement or world changes.' };
    const exceeds = () => bytes(output) > this.cap.bytes || entityCost(output) > this.cap.entities;
    if (exceeds() && output.actors.length) {
      output.actors = [];
      output.omitted = 'Actor detail exceeds response limits. ';
      output.truncated = true;
    }
    while (exceeds() && output.entities.length) {
      output.entities.pop();
      output.next = start + output.entities.length;
      output.truncated = true;
    }
    if (receivedCount > 0 && output.entities.length === 0) {
      output.next = start + 1;
      output.omitted += 'Oversized entity at offset ' + start;
    }
    return this.delivered(output, response, [{ entity: 'tasks', id: taskId }]);
  }
  async recipe(name: string) {
    this.principal();
    const response = await this.coordinator.runtime.query({ op: 'recipe', name });
    this.principal();
    const result = this.recipes.read(response.mods, response.recipe as Record<string, unknown>, response.tick);
    const page = paginate([{ ref: { entity: 'observations', id: name }, value: result }], 0, this.cap);
    return this.delivered(page, response);
  }
}
