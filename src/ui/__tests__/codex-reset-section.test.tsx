import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';

import type { Meter } from '@/core/types';
import { forecastSchema, timelineSchema, statusSchema } from '@/data/codex-reset/models';
import { useCodexReset, useCodexResetForecast } from '@/data/codex-reset/hooks';
import { useCodexResetPreference } from '@/data/codex-reset/preferences';
import {
  averageIntervalDays,
  chanceBand,
  confidenceText,
  eventText,
  localEventTime,
  resetDays,
} from '@/data/codex-reset/format';
import { createTranslator, setLocale } from '@/i18n';
import { CodexResetChip } from '@/ui/codex-reset-chip';
import { CodexResetSection } from '@/ui/codex-reset-section';
import forecast from '@/data/codex-reset/__tests__/fixtures/forecast.json';
import timeline from '@/data/codex-reset/__tests__/fixtures/timeline.json';
import status from '@/data/codex-reset/__tests__/fixtures/status.json';

jest.mock('@/data/codex-reset/hooks', () => ({
  useCodexReset: jest.fn(),
  useCodexResetForecast: jest.fn(),
}));
jest.mock('@/data/codex-reset/preferences', () => ({ useCodexResetPreference: jest.fn() }));
const usePreference = useCodexResetPreference as jest.Mock;
const useReset = useCodexReset as jest.Mock;
const useForecast = useCodexResetForecast as jest.Mock;
const NOW = new Date(forecast.updated_at);
const entry = (data: unknown) => ({
  data: { data, fetchedAt: NOW.getTime(), retryAt: 0, failures: 0 },
  isLoading: false,
});
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

beforeEach(() => {
  setLocale('en');
  useReset.mockClear();
  usePreference.mockReturnValue({
    enabled: true,
    loaded: true,
    pending: false,
    setEnabled: jest.fn().mockResolvedValue(undefined),
  });
  useReset.mockReturnValue({
    forecast: entry(forecastSchema.parse(forecast)),
    timeline: entry(timelineSchema.parse(timeline)),
    status: entry(statusSchema.parse(status)),
  });
});
afterEach(() => {
  setLocale('en');
  jest.restoreAllMocks();
});

const weekly = (hoursLeft: number): Meter => ({
  id: 'weekly',
  label: 'Weekly',
  kind: { type: 'percent', used: 81 },
  scope: { type: 'overall' },
  resetsAt: new Date(NOW.getTime() + hoursLeft * 3_600_000).toISOString(),
});

