import type { DurableRuntime } from '../../../apps/runtime/durable-runtime.js';
import type { Artifact } from '../../storage/src/artifacts.js';
import type { Change, Entity, Reference } from '../execution/durable.js';
import { permits, privateTo } from './authorization.js';
import type { Principal } from './authorization.js';

export interface Limits { bytes: number; entities: number }
export const DEFAULT_LIMITS: Limits = { bytes: 16_384, entities: 30 };
export interface Entry { ref: Reference; value: unknown }
export interface Page { items: Entry[]; total: number; omitted: number; next: number | null; truncated: boolean }
interface Node { ref: Reference; value: Record<string, unknown>; visibility: unknown; sources: Reference[] }
const key = (r: Reference) => `${r.entity}/${r.id}`;
export const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');
export function entityCost(v: unknown): number {
  if (Array.isArray(v)) return v.reduce((n, x) => n + 1 + entityCost(x), 0);
  if (v && typeof v === 'object') return Object.values(v).reduce<number>((n, x) => n + entityCost(x), 0);
  return 0;
}
export function limits(input: Limits): Limits {
  if (!Number.isSafeInteger(input.bytes) || input.bytes < 512 || input.bytes > 65_536 || !Number.isSafeInteger(input.entities) || input.entities < 1 || input.entities > 50) throw new Error('Invalid context limits');
  return { ...input };
}
export function offset(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid context offset'); return value;
}
/** Counts and offsets apply only AFTER authorization. Oversized entries consume a slot with an explicit omission. */
export function paginate(entries: Entry[], start: number, cap: Limits): Page {
  offset(start); limits(cap);
  const result: Page = { items: [], total: entries.length, omitted: 0, next: null, truncated: false };
  let cursor = Math.min(start, entries.length);
  const finish = () => { result.next = cursor < entries.length ? cursor : null; result.omitted = entries.length - result.items.length; result.truncated = result.omitted > 0 || result.items.some(i => typeof i.value === 'object' && i.value !== null && 'omitted' in i.value); };
  while (cursor < entries.length && result.items.length < cap.entities) {
    const original = entries[cursor]!;
    const entry = 1 + entityCost(original.value) > cap.entities ? { ref: original.ref, value: { omitted: 'entity-limit', detail: 'Retrieve bounded payload chunks by this reference.' } } : original;
    if (entityCost(result) + 1 + entityCost(entry.value) > cap.entities) break;
    result.items.push(entry); cursor++; finish();
    if (bytes(result) > cap.bytes) {
      result.items.pop(); cursor--; finish();
      if (result.items.length) break;
      result.items.push({ ref: entry.ref, value: { omitted: 'byte-limit', detail: 'Retrieve bounded payload chunks by this reference.' } }); cursor++; finish();
      if (bytes(result) > cap.bytes) throw new Error('Context identity exceeds response limit');
    }
  }
  finish(); return result;
}

