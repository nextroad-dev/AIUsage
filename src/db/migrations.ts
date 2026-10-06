import type { SqlDriver } from '@/db/driver';

export interface Migration {
  version: number;
  sql: string;
}

/**
 * Append-only. Never edit a released migration; add a new version.
 * Timestamps are epoch milliseconds (INTEGER).
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE accounts (
        id          TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        label       TEXT NOT NULL,
        region      TEXT,
        auth_method TEXT NOT NULL,
        config_json TEXT,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL
      );

      CREATE TABLE snapshots (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id    TEXT NOT NULL,
        fetched_at    INTEGER NOT NULL,
        plan          TEXT,
        status_type   TEXT NOT NULL,
        status_message TEXT
      );
      CREATE INDEX idx_snapshots_account ON snapshots(account_id, fetched_at);

      CREATE TABLE meter_samples (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id INTEGER NOT NULL,
        account_id  TEXT NOT NULL,
        fetched_at  INTEGER NOT NULL,
        meter_id    TEXT NOT NULL,
        label       TEXT NOT NULL,
        scope_model TEXT,
        kind        TEXT NOT NULL,
        value       REAL NOT NULL,
        limit_value REAL,
        unit        TEXT,
        resets_at   INTEGER
      );
      CREATE INDEX idx_samples_series ON meter_samples(account_id, meter_id, fetched_at);
      CREATE INDEX idx_samples_snapshot ON meter_samples(snapshot_id);

      CREATE TABLE manual_state (
        account_id  TEXT NOT NULL,
        meter_id    TEXT NOT NULL,
        used        REAL NOT NULL,
        recorded_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, meter_id)
      );

      CREATE TABLE alert_rules (
        id          TEXT PRIMARY KEY,
        account_id  TEXT NOT NULL,
        meter_id    TEXT NOT NULL,
        scope_model TEXT,
        kind        TEXT NOT NULL,
        threshold   REAL NOT NULL,
        enabled     INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE alert_state (
        rule_id   TEXT NOT NULL,
        cycle_key TEXT NOT NULL,
        fired_at  INTEGER NOT NULL,
        PRIMARY KEY (rule_id, cycle_key)
      );

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE account_health (
        account_id      TEXT PRIMARY KEY,
        last_attempt_at INTEGER,
        last_success_at INTEGER,
        failures        INTEGER NOT NULL DEFAULT 0,
        status_type     TEXT,
        error_kind      TEXT,
        error_message   TEXT,
        retry_after_at  INTEGER
      );
    `,
  },
  {
    version: 2,
    // when the provider says the paid plan renews or ends; NULL when unknown
    sql: `ALTER TABLE snapshots ADD COLUMN renews_at INTEGER;`,
  },
];

export async function currentVersion(db: SqlDriver): Promise<number> {
  const row = await db.first<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/** Applies pending migrations in order, each atomically. Returns the resulting version. */
export async function migrate(
  db: SqlDriver,
  migrations: Migration[] = MIGRATIONS,
): Promise<number> {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  const installed = await currentVersion(db);
  const latest = sorted.length ? sorted[sorted.length - 1].version : 0;
  if (installed > latest) {
    throw new Error(`database is newer (v${installed}) than this app supports (v${latest})`);
  }
  for (const m of sorted) {
    if (m.version <= installed) continue;
    await db.transaction(async () => {
      await db.exec(m.sql);
      await db.exec(`PRAGMA user_version = ${m.version}`);
    });
  }
  return latest;
}