it('answers first with the 24-hour chance and its band, then the evidence, with one source credit', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await render(<CodexResetSection now={NOW} weekly={weekly(30)} />);
  expect(screen.getByText('Chance of a global reset in the next 24 hours')).toBeTruthy();
  expect(screen.getByText('15%')).toBeTruthy();
  expect(screen.getByText('Possible')).toBeTruthy();
  expect(screen.getByText('48 hours: 28%')).toBeTruthy();
  expect(screen.getByText('Low-confidence forecast: treat these odds with caution.')).toBeTruthy();
  expect(
    screen.getByText('Your weekly quota is 81% used and resets on its own in 1d 6h.'),
  ).toBeTruthy();
  // the strip is decorative for screen readers; the sentence above carries the same facts
  expect(screen.getByText('▲ Your weekly reset', { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByLabelText(/3 days with a confirmed reset/)).toBeTruthy();
  expect(screen.getByText('about 5 days')).toBeTruthy();
  expect(screen.getByText(/A global reset does not guarantee your personal quota/)).toBeTruthy();
  expect(screen.getByText('Codex operational')).toBeTruthy();
  // history and incidents wait behind one button
  expect(screen.queryByText('Confirmed reset')).toBeNull();
  expect(screen.queryByText(status.incidents[0].name)).toBeNull();
  await fireEvent.press(screen.getByText('History and service status'));
  expect(screen.getAllByText('Confirmed reset')).toHaveLength(3);
  expect(screen.getByText(status.incidents[0].name)).toBeTruthy();
  expect(screen.getAllByRole('link', { name: 'Data: codex-reset.com' })).toHaveLength(1);
  await fireEvent.press(screen.getByRole('link', { name: 'Data: codex-reset.com' }));
  expect(open).toHaveBeenCalledWith('https://codex-reset.com/');
});

it('pins a weekly reset beyond 48 hours to the end of the strip', async () => {
  await render(<CodexResetSection now={NOW} weekly={weekly(53)} />);
  expect(
    screen.getByText('Your weekly reset is later →', { includeHiddenElements: true }),
  ).toBeTruthy();
  expect(
    screen.getByText('Your weekly quota is 81% used and resets on its own in 2d 5h.'),
  ).toBeTruthy();
});

it('shows Chinese copy and translated announcements and keeps local timestamps', async () => {
  setLocale('zh');
  await render(<CodexResetSection now={NOW} />);
  expect(screen.getByText('全局重置雷达')).toBeTruthy();
  expect(screen.getByText('15%')).toBeTruthy();
  expect(screen.getByText('有可能')).toBeTruthy();
  expect(
    screen.getByText(new RegExp(escape(localEventTime(forecast.last_reset_at, 'zh', NOW)))),
  ).toBeTruthy();
  expect(screen.queryByText(timeline.events[0].localized_summary!)).toBeNull();
  await fireEvent.press(screen.getByText('历史与服务状态'));
  expect(screen.getAllByText('已确认重置')).toHaveLength(3);
  expect(screen.getByText(timeline.events[0].localized_summary!)).toBeTruthy();
  expect(screen.getByText('Codex 运行正常')).toBeTruthy();
});

it('degrades missing probabilities and signals, warns on old cached data without claiming an outage', async () => {
  const q = useReset();
  q.forecast.data.data = forecastSchema.parse({
    probabilities: {},
    confidence: 'future-confidence',
  });
  q.forecast.data.error = 'unavailable';
  q.status = {
    isLoading: false,
    data: { retryAt: 0, failures: 1, error: 'unavailable' },
  };
  await render(<CodexResetSection now={new Date(NOW.getTime() + 3_600_000)} />);
  expect(screen.getAllByText('Unknown')).toHaveLength(2);
  expect(screen.getByText('48 hours: Unknown')).toBeTruthy();
  expect(screen.getByText('Confidence unknown')).toBeTruthy();
  expect(
    screen.getAllByText('Outdated data — showing the last available copy.').length,
  ).toBeGreaterThan(0);
  // one footnote for the card, not one per failed endpoint
  expect(
    screen.getAllByText('Codex Reset data unavailable. This does not indicate a Codex outage.'),
  ).toHaveLength(1);
  expect(screen.getByText('Outdated data')).toBeTruthy();
  expect(screen.getByText('Codex status unknown')).toBeTruthy();
  expect(screen.queryByText('Codex service incident reported')).toBeNull();
  expect(screen.queryByText('Codex operational')).toBeNull();
});

it('reports an explicit platform incident separately from quota and data failures', async () => {
  const q = useReset();
  q.status = entry(
    statusSchema.parse({
      ...status,
      current: { codex: 'major_outage', degraded: true },
    }),
  );
  await render(<CodexResetSection now={NOW} />);
  expect(screen.getByText('Codex service incident reported')).toBeTruthy();
  expect(
    screen.getByText('A platform incident is different from exhausted personal quota.'),
  ).toBeTruthy();
});

it('does not present a type=reset event as confirmed and renders an official signal conservatively', async () => {
  const q = useReset();
  q.timeline.data.data = timelineSchema.parse({
    ...timeline,
    events: [timeline.events[2]],
  });
  q.forecast.data.data.official_signal = { future_field: 'unknown' };
  await render(<CodexResetSection now={NOW} />);
  await fireEvent.press(screen.getByText('History and service status'));
  expect(screen.getByText('Unconfirmed reset signal')).toBeTruthy();
  expect(screen.queryByText('Confirmed reset')).toBeNull();
  expect(screen.getByText('A signal is not a confirmed reset.')).toBeTruthy();
});

it('formats invalid time safely and relies on the device timezone in both locales', () => {
  const value = '2026-10-07T03:35:09.000Z';
  for (const [locale, tag] of [
    ['en', 'en-US'],
    ['zh', 'zh-CN'],
  ] as const) {
    expect(localEventTime(value, locale)).toBe(
      new Intl.DateTimeFormat(tag, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value)),
    );
    expect(localEventTime('bad', locale)).toBe('—');
    expect(confidenceText('future', createTranslator(locale))).toBe(
      createTranslator(locale)('Confidence unknown'),
    );
  }
  const e = timelineSchema.parse(timeline).events[2];
  expect(eventText(e, createTranslator('zh'))).toBe('未确认重置信号');
});

