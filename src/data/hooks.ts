import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { getPermission, requestPermission } from '@/alerts/expo-notifier';
import { webKitCookies } from '@/authkit/expo-cookies';
import {
  DEFAULT_ALERT_SETTINGS,
  mergeAlertSettings,
  meterKey,
  type OverrideChoice,
  type AlertSettings,
} from '@/alerts/evaluate';
import type { Meter } from '@/core/types';
import { loadView, loadViews } from '@/data/load';
import { clearPrices, setPrice, type Price } from '@/data/prices';
import { getServices } from '@/data/services';
import { syncBackgroundRegistration } from '@/refresh/background';
import { runRefreshCycle } from '@/refresh/coordinator';
import { syncWidget } from '@/widgets/sync';
import { refreshAccount } from '@/refresh/refresh-account';

export const keys = {
  services: ['services'] as const,
  views: ['views'] as const,
  view: (id: string) => ['views', id] as const,
};

export function useServices() {
  return useQuery({ queryKey: keys.services, queryFn: getServices, staleTime: Infinity });
}

export function useAccountViews() {
  const services = useServices().data;
  return useQuery({
    queryKey: keys.views,
    queryFn: () => loadViews(services!.repos, new Date()),
    enabled: !!services,
  });
}

export function useAccountView(id: string) {
  const services = useServices().data;
  return useQuery({
    queryKey: keys.view(id),
    queryFn: () => loadView(services!.repos, id, new Date()),
    enabled: !!services,
  });
}

/** Re-renders every `intervalMs` so countdowns stay current. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: keys.views })]);
}

/** Pull-to-refresh / "refresh now": forced, all accounts. */
export function useRefreshAll() {
  const services = useServices().data;
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (opts: { force?: boolean } = {}) =>
      runRefreshCycle(services!.cycleDeps, opts),
    onSettled: invalidate,
  });
}

export function useRefreshAccount(id: string) {
  const services = useServices().data;
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async () => refreshAccount(services!.refreshDeps, id, { force: true }),
    onSettled: invalidate,
  });
}

export function useAccountActions() {
  const services = useServices().data;
  const invalidate = useInvalidate();
  const run = async <T>(fn: () => Promise<T>) => {
    const out = await fn();
    await invalidate();
    // renamed or removed accounts should not linger on the home screen until the next refresh
    void loadViews(services!.repos, new Date()).then((v) => syncWidget(v, new Date()));
    return out;
  };
  return {
    rename: (id: string, label: string) => run(() => services!.repos.accounts.rename(id, label)),
    remove: (id: string) =>
      run(async () => {
        await services!.accounts.remove(id);
        await setPrice(services!.repos, id, null);
      }),
    removeAll: () =>
      run(async () => {
        try {
          await services!.accounts.removeAll();
        } finally {
          await clearPrices(services!.repos);
          // sessions from in-app web sign-in live in the WebView cookie store, not the keychain
          await webKitCookies.clear?.().catch(() => undefined);
        }
      }),
    setPrice: (id: string, price: Price | null) => run(() => setPrice(services!.repos, id, price)),
  };
}

// ---------------- alerts & background ----------------

export function useAlertSettings() {
  const services = useServices().data;
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['alertSettings'],
    queryFn: async () => mergeAlertSettings(await services!.repos.settings.getJson('alerts', null)),
    enabled: !!services,
  });
  const update = useMutation({
    mutationFn: async (patch: Partial<AlertSettings>) => {
      const next = mergeAlertSettings({ ...query.data, ...patch });
      await services!.repos.settings.setJson('alerts', next);
      if (patch.backgroundRefresh !== undefined) {
        await syncBackgroundRegistration(next.backgroundRefresh);
      }
      return next;
    },
    onSuccess: (next) => qc.setQueryData(['alertSettings'], next),
  });
  return {
    settings: query.data ?? DEFAULT_ALERT_SETTINGS,
    /** false until the stored settings are read; until then `settings` are only the defaults */
    loaded: query.data !== undefined,
    update: update.mutate,
  };
}

export function useNotificationPermission() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['notifPermission'], queryFn: getPermission });
  const request = useMutation({
    mutationFn: requestPermission,
    onSuccess: (p) => qc.setQueryData(['notifPermission'], p),
  });
  return { state: query.data, request: request.mutate };
}

/** Registers or removes the background task to match the setting, once the setting is known. */
export function useBackgroundState(enabled: boolean, known = true) {
  return useQuery({
    queryKey: ['backgroundState', enabled],
    queryFn: () => syncBackgroundRegistration(enabled),
    // acting on the default before the stored value arrives would flip the registration
    enabled: known,
  });
}

export function useAlertOverrides(accountId: string) {
  const services = useServices().data;
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['alertRules', accountId],
    queryFn: () => services!.repos.alerts.rules(accountId),
    enabled: !!services,
  });
  const set = useMutation({
    mutationFn: async (v: { meter: Meter; choice: OverrideChoice }) => {
      const repo = services!.repos.alerts;
      const model = v.meter.scope.type === 'model' ? v.meter.scope.name : undefined;
      const id = `${accountId}|${meterKey(v.meter)}|override`;
      if (v.choice === 'default') return repo.deleteRule(id);
      await repo.upsertRule({
        id,
        accountId,
        meterId: v.meter.id,
        model,
        kind: 'usage-over',
        threshold: typeof v.choice === 'number' ? v.choice : 1,
        enabled: v.choice !== 'off',
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alertRules', accountId] }),
  });
  return { rules: query.data ?? [], set: set.mutate };
}
