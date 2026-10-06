import type { Meter } from './types';

export type UsageLevel = 'good' | 'warn' | 'bad' | 'unknown';

export const WARN_AT = 0.6;
export const BAD_AT = 0.85;

/** Used fraction 0..1+ (undefined for balances or amounts without a limit). */
export function usedFraction(m: Meter): number | undefined {
  switch (m.kind.type) {
    case 'percent':
      return m.kind.used / 100;
    case 'amount':
      return m.kind.limit && m.kind.limit > 0 ? m.kind.used / m.kind.limit : undefined;
    case 'balance':
      return undefined;
  }
}

export function level(fraction: number | undefined): UsageLevel {
  if (fraction === undefined || Number.isNaN(fraction)) return 'unknown';
  if (fraction >= BAD_AT) return 'bad';
  if (fraction >= WARN_AT) return 'warn';
  return 'good';
}

export function remaining(m: Meter): number | undefined {
  switch (m.kind.type) {
    case 'percent':
      return Math.max(0, 100 - m.kind.used);
    case 'amount':
      return m.kind.limit === undefined ? undefined : Math.max(0, m.kind.limit - m.kind.used);
    case 'balance':
      return m.kind.value;
  }
}

export interface Countdown {
  ms: number;
  /** "2d 3h" | "3h 12m" | "12m" | "<1m" */
  label: string;
  elapsed: boolean;
}

export function countdown(resetsAt: string | undefined, now: Date): Countdown | undefined {
  if (!resetsAt) return undefined;
  const t = Date.parse(resetsAt);
  if (Number.isNaN(t)) return undefined;
  const ms = t - now.getTime();
  if (ms <= 0) return { ms: 0, label: '0m', elapsed: true };
  const mins = Math.floor(ms / 60_000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  let label: string;
  if (days > 0) label = `${days}d ${hours}h`;
  else if (hours > 0) label = `${hours}h ${m}m`;
  else if (mins > 0) label = `${m}m`;
  else label = '<1m';
  return { ms, label, elapsed: false };
}

/** The meter to highlight on a card: highest used fraction; meters without a ratio rank last. */
export function mostConstrained(meters: Meter[]): Meter | undefined {
  let best: Meter | undefined;
  let bestF = -1;
  for (const m of meters) {
    const f = usedFraction(m) ?? -0.5;
    if (f > bestF) {
      best = m;
      bestF = f;
    }
  }
  return best;
}

/** Alert de-duplication key: same meter, same reset cycle -> same key. */
export function cycleKey(accountId: string, m: Meter): string {
  const scope = m.scope.type === 'model' ? `:${m.scope.name}` : '';
  return `${accountId}:${m.id}${scope}:${m.resetsAt ?? 'none'}`;
}
