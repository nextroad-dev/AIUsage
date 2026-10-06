import { currentVersion, migrate, MIGRATIONS, type Migration } from '@/db/migrations';
import { createRepos, RAW_RETENTION_MS } from '@/db/repos';
import type { ManualAccountConfig } from '@/core/manual';
import type { UsageSnapshot } from '@/core/types';
import { memoryDriver } from '@/test-utils/sqlite';

async function setup() {
  const db = memoryDriver();
  await migrate(db);
  return { db, repos: createRepos(db) };
}

const acct = (id: string, extra: object = {}) => ({
  id,
  providerId: 'openrouter',
  label: id,
  authMethod: 'apiKey' as const,
  createdAt: 1,
  ...extra,
});

const snap = (accountId: string, at: string, used: number): UsageSnapshot => ({
  providerId: 'openrouter',
  accountId,
  plan: 'Pro',
  fetchedAt: at,
  status: { type: 'ok' },
  meters: [
    {
      id: 'weekly',
      label: 'Weekly',
      kind: { type: 'percent', used },
      scope: { type: 'overall' },
      resetsAt: '2026-10-10T00:00:00.000Z',
    },
    {
      id: 'credits',
      label: 'Credits',
      kind: { type: 'balance', value: 7.5, unit: 'USD' },
      scope: { type: 'overall' },
    },
    {
      id: 'spend',
      label: 'Spend',
      kind: { type: 'amount', used: 2, limit: 5, unit: 'USD' },
      scope: { type: 'model', name: 'opus' },
    },
  ],
});

describe('migrations', () => {
  it('creates the schema from an empty database', async () => {
    const db = memoryDriver();
    expect(await currentVersion(db)).toBe(0);
    expect(await migrate(db)).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
    const tables = (
      await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")
    ).map((t) => t.name);
    for (const t of [
      'accounts',
      'snapshots',
      'meter_samples',
      'alert_rules',
      'alert_state',
      'manual_state',
      'settings',
    ]) {
      expect(tables).toContain(t);
    }
  });

  it('is idempotent', async () => {
    const db = memoryDriver();
    await migrate(db);
    await migrate(db);
    expect(await currentVersion(db)).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
  });

  it('upgrades an older database without losing data and applies only pending steps', async () => {
    const db = memoryDriver();
    await migrate(db, MIGRATIONS.slice(0, 1)); // an app that only knew v1
    await createRepos(db).accounts.create(acct('a1'));
    const next: Migration = {
      version: 99,
      sql: 'ALTER TABLE accounts ADD COLUMN note TEXT;',
    };
    await migrate(db, [...MIGRATIONS, next]);
    expect(await currentVersion(db)).toBe(99);
    expect((await createRepos(db).accounts.get('a1'))?.label).toBe('a1');
    // re-running must not re-apply anything (would fail on duplicate column / table)
    await expect(migrate(db, [...MIGRATIONS, next])).resolves.toBe(99);
  });

  it('rolls back a failing migration and keeps the old version', async () => {
    const db = memoryDriver();
    await migrate(db);
    const bad: Migration = {
      version: 99,
      sql: 'CREATE TABLE ok_table (a); SELECT * FROM does_not_exist;',
    };
    await expect(migrate(db, [...MIGRATIONS, bad])).rejects.toThrow();
    expect(await currentVersion(db)).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
    const t = await db.first("SELECT name FROM sqlite_master WHERE name='ok_table'");
    expect(t).toBeNull();
  });

  it('refuses to open a database from a newer app', async () => {
    const db = memoryDriver();
    await migrate(db);
    await db.exec('PRAGMA user_version = 99');
    await expect(migrate(db)).rejects.toThrow(/newer/);
  });
});

