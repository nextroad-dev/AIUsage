import type { Credential } from '@/core/types';

/** Raw key/value backend (iOS Keychain in the app, a Map in tests). */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export function memoryKv(): KeyValueStore & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

/**
 * Keychain items historically fail above ~2048 bytes, and OAuth tokens or cookie bundles can
 * exceed that. Values are split into chunks of at most CHUNK_CHARS characters (<= 3 bytes each in
 * UTF-8 => under 1.8 KB) under `<key>.<n>`, plus a `<key>.meta` entry written last.
 */
export const CHUNK_CHARS = 600;

export class ChunkedStore implements KeyValueStore {
  constructor(
    private kv: KeyValueStore,
    private chunkChars = CHUNK_CHARS,
  ) {}

  async set(key: string, value: string): Promise<void> {
    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += this.chunkChars)
      chunks.push(value.slice(i, i + this.chunkChars));
    if (chunks.length === 0) chunks.push('');
    const previous = await this.readMeta(key);
    for (let i = 0; i < chunks.length; i++) await this.kv.set(`${key}.${i}`, chunks[i]);
    await this.kv.set(`${key}.meta`, JSON.stringify({ n: chunks.length }));
    for (let i = chunks.length; i < (previous ?? 0); i++) await this.kv.delete(`${key}.${i}`);
  }

  async get(key: string): Promise<string | null> {
    const n = await this.readMeta(key);
    if (n === null) return null;
    let out = '';
    for (let i = 0; i < n; i++) {
      const part = await this.kv.get(`${key}.${i}`);
      if (part === null) return null; // torn write: treat as missing rather than return garbage
      out += part;
    }
    return out;
  }

  async delete(key: string): Promise<void> {
    const n = (await this.readMeta(key)) ?? 0;
    await this.kv.delete(`${key}.meta`);
    for (let i = 0; i < n; i++) await this.kv.delete(`${key}.${i}`);
  }

  private async readMeta(key: string): Promise<number | null> {
    const raw = await this.kv.get(`${key}.meta`);
    if (raw === null) return null;
    try {
      const n = (JSON.parse(raw) as { n?: unknown }).n;
      return typeof n === 'number' && n >= 0 ? n : null;
    } catch {
      return null;
    }
  }
}

const idOk = /^[A-Za-z0-9._-]+$/;

/** Credentials per account. Never logs values. */
export class CredentialStore {
  private chunked: ChunkedStore;
  constructor(kv: KeyValueStore) {
    this.chunked = new ChunkedStore(kv);
  }

  private key(accountId: string): string {
    if (!idOk.test(accountId)) throw new Error('invalid account id');
    return `usage.cred.${accountId}`;
  }

  async save(accountId: string, cred: Credential): Promise<void> {
    await this.chunked.set(this.key(accountId), JSON.stringify(cred));
  }

  async load(accountId: string): Promise<Credential | null> {
    const raw = await this.chunked.get(this.key(accountId));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as Credential;
    } catch {
      return null;
    }
  }

  async remove(accountId: string): Promise<void> {
    await this.chunked.delete(this.key(accountId));
  }
}
