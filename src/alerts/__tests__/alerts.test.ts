import { dispatchAlerts, type Notifier } from '@/alerts/dispatch';
import {
  choiceFor,
  DEFAULT_ALERT_SETTINGS,
  evaluateAlerts,
  mergeAlertSettings,
  type AlertEvent,
  type AlertSettings,
} from '@/alerts/evaluate';
import type { Meter, UsageSnapshot } from '@/core/types';
import type { AccountView } from '@/data/summary';
import { migrate } from '@/db/migrations';
import { createRepos, type AlertRule } from '@/db/repos';
import { memoryDriver } from '@/test-utils/sqlite';

const NOW = new Date('2026-10-06T12:00:00Z');
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

const pct = (id: string, used: number, resetsAt?: string, model?: string): Meter => ({
  id,
  label: id === 'weekly' ? 'Weekly' : '5-hour window',
  kind: { type: 'percent', used },
  scope: model ? { type: 'model', name: model } : { type: 'overall' },
  resetsAt,
});

const view = (meters: Meter[], over: Partial<AccountView> = {}): AccountView => {
  const snapshot: UsageSnapshot = {
    providerId: 'zai',
    accountId: 'a',
    fetchedAt: NOW.toISOString(),
    meters,
    status: { type: 'ok' },
  };
  return {
    account: {
      id: 'a',
      providerId: 'zai',
      label: 'Work',
      authMethod: 'apiKey',
      sortOrder: 0,
      createdAt: 1,
    },
    meta: { id: 'zai', name: 'GLM', automation: 'spec', auth: ['apiKey'] },
    snapshot,
    health: { accountId: 'a', failures: 0, statusType: 'ok', lastSuccessAt: NOW.getTime() },
    source: 'auto',
    ...over,
  };
};

const run = (
  views: AccountView[],
  settings: Partial<AlertSettings> = {},
  overrides: AlertRule[] = [],
) =>
  evaluateAlerts({
    views,
    // the threshold suites look at immediate alerts; scheduled reset notices have their own suite
    settings: mergeAlertSettings({ windowReset: false, ...settings }),
    overrides,
    now: NOW,
  });

describe('mergeAlertSettings', () => {
  it('fills defaults and sanitizes thresholds', () => {
    expect(mergeAlertSettings(null)).toEqual(DEFAULT_ALERT_SETTINGS);
    expect(
      mergeAlertSettings({ thresholds: [0.95, 0.8, 0.8, -1, 0, 9, NaN as never] }).thresholds,
    ).toEqual([0.8, 0.95]);
    // a stored setting from the removed "remind me before a reset" rule is dropped
    expect(mergeAlertSettings({ resetSoon: { enabled: true } } as never)).not.toHaveProperty(
      'resetSoon',
    );
    expect(mergeAlertSettings({ enabled: false }).enabled).toBe(false);
  });
});

