import type { ManualAccountConfig, ManualState } from '@/core/manual';
import type { AuthMethod, Meter, MeterKind, SnapshotStatus, UsageSnapshot } from '@/core/types';
import type { SqlDriver } from '@/db/driver';

const HOUR = 3_600_000;
const DAY = 86_400_000;
export const RAW_RETENTION_MS = 90 * DAY;

// ---------------- accounts ----------------

export interface Account {
  id: string;
  providerId: string;
  label: string;
  region?: string;
  authMethod: AuthMethod;
  /** manual-mode plan/limits; undefined for automatic accounts */
  manual?: ManualAccountConfig;
  sortOrder: number;
  createdAt: number;
}

interface AccountRow {
  id: string;
  provider_id: string;
  label: string;
  region: string | null;
  auth_method: string;
  config_json: string | null;
  sort_order: number;
  created_at: number;
}

const toAccount = (r: AccountRow): Account => ({
  id: r.id,
  providerId: r.provider_id,
  label: r.label,
  region: r.region ?? undefined,
  authMethod: r.auth_method as AuthMethod,
  manual: r.config_json ? (JSON.parse(r.config_json) as ManualAccountConfig) : undefined,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
});

export class AccountRepo {
  constructor(private db: SqlDriver) {}

  async create(a: Omit<Account, 'sortOrder'> & { sortOrder?: number }): Promise<void> {
    const sort =
      a.sortOrder ??
      ((await this.db.first<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM accounts'))
        ?.m ?? -1) + 1;
    await this.db.run(
      `INSERT INTO accounts (id, provider_id, label, region, auth_method, config_json, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        a.id,
        a.providerId,
        a.label,
        a.region ?? null,
        a.authMethod,
        a.manual ? JSON.stringify(a.manual) : null,
        sort,
        a.createdAt,
      ],
    );
  }

  async get(id: string): Promise<Account | null> {
    const r = await this.db.first<AccountRow>('SELECT * FROM accounts WHERE id = ?', [id]);
    return r ? toAccount(r) : null;
  }

  async list(): Promise<Account[]> {
    const rows = await this.db.all<AccountRow>(
      'SELECT * FROM accounts ORDER BY sort_order, created_at',
    );
    return rows.map(toAccount);
  }

  async rename(id: string, label: string): Promise<void> {
    await this.db.run('UPDATE accounts SET label = ? WHERE id = ?', [label, id]);
  }

  async setManualConfig(id: string, config: ManualAccountConfig): Promise<void> {
    await this.db.run('UPDATE accounts SET config_json = ? WHERE id = ?', [
      JSON.stringify(config),
      id,
    ]);
  }

  /** Removes the account and everything derived from it. (Credentials live in the keychain; see AccountService.) */
  async remove(id: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run(
        'DELETE FROM alert_state WHERE rule_id IN (SELECT id FROM alert_rules WHERE account_id = ?)',
        [id],
      );
      for (const t of [
        'alert_rules',
        'manual_state',
        'meter_samples',
        'snapshots',
        'account_health',
      ]) {
        await this.db.run(`DELETE FROM ${t} WHERE account_id = ?`, [id]);
      }
      await this.db.run('DELETE FROM accounts WHERE id = ?', [id]);
    });
  }
}

// ---------------- snapshots ----------------

interface SnapshotRow {
  id: number;
  account_id: string;
  fetched_at: number;
  plan: string | null;
  renews_at: number | null;
  status_type: string;
  status_message: string | null;
}

interface SampleRow {
  meter_id: string;
  label: string;
  scope_model: string | null;
  kind: string;
  value: number;
  limit_value: number | null;
  unit: string | null;
  resets_at: number | null;
}

function statusToRow(s: SnapshotStatus): [string, string | null] {
  return [s.type, s.type === 'error' ? s.message : null];
}

function rowToStatus(type: string, message: string | null): SnapshotStatus {
  if (type === 'error') return { type: 'error', message: message ?? '' };
  return { type } as SnapshotStatus;
}

function sampleParts(m: Meter): { value: number; limit: number | null; unit: string | null } {
  const k = m.kind;
  switch (k.type) {
    case 'percent':
      return { value: k.used, limit: 100, unit: '%' };
    case 'amount':
      return { value: k.used, limit: k.limit ?? null, unit: k.unit };
    case 'balance':
      return { value: k.value, limit: null, unit: k.unit };
  }
}

function rowToMeter(r: SampleRow): Meter {
  let kind: MeterKind;
  if (r.kind === 'percent') kind = { type: 'percent', used: r.value };
  else if (r.kind === 'balance') kind = { type: 'balance', value: r.value, unit: r.unit ?? '' };
  else
    kind = { type: 'amount', used: r.value, limit: r.limit_value ?? undefined, unit: r.unit ?? '' };
  return {
    id: r.meter_id,
    label: r.label,
    kind,
    scope: r.scope_model ? { type: 'model', name: r.scope_model } : { type: 'overall' },
    resetsAt: r.resets_at == null ? undefined : new Date(r.resets_at).toISOString(),
  };
}

function renewsMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export class SnapshotRepo {
  constructor(private db: SqlDriver) {}

  async save(s: UsageSnapshot): Promise<void> {
    const at = Date.parse(s.fetchedAt);
    const [statusType, statusMsg] = statusToRow(s.status);
    await this.db.transaction(async () => {
      const ins = await this.db.run(
        'INSERT INTO snapshots (account_id, fetched_at, plan, renews_at, status_type, status_message) VALUES (?, ?, ?, ?, ?, ?)',
        [s.accountId, at, s.plan ?? null, renewsMs(s.renewsAt), statusType, statusMsg],
      );
      for (const m of s.meters) {
        const p = sampleParts(m);
        await this.db.run(
          `INSERT INTO meter_samples
             (snapshot_id, account_id, fetched_at, meter_id, label, scope_model, kind, value, limit_value, unit, resets_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            ins.lastInsertRowId,
            s.accountId,
            at,
            m.id,
            m.label,
            m.scope.type === 'model' ? m.scope.name : null,
            m.kind.type,
            p.value,
            p.limit,
            p.unit,
            m.resetsAt ? Date.parse(m.resetsAt) : null,
          ],
        );
      }
    });
  }

  /** Most recent snapshot that carried data, else the most recent snapshot of any kind. */
  async latest(accountId: string, providerId: string): Promise<UsageSnapshot | null> {
    const row =
      (await this.db.first<SnapshotRow>(
        `SELECT s.* FROM snapshots s
          WHERE s.account_id = ? AND s.status_type IN ('ok', 'manual')
          ORDER BY s.fetched_at DESC, s.id DESC LIMIT 1`,
        [accountId],
      )) ??
      (await this.db.first<SnapshotRow>(
        'SELECT * FROM snapshots WHERE account_id = ? ORDER BY fetched_at DESC, id DESC LIMIT 1',
        [accountId],
      ));
    if (!row) return null;
    const samples = await this.db.all<SampleRow>(
      'SELECT * FROM meter_samples WHERE snapshot_id = ? ORDER BY id',
      [row.id],
    );
    return {
      providerId,
      accountId,
      plan: row.plan ?? undefined,
      renewsAt: row.renews_at == null ? undefined : new Date(row.renews_at).toISOString(),
      fetchedAt: new Date(row.fetched_at).toISOString(),
      meters: samples.map(rowToMeter),
      status: rowToStatus(row.status_type, row.status_message),
    };
  }

  /**
   * Values of each meter within its current reset cycle, oldest first, keyed like alert meter
   * keys (`id` or `id:model`). A sample belongs to the cycle when its reset time is within ten
   * minutes of the current one (providers that report "seconds until reset" drift slightly).
   */
  async cycleSamples(
    accountId: string,
    current: Meter[],
  ): Promise<Record<string, { at: number; used: number }[]>> {
    const out: Record<string, { at: number; used: number }[]> = {};
    const withReset = current.filter((m) => m.resetsAt);
    if (withReset.length === 0) return out;
    const earliest = Math.min(...withReset.map((m) => Date.parse(m.resetsAt!) - 35 * 86_400_000));
    const rows = await this.db.all<SampleRow & { fetched_at: number }>(
      `SELECT * FROM meter_samples
        WHERE account_id = ? AND resets_at IS NOT NULL AND fetched_at >= ?
        ORDER BY fetched_at`,
      [accountId, earliest],
    );
    for (const m of withReset) {
      const key = `${m.id}${m.scope.type === 'model' ? `:${m.scope.name}` : ''}`;
      const reset = Date.parse(m.resetsAt!);
      const model = m.scope.type === 'model' ? m.scope.name : null;
      out[key] = rows
        .filter(
          (r) =>
            r.meter_id === m.id &&
            (r.scope_model ?? null) === model &&
            Math.abs((r.resets_at ?? 0) - reset) <= 10 * 60_000,
        )
        .map((r) => {
          const limit = r.kind === 'percent' ? 100 : r.limit_value;
          return { at: r.fetched_at, used: limit ? r.value / limit : NaN };
        })
        .filter((p) => Number.isFinite(p.used));
    }
    return out;
  }

  /**
   * Retention: samples older than 90 days are reduced to one per (account, meter, scope, hour);
   * snapshot rows left without samples are removed. Recent data is untouched.
   */
  async prune(nowMs: number): Promise<{ samplesDeleted: number; snapshotsDeleted: number }> {
    const cut = nowMs - RAW_RETENTION_MS;
    return this.db.transaction(async () => {
      const s = await this.db.run(
        `DELETE FROM meter_samples
          WHERE fetched_at < ?
            AND account_id NOT IN (
              SELECT id FROM accounts WHERE auth_method IN ('manual', 'webviewSession') OR config_json IS NOT NULL
            )
            AND id NOT IN (
              SELECT MAX(id) FROM meter_samples WHERE fetched_at < ?
              GROUP BY account_id, meter_id, IFNULL(scope_model, ''), fetched_at / ${HOUR}
            )`,
        [cut, cut],
      );
      const n = await this.db.run(
        `DELETE FROM snapshots
          WHERE fetched_at < ?
            AND account_id NOT IN (
              SELECT id FROM accounts WHERE auth_method IN ('manual', 'webviewSession') OR config_json IS NOT NULL
            )
            AND id NOT IN (SELECT DISTINCT snapshot_id FROM meter_samples)`,
        [cut],
      );
      return { samplesDeleted: s.changes, snapshotsDeleted: n.changes };
    });
  }
}

