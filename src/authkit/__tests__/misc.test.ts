import { AccountService } from '@/authkit/account-service';
import { shouldRelock } from '@/authkit/biometric';
import { CredentialStore, memoryKv } from '@/authkit/secure';
import {
  isAllowedNavigation,
  isCaptureComplete,
  jwtExpiryMs,
  looksLoggedOut,
  toSessionCredential,
  type CaptureSpec,
} from '@/authkit/webview-capture';
import { createRepos } from '@/db/repos';
import { migrate } from '@/db/migrations';
import { memoryDriver } from '@/test-utils/sqlite';

describe('shouldRelock', () => {
  it('locks after the grace period in the background', () => {
    expect(shouldRelock({ enabled: false, backgroundedAt: 0, now: 10 ** 9 })).toBe(false);
    expect(shouldRelock({ enabled: true, now: 10 ** 9 })).toBe(false);
    expect(shouldRelock({ enabled: true, backgroundedAt: 1000, now: 20_000 })).toBe(false);
    expect(shouldRelock({ enabled: true, backgroundedAt: 1000, now: 31_000 })).toBe(true);
    expect(shouldRelock({ enabled: true, backgroundedAt: 1000, now: 5000, graceMs: 0 })).toBe(true);
  });
});

describe('webview capture', () => {
  const spec: CaptureSpec = {
    loginUrl: 'https://x.test/login',
    cookieDomains: ['x.test'],
    anyOfCookies: ['sid', 'sid2'],
    allOfStorageKeys: ['t1', 't2'],
    loggedOutUrlHints: ['/login'],
  };
  it('is complete only with a cookie and every storage key', () => {
    expect(isCaptureComplete(spec, { cookies: {}, storage: { t1: 'a', t2: 'b' } })).toBe(false);
    expect(isCaptureComplete(spec, { cookies: { sid: 'v' }, storage: { t1: 'a' } })).toBe(false);
    expect(isCaptureComplete(spec, { cookies: { sid2: 'v' }, storage: { t1: 'a', t2: 'b' } })).toBe(
      true,
    );
    expect(isCaptureComplete(spec, { cookies: { sid: '' }, storage: { t1: 'a', t2: 'b' } })).toBe(
      false,
    );
    expect(
      isCaptureComplete(
        { ...spec, anyOfCookies: undefined, allOfStorageKeys: undefined },
        { cookies: {}, storage: {} },
      ),
    ).toBe(true);
  });
  it('keeps only the wanted cookies in the credential', () => {
    const c = toSessionCredential(spec, {
      cookies: { sid: 'v', tracking: 'zzz' },
      storage: { t1: 'a' },
    });
    expect(c).toEqual({ type: 'session', cookies: { sid: 'v' }, storage: { t1: 'a' } });
  });
  it('detects logged-out navigation', () => {
    expect(looksLoggedOut(spec, 'https://x.test/login?next=/')).toBe(true);
    expect(looksLoggedOut(spec, 'https://x.test/dashboard')).toBe(false);
  });
  it('decodes JWT expiry', () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1790000000 })).toString('base64url');
    expect(jwtExpiryMs(`h.${payload}.s`)).toBe(1790000000_000);
    expect(jwtExpiryMs('not-a-jwt')).toBeUndefined();
    expect(jwtExpiryMs('a.%%%.c')).toBeUndefined();
  });
});

describe('AccountService', () => {
  async function setup() {
    const db = memoryDriver();
    await migrate(db);
    const repos = createRepos(db);
    const creds = new CredentialStore(memoryKv());
    return { repos, creds, svc: new AccountService(repos, creds) };
  }
  const acct = (id: string) => ({
    id,
    providerId: 'openrouter',
    label: id,
    authMethod: 'apiKey' as const,
    createdAt: 1,
  });

  it('stores the credential with the account and deletes both on remove', async () => {
    const { repos, creds, svc } = await setup();
    await svc.add(acct('a'), { type: 'apiKey', key: 'k' });
    expect(await creds.load('a')).not.toBeNull();
    expect(await repos.accounts.get('a')).not.toBeNull();
    await svc.remove('a');
    expect(await creds.load('a')).toBeNull();
    expect(await repos.accounts.get('a')).toBeNull();
  });

  it('refuses a duplicate id without touching the existing credential', async () => {
    const { creds, svc } = await setup();
    await svc.add(acct('a'), { type: 'apiKey', key: 'orig' });
    await expect(svc.add(acct('a'), { type: 'apiKey', key: 'dup' })).rejects.toThrow(
      /already exists/,
    );
    expect(await creds.load('a')).toEqual({ type: 'apiKey', key: 'orig' });
  });

  it('removes the stored credential if creating the row fails', async () => {
    const { repos, creds } = await setup();
    const failing = new AccountService(
      {
        ...repos,
        accounts: Object.assign(Object.create(repos.accounts), {
          create: async () => {
            throw new Error('db down');
          },
        }),
      } as typeof repos,
      creds,
    );
    await expect(failing.add(acct('z'), { type: 'apiKey', key: 'k' })).rejects.toThrow('db down');
    expect(await creds.load('z')).toBeNull();
  });

  it('removeAll wipes every account', async () => {
    const { repos, creds, svc } = await setup();
    await svc.add(acct('a'), { type: 'apiKey', key: '1' });
    await svc.add(acct('b'), { type: 'apiKey', key: '2' });
    await svc.removeAll();
    expect(await repos.accounts.list()).toEqual([]);
    expect(await creds.load('b')).toBeNull();
  });

  it('removeAll keeps going past an account it cannot remove, then rejects', async () => {
    const { repos } = await setup();
    const kv = memoryKv();
    const creds = new CredentialStore({
      ...kv,
      delete: async (k) => {
        if (k.startsWith('usage.cred.a.')) throw new Error('keychain refused');
        await kv.delete(k);
      },
    });
    const svc = new AccountService(repos, creds);
    await svc.add(acct('a'), { type: 'apiKey', key: '1' });
    await svc.add(acct('b'), { type: 'apiKey', key: '2' });
    await expect(svc.removeAll()).rejects.toThrow();
    expect((await repos.accounts.list()).map((x) => x.id)).toEqual(['a']);
    expect(await creds.load('b')).toBeNull();
  });
});

describe('isAllowedNavigation', () => {
  const spec: CaptureSpec = {
    loginUrl: 'https://cursor.com/dashboard',
    cookieDomains: ['cursor.com'],
    signInDomains: ['authkit.app'],
  };

  it('keeps the sign-in page on the provider and its identity provider over https', () => {
    expect(isAllowedNavigation(spec, 'https://cursor.com/dashboard')).toBe(true);
    expect(isAllowedNavigation(spec, 'https://www.cursor.com/x')).toBe(true);
    expect(isAllowedNavigation(spec, 'https://cursor.authkit.app/login')).toBe(true);
    expect(isAllowedNavigation(spec, 'http://cursor.com/dashboard')).toBe(false);
    expect(isAllowedNavigation(spec, 'https://evilcursor.com/')).toBe(false);
    expect(isAllowedNavigation(spec, 'https://cursor.com.evil.io/')).toBe(false);
    expect(isAllowedNavigation(spec, 'javascript:alert(1)')).toBe(false);
  });
});
