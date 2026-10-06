import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Meter, UsageSnapshot } from '@/core/types';
import type { AccountView } from '@/data/summary';
import { setLocale } from '@/i18n';
import { AccountCard } from '@/ui/account-card';
import { Button, Field, Segmented } from '@/ui/controls';
import { MeterDonut } from '@/ui/meter-donut';
import { MeterRow } from '@/ui/meter-row';
import { StatusBadge } from '@/ui/status-badge';
import { defaultColumns } from '@/ui/option-grid';

const NOW = new Date('2026-10-06T12:00:00Z');

const pct = (id: string, used: number, resetsAt?: string, model?: string): Meter => ({
  id,
  label: id === 'session' ? '5-hour window' : 'Weekly',
  kind: { type: 'percent', used },
  scope: model ? { type: 'model', name: model } : { type: 'overall' },
  resetsAt,
});

const snapshot = (meters: Meter[], plan?: string): UsageSnapshot => ({
  providerId: 'zai',
  accountId: 'a',
  plan,
  fetchedAt: NOW.toISOString(),
  meters,
  status: { type: 'ok' },
});

const view = (over: Partial<AccountView> = {}): AccountView => ({
  account: {
    id: 'a',
    providerId: 'zai',
    label: 'Work',
    authMethod: 'apiKey',
    sortOrder: 0,
    createdAt: 1,
  },
  meta: {
    id: 'zai',
    name: 'GLM Coding Plan (z.ai)',
    automation: 'spec',
    auth: ['apiKey'],
  },
  snapshot: null,
  health: null,
  source: 'auto',
  ...over,
});

