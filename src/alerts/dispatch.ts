import type { AlertEvent } from '@/alerts/evaluate';
import type { AlertRepo } from '@/db/repos';

export type PermissionState = 'granted' | 'denied' | 'undetermined';

export interface Notifier {
  permission(): Promise<PermissionState>;
  /**
   * Resolves when the notification was handed to the OS; rejects if it could not be. Events with
   * `at` are scheduled for that time, replacing a pending one with the same `ruleId`.
   */
  send(event: AlertEvent): Promise<void>;
}

/**
 * Sends events that have not fired yet in their reset cycle. An event is recorded as fired only
 * after the OS accepted it, so a denied permission or a transient failure does not silently
 * swallow the alert. Lower thresholds crossed in the same cycle are recorded without sending.
 */
export async function dispatchAlerts(
  events: AlertEvent[],
  deps: { alerts: AlertRepo; notifier: Notifier; now: () => number },
): Promise<{ sent: number; skipped: number }> {
  let sent = 0;
  let skipped = 0;
  if (events.length === 0) return { sent, skipped };
  const permission = await deps.notifier.permission();

  for (const e of events) {
    if (e.at !== undefined) {
      // scheduled for later: (re)schedule every cycle so a moved reset time stays accurate
      if (permission !== 'granted' || e.at <= deps.now()) continue;
      try {
        await deps.notifier.send(e);
        sent++;
      } catch {
        // retried on the next cycle
      }
      continue;
    }
    if (await deps.alerts.hasFired(e.ruleId, e.cycleKey)) {
      skipped++;
      continue;
    }
    if (permission !== 'granted') continue;
    try {
      await deps.notifier.send(e);
    } catch {
      continue; // try again on the next cycle
    }
    await deps.alerts.markFired(e.ruleId, e.cycleKey, deps.now());
    for (const lower of e.alsoMarkFired ?? []) {
      await deps.alerts.markFired(lower.ruleId, lower.cycleKey, deps.now());
    }
    sent++;
  }
  return { sent, skipped };
}
