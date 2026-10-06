/** Minimal async SQL surface so repositories run on expo-sqlite in the app and node:sqlite in tests. */
export type SqlValue = string | number | null;

export interface SqlDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number; lastInsertRowId: number }>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  /** Runs `fn` atomically; rolls back if it throws. Not re-entrant. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