it.each(['en', 'zh'] as const)(
  'requires explicit source consent before enabling in %s',
  async (locale) => {
    setLocale(locale);
    const save = jest.fn().mockResolvedValue(undefined);
    usePreference.mockReturnValue({
      enabled: false,
      loaded: true,
      pending: false,
      setEnabled: save,
    });
    const alert = jest.spyOn(Alert, 'alert');
    await render(<CodexResetSection now={NOW} />);
    expect(useReset).not.toHaveBeenCalled();
    expect(screen.queryByText('15%')).toBeNull();
    await fireEvent.press(screen.getByText(locale === 'zh' ? '开启' : 'Turn on'));
    const [, message, buttons] = alert.mock.calls[0];
    expect(message).toContain('codex-reset.com');
    expect(message).toContain('OpenAI');
    expect(message).toMatch(locale === 'zh' ? /不会发送/ : /never sent/);
    expect(message).toMatch(locale === 'zh' ? /API Key/ : /API keys/);
    expect(save).not.toHaveBeenCalled();
    expect(buttons?.[0].style).toBe('cancel');
    await act(async () => buttons?.[1].onPress?.());
    await waitFor(() => expect(save).toHaveBeenCalledWith(true));
  },
);

it('disables immediately without another consent dialog and reports persistence failure', async () => {
  const save = jest.fn().mockRejectedValue(new Error('disk full'));
  usePreference.mockReturnValue({ enabled: true, loaded: true, pending: false, setEnabled: save });
  const alert = jest.spyOn(Alert, 'alert');
  await render(<CodexResetSection now={NOW} />);
  await fireEvent.press(screen.getByText('Turn off global reset radar'));
  expect(save).toHaveBeenCalledWith(false);
  await waitFor(() =>
    expect(alert).toHaveBeenCalledWith(
      'Could not save the public data setting',
      'Try changing the switch again.',
    ),
  );
  expect(alert).toHaveBeenCalledTimes(1);
});

it('formats today and yesterday using local calendar dates across a year boundary', () => {
  const now = new Date(2027, 0, 1, 0, 15);
  const yesterday = new Date(2026, 11, 31, 23, 50).toISOString();
  for (const [locale, tag] of [
    ['en', 'en-US'],
    ['zh', 'zh-CN'],
  ] as const) {
    const t = createTranslator(locale);
    const time = (value: string) =>
      new Intl.DateTimeFormat(tag, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value));
    expect(localEventTime(now.toISOString(), locale, now)).toBe(
      t('Today {time}', { time: time(now.toISOString()) }),
    );
    expect(localEventTime(yesterday, locale, now)).toBe(
      t('Yesterday {time}', { time: time(yesterday) }),
    );
  }
});

it('bands probabilities, marks 30 local days and averages confirmed intervals', () => {
  expect([null, 0, 14, 15, 39, 40, 100].map(chanceBand)).toEqual([
    undefined,
    'low',
    'low',
    'possible',
    'possible',
    'high',
    'high',
  ]);
  const events = timelineSchema.parse(timeline).events;
  const days = resetDays(events, NOW);
  expect(days).toHaveLength(30);
  expect(days.filter((d) => d === 'confirmed')).toHaveLength(3);
  // non-reset groups (credits, boost) never mark a day
  expect(resetDays(events.filter((e) => e.group !== 'reset'), NOW).every((d) => !d)).toBe(true);
  expect(averageIntervalDays(events.filter((e) => e.announcement_state === 'announced'))).toBe(5);
  expect(averageIntervalDays(events.slice(4, 5))).toBeUndefined();
});

describe('CodexResetChip', () => {
  const chip = (data: unknown) =>
    useForecast.mockReturnValue({
      data: { data: forecastSchema.parse(data), fetchedAt: NOW.getTime(), retryAt: 0, failures: 0 },
    });

  it('shows a possible-or-better 24-hour chance on the overview', async () => {
    chip(forecast);
    await render(<CodexResetChip now={NOW} />);
    expect(screen.getByText('Global reset 15%')).toBeTruthy();
  });

  it('stays quiet for a low chance, for old data and before opt-in', async () => {
    chip({ ...forecast, probabilities: { rounded_24h: 9, rounded_48h: 20 } });
    await render(<CodexResetChip now={NOW} />);
    expect(screen.queryByText(/Global reset/)).toBeNull();

    chip(forecast);
    await render(<CodexResetChip now={new Date(NOW.getTime() + 3_600_000)} />);
    expect(screen.queryByText(/Global reset/)).toBeNull();

    usePreference.mockReturnValue({ enabled: false, loaded: true, pending: false });
    useForecast.mockClear();
    await render(<CodexResetChip now={NOW} />);
    expect(screen.queryByText(/Global reset/)).toBeNull();
    expect(useForecast).not.toHaveBeenCalled();
  });

  it('labels an official signal without calling it confirmed', async () => {
    chip({ ...forecast, probabilities: { rounded_24h: 5 }, official_signal: 'x' });
    await render(<CodexResetChip now={NOW} />);
    expect(screen.getByText('Global reset signal')).toBeTruthy();
    expect(screen.getByLabelText('Global reset signal reported, not confirmed')).toBeTruthy();
  });
});
