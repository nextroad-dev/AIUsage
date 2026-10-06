import { AuthExpiredError, HttpError, RateLimitedError, TimeoutError } from '@/core/errors';
import { specToPlugin } from '@/core/spec-engine';
import type {
  Credential,
  FetchContext,
  ProviderPlugin,
  SnapshotStatus,
  UsageSnapshot,
} from '@/core/types';
import { isConnectableProvider, providerById, supportsCredential } from '@/providers/registry';

/** Only implemented OAuth/API-key providers may collect data. */
export function pluginFor(providerId: string): ProviderPlugin | undefined {
  const meta = providerById(providerId);
  if (!isConnectableProvider(meta)) return undefined;
  if (meta.plugin) return meta.plugin;
  return meta?.spec ? specToPlugin(meta.spec) : undefined;
}

export type FailureKind =
  'invalid-credential' | 'rate-limited' | 'network' | 'server' | 'unsupported' | 'no-plugin';

export interface Classified {
  kind: FailureKind;
  /** status to show on the account card */
  status: SnapshotStatus;
  /** short, user-facing explanation (no secrets, no raw bodies) */
  message: string;
  retryAfterMs?: number;
  /** whether this should advance the account's backoff counter */
  countsAsFailure: boolean;
}

export function classifyError(e: unknown): Classified {
  if (e instanceof AuthExpiredError) {
    return {
      kind: 'invalid-credential',
      status: { type: 'authExpired' },
      message: 'The credential was rejected. Re-enter or re-authorize this account.',
      countsAsFailure: false, // retrying cannot help until the user acts
    };
  }
  if (e instanceof RateLimitedError) {
    return {
      kind: 'rate-limited',
      status: { type: 'stale' },
      message: 'The service is rate limiting requests. Will retry later.',
      retryAfterMs: e.retryAfterMs,
      countsAsFailure: true,
    };
  }
  if (e instanceof TimeoutError) {
    return {
      kind: 'network',
      status: { type: 'stale' },
      message: 'The request timed out.',
      countsAsFailure: true,
    };
  }
  if (e instanceof HttpError) {
    return {
      kind: 'server',
      status: { type: 'error', message: `The service returned HTTP ${e.status}.` },
      message: `The service returned HTTP ${e.status}.`,
      countsAsFailure: true,
    };
  }
  // fetch() rejects with TypeError when offline / DNS / TLS fails
  return {
    kind: 'network',
    status: { type: 'stale' },
    message: 'Could not reach the service.',
    countsAsFailure: true,
  };
}

export type ValidationResult =
  { ok: true; snapshot: UsageSnapshot } | { ok: false; kind: FailureKind; message: string };

/**
 * Add-account check: one real request with the entered credential. Distinguishes a bad key
 * from a good key whose response we cannot interpret (service changed, wrong plan type).
 */
export async function validateCredential(
  providerId: string,
  cred: Credential,
  ctx: FetchContext,
): Promise<ValidationResult> {
  const plugin = pluginFor(providerId);
  if (!plugin)
    return {
      ok: false,
      kind: 'no-plugin',
      message: 'Automatic collection is not available for this provider.',
    };
  const method = cred.type === 'oauth' ? 'deviceCode' : 'apiKey';
  if (!supportsCredential(providerId, method, cred))
    return {
      ok: false,
      kind: 'invalid-credential',
      message: 'Only OAuth or API-key credentials are supported.',
    };
  try {
    const snapshot = await plugin.fetchUsage('validation', cred, ctx);
    if (snapshot.status.type === 'unsupported') {
      return {
        ok: false,
        kind: 'unsupported',
        message:
          'The key was accepted but the response was not recognized. The service may have changed, or this key type has no usage data.',
      };
    }
    return { ok: true, snapshot };
  } catch (e) {
    const c = classifyError(e);
    return { ok: false, kind: c.kind, message: c.message };
  }
}
