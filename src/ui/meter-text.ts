import { daysUntil, formatCountdown, formatDate } from '@/core/format';
import { countdown } from '@/core/meter-utils';
import type { Meter } from '@/core/types';
import type { AccountView } from '@/data/summary';
import { useTheme } from '@/hooks/use-theme';
import type { UsageLevel } from '@/core/meter-utils';
import type { Translator } from '@/i18n';

export function meterTitle(m: Meter, t: Translator): string {
  return m.scope.type === 'model'
    ? t('{label} ({detail})', { label: t(m.label), detail: m.scope.name })
    : t(m.label);
}

export function resetText(m: Meter, now: Date, t: Translator): string | undefined {
  const c = countdown(m.resetsAt, now);
  if (!c) return undefined;
  return c.elapsed ? t('Reset due') : t('Resets in {time}', { time: formatCountdown(c.label, t) });
}

/** Countdown without spaces ("2d5h") for the one-line row; the full sentence stays for screen readers. */
export function resetShort(m: Meter, now: Date, t: Translator): string | undefined {
  const c = countdown(m.resetsAt, now);
  if (!c) return undefined;
  return c.elapsed ? t('Due') : formatCountdown(c.label, t).replace(/\s+/g, '');
}

const keyOf = (m: Meter) => `${m.id}${m.scope.type === 'model' ? `:${m.scope.name}` : ''}`;

/** "Runs out in 1h 20m at this pace" when the current pace empties the window before it resets. */
export function forecastText(
  view: AccountView,
  m: Meter,
  now: Date,
  t: Translator,
): string | undefined {
  const at = view.forecasts?.[keyOf(m)];
  if (at === undefined) return undefined;
  const c = countdown(new Date(at).toISOString(), now);
  if (!c || c.elapsed) return undefined;
  return t('Runs out in {time} at this pace', { time: formatCountdown(c.label, t) });
}

/** Plan end / renewal line, flagged when it is a week away or less. */
export function renewalInfo(
  view: AccountView,
  now: Date,
  t: Translator,
): { text: string; soon: boolean } | undefined {
  const at = view.snapshot?.renewsAt ? Date.parse(view.snapshot.renewsAt) : NaN;
  if (!Number.isFinite(at) || at < now.getTime()) return undefined;
  const days = daysUntil(at, now.getTime());
  const left = days <= 1 ? t('within a day') : t('{n} days left', { n: days });
  return { text: t('Plan until {date} ({left})', { date: formatDate(at), left }), soon: days <= 7 };
}

/** Level colour for a usage share; always paired with the printed figures. */
export function useLevelColor(l: UsageLevel): string {
  const theme = useTheme();
  return l === 'good'
    ? theme.good
    : l === 'warn'
      ? theme.warn
      : l === 'bad'
        ? theme.bad
        : theme.muted;
}
