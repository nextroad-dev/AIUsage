import { DatabaseSync } from 'node:sqlite';

import type { SqlDriver, SqlValue } from '@/db/driver';

/** In-memory SqlDriver on Node's built-in SQLite, for tests only. */
export function memoryDriver(): SqlDriver {
  const db = new DatabaseSync(':memory:');
  let depth = 0;
  return {
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, params: SqlValue[] = []) => {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    all: async <T>(sql: string, params: SqlValue[] = []) =>
      db.prepare(sql).all(...params) as unknown as T[],
    first: async <T>(sql: string, params: SqlValue[] = []) =>
      (db.prepare(sql).get(...params) as unknown as T | undefined) ?? null,
    transaction: async <T>(fn: () => Promise<T>) => {
      if (depth > 0) throw new Error('nested transaction');
      depth++;
      db.exec('BEGIN');
      try {
        const out = await fn();
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        depth--;
      }
    },
  };
}
