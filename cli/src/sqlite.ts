import { Database } from 'bun:sqlite';

/** Retry only connection setup, before any command can have committed a change.
 * Windows can race WAL cleanup against another CLI opening the same file.
 */
export function openDatabase(path: string): Database {
  const deadline = Date.now() + 5000;
  for (;;) {
    let db: Database | undefined;
    try {
      db = new Database(path, { create: true });
      db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      return db;
    } catch (error: any) {
      try { db?.close(); } catch {}
      if (!['SQLITE_BUSY', 'SQLITE_LOCKED', 'SQLITE_IOERR_TRUNCATE'].includes(error?.code) || Date.now() >= deadline) throw error;
      Bun.sleepSync(50);
    }
  }
}
