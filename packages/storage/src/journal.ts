import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Change, Entity, Event, EventContext, Journal, Visibility } from '../../core/execution/durable.js';

export const entities: Entity[] = ['runs', 'agents', 'tasks', 'messages', 'observations', 'commands', 'measurements', 'interventions', 'checkpoints', 'budgets', 'artifacts', 'reservations', 'agentHistory', 'operationalScopes', 'operationalSamples', 'operationalWatches', 'watchTransitions', 'watchAcknowledgements', 'contextDeliveries', 'sessionLifecycle'];
export function visibility(v: Visibility): void {
  if (!v || !['operator', 'shared', 'restricted'].includes(v.kind)) throw new Error('Explicit visibility required');
  if (v.kind === 'restricted' && (!['agents', 'roles', 'tasks'].every(k => Array.isArray(v[k as 'agents'])) || [...v.agents, ...v.roles, ...v.tasks].some(x => typeof x !== 'string' || !x))) throw new Error('Invalid restricted scope');
}
/** Single runtime connection owns writes AND reads; SQLite releases the exclusive lock on process death. */
export class SqliteJournal implements Journal {
  private db: Database.Database;
  constructor(readonly file: string, private readonly sanitize: (value: unknown) => unknown = v => v) {
    mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file, { timeout: 100 });
    try {
      this.db.pragma('locking_mode = EXCLUSIVE');
      if (this.db.pragma('journal_mode = WAL', { simple: true }) !== 'wal') throw new Error('WAL required');
      this.db.pragma('synchronous = FULL');
      this.db.transaction(() => {
        const version = Number(this.db.pragma('user_version', { simple: true }));
        if (version > 1) throw new Error('Unsupported database migration');
        if (!version) {
          this.db.exec(`CREATE TABLE migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
            CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, json TEXT NOT NULL);
            CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'append-only events'); END;
            CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'append-only events'); END;
            CREATE TABLE projections(run TEXT NOT NULL, entity TEXT NOT NULL, id TEXT NOT NULL, sequence INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY(run,entity,id));
            CREATE TABLE outbox(run TEXT NOT NULL, id TEXT NOT NULL, sequence INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY(run,id));
            INSERT INTO migrations VALUES(1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
            PRAGMA user_version = 1;`);
        }
      }).exclusive();
    } catch (error) { this.db.close(); throw error; }
  }
  append(context: EventContext, type: string, changes: Change[]): Event {
    visibility(context.visibility);
    for (const change of changes) if (change.visibility) visibility(change.visibility);
    if (!context.run || !context.epoch || !type || !Number.isFinite(Date.parse(context.wallTime)) || (context.gameTick !== null && (!Number.isSafeInteger(context.gameTick) || context.gameTick < 0))) throw new Error('Invalid event envelope');
    if (!changes.length || changes.some(c => !entities.includes(c.entity) || !c.id || !c.value || Array.isArray(c.value))) throw new Error('Invalid projection change');
    const safe = JSON.parse(JSON.stringify(this.sanitize({ ...context, version: 1, type, changes }))) as Omit<Event, 'sequence'>;
    return this.db.transaction(() => {
      const result = this.db.prepare('INSERT INTO events(json) VALUES(?)').run(JSON.stringify(safe));
      const event: Event = { ...safe, sequence: Number(result.lastInsertRowid) };
      this.project(event); return event;
    })();
  }
  private project(event: Event): void {
    if (event.version !== 1) throw new Error('Unsupported event version');
    for (const change of event.changes) {
      this.db.prepare('INSERT INTO projections VALUES(?,?,?,?,?) ON CONFLICT(run,entity,id) DO UPDATE SET sequence=excluded.sequence,json=excluded.json').run(event.run, change.entity, change.id, event.sequence, JSON.stringify(change.value));
      if (change.entity === 'commands') this.db.prepare('INSERT INTO outbox VALUES(?,?,?,?) ON CONFLICT(run,id) DO UPDATE SET sequence=excluded.sequence,json=excluded.json').run(event.run, change.id, event.sequence, JSON.stringify(change.value));
    }
  }
  get<T>(run: string, entity: Entity, id: string): T | undefined {
    const row = this.db.prepare('SELECT json FROM projections WHERE run=? AND entity=? AND id=?').get(run, entity, id) as { json: string } | undefined;
    return row ? JSON.parse(row.json) as T : undefined;
  }
  list<T>(run: string, entity: Entity): T[] { return (this.db.prepare('SELECT json FROM projections WHERE run=? AND entity=? ORDER BY id').all(run, entity) as { json: string }[]).map(r => JSON.parse(r.json) as T); }
  rows(run: string, entity: Entity): Record<string, unknown>[] {
    return (this.db.prepare('SELECT id,json FROM projections WHERE run=? AND entity=? ORDER BY id').all(run, entity) as { id: string; json: string }[]).map(r => ({ ...JSON.parse(r.json), id: r.id }));
  }
  events(): Event[] { return (this.db.prepare('SELECT sequence,json FROM events ORDER BY sequence').all() as { sequence: number; json: string }[]).map(r => ({ ...JSON.parse(r.json), sequence: r.sequence } as Event)); }
  cursor(): number { return Number((this.db.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM events').get() as { n: number }).n); }
  /** Bounded durable replay; sequence identities survive browser and runtime replacement. */
  page(run: string, after: number, limit = 100): Event[] {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid event page');
    return (this.db.prepare("SELECT sequence,json FROM events WHERE sequence>? AND json_extract(json,'$.run')=? ORDER BY sequence LIMIT ?").all(after, run, limit) as { sequence: number; json: string }[])
      .map(r => ({ ...JSON.parse(r.json), sequence: r.sequence } as Event));
  }
  snapshot(): unknown { return { projections: this.db.prepare('SELECT * FROM projections ORDER BY run,entity,id').all(), outbox: this.db.prepare('SELECT * FROM outbox ORDER BY run,id').all() }; }
  rebuild(): void { this.db.transaction(() => { this.db.exec('DELETE FROM projections; DELETE FROM outbox;'); for (const e of this.events()) this.project(e); })(); }
  async backup(file: string, progress?: (info: { totalPages: number; remainingPages: number }) => number): Promise<void> {
    await this.db.backup(file, progress ? { progress } : undefined);
  }
  close(): void { this.db.close(); }
}
