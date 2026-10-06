import { ChunkedStore, CredentialStore, memoryKv, CHUNK_CHARS } from '@/authkit/secure';
import type { Credential } from '@/core/types';

describe('ChunkedStore', () => {
  it('round-trips values of any size and keeps every chunk under the keychain limit', async () => {
    const kv = memoryKv();
    const store = new ChunkedStore(kv);
    const big = 'é'.repeat(5000) + '漢'.repeat(2000); // multi-byte characters
    await store.set('k', big);
    expect(await store.get('k')).toBe(big);
    for (const v of Object.values(kv.dump())) {
      expect(new TextEncoder().encode(v).length).toBeLessThanOrEqual(2000);
    }
    expect(CHUNK_CHARS * 3).toBeLessThan(2048);
  });

  it('handles empty values and missing keys', async () => {
    const store = new ChunkedStore(memoryKv());
    await store.set('e', '');
    expect(await store.get('e')).toBe('');
    expect(await store.get('nope')).toBeNull();
  });

  it('removes stale chunks when a value shrinks and on delete', async () => {
    const kv = memoryKv();
    const store = new ChunkedStore(kv, 10);
    await store.set('k', 'x'.repeat(95)); // 10 chunks + meta
    await store.set('k', 'y'.repeat(15)); // 2 chunks + meta
    expect(Object.keys(kv.dump()).sort()).toEqual(['k.0', 'k.1', 'k.meta']);
    await store.delete('k');
    expect(kv.dump()).toEqual({});
  });

  it('treats a torn write (missing chunk) as missing', async () => {
    const kv = memoryKv();
    const store = new ChunkedStore(kv, 10);
    await store.set('k', 'z'.repeat(35));
    await kv.delete('k.2');
    expect(await store.get('k')).toBeNull();
  });
});

describe('CredentialStore', () => {
  const oauth: Credential = {
    type: 'oauth',
    accessToken: 'a'.repeat(3000),
    refreshToken: 'r'.repeat(500),
    expiresAt: 123,
    accountId: 'acct',
  };

  it('saves, loads and removes credentials per account', async () => {
    const store = new CredentialStore(memoryKv());
    await store.save('acc-1', oauth);
    await store.save('acc-2', { type: 'apiKey', key: 'sk-1' });
    expect(await store.load('acc-1')).toEqual(oauth);
    expect(await store.load('acc-2')).toEqual({ type: 'apiKey', key: 'sk-1' });
    await store.remove('acc-1');
    expect(await store.load('acc-1')).toBeNull();
    expect(await store.load('acc-2')).not.toBeNull();
  });

  it('only uses keychain-safe key names and rejects odd ids', async () => {
    const kv = memoryKv();
    const store = new CredentialStore(kv);
    await store.save('3f2b-ab_c.1', { type: 'apiKey', key: 'k' });
    for (const k of Object.keys(kv.dump())) expect(k).toMatch(/^[A-Za-z0-9._-]+$/);
    await expect(store.save('bad id/../x', { type: 'apiKey', key: 'k' })).rejects.toThrow();
  });

  it('returns null for corrupted data', async () => {
    const kv = memoryKv();
    await kv.set('usage.cred.a.0', '{not json');
    await kv.set('usage.cred.a.meta', JSON.stringify({ n: 1 }));
    expect(await new CredentialStore(kv).load('a')).toBeNull();
  });
});
