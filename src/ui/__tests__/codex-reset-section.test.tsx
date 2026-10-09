import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';

import { forecastSchema } from '@/data/codex-reset/models';
import { useCodexResetForecast } from '@/data/codex-reset/hooks';
import { useCodexResetPreference } from '@/data/codex-reset/preferences';
import { chanceBand, localEventTime } from '@/data/codex-reset/format';
import { createTranslator, setLocale } from '@/i18n';
import { CodexResetSection } from '@/ui/codex-reset-section';
import { ResetChanceLine } from '@/ui/reset-chance-line';
import forecast from '@/data/codex-reset/__tests__/fixtures/forecast.json';

jest.mock('@/data/codex-reset/hooks', () => ({ useCodexResetForecast: jest.fn() }));
jest.mock('@/data/codex-reset/preferences', () => ({ useCodexResetPreference: jest.fn() }));
const usePreference = useCodexResetPreference as jest.Mock;
const useForecast = useCodexResetForecast as jest.Mock;
const NOW = new Date(forecast.updated_at);
const query = (data: unknown, extra: object = {}) => ({
  data: {
    data: forecastSchema.parse(data),
    fetchedAt: NOW.getTime(),
    retryAt: 0,
    failures: 0,
    ...extra,
  },
  isLoading: false,
});

beforeEach(() => {
  setLocale('en');
  useForecast.mockReset();
  usePreference.mockReturnValue({
    enabled: true,
    loaded: true,
    pending: false,
    setEnabled: jest.fn().mockResolvedValue(undefined),
  });
  useForecast.mockReturnValue(query(forecast));
});
afterEach(() => {
  setLocale('en');
  jest.restoreAllMocks();
});

it('shows only the 24- and 48-hour reset chances, each with its band, and one source credit', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await render(<CodexResetSection now={NOW} />);
  expect(screen.getByText('Reset chance')).toBeTruthy();
  expect(screen.getByLabelText('Next 24 hours: 15%, Possible')).toBeTruthy();
  expect(screen.getByLabelText('Next 48 hours: 28%, Possible')).toBeTruthy();
  expect(screen.getByText(/A global reset does not guarantee your personal quota/)).toBeTruthy();
  expect(screen.queryByText(/confidence/i)).toBeNull();
  await fireEvent.press(screen.getByRole('link', { name: 'Data: codex-reset.com' }));
  expect(open).toHaveBeenCalledWith('https://codex-reset.com/');
});

it('shows Chinese copy and the local source time', async () => {
  setLocale('zh');
  await render(<CodexResetSection now={NOW} />);
  expect(screen.getByText('重置概率')).toBeTruthy();
  expect(screen.getByText('未来 24 小时')).toBeTruthy();
  expect(screen.getByText('15%')).toBeTruthy();
  expect(screen.getAllByText('有可能')).toHaveLength(2);
  expect(
    screen.getByText(
      createTranslator('zh')('Source updated {time}', {
        time: localEventTime(forecast.updated_at, 'zh', NOW),
      }),
    ),
  ).toBeTruthy();
});

it('degrades missing probabilities and warns on old cached data without claiming an outage', async () => {
  useForecast.mockReturnValue(query({ probabilities: {} }, { error: 'unavailable' }));
  await render(<CodexResetSection now={new Date(NOW.getTime() + 3_600_000)} />);
  expect(screen.getAllByText('Unknown')).toHaveLength(2);
  expect(screen.getByText('Outdated data — showing the last available copy.')).toBeTruthy();
  expect(
    screen.getByText('Codex Reset data unavailable. This does not indicate a Codex outage.'),
  ).toBeTruthy();
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
    expect(useForecast).not.toHaveBeenCalled();
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
  await fireEvent.press(screen.getByText('Turn off reset chance'));
  expect(save).toHaveBeenCalledWith(false);
  await waitFor(() =>
    expect(alert).toHaveBeenCalledWith(
      'Could not save the public data setting',
      'Try changing the switch again.',
    ),
  );
  expect(alert).toHaveBeenCalledTimes(1);
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
  }
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

it('bands probabilities into words', () => {
  expect([null, 0, 14, 15, 39, 40, 100].map(chanceBand)).toEqual([
    undefined,
    'low',
    'low',
    'possible',
    'possible',
    'high',
    'high',
  ]);
});

describe('ResetChanceLine (usage page)', () => {
  it('shows both odds on one plain line after opt-in', async () => {
    await render(<ResetChanceLine now={NOW} />);
    expect(screen.getByLabelText('24H reset chance, 15%, Possible')).toBeTruthy();
    expect(screen.getByLabelText('48H reset chance, 28%, Possible')).toBeTruthy();
    expect(screen.queryByText('Outdated data')).toBeNull();
  });

  it('renders nothing before opt-in or without cached odds', async () => {
    useForecast.mockReturnValue({ data: undefined, isLoading: true });
    await render(<ResetChanceLine now={NOW} />);
    expect(screen.queryByLabelText(/24H reset chance/)).toBeNull();
    usePreference.mockReturnValue({ enabled: false, loaded: true, pending: false });
    useForecast.mockClear();
    await render(<ResetChanceLine now={NOW} />);
    expect(useForecast).not.toHaveBeenCalled();
  });
});
