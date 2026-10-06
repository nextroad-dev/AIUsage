import { AccountService } from '@/authkit/account-service';
import { CredentialManager } from '@/authkit/refresh';
import { CredentialStore, memoryKv } from '@/authkit/secure';
import { migrate } from '@/db/migrations';
import { createRepos } from '@/db/repos';
import { loadViews } from '@/data/load';
import { validateCredential } from '@/providers/service';
import { loadSnapshot, refreshAccount } from '@/refresh/refresh-account';
import { ctxWith, fakeFetch, NOW } from '@/test-utils/fetch';
import { memoryDriver } from '@/test-utils/sqlite';

async function setup() {
  const db = memoryDriver();
  await migrate(db);
  const repos = createRepos(db);
  const creds = new CredentialStore(memoryKv());
  return { repos, creds, service: new AccountService(repos, creds) };
}
const account = (id: string) => ({
  id,
  providerId: 'openrouter',
  label: id,
  authMethod: 'apiKey' as const,
  createdAt: NOW.getTime(),
});

describe('service-layer connection policy', () => {
  it('refuses manual, Cookie, unsupported, mismatched and missing credentials without writes', async () => {
    const s = await setup();
    const cases = [
      { ...account('m'), authMethod: 'manual' as const, manual: { meters: [] } },
      { ...account('c'), providerId: 'cursor', authMethod: 'webviewSession' as const },
      { ...account('z'), providerId: 'opencode' },
      { ...account('fake'), providerId: 'codex' },
    ];
    for (const a of cases) {
      await expect(s.service.add(a, { type: 'apiKey', key: 'k' })).rejects.toThrow(
        /Only supported/,
      );
      expect(await s.creds.load(a.id)).toBeNull();
    }
    await expect(
      s.service.add(account('session'), { type: 'session', cookies: { sid: 's' } }),
    ).rejects.toThrow();
    await expect(s.service.add(account('none'))).rejects.toThrow();
    expect(await s.repos.accounts.list()).toEqual([]);
  });

  it('stores PKCE as a key with explicit OAuth provenance and normal device OAuth as tokens', async () => {
    const s = await setup();
    await s.service.add(
      { ...account('pkce'), authMethod: 'oauthPkce' },
      { type: 'apiKey', key: 'issued' },
    );
    expect((await s.repos.accounts.get('pkce'))?.authMethod).toBe('oauthPkce');
    expect(await s.creds.load('pkce')).toEqual({ type: 'apiKey', key: 'issued' });
    await s.service.add(
      { ...account('device'), providerId: 'codex', authMethod: 'deviceCode' },
      { type: 'oauth', accessToken: 'access', refreshToken: 'refresh' },
    );
    expect((await s.creds.load('device'))?.type).toBe('oauth');
  });

  it('validation refuses a session credential without a request, including on an active provider', async () => {
    const f = fakeFetch({});
    expect(
      await validateCredential(
        'openrouter',
        { type: 'session', cookies: { sid: 's' } },
        ctxWith(f.fetch),
      ),
    ).toMatchObject({ ok: false, kind: 'invalid-credential' });
    expect(
      await validateCredential('cursor', { type: 'apiKey', key: 'k' }, ctxWith(f.fetch)),
    ).toMatchObject({ ok: false, kind: 'no-plugin' });
    expect(f.calls).toEqual([]);
  });
});

describe('legacy history retention', () => {
  it('does not reset historical manual values when time moves forward', async () => {
    const s = await setup();
    await s.repos.accounts.create({
      ...account('old'),
      providerId: 'claude',
      authMethod: 'manual',
      manual: {
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
    await s.repos.manual.set('old', 'weekly', 83, NOW.toISOString());
    const earlier = await loadSnapshot(s.repos, 'old', NOW);
    const later = await loadSnapshot(s.repos, 'old', new Date('2026-12-20T12:00:00Z'));
    expect(later).toEqual(earlier);
    expect(later?.meters[0].kind).toEqual({ type: 'percent', used: 83 });
    expect(later?.fetchedAt).toBe(NOW.toISOString());
    const f = fakeFetch({});
    expect(
      await refreshAccount(
        { repos: s.repos, creds: new CredentialManager(s.creds), fetch: f.fetch, now: () => NOW },
        'old',
        { force: true },
      ),
    ).toEqual({ type: 'manual' });
    expect((await s.repos.manual.get('old')).weekly.used).toBe(83);
    expect(f.calls).toEqual([]);
    expect(await s.repos.health.get('old')).toBeNull();
  });

  it('retains Cookie credentials/snapshot but never refreshes or treats them as current automatic data', async () => {
    const s = await setup();
    await s.repos.accounts.create({
      ...account('cookie'),
      providerId: 'cursor',
      authMethod: 'webviewSession',
    });
    const cred = { type: 'session', cookies: { WorkosCursorSessionToken: 'old-secret' } } as const;
    await s.creds.save('cookie', cred);
    const snapshot = {
      accountId: 'cookie',
      providerId: 'cursor',
      fetchedAt: NOW.toISOString(),
      status: { type: 'ok' as const },
      meters: [],
    };
    await s.repos.snapshots.save(snapshot);
    const f = fakeFetch({});
    expect(
      await refreshAccount(
        { repos: s.repos, creds: new CredentialManager(s.creds), fetch: f.fetch, now: () => NOW },
        'cookie',
        { force: true },
      ),
    ).toEqual({ type: 'skipped', reason: 'legacy-account' });
    expect(f.calls).toEqual([]);
    expect(await s.creds.load('cookie')).toEqual(cred);
    expect(await s.repos.health.get('cookie')).toBeNull();
    const views = await loadViews(s.repos, NOW);
    expect(views[0]).toMatchObject({ source: 'legacy', health: null });
    expect(views[0].snapshot).toEqual(snapshot);
  });

  it('prefers a stored manual snapshot over reconstructing a historical view', async () => {
    const s = await setup();
    await s.repos.accounts.create({
      ...account('old'),
      authMethod: 'manual',
      manual: { meters: [] },
    });
    const snapshot = {
      accountId: 'old',
      providerId: 'openrouter',
      fetchedAt: NOW.toISOString(),
      status: { type: 'manual' as const },
      meters: [],
    };
    await s.repos.snapshots.save(snapshot);
    expect(await loadSnapshot(s.repos, 'old', new Date('2027-01-01'))).toEqual(snapshot);
    await s.repos.snapshots.prune(new Date('2027-06-01').getTime());
    expect(await s.repos.snapshots.latest('old', 'openrouter')).toEqual(snapshot);
  });

  it('retains every historical sample instead of thinning legacy accounts during maintenance', async () => {
    const s = await setup();
    await s.repos.accounts.create({ ...account('old'), authMethod: 'manual' });
    for (const minutes of [1, 20, 40]) {
      await s.repos.snapshots.save({
        accountId: 'old',
        providerId: 'openrouter',
        fetchedAt: new Date(NOW.getTime() + minutes * 60000).toISOString(),
        status: { type: 'manual' },
        meters: [
          {
            id: 'weekly',
            label: 'Weekly',
            scope: { type: 'overall' },
            kind: { type: 'percent', used: minutes },
          },
        ],
      });
    }
    expect(await s.repos.snapshots.prune(new Date('2027-06-01').getTime())).toEqual({
      samplesDeleted: 0,
      snapshotsDeleted: 0,
    });
    // nothing was thinned (asserted above); the last recorded value must still round-trip
    const latest = await s.repos.snapshots.latest('old', 'weekly');
    expect(latest?.meters[0].kind).toEqual({ type: 'percent', used: 40 });
  });
});