describe('usage-over rule', () => {
  it('fires nothing below the first threshold', () => {
    expect(run([view([pct('weekly', 79, inHours(10))])])).toEqual([]);
  });

  it('fires for the highest crossed threshold and reports the lower ones for silent marking', () => {
    const [e] = run([view([pct('weekly', 96, inHours(5))])]);
    expect(e.kind).toBe('usage-over');
    expect(e.title).toBe('Weekly at 96%');
    expect(e.body).toBe('GLM (Work): resets in 5h 0m.');
    expect(e.ruleId).toContain('|usage-over|0.95');
    expect(e.alsoMarkFired?.map((x) => x.ruleId)).toEqual([
      expect.stringContaining('|usage-over|0.8'),
    ]);
  });

  it('uses the model in the title and keeps separate rules per model', () => {
    const events = run([
      view([pct('weekly', 85, inHours(5), 'opus'), pct('weekly', 85, inHours(5), 'sonnet')]),
    ]);
    expect(events).toHaveLength(2);
    expect(events[0].title).toContain('Weekly (opus)');
    expect(new Set(events.map((e) => e.ruleId)).size).toBe(2);
  });

  it('ignores meters without a ratio (balances) and snapshots from a finished cycle', () => {
    const balance: Meter = {
      id: 'credits',
      label: 'Credits',
      kind: { type: 'balance', value: 1, unit: 'USD' },
      scope: { type: 'overall' },
    };
    expect(run([view([balance])])).toEqual([]);
    expect(run([view([pct('weekly', 99, inHours(-1))])])).toEqual([]); // reset already passed
  });

  it('never alerts for read-only historical accounts, before or after a reset', () => {
    for (const hours of [-1, 5])
      expect(run([view([pct('weekly', 99, inHours(hours))], { source: 'legacy' })])).toEqual([]);
  });

  it('respects the global switch and custom thresholds', () => {
    expect(run([view([pct('weekly', 99, inHours(5))])], { enabled: false })).toEqual([]);
    expect(run([view([pct('weekly', 75, inHours(5))])], { thresholds: [0.7] })).toHaveLength(1);
    expect(run([view([pct('weekly', 99, inHours(5))])], { thresholds: [] })).toEqual([]);
  });

  it('applies per-meter overrides: off, or a single custom threshold', () => {
    const rule = (over: Partial<AlertRule>): AlertRule => ({
      id: 'o',
      accountId: 'a',
      meterId: 'weekly',
      kind: 'usage-over',
      threshold: 1,
      enabled: true,
      ...over,
    });
    const v = [view([pct('weekly', 85, inHours(5)), pct('session', 85, inHours(1))])];
    expect(run(v, {}, [rule({ enabled: false })]).map((e) => e.title)).toEqual([
      expect.stringContaining('5-hour window'),
    ]);
    expect(run(v, {}, [rule({ threshold: 0.9 })]).map((e) => e.title)).toEqual([
      expect.stringContaining('5-hour window'),
    ]);
    expect(run(v, {}, [rule({ threshold: 0.8 })])).toHaveLength(2);
    // an override for another model or account does not apply
    expect(
      run(v, {}, [
        rule({ enabled: false, model: 'opus' }),
        rule({ enabled: false, accountId: 'zzz' }),
      ]),
    ).toHaveLength(2);
  });
});

describe('reset notices for windows that are not used up', () => {
  it('never fire for an unused or partly used window, however often its reset time moves', () => {
    // an idle 5-hour window reports a reset a full window ahead on every refresh
    const settings = { windowReset: true, resetSoon: { enabled: true, hours: 6 } } as never;
    for (const hours of [5, 4.9, 4.8]) {
      for (const used of [0, 20, 99]) {
        const events = run([view([pct('session', used, inHours(hours))])], settings);
        expect(events.filter((e) => e.kind !== 'usage-over')).toEqual([]);
      }
    }
  });
});

describe('auth-expired rule', () => {
  const expired = view([pct('weekly', 10, inHours(5))], {
    health: { accountId: 'a', failures: 0, statusType: 'authExpired', lastSuccessAt: 111 },
  });
  it('fires once per expiry (key changes only after a new success)', () => {
    const [e] = run([expired]);
    expect(e.kind).toBe('auth-expired');
    expect(e.title).toBe('Sign in again');
    expect(e.body).toBe('GLM (Work): the login was rejected, usage cannot update.');
    const later = view([], {
      health: {
        accountId: 'a',
        failures: 0,
        statusType: 'authExpired',
        lastSuccessAt: 111,
        lastAttemptAt: 999,
      },
    });
    expect(run([later])[0].cycleKey).toBe(e.cycleKey);
    const again = view([], {
      health: { accountId: 'a', failures: 0, statusType: 'authExpired', lastSuccessAt: 222 },
    });
    expect(run([again])[0].cycleKey).not.toBe(e.cycleKey);
  });
  it('can be turned off', () => {
    expect(run([expired], { authExpired: false })).toEqual([]);
  });
});

