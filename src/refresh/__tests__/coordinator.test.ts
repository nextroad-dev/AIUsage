import type { Notifier } from '@/alerts/dispatch';
import type { AlertEvent } from '@/alerts/evaluate';
import { CredentialManager } from '@/authkit/refresh';
import { CredentialStore, memoryKv } from '@/authkit/secure';
import { migrate } from '@/db/migrations';
import { createRepos } from '@/db/repos';
import { resetCoordinatorForTests, runRefreshCycle, type CycleDeps } from '@/refresh/coordinator';
import { fakeFetch, NOW } from '@/test-utils/fetch';
import { memoryDriver } from '@/test-utils/sqlite';
import { CodexResetService, SOURCE } from '@/data/codex-reset/service';

const POE = 'https://api.poe.com/usage/current_balance';
const OR_KEY = 'https://openrouter.ai/api/v1/key';
const OR_CREDITS = 'https://openrouter.ai/api/v1/credits';

async function setup(routes: Parameters<typeof fakeFetch>[0], clock = { t: NOW.getTime() }) {
  resetCoordinatorForTests();
  const db = memoryDriver();
  await migrate(db);
  const repos = createRepos(db);
  const store = new CredentialStore(memoryKv());
  const f = fakeFetch(routes);
  const sent: AlertEvent[] = [];
  const notifier: Notifier = {
    permission: async () => 'granted',
    send: async (e) => void sent.push(e),
    scheduled: async () => [],
    cancel: async () => undefined,
  };
  const deps: CycleDeps = {
    repos,
    creds: new CredentialManager(store),
    fetch: f.fetch,
    now: () => new Date(clock.t),
    notifier,
  };
  const addAuto = async (id: string, providerId: string) => {
    await repos.accounts.create({ id, providerId, label: id, authMethod: 'apiKey', createdAt: 1 });
    await store.save(id, { type: 'apiKey', key: 'k' });
  };
  return { db, repos, deps, sent, f, clock, addAuto };
}

const manualConfig = (anchor: string) => ({
  planName: 'Max',
  meters: [
    {
      id: 'weekly',
      label: 'Weekly',
      window: { type: 'weekly' as const },
      anchor,
      unit: '%',
      percent: true,
    },
  ],
});