describe('accounts', () => {
  it('creates, lists in order, renames and stores manual config', async () => {
    const { repos } = await setup();
    const manual: ManualAccountConfig = { planName: 'Max', meters: [] };
    await repos.accounts.create(acct('a', { region: 'cn' }));
    await repos.accounts.create(acct('b', { manual, authMethod: 'manual' }));
    expect((await repos.accounts.list()).map((a) => a.id)).toEqual(['a', 'b']);
    await repos.accounts.rename('a', 'Work');
    expect(await repos.accounts.get('a')).toMatchObject({
      label: 'Work',
      region: 'cn',
      sortOrder: 0,
    });
    expect((await repos.accounts.get('b'))?.manual).toEqual(manual);
  });

  it('rejects duplicate ids', async () => {
    const { repos } = await setup();
    await repos.accounts.create(acct('a'));
    await expect(repos.accounts.create(acct('a'))).rejects.toThrow();
  });

  it('remove deletes everything derived from the account, and only that', async () => {
    const { repos, db } = await setup();
    for (const id of ['a', 'b']) {
      await repos.accounts.create(acct(id));
      await repos.snapshots.save(snap(id, '2026-10-06T00:00:00.000Z', 10));
      await repos.manual.set(id, 'weekly', 5, '2026-10-06T00:00:00.000Z');
      await repos.alerts.upsertRule({
        id: `r-${id}`,
        accountId: id,
        meterId: 'weekly',
        kind: 'usage-over',
        threshold: 0.8,
        enabled: true,
      });
      await repos.alerts.markFired(`r-${id}`, 'c1', 1);
    }
    await repos.accounts.remove('a');
    for (const t of ['snapshots', 'meter_samples', 'manual_state', 'alert_rules']) {
      const rows = await db.all<{ account_id: string }>(`SELECT DISTINCT account_id FROM ${t}`);
      expect(rows.map((r) => r.account_id)).toEqual(['b']);
    }
    expect((await db.all('SELECT * FROM alert_state')).length).toBe(1);
    expect(await repos.accounts.get('a')).toBeNull();
  });
});