describe('window-reset rule', () => {
  const resets = (
    views: AccountView[],
    over: Partial<AlertSettings> = {},
    rules: AlertRule[] = [],
  ) => run(views, { windowReset: true, ...over }, rules).filter((e) => e.kind === 'window-reset');

  it('schedules a "quota is back" notice at the reset of a used-up window', () => {
    const [e] = resets([view([pct('session', 100, inHours(2))])]);
    expect(e.at).toBe(NOW.getTime() + 2 * 3_600_000);
    expect(e.title).toBe('5-hour window has reset');
    expect(e.body).toBe('GLM (Work): the quota is available again.');
    expect(e.ruleId).toBe('a|session|window-reset');
  });

  it('counts a window that reads as 100% as used up', () => {
    expect(resets([view([pct('session', 99.6, inHours(2))])])).toHaveLength(1);
  });

  it('stays quiet for unused or not yet used-up windows, when turned off, or when muted', () => {
    expect(resets([view([pct('session', 0, inHours(2))])])).toEqual([]);
    expect(resets([view([pct('session', 90, inHours(2))])])).toEqual([]);
    expect(resets([view([pct('session', 100, inHours(2))])], { windowReset: false })).toEqual([]);
    const off: AlertRule = {
      id: 'o',
      accountId: 'a',
      meterId: 'session',
      kind: 'usage-over',
      threshold: 1,
      enabled: false,
    };
    expect(resets([view([pct('session', 100, inHours(2))])], {}, [off])).toEqual([]);
  });
});

describe('renewal-soon rule', () => {
  const withRenewal = (days: number): AccountView => {
    const v = view([pct('weekly', 10, inHours(30))]);
    return { ...v, snapshot: { ...v.snapshot!, renewsAt: inHours(days * 24) } };
  };
  const renewals = (v: AccountView, over: Partial<AlertSettings> = {}) =>
    run([v], over).filter((e) => e.kind === 'renewal-soon');

  it('reminds within the chosen number of days, once per renewal date', () => {
    const [e] = renewals(withRenewal(2));
    expect(e.title).toMatch(/^Plan ends /);
    expect(e.body).toBe('GLM (Work): ends or renews in 2 days.');
    expect(e.cycleKey).toBe(`a:renew:${Date.parse(inHours(48))}`);
  });

  it('waits until the reminder window opens and respects the switch', () => {
    expect(renewals(withRenewal(5))).toEqual([]);
    expect(renewals(withRenewal(5), { renewal: { enabled: true, days: 7 } })).toHaveLength(1);
    expect(renewals(withRenewal(1), { renewal: { enabled: false, days: 3 } })).toEqual([]);
  });
});

describe('choiceFor', () => {
  const m = pct('weekly', 1);
  const rule = (over: Partial<AlertRule>): AlertRule => ({
    id: 'o',
    accountId: 'a',
    meterId: 'weekly',
    kind: 'usage-over',
    threshold: 0.9,
    enabled: true,
    ...over,
  });
  it('maps rules to UI choices', () => {
    expect(choiceFor([], 'a', m)).toBe('default');
    expect(choiceFor([rule({})], 'a', m)).toBe(0.9);
    expect(choiceFor([rule({ enabled: false })], 'a', m)).toBe('off');
  });
});