/** Sole gameplay archive boundary. Raw journal/export APIs stay operator-internal. */
export class ContextArchive {
  constructor(readonly runtime: DurableRuntime, private readonly current: () => Principal, readonly cap: Limits = DEFAULT_LIMITS) { limits(cap); }
  private snapshot() {
    const principal = this.current();
    if (principal.run !== this.runtime.run) throw new Error('Run scope forbidden');
    const nodes = new Map<string, Node>();
    for (const event of this.runtime.journal.events().filter(e => e.run === principal.run)) {
      const changes: Change[] = event.changes;
      for (const c of changes) nodes.set(key(c), { ref: { entity: c.entity, id: c.id }, value: c.value, visibility: c.visibility ?? event.visibility, sources: c.sources ?? [] });
      const ref: Reference = { entity: 'events', id: String(event.sequence) };
      // Never export envelope correlations or raw mixed-visibility changes.
      nodes.set(key(ref), { ref, value: { type: event.type, wallTime: event.wallTime, gameTick: event.gameTick, changes: changes.map(c => ({ ref: { entity: c.entity, id: c.id } })) }, visibility: event.visibility, sources: changes.map(c => ({ entity: c.entity, id: c.id })) });
    }
    return { principal, nodes };
  }
  private authorized(node: Node | undefined, p: Principal, nodes: Map<string, Node>, stack = new Set<string>()): node is Node {
    if (!node || !permits(node.visibility, p) || stack.has(key(node.ref)) || stack.size >= 32) return false;
    const scope = ({ tasks: 'assigned-tasks', commands: 'assigned-tasks', reservations: 'assigned-tasks', messages: 'messages', agentHistory: 'history' } as Partial<Record<Entity | 'events', string>>)[node.ref.entity];
    if (scope && p.observations && !p.observations.includes(scope)) return false;
    if (node.ref.entity === 'artifacts') {
      if (node.value.run !== p.run || !permits(node.value.visibility, p) || !['agent-observation', 'public-transcript'].includes(String(node.value.purpose))) return false;
    }
    const next = new Set(stack).add(key(node.ref));
    return node.sources.every(r => this.authorized(nodes.get(key(r)), p, nodes, next));
  }
  private project(node: Node, p: Principal, nodes: Map<string, Node>, stack = new Set<string>()): unknown {
    const next = new Set(stack).add(key(node.ref));
    const allowed = (r: Reference) => this.authorized(nodes.get(key(r)), p, nodes);
    const scrub = (v: unknown, field = '', depth = 0): unknown => {
      if (depth > 32) return { omitted: 'depth-limit' };
      if (Array.isArray(v)) {
        if (['evidence', 'dependencies', 'resultingTasks', 'supersededTasks'].includes(field)) return v.filter(x => typeof x === 'string' && (['artifacts', 'commands', 'messages', 'tasks'] as Entity[]).some(entity => allowed({ entity, id: x })));
        return v.map(x => scrub(x, field, depth + 1));
      }
      if (!v || typeof v !== 'object') {
        if (typeof v === 'string' && ['telemetry', 'response', 'payload', 'parent', 'source', 'artifact', 'commandId'].includes(field)) return (['artifacts', 'commands', 'tasks'] as Entity[]).some(entity => allowed({ entity, id: v })) ? v : null;
        return v;
      }
      const obj = v as Record<string, unknown>;
      if ('ref' in obj) {
        const r = obj.ref as Reference;
        if (!r || typeof r !== 'object' || !allowed(r)) return { unavailable: true };
        if (next.has(key(r)) || next.size >= 16) return { ref: r, omitted: 'reference-depth' };
        return { ref: r, value: 'value' in obj ? scrub(obj.value, '', depth + 1) : this.project(nodes.get(key(r))!, p, nodes, next) };
      }
      return Object.fromEntries(Object.entries(obj).filter(([k]) => !['visibility', 'sources', 'sha256', 'directory', 'file'].includes(k)).map(([k, x]) => [k, scrub(x, k, depth + 1)]));
    };
    if (node.ref.entity === 'artifacts') {
      // Authorization is complete above; operator read here only verifies the bytes/checksum.
      const data = this.runtime.artifacts.read(node.value as unknown as Artifact, { kind: 'operator' });
      if (!data.available) return { unavailable: true };
      try { return scrub(JSON.parse(data.bytes.toString('utf8'))); } catch { return { unavailable: true }; }
    }
    return scrub(node.value);
  }
  entries(entity?: Entity | 'events'): Entry[] {
    const { principal, nodes } = this.snapshot();
    return [...nodes.values()].filter(n => (!entity || n.ref.entity === entity) && this.authorized(n, principal, nodes)).map(n => ({ ref: n.ref, value: this.project(n, principal, nodes) }));
  }
  get(ref: Reference): Entry | null { return this.entries(ref.entity).find(e => e.ref.id === ref.id) ?? null; }
  /** Include every visible transitive input before flattening a projection into snippets or JSON text. */
  provenance(refs: Reference[]): Reference[] {
    const { principal, nodes } = this.snapshot(); const found = new Map<string, Reference>();
    const visit = (ref: Reference) => {
      const node = nodes.get(key(ref));
      if (found.has(key(ref)) || !this.authorized(node, principal, nodes)) return;
      found.set(key(ref), ref); node.sources.forEach(visit);
      const walk = (v: unknown, field = '', depth = 0): void => {
        if (depth > 32) return;
        if (Array.isArray(v)) { for (const x of v) walk(x, field, depth + 1); return; }
        if (v && typeof v === 'object') {
          const obj = v as Record<string, unknown>;
          if (obj.ref && typeof obj.ref === 'object') visit(obj.ref as Reference);
          for (const [k, x] of Object.entries(obj)) walk(x, k, depth + 1);
        } else if (typeof v === 'string' && ['evidence', 'dependencies', 'resultingTasks', 'supersededTasks', 'telemetry', 'response', 'payload', 'parent', 'source', 'artifact', 'commandId'].includes(field)) {
          for (const entity of ['artifacts', 'commands', 'messages', 'tasks'] as Entity[]) visit({ entity, id: v });
        }
      };
      if (ref.entity === 'artifacts') {
        const data = this.runtime.artifacts.read(node.value as unknown as Artifact, { kind: 'operator' });
        if (data.available) { try { walk(JSON.parse(data.bytes.toString('utf8'))); } catch { /* Missing/corrupt content is not a source. */ } }
      } else walk(node.value);
    };
    refs.forEach(visit); return [...found.values()];
  }
  search(query: string, start = 0, entity?: Entity | 'events'): Page {
    if (typeof query !== 'string' || query.length > 200) throw new Error('Invalid context query');
    const entries = this.entries(entity).filter(e => JSON.stringify(e).toLowerCase().includes(query.toLowerCase())).map(e => ({ ref: e.ref, value: { snippet: JSON.stringify(e.value).slice(0, 200) } }));
    return paginate(entries, start, this.cap);
  }
  detail(ref: Reference): Page { const entry = this.get(ref); return paginate(entry ? [entry] : [], 0, this.cap); }
  /** JSON text chunks of the authorized projection, never raw artifact bytes or filenames. */
  download(ref: Reference, start = 0) {
    offset(start); const entry = this.get(ref);
    if (!entry) return { available: false as const };
    const text = JSON.stringify(entry.value);
    if (start > text.length || (start > 0 && /[\uDC00-\uDFFF]/.test(text[start] ?? ''))) throw new Error('Invalid payload offset');
    let end = Math.min(text.length, start + Math.floor(this.cap.bytes / 4));
    if (end > start && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
    const result = { available: true as const, text: text.slice(start, end), next: end < text.length ? end : null, total: Buffer.byteLength(text), truncated: end < text.length || start > 0 };
    while (bytes(result) > this.cap.bytes && end > start) { end--; if (end > start && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--; result.text = text.slice(start, end); result.next = end; result.truncated = true; }
    return result;
  }
  /** Deterministic extract, with conjunctive source provenance rechecked on every read. */
  summarize(refs: Reference[]): Reference {
    if (!Array.isArray(refs) || refs.length > this.cap.entities) throw new Error('Too many summary sources');
    const p = this.current(); const entries = refs.flatMap(ref => { const entry = this.get(ref); return entry ? [entry] : []; });
    const page = paginate(entries, 0, this.cap);
    const artifact = this.runtime.artifacts.put(this.runtime.context(privateTo(p.agent)), 'public-transcript', { kind: 'evidence-summary', ...page });
    this.runtime.record('context/summary', [{ entity: 'artifacts', id: artifact.id, value: { ...artifact }, sources: this.provenance(entries.map(e => e.ref)) }], privateTo(p.agent));
    return { entity: 'artifacts', id: artifact.id };
  }
}
