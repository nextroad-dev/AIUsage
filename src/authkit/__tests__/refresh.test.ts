import { CredentialManager, needsRefresh } from '@/authkit/refresh';
import { CredentialStore, memoryKv } from '@/authkit/secure';
import { AuthExpiredError } from '@/core/errors';
import type { Credential, ProviderPlugin } from '@/core/types';
import { ctxWith, fakeFetch, NOW } from '@/test-utils/fetch';

const ctx = ctxWith(fakeFetch({}).fetch);
const oauth = (access: string, refresh: string | undefined, expiresInMs: number): Credential => ({
  type: 'oauth',
  accessToken: access,
  refreshToken: refresh,
  expiresAt: NOW.getTime() + expiresInMs,
});

function setup(initial: Credential, refresh?: ProviderPlugin['refresh']) {
  const store = new CredentialStore(memoryKv());
  const plugin: ProviderPlugin = { id: 'p', fetchUsage: jest.fn(), refresh };
  return { store, plugin, mgr: new CredentialManager(store), init: store.save('a', initial) };
}

describe('needsRefresh', () => {
  it('refreshes within the 60 s leeway, only for refreshable oauth', () => {
    const now = NOW.getTime();
    expect(needsRefresh(oauth('a', 'r', 30_000), now)).toBe(true);
    expect(needsRefresh(oauth('a', 'r', 120_000), now)).toBe(false);
    expect(needsRefresh(oauth('a', undefined, 1000), now)).toBe(false);
    expect(needsRefresh({ type: 'apiKey', key: 'k' }, now)).toBe(false);
    expect(needsRefresh({ type: 'oauth', accessToken: 'a', refreshToken: 'r' }, now)).toBe(false);
  });
});

describe('CredentialManager.getFresh', () => {
  it('returns the stored credential when it is still valid', async () => {
    const refresh = jest.fn();
    const s = setup(oauth('a1', 'r1', 600_000), refresh);
    await s.init;
    expect(await s.mgr.getFresh('a', s.plugin, ctx)).toMatchObject({ accessToken: 'a1' });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('throws AuthExpiredError when nothing is stored', async () => {
    const s = setup({ type: 'apiKey', key: 'k' });
    await expect(s.mgr.getFresh('missing', s.plugin, ctx)).rejects.toBeInstanceOf(AuthExpiredError);
  });

  it('shares a single refresh between concurrent callers and saves the rotated token', async () => {
    let n = 0;
    const refresh = jest.fn(async (): Promise<Credential> => {
      await new Promise((r) => setTimeout(r, 10));
      n++;
      return oauth(`new-${n}`, `rot-${n}`, 3_600_000);
    });
    const s = setup(oauth('old', 'r0', 1000), refresh);
    await s.init;
    const results = await Promise.all(
      Array.from({ length: 10 }, () => s.mgr.getFresh('a', s.plugin, ctx)),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((c) => (c as { accessToken: string }).accessToken))).toEqual(
      new Set(['new-1']),
    );
    expect(await s.store.load('a')).toMatchObject({ accessToken: 'new-1', refreshToken: 'rot-1' });
    // a later expiry triggers a new, separate refresh
    await s.store.save('a', oauth('stale', 'rot-1', 1000));
    await s.mgr.getFresh('a', s.plugin, ctx);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('keeps the old credential on a transient refresh failure and does not call it an expired login', async () => {
    const refresh = jest.fn().mockRejectedValue(new TypeError('network down'));
    const s = setup(oauth('old', 'r0', 1000), refresh);
    await s.init;
    const err = await s.mgr.getFresh('a', s.plugin, ctx).catch((e) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(AuthExpiredError);
    expect(await s.store.load('a')).toMatchObject({ accessToken: 'old', refreshToken: 'r0' });
  });

  it('reports an expired login when the server rejects the refresh token', async () => {
    const refresh = jest.fn().mockRejectedValue(new AuthExpiredError('revoked'));
    const s = setup(oauth('old', 'r0', 1000), refresh);
    await s.init;
    await expect(s.mgr.getFresh('a', s.plugin, ctx)).rejects.toBeInstanceOf(AuthExpiredError);
    expect(await s.store.load('a')).toMatchObject({ refreshToken: 'r0' });
  });

  it('cannot refresh without plugin support', async () => {
    const s = setup(oauth('old', 'r0', 1000));
    await s.init;
    await expect(s.mgr.getFresh('a', s.plugin, ctx)).rejects.toBeInstanceOf(AuthExpiredError);
  });
});

describe('CredentialManager.withAuth', () => {
  it('retries once with a refreshed credential after a 401', async () => {
    const refresh = jest.fn(async () => oauth('fresh', 'r1', 3_600_000));
    const s = setup(oauth('revoked', 'r0', 3_600_000), refresh);
    await s.init;
    const fn = jest.fn(async (c: Credential) => {
      if (c.type === 'oauth' && c.accessToken === 'revoked') throw new AuthExpiredError();
      return 'ok';
    });
    expect(await s.mgr.withAuth('a', s.plugin, ctx, fn)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not loop: a second 401 propagates', async () => {
    const refresh = jest.fn(async () => oauth('fresh', 'r1', 3_600_000));
    const s = setup(oauth('revoked', 'r0', 3_600_000), refresh);
    await s.init;
    const fn = jest.fn(async () => {
      throw new AuthExpiredError();
    });
    await expect(s.mgr.withAuth('a', s.plugin, ctx, fn)).rejects.toBeInstanceOf(AuthExpiredError);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('reuses a credential another caller already refreshed instead of refreshing again', async () => {
    const refresh = jest.fn(async () => oauth('should-not-happen', 'x', 3_600_000));
    const s = setup(oauth('old', 'r0', 3_600_000), refresh);
    await s.init;
    const fn = jest.fn(async (c: Credential) => {
      if (c.type === 'oauth' && c.accessToken === 'old') {
        await s.store.save('a', oauth('refreshed-elsewhere', 'r1', 3_600_000)); // concurrent refresh
        throw new AuthExpiredError();
      }
      return (c as { accessToken: string }).accessToken;
    });
    expect(await s.mgr.withAuth('a', s.plugin, ctx, fn)).toBe('refreshed-elsewhere');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not refresh api keys or session credentials on 401', async () => {
    const refresh = jest.fn();
    const s = setup({ type: 'apiKey', key: 'k' }, refresh);
    await s.init;
    await expect(
      s.mgr.withAuth('a', s.plugin, ctx, async () => {
        throw new AuthExpiredError();
      }),
    ).rejects.toBeInstanceOf(AuthExpiredError);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('passes non-auth errors through untouched', async () => {
    const s = setup(oauth('a', 'r', 3_600_000), jest.fn());
    await s.init;
    await expect(
      s.mgr.withAuth('a', s.plugin, ctx, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