describe('snapshots', () => {
  it('round-trips every meter kind, scope and reset time', async () => {
    const { repos } = await setup();
    const s = snap('a', '2026-10-06T00:00:00.000Z', 42);
    await repos.snapshots.save(s);
    expect(await repos.snapshots.latest('a', 'openrouter')).toEqual(s);
  });

  it('keeps the plan renewal date', async () => {
    const { repos } = await setup();
    await repos.snapshots.save({
      ...snap('a', '2026-10-06T00:00:00.000Z', 42),
      renewsAt: '2026-11-01T00:00:00.000Z',
    });
    expect((await repos.snapshots.latest('a', 'openrouter'))?.renewsAt).toBe(
      '2026-11-01T00:00:00.000Z',
    );
  });

  it('returns the samples of the current reset cycle only, as used fractions', async () => {
    const { repos } = await setup();
    const cycle = (at: string, used: number, resetsAt: string) => {
      const s = snap('a', at, used);
      return { ...s, meters: s.meters.map((m) => (m.id === 'weekly' ? { ...m, resetsAt } : m)) };
    };
    await repos.snapshots.save(cycle('2026-10-01T00:00:00.000Z', 90, '2026-10-03T00:00:00.000Z'));
    await repos.snapshots.save(cycle('2026-10-05T00:00:00.000Z', 20, '2026-10-10T00:00:00.000Z'));
    // a provider reporting "seconds until reset" drifts a little between fetches
    await repos.snapshots.save(cycle('2026-10-06T00:00:00.000Z', 40, '2026-10-10T00:02:00.000Z'));
    const latest = (await repos.snapshots.latest('a', 'openrouter'))!;
    const samples = await repos.snapshots.cycleSamples('a', latest.meters);
    expect(samples.weekly).toEqual([
      { at: Date.parse('2026-10-05T00:00:00.000Z'), used: 0.2 },
      { at: Date.parse('2026-10-06T00:00:00.000Z'), used: 0.4 },
    ]);
  });

  it('prefers the latest snapshot with data over a newer failure', async () => {
    const { repos } = await setup();
    await repos.snapshots.save(snap('a', '2026-10-06T00:00:00.000Z', 10));
    await repos.snapshots.save({
      providerId: 'openrouter',
      accountId: 'a',
      fetchedAt: '2026-10-06T01:00:00.000Z',
      meters: [],
      status: { type: 'error', message: 'boom' },
    });
    expect((await repos.snapshots.latest('a', 'openrouter'))?.status).toEqual({ type: 'ok' });
    // only failures stored -> returns the failure so the UI can show it
    await repos.snapshots.save({
      providerId: 'x',
      accountId: 'only-fail',
      fetchedAt: '2026-10-06T01:00:00.000Z',
      meters: [],
      status: { type: 'error', message: 'boom' },
    });
    expect((await repos.snapshots.latest('only-fail', 'x'))?.status).toEqual({
      type: 'error',
      message: 'boom',
    });
    expect(await repos.snapshots.latest('nobody', 'x')).toBeNull();
  });

  it('prune keeps recent data and thins old samples to one per hour', async () => {
    const { repos, db } = await setup();
    const now = Date.parse('2027-03-01T00:00:00.000Z');
    const old = now - RAW_RETENTION_MS - 10 * 86_400_000;
    const hourStart = Math.floor(old / 3_600_000) * 3_600_000;
    for (const minute of [1, 20, 40]) {
      await repos.snapshots.save(
        snap('a', new Date(hourStart + minute * 60_000).toISOString(), minute),
      );
    }
    await repos.snapshots.save(snap('a', new Date(hourStart + 3_700_000).toISOString(), 99)); // next hour
    await repos.snapshots.save(snap('a', new Date(now - 3_600_000).toISOString(), 77)); // recent
    const before = (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM meter_samples'))!.n;
    const res = await repos.snapshots.prune(now);
    const after = (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM meter_samples'))!.n;
    expect(before - after).toBe(res.samplesDeleted);
    // 2 old hours + 1 recent snapshot, 3 meters each
    expect(after).toBe(9);
    expect(res.snapshotsDeleted).toBe(2);
    const kept = await db.all<{ value: number }>(
      `SELECT value FROM meter_samples WHERE meter_id = 'weekly' ORDER BY fetched_at`,
    );
    expect(kept.map((r) => r.value)).toEqual([40, 99, 77]); // last sample of the first hour wins
  });
});

describe('manual state, alerts, settings', () => {
  it('manual state upserts', async () => {
    const { repos } = await setup();
    await repos.manual.set('a', 'weekly', 5, '2026-10-06T00:00:00.000Z');
    await repos.manual.set('a', 'weekly', 9, '2026-10-06T01:00:00.000Z');
    expect(await repos.manual.get('a')).toEqual({
      weekly: { used: 9, recordedAt: '2026-10-06T01:00:00.000Z' },
    });
  });

  it('alert fires once per cycle and re-arms on a new cycle', async () => {
    const { repos } = await setup();
    expect(await repos.alerts.markFired('r', 'cycle-1', 100)).toBe(true);
    expect(await repos.alerts.markFired('r', 'cycle-1', 200)).toBe(false);
    expect(await repos.alerts.hasFired('r', 'cycle-1')).toBe(true);
    expect(await repos.alerts.markFired('r', 'cycle-2', 300)).toBe(true);
    expect(await repos.alerts.pruneState(250)).toBe(1);
    expect(await repos.alerts.hasFired('r', 'cycle-1')).toBe(false);
  });

  it('rules upsert, list and delete with their state', async () => {
    const { repos } = await setup();
    const rule = {
      id: 'r1',
      accountId: 'a',
      meterId: 'weekly',
      model: 'opus',
      kind: 'usage-over' as const,
      threshold: 0.8,
      enabled: true,
    };
    await repos.alerts.upsertRule(rule);
    await repos.alerts.upsertRule({ ...rule, threshold: 0.9, enabled: false });
    expect(await repos.alerts.rules('a')).toEqual([{ ...rule, threshold: 0.9, enabled: false }]);
    await repos.alerts.markFired('r1', 'c', 1);
    await repos.alerts.deleteRule('r1');
    expect(await repos.alerts.rules()).toEqual([]);
    expect(await repos.alerts.hasFired('r1', 'c')).toBe(false);
  });

  it('settings round-trip with JSON fallback', async () => {
    const { repos } = await setup();
    expect(await repos.settings.get('x')).toBeNull();
    await repos.settings.setJson('x', { a: 1 });
    expect(await repos.settings.getJson('x', null)).toEqual({ a: 1 });
    await repos.settings.set('bad', '{not json');
    expect(await repos.settings.getJson('bad', 'fallback')).toBe('fallback');
  });
});
