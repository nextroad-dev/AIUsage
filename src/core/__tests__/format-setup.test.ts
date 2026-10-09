import { formatAgo, formatAmount, formatCountdown, formatPlan, meterText } from '@/core/format';
import {
  anchorFor,
  applyEdits,
  buildManualConfig,
  customTemplate,
  parseNumber,
} from '@/core/manual-setup';
import { nextReset } from '@/core/manual';
import type { Meter } from '@/core/types';
import { setLocale } from '@/i18n';

afterEach(() => setLocale('en'));

const meter = (kind: Meter['kind']): Meter => ({
  id: 'm',
  label: 'M',
  kind,
  scope: { type: 'overall' },
});

describe('formatting', () => {
  it('formats currencies, percents and plain units', () => {
    expect(formatAmount(12.5, 'USD')).toBe('$12.50');
    expect(formatAmount(40, '%')).toBe('40%');
    expect(formatAmount(1234.5, 'credits')).toBe('1,234.5 credits');
    expect(formatAmount(3, '')).toBe('3');
  });
  it('describes each meter kind', () => {
    expect(meterText(meter({ type: 'percent', used: 42.4 }))).toEqual({
      primary: '42%',
      secondary: 'used',
    });
    expect(meterText(meter({ type: 'amount', used: 5, limit: 20, unit: 'USD' }))).toEqual({
      primary: '$5.00',
      secondary: 'of $20.00',
    });
    expect(meterText(meter({ type: 'amount', used: 5, unit: 'credits' })).secondary).toBe('used');
    expect(meterText(meter({ type: 'balance', value: 7.5, unit: 'USD' }))).toEqual({
      primary: '$7.50',
      secondary: 'balance',
    });
  });
  it('formats relative time', () => {
    const now = 10_000_000_000;
    expect(formatAgo(now - 5_000, now)).toBe('just now');
    expect(formatAgo(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatAgo(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatAgo(now - 49 * 3_600_000, now)).toBe('2d ago');
    expect(formatAgo(now + 5000, now)).toBe('just now'); // clock skew
  });
  it('localizes to Chinese and falls back to English for unknown text', () => {
    setLocale('zh');
    expect(meterText(meter({ type: 'percent', used: 1 })).secondary).toBe('已用');
    expect(formatAgo(0, 5 * 60_000)).toBe('5 分钟前');
    expect(formatCountdown('2d 3h')).toBe('2天 3小时');
    expect(formatCountdown('3h 12m')).toBe('3小时 12分');
    expect(formatCountdown('45m')).toBe('45分');
    expect(formatCountdown('<1m')).toBe('<1分');
    setLocale('en');
    expect(formatCountdown('2d 3h')).toBe('2d 3h');
    expect(formatCountdown('3h 12m')).toBe('3h 12m');
  });
});

describe('formatPlan', () => {
  it('capitalises reported plan names without touching their own casing', () => {
    expect(formatPlan('plus')).toBe('Plus');
    expect(formatPlan('pro_plus')).toBe('Pro Plus');
    expect(formatPlan('individual')).toBe('Individual');
    expect(formatPlan('ChatGPT Pro')).toBe('ChatGPT Pro');
    expect(formatPlan('New API')).toBe('New API');
    expect(formatPlan('专业版')).toBe('专业版');
  });
});

describe('anchorFor', () => {
  const now = new Date(2026, 9, 6, 15, 30); // Tue 6 Oct 2026, local
  it('rolling: now minus minutes since the window started', () => {
    expect(anchorFor({ type: 'rolling', hours: 5 }, { startedMinutesAgo: 90 }, now)).toBe(
      new Date(now.getTime() - 90 * 60_000).toISOString(),
    );
    expect(anchorFor({ type: 'rolling', hours: 5 }, {}, now)).toBe(now.toISOString());
  });
  it('daily: local midnight', () => {
    expect(anchorFor({ type: 'daily' }, {}, now)).toBe(new Date(2026, 9, 6).toISOString());
  });
  it('weekly: most recent chosen weekday at local midnight', () => {
    expect(anchorFor({ type: 'weekly' }, { weekday: 1 }, now)).toBe(
      new Date(2026, 9, 5).toISOString(),
    ); // Monday
    expect(anchorFor({ type: 'weekly' }, { weekday: 2 }, now)).toBe(
      new Date(2026, 9, 6).toISOString(),
    ); // today
    expect(anchorFor({ type: 'weekly' }, { weekday: 3 }, now)).toBe(
      new Date(2026, 8, 30).toISOString(),
    ); // last Wed
  });
  it('monthly: most recent occurrence of the day, clamped to month length', () => {
    expect(anchorFor({ type: 'monthly' }, { dayOfMonth: 15 }, now)).toBe(
      new Date(2026, 8, 15).toISOString(),
    ); // not yet this month
    expect(anchorFor({ type: 'monthly' }, { dayOfMonth: 3 }, now)).toBe(
      new Date(2026, 9, 3).toISOString(),
    );
    expect(anchorFor({ type: 'monthly' }, { dayOfMonth: 31 }, new Date(2026, 2, 1))).toBe(
      new Date(2026, 1, 28).toISOString(),
    ); // Feb clamp
    expect(anchorFor({ type: 'monthly' }, { dayOfMonth: 20 }, new Date(2026, 0, 5))).toBe(
      new Date(2025, 11, 20).toISOString(),
    ); // year wrap
  });
  it('produces anchors whose next reset is in the future and within one period', () => {
    for (const w of [{ type: 'weekly' }, { type: 'monthly' }, { type: 'daily' }] as const) {
      const next = nextReset(w, anchorFor(w, { weekday: 4, dayOfMonth: 17 }, now), now);
      expect(next.getTime()).toBeGreaterThan(now.getTime());
      expect(next.getTime() - now.getTime()).toBeLessThanOrEqual(32 * 86_400_000);
    }
  });
});

describe('buildManualConfig', () => {
  const now = new Date(2026, 9, 6, 12);
  const template = {
    planName: 'Max 5x',
    priceMonthly: 100,
    currency: 'USD',
    meters: [
      {
        id: 'session',
        label: '5h',
        window: { type: 'rolling', hours: 5 } as const,
        limit: 100,
        unit: '%',
        percent: true,
      },
      {
        id: 'monthly',
        label: 'Monthly',
        window: { type: 'monthly' } as const,
        limit: 625,
        unit: 'credits',
      },
    ],
  };
  it('applies overrides, anchors every meter and keeps percent limits at 100', () => {
    const c = buildManualConfig(
      template,
      {
        planName: ' My plan ',
        priceMonthly: 90,
        limits: { monthly: 1000, session: 5 },
        resets: { monthly: { dayOfMonth: 1 } },
      },
      now,
    );
    expect(c).toMatchObject({ planName: 'My plan', priceMonthly: 90, currency: 'USD' });
    expect(c.meters[0].limit).toBe(100);
    expect(c.meters[1].limit).toBe(1000);
    expect(c.meters[1].anchor).toBe(new Date(2026, 9, 1).toISOString());
  });
  it('falls back to template values', () => {
    const c = buildManualConfig(template, {}, now);
    expect(c).toMatchObject({ planName: 'Max 5x', priceMonthly: 100 });
    expect(c.meters[1].limit).toBe(625);
  });
  it('custom template is usable', () => {
    expect(buildManualConfig(customTemplate(), { planName: 'X' }, now).meters).toHaveLength(1);
  });
});

describe('parseNumber / applyEdits', () => {
  it('parses lenient numeric input', () => {
    expect(parseNumber(' 1,234.5 ')).toBe(1234.5);
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber('1,000')).toBe(1000);
    expect(parseNumber('')).toBeUndefined();
    expect(parseNumber('abc')).toBeUndefined();
  });
  it('edits plan details but keeps reset anchors', () => {
    const cfg = buildManualConfig(
      {
        planName: 'P',
        meters: [
          { id: 'monthly', label: 'M', window: { type: 'monthly' }, unit: 'credits', limit: 10 },
        ],
      },
      { resets: { monthly: { dayOfMonth: 9 } } },
      new Date(2026, 9, 12),
    );
    const edited = applyEdits(cfg, { planName: ' New ', priceMonthly: 5, limits: { monthly: 20 } });
    expect(edited).toMatchObject({ planName: 'New', priceMonthly: 5 });
    expect(edited.meters[0].limit).toBe(20);
    expect(edited.meters[0].anchor).toBe(cfg.meters[0].anchor);
  });
});