// ---------------- manual state ----------------

export class ManualStateRepo {
  constructor(private db: SqlDriver) {}

  async get(accountId: string): Promise<ManualState> {
    const rows = await this.db.all<{ meter_id: string; used: number; recorded_at: number }>(
      'SELECT meter_id, used, recorded_at FROM manual_state WHERE account_id = ?',
      [accountId],
    );
    return Object.fromEntries(
      rows.map((r) => [
        r.meter_id,
        { used: r.used, recordedAt: new Date(r.recorded_at).toISOString() },
      ]),
    );
  }

  async set(accountId: string, meterId: string, used: number, recordedAt: string): Promise<void> {
    await this.db.run(
      `INSERT INTO manual_state (account_id, meter_id, used, recorded_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id, meter_id) DO UPDATE SET used = excluded.used, recorded_at = excluded.recorded_at`,
      [accountId, meterId, used, Date.parse(recordedAt)],
    );
  }
}

// ---------------- alerts ----------------

export type AlertKind =
  'usage-over' | 'reset-soon-unused' | 'auth-expired' | 'window-reset' | 'renewal-soon';

export interface AlertRule {
  id: string;
  accountId: string;
  meterId: string;
  model?: string;
  kind: AlertKind;
  /** usage-over: fraction 0..1; reset-soon-unused: hours before reset */
  threshold: number;
  enabled: boolean;
}