describe('runRefreshCycle', () => {
  it('keeps Codex personal usage and other providers healthy when the public data source fails', async () => {
    const usage = 'https://chatgpt.com/backend-api/wham/usage';
    const s = await setup({
      [usage]: {
        json: {
          rate_limit: {
            primary_window: { used_percent: 40, reset_at: 1791300000 },
          },
        },
      },
      [POE]: { json: { current_point_balance: 100 } },
      [`${SOURCE}api/forecast`]: { status: 401 },
    });
    // Match the production Expo driver's serialized transactions; the basic memory fake
    // rejects overlapping transactions from two otherwise successful provider refreshes.
    const transaction = s.db.transaction;
    let chain: Promise<unknown> = Promise.resolve();
    s.db.transaction = (fn) => {
      const next = chain.then(() => transaction(fn));
      chain = next.catch(() => undefined);
      return next;
    };
    await s.addAuto('p', 'poe');
    await s.repos.accounts.create({
      id: 'c',
      providerId: 'codex',
      label: 'Codex',
      authMethod: 'oauthPkce',
      createdAt: 1,
    });
    const store = new CredentialStore(memoryKv());
    await store.save('c', {
      type: 'oauth',
      accessToken: 'private-codex-token',
      accountId: 'private-account',
    });
    await store.save('p', { type: 'apiKey', key: 'private-poe-key' });
    s.deps.creds = new CredentialManager(store);
    const service = new CodexResetService({
      store: s.repos.settings,
      fetch: s.f.fetch,
      now: () => s.clock.t,
    });
    await service.setEnabled(true);
    const publicWork = service.refresh();
    s.deps.refreshPublicData = () => publicWork;
    const result = await runRefreshCycle(s.deps, { force: true });
    await publicWork;
    expect(result.outcomes.c.type).toBe('ok');
    expect(result.outcomes.p.type).toBe('ok');
    expect(await s.repos.health.get('c')).toMatchObject({
      statusType: 'ok',
      failures: 0,
    });
    expect((await s.repos.snapshots.latest('c', 'codex'))?.meters[0].kind).toEqual({
      type: 'percent',
      used: 40,
    });
    for (const call of s.f.calls.filter((c) => c.url.startsWith(SOURCE))) {
      expect(call.headers.Authorization).toBeUndefined();
      expect(call.headers['ChatGPT-Account-Id']).toBeUndefined();
    }
  });

  it('never waits for or fails the personal refresh cycle on auxiliary public work', async () => {
    const s = await setup({ [POE]: { json: { current_point_balance: 1 } } });
    await s.addAuto('p', 'poe');
    s.deps.refreshPublicData = () => new Promise(() => {});
    expect((await runRefreshCycle(s.deps, { force: true })).outcomes.p.type).toBe('ok');
    s.deps.refreshPublicData = async () => {
      throw new Error('source unavailable');
    };
    expect((await runRefreshCycle(s.deps, { force: true })).outcomes.p.type).toBe('ok');
  });

  it('refreshes, evaluates alerts and notifies in one pass', async () => {
    const s = await setup({
      [OR_KEY]: { json: { data: { limit: 10, usage: 9, usage_daily: 1 } } },
      [OR_CREDITS]: { json: { data: { total_credits: 10, total_usage: 9 } } },
    });
    await s.addAuto('o', 'openrouter');
    const r = await runRefreshCycle(s.deps, { force: true });
    expect(r.outcomes.o.type).toBe('ok');
    expect(r.alertsSent).toBe(1);
    expect(s.sent[0].title).toContain('90%'); // key spend limit: 9 of 10
    // a second cycle in the same reset cycle does not repeat the alert
    s.clock.t += 5 * 60_000;
    const r2 = await runRefreshCycle(s.deps, { force: true });
    expect(r2.alertsSent).toBe(0);
    expect(s.sent).toHaveLength(1);
  });

  it('keeps historical manual accounts without notifications or network access', async () => {
    const s = await setup({});
    await s.repos.accounts.create({
      id: 'm',
      providerId: 'claude',
      label: 'm',
      authMethod: 'manual',
      createdAt: 1,
      manual: manualConfig('2026-10-04T00:00:00Z'),
    });
    await s.repos.manual.set('m', 'weekly', 96, NOW.toISOString());
    const r = await runRefreshCycle(s.deps);
    expect(r.alertsSent).toBe(0);
    expect(s.f.calls).toHaveLength(0);
    expect((await s.repos.manual.get('m')).weekly.used).toBe(96);
  });

  it('a failing account does not stop others or the alert pass', async () => {
    const s = await setup({
      [POE]: { status: 500 },
      [OR_KEY]: { json: { data: { limit: 10, usage: 9, usage_daily: 1 } } },
      [OR_CREDITS]: { json: { data: { total_credits: 5, total_usage: 1 } } },
    });
    await s.addAuto('p', 'poe');
    await s.addAuto('o', 'openrouter');
    await s.repos.accounts.create({
      id: 'm',
      providerId: 'claude',
      label: 'm',
      authMethod: 'manual',
      createdAt: 2,
      manual: manualConfig('2026-10-04T00:00:00Z'),
    });
    await s.repos.manual.set('m', 'weekly', 99, NOW.toISOString());
    const r = await runRefreshCycle(s.deps, { force: true });
    expect(r.outcomes.p.type).toBe('failed');
    expect(r.outcomes.o.type).toBe('ok');
    expect(r.alertsSent).toBe(1);
  });

  it('notifies about an expired login once', async () => {
    const s = await setup({ [POE]: { status: 401 } });
    await s.addAuto('p', 'poe');
    expect((await runRefreshCycle(s.deps, { force: true })).alertsSent).toBe(1);
    expect(s.sent[0].kind).toBe('auth-expired');
    expect((await runRefreshCycle(s.deps, { force: true })).alertsSent).toBe(0);
  });

  it('shares one in-flight cycle between concurrent callers', async () => {
    const s = await setup({ [POE]: { json: { current_point_balance: 1 } } });
    await s.addAuto('p', 'poe');
    const [a, b] = await Promise.all([
      runRefreshCycle(s.deps, { force: true }),
      runRefreshCycle(s.deps, { force: true }),
    ]);
    expect(a).toBe(b);
    expect(s.f.calls.filter((x) => x.url === POE)).toHaveLength(1); // one shared run, not two
  });

  it('returns within the time budget even if the work is slow, without starting a second cycle', async () => {
    const s = await setup({});
    await s.addAuto('p', 'poe');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    s.deps.fetch = (async () => {
      await gate;
      return new Response(JSON.stringify({ current_point_balance: 1 }));
    }) as typeof fetch;
    const slow = await runRefreshCycle(s.deps, { force: true, budgetMs: 20 });
    expect(slow.timedOut).toBe(true);
    // still running in the background: a new call joins it rather than overlapping
    const joined = runRefreshCycle(s.deps, { force: true, budgetMs: 5000 });
    release();
    expect((await joined).timedOut).toBe(true); // same shared promise as the timed-out one
    await new Promise((r) => setTimeout(r, 20));
    // after the real work finished, a fresh cycle is allowed again
    s.deps.fetch = fakeFetch({ [POE]: { json: { current_point_balance: 2 } } }).fetch;
    expect((await runRefreshCycle(s.deps, { force: true })).timedOut).toBe(false);
  });

  it('prunes old data at most once a day', async () => {
    const s = await setup({});
    expect((await runRefreshCycle(s.deps)).pruned).toBe(true);
    expect((await runRefreshCycle(s.deps)).pruned).toBe(false);
    s.clock.t += 25 * 3_600_000;
    expect((await runRefreshCycle(s.deps)).pruned).toBe(true);
  });

  it('never throws, even if the database fails', async () => {
    const s = await setup({});
    s.deps.repos.accounts.list = async () => {
      throw new Error('db down');
    };
    const r = await runRefreshCycle(s.deps);
    expect(r).toEqual({ outcomes: {}, alertsSent: 0, pruned: false, timedOut: false });
  });
});
