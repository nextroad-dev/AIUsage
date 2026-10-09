import { fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import type { Meter, UsageSnapshot } from '@/core/types';
import type { AccountView } from '@/data/summary';
import { setLocale } from '@/i18n';
import { AccountCard } from '@/ui/account-card';
import { Button, ColorSwatches, Field, Segmented } from '@/ui/controls';
import { MeterRow } from '@/ui/meter-row';
import { RowSkeleton } from '@/ui/skeleton';
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
    expect(screen.getByText(/Weekly/)).toBeTruthy();
    // one line per window: used share and a short countdown; remaining is left to the details
    expect(screen.getByText('72%')).toBeTruthy();
    expect(screen.getByText('10%')).toBeTruthy();
    // the test renderer reports a large font scale, so rows stack with the full countdown
    expect(screen.getByText('Resets in 3h 12m')).toBeTruthy();
    expect(screen.queryByText('Remaining 90%')).toBeNull();
    // screen readers still get the full sentence
    expect(screen.getByLabelText('5-hour window, used 72%, Resets in 3h 12m')).toBeTruthy();
    expect(screen.queryByText('Login expired')).toBeNull();
  });

  it('fits each window on one line at normal font sizes', async () => {
    const window = Dimensions.get('window');
    Dimensions.set({ window: { ...window, fontScale: 1 } });
    try {
      const v = view({
        snapshot: snapshot([pct('session', 72, '2026-10-06T15:12:00Z')]),
      });
      await render(<AccountCard view={v} now={NOW} onPress={() => {}} />);
      expect(screen.getByText('72%')).toBeTruthy();
      expect(screen.getByText('3h12m')).toBeTruthy();
      expect(screen.queryByText('Resets in 3h 12m')).toBeNull();
    } finally {
      Dimensions.set({ window });
    }
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

  it('centres a lone title on the icon and hides empty add-on quotas', async () => {
    const credits: Meter = {
      id: 'credits',
      label: 'Credits balance',
      kind: { type: 'balance', value: 0, unit: 'credits' },
      scope: { type: 'overall' },
    };
    await render(
      <AccountCard
        view={view({
          account: { ...view().account, label: 'GLM Coding Plan (z.ai)' },
          snapshot: snapshot([pct('weekly', 30), credits]),
        })}
        now={NOW}
        onPress={() => {}}
      />,
    );
    // no empty subtitle line under the name
    expect(screen.queryByText('')).toBeNull();
    expect(screen.queryByText(/Credits balance/)).toBeNull();
    expect(screen.getByText(/Weekly/)).toBeTruthy();
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

describe('MeterRow / StatusBadge', () => {
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

describe('ColorSwatches', () => {
  it('exposes named radios and reports the picked colour', async () => {
    const onChange = jest.fn();
    await render(
      <ColorSwatches
        label="Theme color"
        options={[
          { value: 'blue', color: '#2563EB', label: 'Blue' },
          { value: 'teal', color: '#0F766E', label: 'Teal' },
        ]}
        value="blue"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Blue', checked: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Teal', checked: false }));
    expect(onChange).toHaveBeenCalledWith('teal');
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

describe('RowSkeleton', () => {
  it('announces loading and draws one line per row', async () => {
    setLocale('en');
    await render(<RowSkeleton rows={3} leading />);
    const list = screen.getByLabelText('Loading…');
    expect(list.props.accessibilityState).toEqual({ busy: true });
    expect(list.props.children).toHaveLength(3);
  });
});

describe('AccountCard plan', () => {
  it('shows a reported plan with its first letter raised', async () => {
    setLocale('en');
    await render(
      <AccountCard
        view={{ ...view(), snapshot: snapshot([], 'plus') }}
        now={NOW}
        onPress={() => {}}
      />,
    );
    expect(screen.getByText('Work · Plus')).toBeTruthy();
  });
});
