import type { CredentialStore } from '@/authkit/secure';
import { AuthExpiredError } from '@/core/errors';
import type { Credential, FetchContext, ProviderPlugin } from '@/core/types';

export const REFRESH_LEEWAY_MS = 60_000;

export function needsRefresh(
  cred: Credential,
  nowMs: number,
  leewayMs = REFRESH_LEEWAY_MS,
): boolean {
  return (
    cred.type === 'oauth' &&
    cred.refreshToken !== undefined &&
    cred.expiresAt !== undefined &&
    cred.expiresAt - nowMs < leewayMs
  );
}

const tokenOf = (c: Credential): string | undefined =>
  c.type === 'oauth' ? c.accessToken : c.type === 'apiKey' ? c.key : undefined;

/**
 * Hands out valid credentials and refreshes OAuth tokens at most once at a time per account.
 * Refresh tokens may rotate (single use), so concurrent callers must share one refresh and the
 * new credential must be saved before anyone uses it.
 */
export class CredentialManager {
  private inflight = new Map<string, Promise<Credential>>();

  constructor(
    private store: CredentialStore,
    private leewayMs = REFRESH_LEEWAY_MS,
  ) {}

  /** Credential that is not about to expire, refreshing first when needed. */
  async getFresh(
    accountId: string,
    plugin: ProviderPlugin,
    ctx: FetchContext,
  ): Promise<Credential> {
    const cred = await this.store.load(accountId);
    if (!cred) throw new AuthExpiredError('no stored credential');
    if (needsRefresh(cred, ctx.now().getTime(), this.leewayMs)) {
      return this.refreshOnce(accountId, plugin, ctx, cred);
    }
    return cred;
  }

  /**
   * Run `fn` with a fresh credential. If it fails with AuthExpiredError, refresh (or reuse a
   * credential another caller just refreshed) and retry exactly once.
   */
  async withAuth<T>(
    accountId: string,
    plugin: ProviderPlugin,
    ctx: FetchContext,
    fn: (cred: Credential) => Promise<T>,
  ): Promise<T> {
    const cred = await this.getFresh(accountId, plugin, ctx);
    try {
      return await fn(cred);
    } catch (e) {
      if (!(e instanceof AuthExpiredError) || !plugin.refresh || cred.type !== 'oauth') throw e;
      const stored = await this.store.load(accountId);
      const next =
        stored && tokenOf(stored) !== tokenOf(cred)
          ? stored // someone else already refreshed
          : await this.refreshOnce(accountId, plugin, ctx, cred);
      return fn(next);
    }
  }

  private refreshOnce(
    accountId: string,
    plugin: ProviderPlugin,
    ctx: FetchContext,
    current: Credential,
  ): Promise<Credential> {
    const existing = this.inflight.get(accountId);
    if (existing) return existing;
    const p = (async () => {
      if (!plugin.refresh) throw new AuthExpiredError('credential expired and cannot be refreshed');
      let next: Credential;
      try {
        next = await plugin.refresh(current, ctx);
      } catch (e) {
        // Keep the old credential: a transient error must neither destroy the refresh token nor be
        // reported as an expired login.
        throw e; // AuthExpiredError = sign in again; anything else (network...) is transient
      }
      await this.store.save(accountId, next);
      return next;
    })().finally(() => this.inflight.delete(accountId));
    this.inflight.set(accountId, p);
    return p;
  }
}
