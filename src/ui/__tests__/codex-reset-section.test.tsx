import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';

import { forecastSchema, timelineSchema, statusSchema } from '@/data/codex-reset/models';
import { useCodexReset } from '@/data/codex-reset/hooks';
import { useCodexResetPreference } from '@/data/codex-reset/preferences';
import { confidenceText, eventText, localEventTime } from '@/data/codex-reset/format';
import { createTranslator, setLocale } from '@/i18n';
import { CodexResetSection } from '@/ui/codex-reset-section';
import forecast from '@/data/codex-reset/__tests__/fixtures/forecast.json';
import timeline from '@/data/codex-reset/__tests__/fixtures/timeline.json';
import status from '@/data/codex-reset/__tests__/fixtures/status.json';

jest.mock('@/data/codex-reset/hooks', () => ({ useCodexReset: jest.fn() }));
jest.mock('@/data/codex-reset/preferences', () => ({ useCodexResetPreference: jest.fn() }));
const usePreference = useCodexResetPreference as jest.Mock;
const useReset = useCodexReset as jest.Mock;
const NOW = new Date(forecast.updated_at);
const entry = (data: unknown) => ({
  data: { data, fetchedAt: NOW.getTime(), retryAt: 0, failures: 0 },
  isLoading: false,
});

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

it('renders genuine probabilities, low confidence, confirmation labels and clickable source on each surface', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await render(<CodexResetSection now={NOW} />);
  expect(screen.getByText('15%')).toBeTruthy();
  expect(screen.getByText('28%')).toBeTruthy();
  expect(screen.getByText('Low-confidence forecast: treat these odds with caution.')).toBeTruthy();
  expect(screen.getAllByText('Confirmed reset')).toHaveLength(2);
  expect(screen.getByText(/A global reset does not guarantee your personal quota/)).toBeTruthy();
  expect(screen.getByText('Codex operational')).toBeTruthy();
  expect(screen.queryByText(status.incidents[0].name)).toBeNull();
  await fireEvent.press(screen.getByText('Recent incidents'));
  expect(screen.getByText(status.incidents[0].name)).toBeTruthy();
  expect(screen.getAllByRole('link', { name: 'Data: codex-reset.com' })).toHaveLength(3);
  await fireEvent.press(screen.getAllByRole('link', { name: 'Data: codex-reset.com' })[0]);
  expect(open).toHaveBeenCalledWith('https://codex-reset.com/');
});

it('shows Chinese copy and translated announcements and keeps local timestamps', async () => {
  setLocale('zh');
  await render(<CodexResetSection now={NOW} />);
  expect(screen.getByText('全局重置预测')).toBeTruthy();
  expect(screen.getByText('15%')).toBeTruthy();
  expect(screen.getAllByText('已确认重置')).toHaveLength(2);
  // Before expansion, last-confirmed and its timeline entry share the same local time.
  expect(
    screen.getAllByText(localEventTime(timeline.events[4].announced_at, 'zh', NOW)),
  ).toHaveLength(2);
  expect(screen.queryByText(timeline.events[0].localized_summary!)).toBeNull();
  await fireEvent.press(screen.getByText('更多历史记录'));
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
  expect(screen.getByText('Confidence unknown')).toBeTruthy();
  expect(
    screen.getAllByText('Outdated data — showing the last available copy.').length,
  ).toBeGreaterThan(0);
  expect(
    screen.getAllByText('Codex Reset data unavailable. This does not indicate a Codex outage.'),
  ).toHaveLength(2);
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
  await fireEvent.press(screen.getByText('More history'));
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
    await fireEvent(screen.getByRole('switch'), 'valueChange', true);
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
  await fireEvent(screen.getByRole('switch'), 'valueChange', false);
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
