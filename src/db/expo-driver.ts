import * as SQLite from 'expo-sqlite';

import type { SqlDriver, SqlValue } from '@/db/driver';

export async function openExpoDriver(name = 'usage.db'): Promise<SqlDriver> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  // expo-sqlite's non-exclusive transactions can interleave with other queries, so a manual
  // BEGIN/COMMIT is serialized through this chain instead.
  let chain: Promise<unknown> = Promise.resolve();

  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params: SqlValue[] = []) => {
      const r = await db.runAsync(sql, params);
      return { changes: r.changes, lastInsertRowId: r.lastInsertRowId };
    },
    all: <T>(sql: string, params: SqlValue[] = []) => db.getAllAsync<T>(sql, params),
    first: <T>(sql: string, params: SqlValue[] = []) => db.getFirstAsync<T>(sql, params),
    transaction<T>(fn: () => Promise<T>): Promise<T> {
      const run = async () => {
        await db.execAsync('BEGIN');
        try {
          const out = await fn();
          await db.execAsync('COMMIT');
          return out;
        } catch (e) {
          await db.execAsync('ROLLBACK');
          throw e;
        }
      };
      const next = chain.then(run, run);
      chain = next.catch(() => undefined);
      return next;
    },
  };
}
