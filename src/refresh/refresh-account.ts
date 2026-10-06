import type { CredentialManager } from '@/authkit/refresh';
import { canRefresh } from '@/core/backoff';
import { manualSnapshot } from '@/core/manual';
import { AuthExpiredError } from '@/core/errors';
import type { FetchContext, UsageSnapshot } from '@/core/types';
import type { Repos } from '@/db/repos';
import { classifyError, pluginFor } from '@/providers/service';
import { supportsCredential } from '@/providers/registry';

export interface RefreshDeps {
  repos: Repos;
  creds: CredentialManager;
  fetch: typeof fetch;
  now: () => Date;
}

export type RefreshOutcome =
  | { type: 'skipped'; reason: 'rate-limited' | 'missing-account' | 'legacy-account' }
  | { type: 'manual' }
  | { type: 'ok'; snapshot: UsageSnapshot }
  | { type: 'failed'; kind: string; message: string };

/**
 * Refresh one account. Automatic accounts hit the provider and store a snapshot on success; on
 * failure the previous snapshot is kept and the failure is recorded in account_health. Manual
 * and Cookie accounts are read-only, so this is a no-op for them. Never throws.
 */
export async function refreshAccount(
  deps: RefreshDeps,
  accountId: string,
  opts: { force?: boolean } = {},
): Promise<RefreshOutcome> {
  const { repos, now } = deps;
  const account = await repos.accounts.get(accountId);
  if (!account) return { type: 'skipped', reason: 'missing-account' };
  if (account.manual || account.authMethod === 'manual') return { type: 'manual' };
  if (account.authMethod === 'webviewSession') return { type: 'skipped', reason: 'legacy-account' };

  const nowMs = now().getTime();
  const health = await repos.health.get(accountId);
  const retryAfterMs =
    health?.retryAfterAt !== undefined
      ? Math.max(0, health.retryAfterAt - (health.lastAttemptAt ?? nowMs))
      : undefined;
  // authExpired never auto-retries: it needs the user, so only an explicit refresh may try again
  if (health?.statusType === 'authExpired' && !opts.force)
    return { type: 'skipped', reason: 'rate-limited' };
  if (
    !canRefresh({
      lastAttemptAt: health?.lastAttemptAt,
      failures: health?.failures ?? 0,
      now: nowMs,
      force: opts.force,
      retryAfterMs,
    })
  ) {
    return { type: 'skipped', reason: 'rate-limited' };
  }

  const plugin = pluginFor(account.providerId);
  if (!plugin) {
    const message = 'Automatic collection is not available for this provider.';
    await repos.health.recordFailure(accountId, nowMs, {
      statusType: 'unsupported',
      kind: 'no-plugin',
      message,
      countsAsFailure: false,
    });
    return { type: 'failed', kind: 'no-plugin', message };
  }

  const ctx: FetchContext = { fetch: deps.fetch, now, region: account.region };
  try {
    const snapshot = await deps.creds.withAuth(accountId, plugin, ctx, (cred) => {
      if (!supportsCredential(account.providerId, account.authMethod, cred))
        throw new AuthExpiredError('unsupported credential type');
      return plugin.fetchUsage(accountId, cred, ctx);
    });
    if (snapshot.status.type === 'unsupported') {
      await repos.health.recordFailure(accountId, nowMs, {
        statusType: 'unsupported',
        kind: 'unsupported',
        message: 'The response was not recognized. The service may have changed.',
        countsAsFailure: false,
      });
      return { type: 'failed', kind: 'unsupported', message: 'unsupported' };
    }
    await repos.snapshots.save(snapshot);
    await repos.health.recordSuccess(accountId, nowMs);
    return { type: 'ok', snapshot };
  } catch (e) {
    const c = classifyError(e);
    await repos.health.recordFailure(accountId, nowMs, {
      statusType: c.status.type,
      kind: c.kind,
      message: c.message,
      countsAsFailure: c.countsAsFailure,
      retryAfterMs: c.retryAfterMs,
    });
    return { type: 'failed', kind: c.kind, message: c.message };
  }
}

/** All accounts in parallel; one failing account never blocks the others. */
export async function refreshAll(
  deps: RefreshDeps,
  opts: { force?: boolean } = {},
): Promise<Record<string, RefreshOutcome>> {
  const accounts = await deps.repos.accounts.list();
  const entries = await Promise.all(
    accounts.map(async (a) => [a.id, await refreshAccount(deps, a.id, opts)] as const),
  );
  return Object.fromEntries(entries);
}

/** Legacy records are frozen at their last recorded time, never advanced to a new window. */
export async function loadSnapshot(
  repos: Repos,
  accountId: string,
  _now: Date,
): Promise<UsageSnapshot | null> {
  const account = await repos.accounts.get(accountId);
  if (!account) return null;
  const stored = await repos.snapshots.latest(accountId, account.providerId);
  if (stored || !account.manual) return stored;
  const state = await repos.manual.get(accountId);
  const recorded = Object.values(state)
    .map((v) => Date.parse(v.recordedAt))
    .filter(Number.isFinite);
  const anchors = account.manual.meters.map((m) => Date.parse(m.anchor)).filter(Number.isFinite);
  const lastRecorded = recorded.length
    ? Math.max(...recorded)
    : anchors.length
      ? Math.max(...anchors)
      : account.createdAt;
  return manualSnapshot(
    account.providerId,
    accountId,
    account.manual,
    state,
    new Date(lastRecorded),
  );
}