describe('dispatchAlerts', () => {
  async function setup(
    permission: 'granted' | 'denied' | 'undetermined' = 'granted',
    failSend = false,
  ) {
    const db = memoryDriver();
    await migrate(db);
    const repos = createRepos(db);
    const sent: AlertEvent[] = [];
    // pending scheduled notifications, by identifier, as the OS would keep them
    const pending = new Set<string>();
    const notifier: Notifier = {
      permission: async () => permission,
      send: async (e) => {
        if (failSend) throw new Error('os refused');
        sent.push(e);
        if (e.at !== undefined) pending.add(e.ruleId);
      },
      scheduled: async () => [...pending],
      cancel: async (id) => void pending.delete(id),
    };
    return {
      repos,
      sent,
      pending,
      deps: { alerts: repos.alerts, notifier, now: () => NOW.getTime() },
    };
  }

  const event = (over: Partial<AlertEvent> = {}): AlertEvent => ({
    ruleId: 'r|0.95',
    cycleKey: 'c1',
    kind: 'usage-over',
    accountId: 'a',
    title: 'T',
    body: 'B',
    ...over,
  });

  it('sends once per cycle and re-arms when the cycle changes', async () => {
    const s = await setup();
    expect(await dispatchAlerts([event()], s.deps)).toEqual({ sent: 1, skipped: 0 });
    expect(await dispatchAlerts([event()], s.deps)).toEqual({ sent: 0, skipped: 1 });
    expect(await dispatchAlerts([event({ cycleKey: 'c2' })], s.deps)).toEqual({
      sent: 1,
      skipped: 0,
    });
    expect(s.sent).toHaveLength(2);
  });

  it('marks lower thresholds silently so they never fire later in the same cycle', async () => {
    const s = await setup();
    await dispatchAlerts([event({ alsoMarkFired: [{ ruleId: 'r|0.8', cycleKey: 'c1' }] })], s.deps);
    expect(await dispatchAlerts([event({ ruleId: 'r|0.8' })], s.deps)).toEqual({
      sent: 0,
      skipped: 1,
    });
  });

  it('does not consume the alert while notifications are not allowed, so it fires after permission is granted', async () => {
    const denied = await setup('denied');
    expect(await dispatchAlerts([event()], denied.deps)).toEqual({ sent: 0, skipped: 0 });
    expect(await denied.repos.alerts.hasFired('r|0.95', 'c1')).toBe(false);
    const granted = {
      ...denied.deps,
      notifier: { ...denied.deps.notifier, permission: async () => 'granted' as const },
    };
    expect((await dispatchAlerts([event()], granted)).sent).toBe(1);
  });

  it('keeps the alert pending if the OS rejects the notification', async () => {
    const s = await setup('granted', true);
    expect(await dispatchAlerts([event()], s.deps)).toEqual({ sent: 0, skipped: 0 });
    expect(await s.repos.alerts.hasFired('r|0.95', 'c1')).toBe(false);
  });

  it('reschedules timed notices every cycle without consuming them, and skips past ones', async () => {
    const s = await setup();
    const timed = event({
      kind: 'window-reset',
      ruleId: 'a|session|window-reset',
      at: NOW.getTime() + 60_000,
    });
    expect((await dispatchAlerts([timed], s.deps)).sent).toBe(1);
    expect((await dispatchAlerts([timed], s.deps)).sent).toBe(1);
    expect(await s.repos.alerts.hasFired(timed.ruleId, timed.cycleKey)).toBe(false);
    expect((await dispatchAlerts([{ ...timed, at: NOW.getTime() - 1 }], s.deps)).sent).toBe(0);
  });

  it('withdraws a scheduled reset notice once no event asks for it', async () => {
    const s = await setup();
    const timed = (ruleId: string) =>
      event({ kind: 'window-reset', ruleId, at: NOW.getTime() + 60_000 });
    await dispatchAlerts([timed('a|session|window-reset'), timed('b|weekly|window-reset')], s.deps);
    expect([...s.pending].sort()).toEqual(['a|session|window-reset', 'b|weekly|window-reset']);
    // account b's window is no longer used up (or b was removed): only a's notice stays
    await dispatchAlerts([timed('a|session|window-reset')], s.deps);
    expect([...s.pending]).toEqual(['a|session|window-reset']);
    // alerts turned off: nothing is asked for, so nothing stays scheduled
    await dispatchAlerts([], s.deps);
    expect([...s.pending]).toEqual([]);
  });

  it('does nothing for an empty list without asking for permission', async () => {
    const s = await setup();
    const spy = jest.spyOn(s.deps.notifier, 'permission');
    expect(await dispatchAlerts([], s.deps)).toEqual({ sent: 0, skipped: 0 });
    expect(spy).not.toHaveBeenCalled();
  });
});
