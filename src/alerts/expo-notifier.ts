import * as Notifications from 'expo-notifications';

import type { AlertEvent } from '@/alerts/evaluate';
import type { Notifier, PermissionState } from '@/alerts/dispatch';

/** Show alerts as banners even while the app is open. */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function getPermission(): Promise<PermissionState> {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

export async function requestPermission(): Promise<PermissionState> {
  const p = await Notifications.requestPermissionsAsync();
  return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
}

export const expoNotifier: Notifier = {
  permission: getPermission,
  async send(e: AlertEvent) {
    await Notifications.scheduleNotificationAsync({
      // a stable identifier makes rescheduling replace the pending notification, not stack it
      identifier: e.at === undefined ? undefined : e.ruleId,
      content: { title: e.title, body: e.body, data: { accountId: e.accountId, kind: e.kind } },
      trigger:
        e.at === undefined
          ? null
          : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(e.at) },
    });
  },
  async scheduled() {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    return pending.map((p) => p.identifier);
  },
  async cancel(id) {
    await Notifications.cancelScheduledNotificationAsync(id);
  },
};
