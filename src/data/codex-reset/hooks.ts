import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useServices } from '@/data/hooks';
import { CACHE_MS, type CodexResetService } from './service';
import type { Endpoint } from './models';
import { useCodexResetPreference } from './preferences';

export const resetKey = (endpoint: Endpoint) => ['codexReset', endpoint] as const;

export function resetQuery(service: CodexResetService, endpoint: Endpoint) {
  return {
    queryKey: resetKey(endpoint),
    queryFn: () => service.load(endpoint),
    staleTime: CACHE_MS,
    gcTime: 24 * 60 * 60_000,
    retry: false as const,
  };
}

/** Polls only while the screen is focused and the app is in the foreground, and only after opt-in. */
function usePollOptions() {
  const service = useServices().data?.codexReset;
  const preference = useCodexResetPreference();
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return {
    service,
    options: {
      enabled: !!service && preference.enabled && focused && active,
      staleTime: CACHE_MS,
      gcTime: 24 * 60 * 60_000,
      retry: false as const,
      refetchInterval: CACHE_MS,
      refetchIntervalInBackground: false,
    },
  };
}

export function useCodexReset() {
  const { service, options } = usePollOptions();
  return {
    forecast: useQuery({
      ...options,
      queryKey: resetKey('forecast'),
      queryFn: () => service!.load('forecast'),
    }),
    timeline: useQuery({
      ...options,
      queryKey: resetKey('timeline'),
      queryFn: () => service!.load('timeline'),
    }),
    status: useQuery({
      ...options,
      queryKey: resetKey('status'),
      queryFn: () => service!.load('status'),
    }),
  };
}

/** Forecast alone, for the overview card; shares the cache and gates of the details screen. */
export function useCodexResetForecast() {
  const { service, options } = usePollOptions();
  return useQuery({
    ...options,
    queryKey: resetKey('forecast'),
    queryFn: () => service!.load('forecast'),
  });
}

/** fetchQuery honours the same cache as mount/poll; the service also gates background reads. */
export function useRefreshCodexReset() {
  const service = useServices().data?.codexReset;
  const preference = useCodexResetPreference();
  const client = useQueryClient();
  return () => {
    if (!service || !preference.enabled) return;
    void Promise.allSettled(
      (['forecast', 'timeline', 'status'] as const).map((endpoint) =>
        client.fetchQuery(resetQuery(service, endpoint)),
      ),
    );
  };
}
