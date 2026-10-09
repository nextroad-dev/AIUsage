import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useServices } from '@/data/hooks';
import { fakeFetch } from '@/test-utils/fetch';
import { useCodexResetForecast, useRefreshCodexReset } from '../hooks';
import { useCodexResetPreference } from '../preferences';
import { CACHE_MS, CONSENT_KEY, CodexResetService, SOURCE } from '../service';
import forecast from './fixtures/forecast.json';

jest.mock('@/data/hooks', () => ({ useServices: jest.fn() }));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) =>
    jest.requireActual<typeof import('react')>('react').useEffect(effect, []),
}));

it('shares real query hooks across components/remount/manual/background loads and pauses in native background', async () => {
  const values = new Map<string, unknown>([
    [
      CONSENT_KEY,
      {
        version: 1,
        source: SOURCE,
        enabled: true,
        acceptedAt: Date.now(),
      },
    ],
  ]);
  const f = fakeFetch({
    [`${SOURCE}api/forecast`]: { json: forecast },
  });
  const service = new CodexResetService({
    store: {
      getJson: async <T,>(key: string, fallback: T) => (values.get(key) ?? fallback) as T,
      setJson: async (key, value) => {
        values.set(key, value);
      },
    },
    fetch: f.fetch,
    now: () => Date.now(),
  });
  (useServices as jest.Mock).mockReturnValue({ data: { codexReset: service } });
  const oldState = AppState.currentState;
  AppState.currentState = 'active';
  let change!: (state: AppStateStatus) => void;
  const listener = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_type, callback) => {
      change = callback;
      return { remove: jest.fn() };
    });
  const client = new QueryClient({ defaultOptions: { mutations: { gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  try {
    const first = await renderHook(
      () => ({ query: useCodexResetForecast(), refresh: useRefreshCodexReset() }),
      { wrapper },
    );
    await waitFor(() =>
      expect(first.result.current.query.data?.data?.probabilities.rounded_24h).toBe(15),
    );
    expect(f.calls).toHaveLength(1);
    await act(async () => {
      first.result.current.refresh();
      await service.refresh();
    });
    expect(f.calls).toHaveLength(1);
    await first.unmount();
    const second = await renderHook(() => useCodexResetForecast(), { wrapper });
    expect(second.result.current.data?.data?.probabilities.rounded_24h).toBe(15);
    expect(f.calls).toHaveLength(1);
    await act(async () => change('background'));
    jest.useFakeTimers();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(CACHE_MS * 2);
    });
    expect(f.calls).toHaveLength(1);
    await second.unmount();
  } finally {
    client.clear();
    listener.mockRestore();
    AppState.currentState = oldState;
    jest.useRealTimers();
  }
});

it('keeps mount/manual/background off by default and shares revocation across account screens', async () => {
  const listener = jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  const values = new Map<string, unknown>();
  const f = fakeFetch({
    [`${SOURCE}api/forecast`]: { json: forecast },
  });
  const service = new CodexResetService({
    store: {
      getJson: async <T,>(key: string, fallback: T) => (values.get(key) ?? fallback) as T,
      setJson: async (key, value) => {
        values.set(key, value);
      },
    },
    fetch: f.fetch,
    now: () => Date.now(),
  });
  (useServices as jest.Mock).mockReturnValue({ data: { codexReset: service } });
  const oldState = AppState.currentState;
  AppState.currentState = 'active';
  // MutationCache removal leaves its normal five-minute GC timer alive; avoid that in this test.
  const client = new QueryClient({ defaultOptions: { mutations: { gcTime: Infinity } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const useScreen = () => ({
    preference: useCodexResetPreference(),
    query: useCodexResetForecast(),
    refresh: useRefreshCodexReset(),
  });
  try {
    const first = await renderHook(useScreen, { wrapper });
    const second = await renderHook(useScreen, { wrapper });
    await waitFor(() => expect(first.result.current.preference.loaded).toBe(true));
    await act(async () => {
      first.result.current.refresh();
      await service.refresh();
    });
    expect(f.calls).toHaveLength(0);
    await act(async () => {
      await first.result.current.preference.setEnabled(true);
    });
    await waitFor(() => expect(second.result.current.query.data?.data).toBeDefined());
    expect(f.calls).toHaveLength(1);
    await act(async () => {
      await second.result.current.preference.setEnabled(false);
    });
    await waitFor(() => expect(first.result.current.preference.enabled).toBe(false));
    // Public cache remains local, but disabling every observer prevents reads and new requests.
    expect(first.result.current.query.isFetching).toBe(false);
    await act(async () => {
      first.result.current.refresh();
      await service.refresh();
    });
    expect(f.calls).toHaveLength(1);
    await first.unmount();
    await second.unmount();
  } finally {
    client.clear();
    listener.mockRestore();
    AppState.currentState = oldState;
  }
});
