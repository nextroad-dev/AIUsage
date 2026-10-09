import { usedFraction } from '@/core/meter-utils';
import type { UsageSnapshot } from '@/core/types';
import type { Price } from '@/data/prices';
import type { Account, Health } from '@/db/repos';
import type { ProviderMeta } from '@/providers/registry';

export interface AccountView {
  account: Account;
  meta?: ProviderMeta;
  snapshot: UsageSnapshot | null;
  health: Health | null;
  source: 'auto' | 'legacy';
  /** monthly price the user entered for this account */
  price?: Price;
  /** epoch ms each meter (alert meter key) runs out at the current pace, when before its reset */
  forecasts?: Record<string, number>;
}

export type DisplayKind =
  'ok' | 'manual' | 'stale' | 'authExpired' | 'unsupported' | 'error' | 'pending';

export interface DisplayStatus {
  kind: DisplayKind;
  message?: string;
  lastSuccessAt?: number;
}

/**
 * What the card should say. Failures never hide the last good data; they only add a badge.
 * (The data layer keeps the last successful snapshot and records failures separately.)
 */
export function deriveStatus(v: AccountView): DisplayStatus {
  if (v.source === 'legacy') return { kind: 'manual' };
  const h = v.health;
  const lastSuccessAt =
    h?.lastSuccessAt ?? (v.snapshot ? Date.parse(v.snapshot.fetchedAt) : undefined);
  if (h?.statusType === 'authExpired')
    return { kind: 'authExpired', message: h.errorMessage, lastSuccessAt };
  if (h?.statusType === 'unsupported')
    return { kind: 'unsupported', message: h.errorMessage, lastSuccessAt };
  if (h?.statusType === 'error') return { kind: 'error', message: h.errorMessage, lastSuccessAt };
  if (h?.statusType === 'stale') return { kind: 'stale', message: h.errorMessage, lastSuccessAt };
  if (!v.snapshot || v.snapshot.meters.length === 0) return { kind: 'pending' };
  return { kind: 'ok', lastSuccessAt };
}

/** Lower sorts first: login problems, then the most used meter, then the rest. */
export function attentionScore(v: AccountView): number {
  const s = deriveStatus(v);
  if (s.kind === 'authExpired') return -2;
  if (s.kind === 'error' || s.kind === 'unsupported') return -1;
  let best = -1;
  for (const m of v.snapshot?.meters ?? []) {
    const f = usedFraction(m);
    if (f !== undefined && f > best) best = f;
  }
  return -best; // more used => smaller => earlier
}

export function sortViews(views: AccountView[]): AccountView[] {
  return [...views].sort(
    (a, b) =>
      attentionScore(a) - attentionScore(b) ||
      a.account.sortOrder - b.account.sortOrder ||
      a.account.createdAt - b.account.createdAt,
  );
}

/**
 * Overview order: accounts that need the user (login expired, then errors) first, otherwise the
 * user's own order. Unlike `sortViews` it does not depend on usage, so cards stay put when a
 * refresh changes the numbers.
 */
export function orderViews(views: AccountView[]): AccountView[] {
  const rank = (v: AccountView) => {
    const s = deriveStatus(v).kind;
    return s === 'authExpired' ? 0 : s === 'error' || s === 'unsupported' ? 1 : 2;
  };
  return [...views].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.account.sortOrder - b.account.sortOrder ||
      a.account.createdAt - b.account.createdAt,
  );
}

/** When any automatic account last fetched successfully (epoch ms). */
export function lastUpdated(views: AccountView[]): number | undefined {
  let best: number | undefined;
  for (const v of views) {
    if (v.source !== 'auto') continue;
    const at = deriveStatus(v).lastSuccessAt;
    if (at !== undefined && Number.isFinite(at) && (best === undefined || at > best)) best = at;
  }
  return best;
}

/** Sum of known monthly plan prices per currency: entered prices first, legacy manual configs otherwise. */
export function subscriptionTotals(views: AccountView[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of views) {
    const cfg = v.account.manual;
    const amount = v.price?.amount ?? cfg?.priceMonthly;
    if (amount) {
      const c = v.price?.currency ?? cfg?.currency ?? 'USD';
      out[c] = (out[c] ?? 0) + amount;
    }
  }
  return out;
}

/** The soonest upcoming plan renewal across accounts. */
export function nextRenewal(
  views: AccountView[],
  now: Date,
): { view: AccountView; at: number } | undefined {
  let best: { view: AccountView; at: number } | undefined;
  for (const v of views) {
    const at = v.snapshot?.renewsAt ? Date.parse(v.snapshot.renewsAt) : NaN;
    if (!Number.isFinite(at) || at < now.getTime()) continue;
    if (!best || at < best.at) best = { view: v, at };
  }
  return best;
}
