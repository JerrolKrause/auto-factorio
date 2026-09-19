import { createHash } from 'node:crypto';
import { DEFAULT_OPERATIONAL_LIMITS, OBSERVATION_SCHEMA, targetRequirements } from '@autofactorio/contracts';
import type { CoordinatedTask, InterventionRecord, MetricKind, ObservationScope, ProductionTarget, RunManifest } from '@autofactorio/contracts';
import type { Coordinator, SessionBinding } from '../orchestration/coordinator.js';
import { privateTo } from './authorization.js';
import { ContextArchive, DEFAULT_LIMITS, bytes, entityCost, limits, offset, paginate } from './archive.js';
import type { Entry, Limits, Page } from './archive.js';
import type { Reference } from '../execution/durable.js';
import { ObservationSnapshots, OperationalStore, OperationalWatches, targetReadings } from './operational.js';
import type { SnapshotFilter, WatchTransition } from './operational.js';

// Module map, policy rationale and regression tests: ./README.md.
const pick = (v: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter(k => k in v).map(k => [k, v[k]]));
const terminalStatus = (status: string) => ['succeeded', 'failed', 'cancelled', 'superseded'].includes(status);
const shared = new WeakMap<object, { snapshots: ObservationSnapshots; operational: OperationalStore; watches: OperationalWatches }>();
function state(coordinator: Coordinator) {
  let value = shared.get(coordinator.runtime);
  if (!value) {
    const manifest = coordinator.runtime.journal.get<RunManifest>(coordinator.runtime.run, 'runs', coordinator.runtime.run);
    const operational = new OperationalStore(coordinator.runtime, manifest?.operationalLimits ?? DEFAULT_OPERATIONAL_LIMITS);
    value = { operational, snapshots: new ObservationSnapshots(operational.limits), watches: new OperationalWatches(coordinator.runtime, operational.limits) }; shared.set(coordinator.runtime, value);
  }
  return value;
}
function commandSummary(entry: Entry) {
  const c = entry.value as Record<string, unknown>; const batch = (c.batch ?? {}) as Record<string, unknown>; const receipt = (c.receipt ?? null) as Record<string, unknown> | null;
  const steps = Array.isArray(receipt?.steps) ? receipt.steps as Record<string, unknown>[] : [];
  const failed = steps.find(s => s.status === 'failed');
  const known = c.state === 'acknowledged' && receipt !== null;
  return { ref: entry.ref, value: { kind: 'command-outcome', commandId: batch.commandId ?? entry.ref.id, task: batch.task ?? null, revision: batch.revision ?? null,
    certainty: known ? 'known' : 'unknown', status: known ? receipt.status : 'unknown', completed: known ? receipt.completed : null, remaining: known ? receipt.unexecuted : null,
    failedStep: failed?.index ?? null, reason: failed?.reason ?? c.reason ?? null, detail: entry.ref } };
}
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
  private readonly operational: OperationalStore;
  private readonly snapshots: ObservationSnapshots;
  private readonly watches: OperationalWatches;
  private conditionReconstructionRequired = false;
  private conditionTransitions: WatchTransition[] = [];
  constructor(private coordinator: Coordinator, private binding: SessionBinding, readonly cap: Limits = DEFAULT_LIMITS, private recipes = new RecipeCache(), private recordDelivery = true) {
    limits(cap); this.archive = new ContextArchive(coordinator.runtime, () => this.principal(), cap);
    ({ operational: this.operational, snapshots: this.snapshots, watches: this.watches } = state(coordinator));
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
    const work = tasks.map(e => ({ ref: e.ref, value: pick(e.value as Record<string, unknown>, ['id', 'goal', 'owner', 'manager', 'revision', 'committedPlan', 'status', 'wait', 'scope', 'reservations', 'dependencies', 'evidence', 'productionTarget']) }));
    // Release ownership status/grants for an already visible current task, excluding raw requests and receipts.
    const reservations: Entry[] = runtime.ownership.list().filter(r => tasks.some(t => t.ref.id === r.task)).map(r => ({ ref: { entity: 'tasks', id: r.task }, value: { kind: 'reservation', id: r.id, state: r.state, revision: r.revision, actor: r.actor, resources: r.resources } }));
    const steering = this.archive.entries('interventions').filter(e => {
      const i = e.value as InterventionRecord; return (i.recipient === p.agent || i.recipient === p.role || i.recipient === 'all') && !['resolved', 'superseded'].includes(i.delivery);
    });
    const relevant = new Set(tasks.map(t => t.ref.id));
    const commands = visibleCommands.filter(e => relevant.has(String((e.value as { batch?: { task?: string } }).batch?.task)));
    const pending = commands.filter(isPending).map(commandSummary);
    const outcomes = commands.filter(e => !commands.filter(isPending).includes(e)).slice(-5).reverse().map(commandSummary);
    const messages = this.archive.entries('messages').filter(e => relevant.has(String((e.value as { task?: string }).task))).slice(-5);
    const visibleWatches = this.watches.list().filter(w => {
      const currentScope = this.operational.scope(w.scopeId); const currentTask = tasks.find(t => t.ref.id === w.task)?.value as CoordinatedTask | undefined;
      const responsible = currentTask?.owner ?? currentTask?.manager;
      return relevant.has(w.task) && (responsible === p.agent || responsible === p.role) && currentScope?.revision === w.scopeRevision && currentTask?.revision === w.scopeRevision && !terminalStatus(currentTask.status);
    });
    const visibleWatchIds = new Set(visibleWatches.map(w => w.id)); const pendingConditions = this.watches.pendingFor(p.agent, visibleWatchIds);
    this.conditionReconstructionRequired = visibleWatches.length > 0 || pendingConditions.transitions.length > 0 || pendingConditions.gap;
    this.conditionTransitions = pendingConditions.transitions;
    // One encoded string has zero aggregate entity cost. This keeps the bounded
    // reconciliation envelope retrievable even when all allowed watches and
    // transitions are present; the versioned field lists make it deterministic.
    const encode = (rows: (string | number | boolean)[][]) => rows.map(row => row.map(value => encodeURIComponent(String(value))).join('|')).join('\n');
    const conditions: Entry[] = this.conditionReconstructionRequired ? [{ ref: { entity: 'observations', id: `conditions.${p.agent}` }, value: {
      kind: 'operational-conditions', encoding: 'uri-component-lines-v1',
      currentFields: 'watch|task|state|sinceTick|sequence', currentCount: visibleWatches.length, current: encode(visibleWatches.map(w => [w.id, w.task, w.state, w.sinceTick, w.sequence])),
      transitionFields: 'watch|sequence|state|tick|gap|metric', transitionCount: pendingConditions.transitions.length, transitions: encode(pendingConditions.transitions.map(t => [t.watch, t.sequence, t.state, t.tick, t.gap, t.metric])), gap: pendingConditions.gap,
    } }] : [];
    const view: Entry = { ref: { entity: 'agents', id: p.agent }, value: { kind: 'role-view', role: p.role, priorities: p.role === 'foreman' ? ['targets', 'measured supply', 'stock trends', 'dependencies', 'exceptions'] : p.role === 'engineer' ? ['objective', 'ownership', 'actor', 'unresolved commands', 'local symptoms'] : ['targets', 'ownership', 'actor', 'unresolved commands', 'exceptions'], actor: this.coordinator.agent(p.agent).actors.length ? { available: true, inspect: { view: 'actor' } } : { available: false, bodyless: true } } };
    const page = paginate([objective, view, ...work, ...conditions, ...steering, ...reservations, ...pending, ...outcomes, ...messages], start, this.cap);
    // Objective and reservation projections are explicit declassifications; provenance stays in operator telemetry.
    const result = this.delivered(page, { kind: 'replacement-briefing', page, epoch: runtime.context().epoch }, [...tasks, ...commands, ...steering, ...messages].map(t => t.ref));
    const deliveredConditions = page.items.some(item => item.ref.id === `conditions.${p.agent}` && (item.value as Record<string, unknown>)?.kind === 'operational-conditions');
    if (this.recordDelivery && deliveredConditions) this.watches.acknowledge(p.agent, pendingConditions.transitions);
    return result;
  }
  conditionsComplete(page: Page) { return !this.conditionReconstructionRequired || page.items.some(item => item.ref.id === `conditions.${this.principal().agent}` && (item.value as Record<string, unknown>)?.kind === 'operational-conditions'); }
  deliveredConditionTransitions(page: Page) { return this.conditionsComplete(page) ? this.conditionTransitions : []; }
  search(query: string, start: number) { const page = this.archive.search(query, start); return this.delivered(page, page, page.items.map(i => i.ref)); }
  detail(ref: Reference) { const page = this.archive.detail(ref); return this.delivered(page, page, page.items.map(i => i.ref)); }
  download(ref: Reference, start: number) { const result = this.archive.download(ref, start); return this.delivered(result, result, result.available ? [ref] : []); }
  summary(refs: Reference[]) { const ref = this.archive.summarize(refs); return this.delivered({ ref }, { ref }, [ref]); }
  command(commandId: string) {
    const entry = this.archive.get({ entity: 'commands', id: commandId });
    if (!entry) throw new Error('Command scope forbidden');
    return this.delivered(commandSummary(entry).value, { kind: 'compact-command', source: entry.value }, [entry.ref]);
  }
  async actor(taskId: string, areaIndex: number) {
    const { p, task, area } = this.authorizedArea(taskId, areaIndex);
    const response = await this.coordinator.runtime.query({ op: 'observe', surface: area.surface, area: area.bounds, offset: 0, limit: 1 });
    this.recheckTask(task);
    const actors = response.actors as Record<string, Record<string, unknown>>;
    const own: Record<string, unknown>[] = this.coordinator.agent(p.agent).actors.filter(a => a === task.actor && actors?.[a]).map(a => ({ id: a, ...pick(actors[a]!, ['position', 'surface', 'inventory', 'walking', 'mining', 'crafting', 'connected', 'buildDistance', 'reachDistance', 'runningSpeed', 'miningSpeed', 'craftingSpeed']) }));
    const result = { tick: response.tick, task: taskId, actors: own, bodyless: task.actor === null };
    while ((bytes(result) > this.cap.bytes || entityCost(result) > this.cap.entities) && own[0] && Array.isArray(own[0].inventory) && own[0].inventory.length) own[0].inventory.pop();
    return this.delivered(result, response, [{ entity: 'tasks', id: taskId }]);
  }
  private authorizedArea(taskId: string, areaIndex: number) {
    const p = this.principal(); offset(areaIndex);
    const task = this.archive.get({ entity: 'tasks', id: taskId })?.value as CoordinatedTask | undefined;
    const area = task?.reservations.filter(r => r.kind === 'area')[areaIndex];
    if (!task || !p.tasks.includes(taskId) || !area || area.kind !== 'area') throw new Error('World scope forbidden');
    return { p, task, area };
  }
  private recheckTask(task: CoordinatedTask) {
    this.principal(); const current = this.archive.get({ entity: 'tasks', id: task.id })?.value as CoordinatedTask | undefined;
    if (!current || current.revision !== task.revision || JSON.stringify(current.reservations) !== JSON.stringify(task.reservations)) throw new Error('World scope changed');
    return current;
  }
  /** Replacement needs current world evidence as well as durable memory; neither step dispatches actions. */
  async replacement(taskId: string, areaIndex: number, start: number) {
    const principal = this.principal();
    const task = this.archive.get({ entity: 'tasks', id: taskId })?.value as CoordinatedTask | undefined;
    if (!task) throw new Error('Replacement scope forbidden');
    const child = new AgentContext(this.coordinator, this.binding, this.cap, this.recipes, false);
    const hasArea = task.reservations.some(r => r.kind === 'area');
    const world = hasArea ? await child.world(taskId, areaIndex, start) as Record<string, unknown> : { omitted: 'No world area assigned' };
    // Rebuild after the asynchronous refresh so assignment and pending-intent state are current.
    const briefing = child.briefing() as Page;
    const worldSnapshot = typeof world.snapshot === 'string' ? world.snapshot : undefined;
    const continuation = (position: unknown) => hasArea && typeof position === 'number' ? { tool: 'world', task: taskId, area: areaIndex, offset: position, ...(worldSnapshot ? { cursor: worldSnapshot } : {}) } : null;
    const budget = this.coordinator.budget.snapshot();
    const result = { briefing, world, budget: { elapsedMs: budget.elapsedMs, spentTurns: budget.spentTurns, attempts: budget.attempts, reportedTokens: budget.reportedTokens, closed: budget.closed, reason: budget.reason }, reconstruction: { conditionsComplete: false }, briefingNext: briefing.next === null ? null : { tool: 'briefing', offset: briefing.next }, worldNext: continuation(world.next) };
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
    result.reconstruction.conditionsComplete = child.conditionsComplete(briefing);
    const delivered = this.delivered(result, { kind: 'replacement-with-world', components: child.telemetry }, [{ entity: 'tasks', id: taskId }, ...briefing.items.map(t => t.ref)]);
    if (result.reconstruction.conditionsComplete) this.watches.acknowledge(principal.agent, child.deliveredConditionTransitions(briefing));
    return delivered;
  }
  async world(taskId: string, areaIndex: number, start: number, filter: SnapshotFilter = {}, cursor?: string) {
    offset(start); const { p, task, area } = this.authorizedArea(taskId, areaIndex);
    const allowedFields = ['name', 'quality', 'position', 'unit', 'direction', 'type', 'protected', 'inventories', 'recipe', 'craftingSpeed', 'status', 'power'];
    if (filter.fields?.length === 0 || filter.fields?.some(f => !allowedFields.includes(f)) || filter.types?.some(v => typeof v !== 'string') || filter.names?.some(v => typeof v !== 'string')) throw new Error('Unsupported world filter');
    if (filter.subarea) {
      const [from, to] = filter.subarea;
      if (from.x < area.bounds[0].x || from.y < area.bounds[0].y || to.x > area.bounds[1].x || to.y > area.bounds[1].y || from.x > to.x || from.y > to.y) throw new Error('Subarea outside authorized scope');
    }
    let snapshot: ReturnType<ObservationSnapshots['read']>; let telemetry: unknown;
    if (cursor) snapshot = this.snapshots.read(cursor, p.agent, taskId, task.revision, filter);
    else {
      const queryArea = filter.subarea ?? area.bounds; const all: Record<string, unknown>[] = []; const rawPages: unknown[] = []; let gameOffset = 0; let tick = 0;
      for (;;) {
        const response = await this.coordinator.runtime.query({ op: 'observe', surface: area.surface, area: queryArea, offset: gameOffset, limit: Math.min(50, this.cap.entities) }); rawPages.push(response); tick = Number(response.tick ?? tick);
        const page = Array.isArray(response.entities) ? response.entities as Record<string, unknown>[] : [];
        all.push(...page); if (all.length > this.operational.limits.maxEntities) throw new Error('Observation scope exceeds registered entity limit');
        if (response.nextOffset === undefined || response.nextOffset === null) break; gameOffset = Number(response.nextOffset);
      }
      this.recheckTask(task);
      const selected = all.filter(e => (!filter.types || filter.types.includes(String(e.type))) && (!filter.names || filter.names.includes(String(e.name))))
        .map(e => pick(e, filter.fields?.length ? filter.fields : allowedFields));
      const id = this.snapshots.create(p.agent, taskId, task.revision, tick, filter, selected);
      snapshot = this.snapshots.read(id, p.agent, taskId, task.revision, filter);
      telemetry = { kind: 'world-snapshot-source', filter, pages: rawPages };
    }
    this.recheckTask(task);
    const entries = snapshot.entities.map((e, i) => ({ ref: { entity: 'observations' as const, id: `${snapshot.id}.${i}` }, value: e }));
    const page = paginate(entries, start, this.cap);
    const oversized = page.items.length === 1 && typeof page.items[0]!.value === 'object' && page.items[0]!.value !== null && 'omitted' in page.items[0]!.value;
    const output = { tick: snapshot.tick, surface: area.surface, scope: { from: filter.subarea?.[0] ?? area.bounds[0], to: filter.subarea?.[1] ?? area.bounds[1], taskRevision: task.revision }, snapshot: snapshot.id, fields: (filter.fields ?? allowedFields).join(','), entities: oversized ? [] : page.items.map(i => i.value), total: page.total, next: oversized ? start + 1 : page.next, truncated: oversized || page.truncated, omitted: oversized ? `Oversized entity at offset ${start}` : page.omitted, freshness: 'Bounded snapshot; continuations retain filters and recheck live authorization.' };
    return this.delivered(output, telemetry ?? output, [{ entity: 'tasks', id: taskId }]);
  }
  async machines(taskId: string, areaIndex: number, start: number, names?: string[], fields: string[] = ['name', 'quality', 'position', 'unit', 'status', 'recipe', 'inventories', 'power'], cursor?: string, subarea?: [{ x: number; y: number }, { x: number; y: number }]) {
    return this.world(taskId, areaIndex, start, { types: ['assembling-machine'], ...(names ? { names } : {}), fields, ...(subarea ? { subarea } : {}) }, cursor);
  }
  private async ensureOperationalScope(taskId: string, areaIndex: number) {
    const { task, area } = this.authorizedArea(taskId, areaIndex); const id = `${task.id}.area.${areaIndex}`;
    let scope = this.operational.scope(id);
    if (!scope || scope.revision !== task.revision) {
      const next: ObservationScope = { schema: OBSERVATION_SCHEMA, id, revision: task.revision, task: task.id, surface: area.surface, area: area.bounds, entityLimit: this.operational.limits.maxEntities };
      await this.coordinator.runtime.query({ op: 'operational-register', scope: next, sampleTicks: this.operational.limits.sampleTicks, historySamples: this.operational.limits.historySamples });
      this.recheckTask(task); scope = this.operational.register(next, { kind: 'restricted', agents: [], roles: [], tasks: [task.id] });
      if (task.productionTarget && !this.watches.list().some(w => w.scopeId === scope!.id && w.task === task.id && w.scopeRevision === scope!.revision)) {
        const role = task.owner ?? task.manager;
        this.watches.register({ id: `target.${scope.id}`, role, task: task.id, scopeId: scope.id, scopeRevision: scope.revision, metric: { kind: 'production', name: task.productionTarget.name, quality: task.productionTarget.quality, surface: task.productionTarget.surface }, threshold: task.productionTarget.rate * 0.95, recovery: task.productionTarget.rate * 1.05, persistenceTicks: this.operational.limits.watchPersistenceTicks }, { kind: 'restricted', agents: [], roles: [], tasks: [task.id] });
      }
    }
    const prior = this.operational.samples(id, scope.revision).at(-1)?.tick ?? -1;
    const response = await this.coordinator.runtime.query({ op: 'operational-read', scopeId: id, scopeRevision: scope.revision, afterTick: prior });
    this.recheckTask(task);
    for (const raw of Array.isArray(response.samples) ? response.samples : []) this.operational.ingest(raw as never, { kind: 'restricted', agents: [], roles: [], tasks: [task.id] });
    return { scope, tick: Number(response.tick ?? prior) };
  }
  async metrics(taskId: string, areaIndex: number, windowTicks: number, kinds?: MetricKind[], items?: string[]) {
    const { scope, tick } = await this.ensureOperationalScope(taskId, areaIndex);
    const metrics = this.operational.metrics(scope.id, windowTicks, tick, kinds, items);
    const task = this.archive.get({ entity: 'tasks', id: taskId })?.value as CoordinatedTask;
    let requirements: unknown = { supported: false, reason: 'no_validated_target' };
    if (task.productionTarget) {
      const response = await this.coordinator.runtime.query({ op: 'recipe', name: task.productionTarget.recipe }); this.recheckTask(task);
      const recipe = this.recipes.read(response.mods, response.recipe as Record<string, unknown>, response.tick);
      requirements = targetRequirements(task.productionTarget, recipe.facts as never);
      const inputs = (requirements as { supported: boolean }).supported ? (requirements as { inputs: ProductionTarget[] }).inputs : [];
      if (!kinds || kinds.includes('target-demand')) for (const reading of targetReadings(task.productionTarget, inputs, scope)) {
        if (items && !items.includes(reading.name)) continue;
        metrics.push({ schema: OBSERVATION_SCHEMA, scopeId: scope.id, scopeRevision: scope.revision, epoch: this.coordinator.runtime.context().epoch, kind: 'target-demand', name: reading.name, quality: reading.quality, surface: reading.surface, quantity: reading.total! * windowTicks / 60, rate: reading.total, unit: 'items-per-game-second', startTick: Math.max(0, tick - windowTicks), endTick: tick, ageTicks: 0, coverage: 'complete', method: reading.method, evidence: reading.evidence });
      }
      if (kinds?.includes('nominal-capacity') && (!items || items.includes(task.productionTarget.name))) metrics.push({ schema: OBSERVATION_SCHEMA, scopeId: scope.id, scopeRevision: scope.revision, epoch: this.coordinator.runtime.context().epoch, kind: 'nominal-capacity', name: task.productionTarget.name, quality: task.productionTarget.quality, surface: task.productionTarget.surface, quantity: null, rate: null, unit: 'items-per-game-second', startTick: Math.max(0, tick - windowTicks), endTick: tick, ageTicks: 0, coverage: 'unknown', reason: 'machine_capacity_not_sampled', method: 'explicit-unsupported-v1', evidence: [`task:${task.id}`] });
    }
    const specialWithoutTarget = !task.productionTarget && kinds?.some(kind => kind === 'target-demand' || kind === 'nominal-capacity');
    const unknown = metrics.length ? null : specialWithoutTarget ? 'A validated production target is required for target demand or capacity.' : (requirements as { supported?: boolean; reason?: string }).supported === false && kinds?.includes('target-demand') ? `Target inputs unavailable: ${(requirements as { reason?: string }).reason ?? 'unsupported recipe'}.` : 'No completed supported samples yet.';
    return this.delivered({ schema: OBSERVATION_SCHEMA, scope: { id: scope.id, revision: scope.revision }, tick, windowTicks, metrics, requirements, unknown }, { kind: 'operational-metrics', metrics, requirements, unknown }, [{ entity: 'tasks', id: taskId }, { entity: 'operationalScopes', id: scope.id }]);
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