interface RuleRow {
  id: string;
  account_id: string;
  meter_id: string;
  scope_model: string | null;
  kind: string;
  threshold: number;
  enabled: number;
}

export class AlertRepo {
  constructor(private db: SqlDriver) {}

  async upsertRule(r: AlertRule): Promise<void> {
    await this.db.run(
      `INSERT INTO alert_rules (id, account_id, meter_id, scope_model, kind, threshold, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET meter_id = excluded.meter_id, scope_model = excluded.scope_model,
         kind = excluded.kind, threshold = excluded.threshold, enabled = excluded.enabled`,
      [r.id, r.accountId, r.meterId, r.model ?? null, r.kind, r.threshold, r.enabled ? 1 : 0],
    );
  }

  async rules(accountId?: string): Promise<AlertRule[]> {
    const rows = accountId
      ? await this.db.all<RuleRow>('SELECT * FROM alert_rules WHERE account_id = ?', [accountId])
      : await this.db.all<RuleRow>('SELECT * FROM alert_rules');
    return rows.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      meterId: r.meter_id,
      model: r.scope_model ?? undefined,
      kind: r.kind as AlertKind,
      threshold: r.threshold,
      enabled: r.enabled === 1,
    }));
  }

  async deleteRule(id: string): Promise<void> {
    await this.db.transaction(async () => {
      await this.db.run('DELETE FROM alert_state WHERE rule_id = ?', [id]);
      await this.db.run('DELETE FROM alert_rules WHERE id = ?', [id]);
    });
  }

  /** Records that a rule fired for this reset cycle. Returns true only the first time. */
  async markFired(ruleId: string, cycleKey: string, nowMs: number): Promise<boolean> {
    const r = await this.db.run(
      'INSERT OR IGNORE INTO alert_state (rule_id, cycle_key, fired_at) VALUES (?, ?, ?)',
      [ruleId, cycleKey, nowMs],
    );
    return r.changes === 1;
  }

  async hasFired(ruleId: string, cycleKey: string): Promise<boolean> {
    return (
      (await this.db.first('SELECT 1 AS x FROM alert_state WHERE rule_id = ? AND cycle_key = ?', [
        ruleId,
        cycleKey,
      ])) !== null
    );
  }

  /** Cycles older than the cutoff can never match again. */
  async pruneState(olderThanMs: number): Promise<number> {
    return (await this.db.run('DELETE FROM alert_state WHERE fired_at < ?', [olderThanMs])).changes;
  }
}

