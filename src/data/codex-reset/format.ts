import { createTranslator, type Locale, type Translator } from '@/i18n';
import { isConfirmedReset, type ResetEvent } from './models';
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

export function confidenceText(value: string | null | undefined, t: Translator): string {
  if (value === 'low') return t('Low confidence');
  if (value === 'medium') return t('Medium confidence');
  if (value === 'high') return t('High confidence');
  return t('Confidence unknown');
}

export function eventText(event: ResetEvent, t: Translator): string {
  if (isConfirmedReset(event)) return t('Confirmed reset');
  if (event.group === 'reset') return t('Unconfirmed reset signal');
  if (event.group === 'boost') return t('Usage boost announcement');
  if (event.group === 'unlock') return t('Unlock announcement');
  if (event.group === 'credits') return t('Credits / banked reset announcement');
  return t('Other announcement');
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

/** Confidence as filled dots out of three; undefined when the source gives no known level. */
export function confidenceLevel(value: string | null | undefined): 1 | 2 | 3 | undefined {
  if (value === 'low') return 1;
  if (value === 'medium') return 2;
  if (value === 'high') return 3;
  return undefined;
}

/** Mean days between consecutive confirmed resets; needs at least two. */
export function averageIntervalDays(confirmed: ResetEvent[]): number | undefined {
  const times = confirmed
    .map((e) => Date.parse(e.announced_at))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (times.length < 2) return undefined;
  const span = times[times.length - 1] - times[0];
  return Math.max(1, Math.round(span / (times.length - 1) / 86_400_000));
}

export type DayMark = 'confirmed' | 'signal' | undefined;

/**
 * One mark per local calendar day, oldest first, ending today. A confirmed reset outranks an
 * unconfirmed reset signal on the same day; other announcement groups are not marked.
 */
export function resetDays(events: ResetEvent[], now: Date, days = 30): DayMark[] {
  const marks: DayMark[] = Array.from({ length: days }, () => undefined);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const e of events) {
    if (e.group !== 'reset') continue;
    const at = new Date(Date.parse(e.announced_at));
    if (!Number.isFinite(at.getTime())) continue;
    const day = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
    // calendar days, rounded so a daylight-saving shift does not drop a day
    const back = Math.round((today - day) / 86_400_000);
    if (back < 0 || back >= days) continue;
    const i = days - 1 - back;
    if (isConfirmedReset(e)) marks[i] = 'confirmed';
    else if (marks[i] !== 'confirmed') marks[i] = 'signal';
  }
  return marks;
}
