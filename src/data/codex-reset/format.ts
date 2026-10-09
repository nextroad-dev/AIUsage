import { createTranslator, type Locale, type Translator } from '@/i18n';
import type { DataError } from './service';

/** Intl defaults to the device's local timezone; never interpret a bare date as an event time. */
export function localEventTime(
  value: string | null | undefined,
  locale: Locale,
  now?: Date,
): string {
  const at = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(at)) return '—';
  const tag = locale === 'zh' ? 'zh-CN' : 'en-US';
  const date = new Date(at);
  if (now) {
    const t = createTranslator(locale);
    const day = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const time = new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' }).format(date);
    if (day(date) === day(now)) return t('Today {time}', { time });
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (day(date) === day(yesterday)) return t('Yesterday {time}', { time });
  }
  return new Intl.DateTimeFormat(tag, {
    year: !now || date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(at));
}

export function errorText(error: DataError | undefined, t: Translator): string {
  if (error === 'rate-limited') return t('Codex Reset is rate limited. Retry later.');
  if (error === 'timeout') return t('Codex Reset request timed out.');
  if (error === 'invalid') return t('Codex Reset returned unrecognized data.');
  return t('Codex Reset data unavailable. This does not indicate a Codex outage.');
}

export type ChanceBand = 'low' | 'possible' | 'high';

/** Words before numbers: rounded percentage (0..100) to a band. */
export function chanceBand(percent: number | null | undefined): ChanceBand | undefined {
  if (percent == null || !Number.isFinite(percent)) return undefined;
  if (percent >= 40) return 'high';
  if (percent >= 15) return 'possible';
  return 'low';
}

export function chanceBandText(band: ChanceBand | undefined, t: Translator): string {
  if (band === 'high') return t('High');
  if (band === 'possible') return t('Possible');
  if (band === 'low') return t('Low');
  return t('Unknown');
}
