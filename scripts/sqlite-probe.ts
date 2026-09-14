import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { CompatibilityCheck } from '@autofactorio/contracts';
import type Database from 'better-sqlite3';

type DriverLoader = () => Promise<typeof Database>;
const loadDriver: DriverLoader = async () => (await import('better-sqlite3')).default;

/** Always creates fresh probe files; never opens a user's database. */
export async function probeSqlite(
  directory: string,
  driver = 'better-sqlite3',
  load: DriverLoader = loadDriver,
): Promise<CompatibilityCheck> {
  if (driver !== 'better-sqlite3') {
    return { id: 'sqlite', status: 'unsupported', detail: `Unsupported SQLite driver: ${driver}; no fallback attempted.` };
  }
  let db: Database.Database | undefined;
  try {
    const Driver = await load();
    const prefix = path.join(directory, `probe-${randomUUID()}`);
    const file = `${prefix}.sqlite`;
    const backup = `${prefix}-backup.sqlite`;
    db = new Driver(file);
    if (db.pragma('journal_mode = WAL', { simple: true }) !== 'wal') throw new Error('WAL unavailable');
    db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    const insert = db.prepare('INSERT INTO probe (id, value) VALUES (?, ?)');
    db.transaction(() => { insert.run(1, 'committed'); })();
    let rolledBack = false;
    try {
      db.transaction(() => {
        insert.run(2, 'must roll back');
        insert.run(1, 'duplicate key');
      })();
    } catch { rolledBack = true; }
    if (!rolledBack) throw new Error('Rollback was not exercised');
    const assertRows = (connection: Database.Database) => {
      const rows: unknown = connection.prepare('SELECT id, value FROM probe ORDER BY id').all();
      if (JSON.stringify(rows) !== JSON.stringify([{ id: 1, value: 'committed' }])) {
        throw new Error('Committed data or rollback verification failed');
      }
    };
    assertRows(db);
    const sqliteVersion = db.prepare('SELECT sqlite_version() AS version').get() as { version: string };
    db.close();
    db = new Driver(file, { fileMustExist: true });
    assertRows(db);
    await db.backup(backup);
    db.close();
    db = new Driver(backup, { readonly: true, fileMustExist: true });
    assertRows(db);
    const require = createRequire(import.meta.url);
    const metadata = require('better-sqlite3/package.json') as { version: string };
    return {
      id: 'sqlite', status: 'supported',
      detail: `better-sqlite3 ${metadata.version}; SQLite ${sqliteVersion.version}; WAL, commit, read, rollback, reopen and backup/reopen passed. Files: ${file}, ${backup}`,
    };
  } catch (error) {
    return { id: 'sqlite', status: 'unsupported', detail: `SQLite probe failed; no fallback attempted: ${error instanceof Error ? error.message : String(error)}` };
  } finally { db?.close(); }
}
