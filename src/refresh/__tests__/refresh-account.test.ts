import { CredentialManager } from '@/authkit/refresh';
import { CredentialStore, memoryKv } from '@/authkit/secure';
import { migrate } from '@/db/migrations';
import { createRepos } from '@/db/repos';
import {
  loadSnapshot,
  refreshAccount,
  refreshAll,
  type RefreshDeps,
} from '@/refresh/refresh-account';
import { fakeFetch, NOW } from '@/test-utils/fetch';
import { memoryDriver } from '@/test-utils/sqlite';

const POE = 'https://api.poe.com/usage/current_balance';
const OR_KEY = 'https://openrouter.ai/api/v1/key';
const OR_CREDITS = 'https://openrouter.ai/api/v1/credits';

async function setup(routes: Parameters<typeof fakeFetch>[0], clock = { t: NOW.getTime() }) {
  const db = memoryDriver();
  await migrate(db);
  const repos = createRepos(db);
  const store = new CredentialStore(memoryKv());
  const f = fakeFetch(routes);
  const deps: RefreshDeps = {
    repos,
    creds: new CredentialManager(store),
    fetch: f.fetch,
    now: () => new Date(clock.t),
  };
  const add = async (id: string, providerId: string, key = 'k', extra: object = {}) => {
    await repos.accounts.create({
      id,
      providerId,
      label: id,
      authMethod: 'apiKey',
      createdAt: 1,
      ...extra,
    });
    await store.save(id, { type: 'apiKey', key });
  };
  return { repos, deps, add, f, clock, store };
}

describe('refreshAccount', () => {
  it('stores a snapshot and marks the account healthy', async () => {
    const s = await setup({ [POE]: { json: { current_point_balance: 500 } } });
    await s.add('a', 'poe');
    const r = await refreshAccount(s.deps, 'a');
    expect(r.type).toBe('ok');
    expect((await s.repos.snapshots.latest('a', 'poe'))?.meters[0].kind).toMatchObject({
      value: 500,
    });
    expect(await s.repos.health.get('a')).toMatchObject({
      failures: 0,
      statusType: 'ok',
      lastSuccessAt: NOW.getTime(),
    });
    expect(s.f.calls[0].headers.Authorization).toBe('Bearer k');
  });

  it('keeps the last good snapshot when a later refresh fails', async () => {
    const s = await setup({ [POE]: { json: { current_point_balance: 500 } } });
    await s.add('a', 'poe');
    await refreshAccount(s.deps, 'a');
    s.clock.t += 10 * 60_000;
    const f2 = fakeFetch({ [POE]: { status: 500 } });
    const r = await refreshAccount({ ...s.deps, fetch: f2.fetch }, 'a');
    expect(r).toMatchObject({ type: 'failed', kind: 'server' });
    expect((await s.repos.snapshots.latest('a', 'poe'))?.meters[0].kind).toMatchObject({
      value: 500,
    });
    expect(await s.repos.health.get('a')).toMatchObject({
      failures: 1,
      statusType: 'error',
      lastSuccessAt: NOW.getTime(),
    });
  });

  it('flags authExpired without counting a failure, and stops auto-retrying until forced', async () => {
    const s = await setup({ [POE]: { status: 401 } });
    await s.add('a', 'poe');
    expect(await refreshAccount(s.deps, 'a')).toMatchObject({
      type: 'failed',
      kind: 'invalid-credential',
    });
    expect(await s.repos.health.get('a')).toMatchObject({ failures: 0, statusType: 'authExpired' });
    s.clock.t += 60 * 60_000; // an hour later
    expect(await refreshAccount(s.deps, 'a')).toEqual({ type: 'skipped', reason: 'rate-limited' });
    expect((await refreshAccount(s.deps, 'a', { force: true })).type).toBe('failed');
    expect(s.f.calls).toHaveLength(2);
  });

  it('rate-limits repeated refreshes, but not forced ones', async () => {
    const s = await setup({ [POE]: { json: { current_point_balance: 1 } } });
    await s.add('a', 'poe');
    await refreshAccount(s.deps, 'a');
    s.clock.t += 30_000;
    expect(await refreshAccount(s.deps, 'a')).toEqual({ type: 'skipped', reason: 'rate-limited' });
    expect((await refreshAccount(s.deps, 'a', { force: true })).type).toBe('ok');
    s.clock.t += 2 * 60_000;
    expect((await refreshAccount(s.deps, 'a')).type).toBe('ok');
  });

  it('backs off after repeated failures and honors Retry-After', async () => {
    const s = await setup({ [POE]: { status: 429, headers: { 'retry-after': '600' } } });
    await s.add('a', 'poe');
    await refreshAccount(s.deps, 'a');
    s.clock.t += 5 * 60_000;
    expect((await refreshAccount(s.deps, 'a', { force: true })).type).toBe('skipped'); // still inside Retry-After
    s.clock.t += 6 * 60_000;
    expect((await refreshAccount(s.deps, 'a', { force: true })).type).toBe('failed'); // allowed again
  });

  it('records unsupported when the response is not recognized, without counting a failure', async () => {
    const s = await setup({ [POE]: { json: { something: 'else' } } });
    await s.add('a', 'poe');
    await refreshAccount(s.deps, 'a');
    expect(await s.repos.health.get('a')).toMatchObject({ statusType: 'unsupported', failures: 0 });
    expect(await s.repos.snapshots.latest('a', 'poe')).toBeNull();
  });

  it('manual accounts and unknown accounts do not touch the network', async () => {
    const s = await setup({});
    await s.add('m', 'claude', 'k', {
      authMethod: 'manual',
      manual: { planName: 'Pro', meters: [] },
    });
    expect(await refreshAccount(s.deps, 'm')).toEqual({ type: 'manual' });
    expect(await refreshAccount(s.deps, 'ghost')).toEqual({
      type: 'skipped',
      reason: 'missing-account',
    });
    expect(s.f.calls).toHaveLength(0);
  });

  it('accounts for providers without a plugin are marked unsupported', async () => {
    const s = await setup({});
    await s.add('c', 'perplexity');
    expect(await refreshAccount(s.deps, 'c')).toMatchObject({ type: 'failed', kind: 'no-plugin' });
    expect((await s.repos.health.get('c'))?.statusType).toBe('unsupported');
  });
});

