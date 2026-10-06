import type { Meter, UsageSnapshot } from './types';

/**
 * Manual mode: the user declares plan + limits + reset anchor and records usage.
 * Reset times are computed from the anchor; usage recorded before the most recent
 * reset boundary no longer counts.
 */
export type ResetWindow =
  | { type: 'rolling'; hours: number } // e.g. 5-hour session, anchored at `anchor`
  | { type: 'daily' } // every 24h at the anchor's time of day
  | { type: 'weekly' } // every 7 days from the anchor
  | { type: 'monthly' }; // same day-of-month as the anchor (clamped to month length)

export interface ManualMeterConfig {
  id: string;
  label: string;
  window: ResetWindow;
  /** ISO time of a known reset (or the window start) */
  anchor: string;
  limit?: number;
  unit: string;
  /** true when `limit` is a percentage scale (used is 0..100) */
  percent?: boolean;
  model?: string;
}

export interface ManualAccountConfig {
  planName?: string;
  priceMonthly?: number;
  currency?: string;
  meters: ManualMeterConfig[];
}

export interface ManualUsageEntry {
  used: number;
  /** ISO time the value was recorded */
  recordedAt: string;
}

export type ManualState = Record<string, ManualUsageEntry>;

const DAY = 86_400_000;

function addMonthsClamped(base: Date, months: number): Date {
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth() + months;
  const target = new Date(
    Date.UTC(y, m, 1, base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds()),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(base.getUTCDate(), lastDay));
  return target;
}

/** Reset boundaries (UTC) surrounding `now`: { prev <= now < next }. */
export function resetBounds(
  window: ResetWindow,
  anchorIso: string,
  now: Date,
): { prev: Date; next: Date } {
  const anchor = new Date(anchorIso);
  const t = now.getTime();
  if (window.type === 'monthly') {
    const monthsDiff =
      (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
      (now.getUTCMonth() - anchor.getUTCMonth());
    let k = monthsDiff;
    while (addMonthsClamped(anchor, k).getTime() > t) k -= 1;
    while (addMonthsClamped(anchor, k + 1).getTime() <= t) k += 1;
    return { prev: addMonthsClamped(anchor, k), next: addMonthsClamped(anchor, k + 1) };
  }
  const period =
    window.type === 'rolling' ? window.hours * 3_600_000 : window.type === 'daily' ? DAY : 7 * DAY;
  const k = Math.floor((t - anchor.getTime()) / period);
  const prev = anchor.getTime() + k * period;
  return { prev: new Date(prev), next: new Date(prev + period) };
}

export function nextReset(window: ResetWindow, anchorIso: string, now: Date): Date {
  return resetBounds(window, anchorIso, now).next;
}

export function manualMeters(config: ManualAccountConfig, state: ManualState, now: Date): Meter[] {
  return config.meters.map((c) => {
    const { prev, next } = resetBounds(c.window, c.anchor, now);
    const entry = state[c.id];
    const used = entry && Date.parse(entry.recordedAt) >= prev.getTime() ? entry.used : 0;
    const kind: Meter['kind'] = c.percent
      ? { type: 'percent', used }
      : { type: 'amount', used, limit: c.limit, unit: c.unit };
    return {
      id: c.id,
      label: c.label,
      kind,
      scope: c.model ? { type: 'model', name: c.model } : { type: 'overall' },
      resetsAt: next.toISOString(),
    };
  });
}

export function manualSnapshot(
  providerId: string,
  accountId: string,
  config: ManualAccountConfig,
  state: ManualState,
  now: Date,
): UsageSnapshot {
  return {
    providerId,
    accountId,
    plan: config.planName,
    fetchedAt: now.toISOString(),
    meters: manualMeters(config, state, now),
    status: { type: 'manual' },
  };
}

/** Add to the current-window usage (or set it), returning the new state. */
export function recordUsage(
  state: ManualState,
  config: ManualMeterConfig,
  now: Date,
  change: { add: number } | { set: number },
): ManualState {
  const { prev } = resetBounds(config.window, config.anchor, now);
  const existing = state[config.id];
  const current = existing && Date.parse(existing.recordedAt) >= prev.getTime() ? existing.used : 0;
  const used = 'set' in change ? change.set : current + change.add;
  return { ...state, [config.id]: { used: Math.max(0, used), recordedAt: now.toISOString() } };
}