// ---------------- health ----------------

export interface Health {
  accountId: string;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  /** consecutive failures that count toward backoff */
  failures: number;
  /** SnapshotStatus.type of the last attempt: ok | stale | authExpired | unsupported | error */
  statusType?: string;
  errorKind?: string;
  errorMessage?: string;
  retryAfterAt?: number;
}

interface HealthRow {
  account_id: string;
  last_attempt_at: number | null;
  last_success_at: number | null;
  failures: number;
  status_type: string | null;
  error_kind: string | null;
  error_message: string | null;
  retry_after_at: number | null;
}

export class HealthRepo {
  constructor(private db: SqlDriver) {}

  async get(accountId: string): Promise<Health | null> {
    const r = await this.db.first<HealthRow>('SELECT * FROM account_health WHERE account_id = ?', [
      accountId,
    ]);
    if (!r) return null;
    return {
      accountId: r.account_id,
      lastAttemptAt: r.last_attempt_at ?? undefined,
      lastSuccessAt: r.last_success_at ?? undefined,
      failures: r.failures,
      statusType: r.status_type ?? undefined,
      errorKind: r.error_kind ?? undefined,
      errorMessage: r.error_message ?? undefined,
      retryAfterAt: r.retry_after_at ?? undefined,
    };
  }

  async recordSuccess(accountId: string, nowMs: number): Promise<void> {
    await this.db.run(
      `INSERT INTO account_health (account_id, last_attempt_at, last_success_at, failures, status_type)
       VALUES (?, ?, ?, 0, 'ok')
       ON CONFLICT(account_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at,
         last_success_at = excluded.last_success_at, failures = 0, status_type = 'ok',
         error_kind = NULL, error_message = NULL, retry_after_at = NULL`,
      [accountId, nowMs, nowMs],
    );
  }

  async recordFailure(
    accountId: string,
    nowMs: number,
    f: {
      statusType: string;
      kind: string;
      message: string;
      countsAsFailure: boolean;
      retryAfterMs?: number;
    },
  ): Promise<void> {
    await this.db.run(
      `INSERT INTO account_health
         (account_id, last_attempt_at, failures, status_type, error_kind, error_message, retry_after_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at,
         failures = account_health.failures + excluded.failures, status_type = excluded.status_type,
         error_kind = excluded.error_kind, error_message = excluded.error_message,
         retry_after_at = excluded.retry_after_at`,
      [
        accountId,
        nowMs,
        f.countsAsFailure ? 1 : 0,
        f.statusType,
        f.kind,
        f.message,
        f.retryAfterMs === undefined ? null : nowMs + f.retryAfterMs,
      ],
    );
  }
}

// ---------------- settings ----------------

export class SettingsRepo {
  constructor(private db: SqlDriver) {}

  async get(key: string): Promise<string | null> {
    return (
      (await this.db.first<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]))
        ?.value ?? null
    );
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }

  async getJson<T>(key: string, fallback: T): Promise<T> {
    const v = await this.get(key);
    if (v === null) return fallback;
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }

  async setJson(key: string, value: unknown): Promise<void> {
    await this.set(key, JSON.stringify(value));
  }
}

export interface Repos {
  accounts: AccountRepo;
  snapshots: SnapshotRepo;
  manual: ManualStateRepo;
  alerts: AlertRepo;
  health: HealthRepo;
  settings: SettingsRepo;
}

export function createRepos(db: SqlDriver): Repos {
  return {
    accounts: new AccountRepo(db),
    snapshots: new SnapshotRepo(db),
    manual: new ManualStateRepo(db),
    alerts: new AlertRepo(db),
    health: new HealthRepo(db),
    settings: new SettingsRepo(db),
  };
}