describe('refreshAll / loadSnapshot', () => {
  it('refreshes every account independently', async () => {
    const s = await setup({
      [POE]: { status: 500 },
      [OR_KEY]: { json: { data: { usage_daily: 1 } } },
      [OR_CREDITS]: { json: { data: { total_credits: 10, total_usage: 1 } } },
    });
    await s.add('p', 'poe');
    await s.add('o', 'openrouter');
    const out = await refreshAll(s.deps);
    expect(out.p.type).toBe('failed');
    expect(out.o.type).toBe('ok');
  });

  it('reconstructs read-only manual history and reads stored snapshots for automatic accounts', async () => {
    const s = await setup({ [POE]: { json: { current_point_balance: 5 } } });
    await s.add('a', 'poe');
    expect(await loadSnapshot(s.repos, 'a', NOW)).toBeNull();
    await refreshAccount(s.deps, 'a');
    expect((await loadSnapshot(s.repos, 'a', NOW))?.status).toEqual({ type: 'ok' });
    await s.repos.accounts.create({
      id: 'm',
      providerId: 'claude',
      label: 'm',
      authMethod: 'manual',
      createdAt: 2,
      manual: {
        planName: 'Pro',
        meters: [
          {
            id: 'weekly',
            label: 'Weekly',
            window: { type: 'weekly' },
            anchor: '2026-10-01T00:00:00Z',
            unit: '%',
            percent: true,
          },
        ],
      },
    });
    const snap = await loadSnapshot(s.repos, 'm', NOW);
    expect(snap?.status).toEqual({ type: 'manual' });
    expect(snap?.meters[0].resetsAt).toBe('2026-10-08T00:00:00.000Z');
    expect(await loadSnapshot(s.repos, 'ghost', NOW)).toBeNull();
  });
});
