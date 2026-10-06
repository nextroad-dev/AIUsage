import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { configureNotificationHandler } from '@/alerts/expo-notifier';
import { mergeAlertSettings } from '@/alerts/evaluate';
import { useRefreshAll, useServices } from '@/data/hooks';
import { syncBackgroundRegistration } from '@/refresh/background';

/**
 * Side effects that live as long as the app: notification banners, background registration,
 * refresh when the app comes to the foreground, and opening the account behind a tapped
 * notification. Renders nothing.
 */
export function AppLifecycle() {
  const router = useRouter();
  const services = useServices().data;
  const { mutate: refresh } = useRefreshAll();
  const last = Notifications.useLastNotificationResponse();
  const handled = useRef<string | undefined>(undefined);

  useEffect(() => {
    configureNotificationHandler();
  }, []);

  useEffect(() => {
    if (!services) return;
    services.repos.settings
      .getJson('alerts', null)
      .then((s) => syncBackgroundRegistration(mergeAlertSettings(s).backgroundRefresh));
  }, [services]);

  useEffect(() => {
    if (!services) return;
    const sub = AppState.addEventListener('change', (state) => {
      // rate limiting inside the coordinator keeps this cheap when data is recent
      if (state === 'active') refresh({});
    });
    return () => sub.remove();
  }, [services, refresh]);

  useEffect(() => {
    if (!last) return;
    const id = last.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const accountId = last.notification.request.content.data?.accountId;
    if (typeof accountId === 'string') router.push(`/account/${accountId}`);
  }, [last, router]);

  return null;
}
