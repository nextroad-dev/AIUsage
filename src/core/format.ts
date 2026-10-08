import type { Meter } from '@/core/types';
import { intlLocale, t as globalT, type Translator } from '@/i18n';

const CURRENCIES = new Set(['USD', 'CNY', 'EUR', 'GBP', 'JPY']);

/**
 * A plan name as a provider reports it ("plus", "pro_plus") made presentable ("Plus", "Pro Plus").
 * Only first letters are raised, so names that already have their own casing ("ChatGPT") stay.
 */
export function formatPlan(plan: string): string {
  return plan
    .replace(/_+/g, ' ')
    .trim()
    .replace(/(^|\s)(\p{Ll})/gu, (_, gap: string, c: string) => gap + c.toUpperCase());
}

export function formatNumber(n: number, maxFractionDigits = 2): string {
  return new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: maxFractionDigits }).format(
    n,
  );
}

export function formatAmount(value: number, unit: string): string {
  if (unit === '%') return `${formatNumber(value, 0)}%`;
  if (CURRENCIES.has(unit)) {
    return new Intl.NumberFormat(intlLocale(), {
      style: 'currency',
      currency: unit,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return unit ? `${formatNumber(value)} ${unit}` : formatNumber(value);
}

/** Short calendar date, e.g. "Oct 21" / "10月21日". */
export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat(intlLocale(), { month: 'short', day: 'numeric' }).format(ms);
}

/** Whole days from now until `ms`, rounded up so "later today" reads as 1 day only past midnight. */
export function daysUntil(ms: number, nowMs: number): number {
  return Math.max(0, Math.ceil((ms - nowMs) / 86_400_000));
}

export interface MeterText {
  primary: string;
  secondary?: string;
}

/**
 * `t` is the caller's translator: pass the component's `useT()` value so the produced text
 * stays reactive to language changes (see the React Compiler note in src/i18n/index.ts).
 */
export function meterText(m: Meter, t: Translator = globalT): MeterText {
  const k = m.kind;
  switch (k.type) {
    case 'percent':
      return { primary: `${formatNumber(k.used, 0)}%`, secondary: t('used') };
    case 'amount':
      return k.limit === undefined
        ? { primary: formatAmount(k.used, k.unit), secondary: t('used') }
        : {
            primary: formatAmount(k.used, k.unit),
            secondary: t('of {limit}', { limit: formatAmount(k.limit, k.unit) }),
          };
    case 'balance':
      return { primary: formatAmount(k.value, k.unit), secondary: t('balance') };
  }
}

export function formatAgo(thenMs: number, nowMs: number, t: Translator = globalT): string {
  const s = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (s < 60) return t('just now');
  const m = Math.floor(s / 60);
  if (m < 60) return t('{n}m ago', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('{n}h ago', { n: h });
  return t('{n}d ago', { n: Math.floor(h / 24) });
}

/** "2d 3h" style countdown label with localized units. */
export function formatCountdown(label: string, t: Translator = globalT): string {
  return label
    .replace(/(\d+)d/g, (_m, n) => t('{n}d', { n }))
    .replace(/(\d+)h/g, (_m, n) => t('{n}h', { n }));
}
