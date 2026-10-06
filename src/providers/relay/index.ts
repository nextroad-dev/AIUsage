import { AuthExpiredError } from '@/core/errors';
import type { Meter, ProviderPlugin, UsageSnapshot } from '@/core/types';
import {
  RELAY_TYPE_NAMES,
  refreshBilling,
  type BillingInfo,
  type RelayType,
} from '@/providers/relay/inspect';

/** One meter for a relay key: used of total when the site has a limit, else the balance. */
export function relayMeters(billing: BillingInfo): Meter[] {
  if (!billing.supported) return [];
  const unit = billing.currency ?? 'USD';
  const base = { id: 'credits', scope: { type: 'overall' as const } };
  if (!billing.unlimited && billing.total !== undefined && billing.total > 0) {
    const used = billing.used ?? Math.max(0, billing.total - (billing.remaining ?? billing.total));
    return [
      { ...base, label: 'Key quota', kind: { type: 'amount', used, limit: billing.total, unit } },
    ];
  }
  if (billing.remaining !== undefined) {
    return [
      {
        ...base,
        label: 'Credits balance',
        kind: { type: 'balance', value: billing.remaining, unit },
      },
    ];
  }
  if (billing.used !== undefined) {
    return [{ ...base, label: 'Key usage', kind: { type: 'amount', used: billing.used, unit } }];
  }
  return [];
}

export function relaySnapshot(
  accountId: string,
  billing: BillingInfo,
  type: RelayType,
  now: Date,
): UsageSnapshot {
  const meters = relayMeters(billing);
  return {
    providerId: 'relay',
    accountId,
    plan: RELAY_TYPE_NAMES[type],
    fetchedAt: now.toISOString(),
    meters,
    status: meters.length > 0 ? { type: 'ok' } : { type: 'unsupported' },
  };
}

/** Refreshes a saved relay with its recognised adapter, re-detecting only when that fails. */
export function relayPlugin(): ProviderPlugin {
  return {
    id: 'relay',
    async fetchUsage(accountId, cred, ctx) {
      if (cred.type !== 'apiKey' || !cred.key.trim() || !cred.baseUrl) {
        throw new AuthExpiredError('relay credential without a base URL');
      }
      const r = await refreshBilling({
        baseUrl: cred.baseUrl,
        apiKey: cred.key,
        adapter: cred.adapter,
        fetch: ctx.fetch,
      });
      if (r.keyRejected) throw new AuthExpiredError('relay rejected the key');
      return relaySnapshot(accountId, r.billing, r.adapter, ctx.now());
    },
  };
}