describe('AccountCard', () => {
  it('shows the most constrained meter with reset countdown and the others below', async () => {
    const v = view({
      snapshot: snapshot(
        [pct('weekly', 10, '2026-10-10T00:00:00Z'), pct('session', 72, '2026-10-06T15:12:00Z')],
        'Pro',
      ),
      health: { accountId: 'a', failures: 0, statusType: 'ok', lastSuccessAt: NOW.getTime() },
    });
    await render(<AccountCard view={v} now={NOW} onPress={() => {}} />);
    expect(screen.getByText('GLM Coding Plan (z.ai)')).toBeTruthy();
    expect(screen.getByText('Work · Pro')).toBeTruthy();
    expect(screen.getByText(/5-hour window/)).toBeTruthy();
    expect(screen.getByText('Resets in 3h 12m')).toBeTruthy();
    expect(screen.getByText(/Weekly/)).toBeTruthy();
    // every window is drawn as its own donut, with the used share in the hole
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
    expect(screen.getByText('72%')).toBeTruthy();
    expect(screen.getByText('10%')).toBeTruthy();
    expect(screen.queryByText('Login expired')).toBeNull();
  });

  it('keeps showing the last data without a staleness badge', async () => {
    const v = view({
      snapshot: snapshot([pct('session', 40)]),
      health: {
        accountId: 'a',
        failures: 2,
        statusType: 'stale',
        lastSuccessAt: NOW.getTime() - 3 * 3_600_000,
      },
    });
    await render(<AccountCard view={v} now={NOW} onPress={() => {}} />);
    expect(screen.queryByText(/Offline/)).toBeNull();
    expect(screen.getByText(/5-hour window/)).toBeTruthy();
  });

  it('prompts to sign in again when the login expired', async () => {
    const v = view({ health: { accountId: 'a', failures: 0, statusType: 'authExpired' } });
    await render(<AccountCard view={v} now={NOW} onPress={() => {}} />);
    expect(screen.getByText(/Login expired/)).toBeTruthy();
    expect(screen.getByText('Open this account to sign in again.')).toBeTruthy();
  });

  it('labels manual and not-yet-loaded accounts', async () => {
    const { rerender } = await render(
      <AccountCard view={view({ source: 'legacy' })} now={NOW} onPress={() => {}} />,
    );
    expect(screen.getByText(/Historical account/)).toBeTruthy();
    await rerender(<AccountCard view={view()} now={NOW} onPress={() => {}} />);
    expect(screen.getByText(/Not loaded yet/)).toBeTruthy();
    expect(screen.getByText('Tap refresh to load usage.')).toBeTruthy();
  });

  it('shows model scope in the meter title and calls onPress', async () => {
    const onPress = jest.fn();
    await render(
      <AccountCard
        view={view({ snapshot: snapshot([pct('weekly', 50, undefined, 'opus')]) })}
        now={NOW}
        onPress={onPress}
      />,
    );
    expect(screen.getByText(/Weekly · opus/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalled();
  });

  it('renders in Chinese', async () => {
    setLocale('zh');
    try {
      await render(
        <AccountCard
          view={view({
            source: 'legacy',
            snapshot: snapshot([pct('session', 40, '2026-10-06T15:12:00Z')]),
          })}
          now={NOW}
          onPress={() => {}}
        />,
      );
      expect(screen.getByText('3小时 12m后重置'.replace('12m', '12m'))).toBeTruthy();
      expect(screen.getByText(/只读/)).toBeTruthy();
    } finally {
      setLocale('en');
    }
  });
});

describe('MeterRow / MeterDonut / StatusBadge', () => {
  it('exposes progress to accessibility', async () => {
    await render(<MeterDonut fraction={0.42} centerText="42%" accessibilityLabel="Weekly 42%" />);
    expect(
      screen.getByRole('progressbar', { name: 'Weekly 42%', value: { min: 0, max: 100, now: 42 } }),
    ).toBeTruthy();
    expect(screen.getByText('42%')).toBeTruthy();
  });

  it('renders a meter row with amount text and an elapsed reset', async () => {
    const m: Meter = {
      id: 'credits',
      label: 'Credits',
      kind: { type: 'amount', used: 5, limit: 20, unit: 'USD' },
      scope: { type: 'overall' },
      resetsAt: '2026-10-01T00:00:00Z',
    };
    await render(<MeterRow meter={m} now={NOW} />);
    expect(screen.getByText(/used \$5\.00/)).toBeTruthy();
    expect(screen.getByText(/Remaining \$15\.00/)).toBeTruthy();
    expect(screen.getByText('Reset due')).toBeTruthy();
  });

  it('renders nothing for an ok status', async () => {
    const { toJSON } = await render(<StatusBadge status={{ kind: 'ok' }} now={NOW} />);
    expect(toJSON()).toBeNull();
  });
});

describe('controls', () => {
  it('Button reports disabled/busy state and presses when enabled', async () => {
    // RNTL also walks up to the composite component's onPress, so assert the host state instead
    // of firing events at a disabled button.
    const onPress = jest.fn();
    const { rerender } = await render(<Button title="Go" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
    await rerender(<Button title="Go" onPress={onPress} loading />);
    expect(screen.getByRole('button', { busy: true })).toBeTruthy();
    await rerender(<Button title="Go" onPress={onPress} disabled />);
    expect(screen.getByRole('button', { disabled: true })).toBeTruthy();
  });

  it('Segmented reports selection and Field is labelled', async () => {
    const onChange = jest.fn();
    await render(
      <>
        <Segmented
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ]}
          value="a"
          onChange={onChange}
        />
        <Field label="API key" value="" onChangeText={() => {}} />
      </>,
    );
    await fireEvent.press(screen.getByText('B'));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.getByLabelText('API key')).toBeTruthy();
  });

  it('Segmented exposes radio semantics, not tabs', async () => {
    const onChange = jest.fn();
    await render(
      <Segmented
        label="Language"
        options={[
          { value: 'en', label: 'English' },
          { value: 'zh', label: 'Chinese' },
        ]}
        value="en"
        onChange={onChange}
      />,
    );
    // the container is not `accessible` on purpose (that would flatten its children for
    // VoiceOver), so the group role is asserted through its labelled radios instead
    expect(screen.getByRole('radio', { name: 'English', checked: true })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Chinese', checked: false })).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
  });
});

describe('option grid', () => {
  it('keeps short groups in one row and wraps long ones', () => {
    // language / appearance / history range: one row of equal cells
    expect(defaultColumns(['跟随系统', '中文', '英文'])).toBe(3);
    expect(defaultColumns(['Follow system', 'Chinese', 'English'])).toBe(3);
    // hours are short: four fit in a row
    expect(defaultColumns(['3h', '6h', '12h', '24h'])).toBe(4);
    // longer labels: two per row
    expect(defaultColumns(['Default', 'Off', '70%', '80%'])).toBe(2);
    // five or more: three per row
    expect(defaultColumns(['Default', 'Off', '70%', '80%', '90%', '95%'])).toBe(3);
  });
});
