import type { ManualAccountConfig, ManualMeterConfig, ResetWindow } from '@/core/manual';

/** What the user tells us about when a window resets (all in local time). */
export interface ResetInput {
  /** monthly: 1..31 */
  dayOfMonth?: number;
  /** weekly: 0 = Sunday .. 6 = Saturday */
  weekday?: number;
  /** rolling: how long ago the current window started (default 0 = just now) */
  startedMinutesAgo?: number;
}

function localMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/**
 * Most recent reset instant (<= now) consistent with the user's answer. The result is stored as an
 * ISO anchor; later reset times are computed from it. Note: month/week math runs in UTC, so
 * across a daylight-saving change a reset can drift by an hour.
 */
export function anchorFor(window: ResetWindow, input: ResetInput, now: Date): string {
  switch (window.type) {
    case 'rolling':
      return new Date(now.getTime() - (input.startedMinutesAgo ?? 0) * 60_000).toISOString();
    case 'daily':
      return localMidnight(now).toISOString();
    case 'weekly': {
      const target = input.weekday ?? now.getDay();
      const back = (now.getDay() - target + 7) % 7;
      const d = localMidnight(now);
      d.setDate(d.getDate() - back);
      return d.toISOString();
    }
    case 'monthly': {
      const want = Math.min(31, Math.max(1, Math.floor(input.dayOfMonth ?? now.getDate())));
      const clampDay = (y: number, m: number) => Math.min(want, new Date(y, m + 1, 0).getDate());
      let d = new Date(
        now.getFullYear(),
        now.getMonth(),
        clampDay(now.getFullYear(), now.getMonth()),
      );
      if (d.getTime() > now.getTime()) {
        const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
        const m = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
        d = new Date(y, m, clampDay(y, m));
      }
      return d.toISOString();
    }
  }
}

export interface ManualTemplateLike {
  planName: string;
  priceMonthly?: number;
  currency?: string;
  meters: Omit<ManualMeterConfig, 'anchor'>[];
}

export interface ManualSetup {
  planName?: string;
  priceMonthly?: number;
  /** overrides per meter id (amount meters only; percent meters are always 0..100) */
  limits?: Record<string, number>;
  resets?: Record<string, ResetInput>;
}

export function buildManualConfig(
  template: ManualTemplateLike,
  setup: ManualSetup,
  now: Date,
): ManualAccountConfig {
  return {
    planName: setup.planName?.trim() || template.planName,
    priceMonthly: setup.priceMonthly ?? template.priceMonthly,
    currency: template.currency,
    meters: template.meters.map((m) => ({
      ...m,
      limit: m.percent ? 100 : (setup.limits?.[m.id] ?? m.limit),
      anchor: anchorFor(m.window, setup.resets?.[m.id] ?? {}, now),
    })),
  };
}

/** A blank plan for providers/plans without a template. */
export function customTemplate(): ManualTemplateLike {
  return {
    planName: 'Custom',
    meters: [{ id: 'monthly', label: 'Monthly', window: { type: 'monthly' }, unit: 'credits' }],
  };
}

/** Lenient number input: accepts "1,234.5", "12,5" (decimal comma) and surrounding spaces. */
export function parseNumber(input: string): number | undefined {
  const s = input.trim().replace(/\s/g, '');
  if (s === '') return undefined;
  let normalized = s;
  if (/^\d+,\d{1,2}$/.test(s)) normalized = s.replace(',', '.');
  else normalized = s.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

/** Edit an existing manual account: name, price and limits change; reset anchors are kept. */
export function applyEdits(config: ManualAccountConfig, setup: ManualSetup): ManualAccountConfig {
  return {
    ...config,
    planName: setup.planName?.trim() || config.planName,
    priceMonthly: setup.priceMonthly,
    meters: config.meters.map((m) => ({
      ...m,
      limit: m.percent ? 100 : (setup.limits?.[m.id] ?? m.limit),
    })),
  };
}
