import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { usedFraction, visibleMeters } from '@/core/meter-utils';
import type { Meter } from '@/core/types';
import { sortViews, type AccountView } from '@/data/summary';
import { t as translate } from '@/i18n';
import type { UsageWidgetProps, WidgetMeter } from '@/widgets/usage-widget';

const SHORT: Record<string, string> = {
  session: '5h',
  five_hour: '5h',
  daily: 'Day',
  weekly: 'Week',
  monthly: 'Month',
};

function toWidgetMeter(m: Meter, t: typeof translate): WidgetMeter {
  const label = m.scope.type === 'model' ? `${t(m.label)} · ${m.scope.name}` : t(m.label);
  const reset = m.resetsAt ? Date.parse(m.resetsAt) : NaN;
  return {
    label,
    short: SHORT[m.id] ? t(SHORT[m.id]) : label,
    used: usedFraction(m) ?? -1,
    resetsAt: Number.isFinite(reset) ? reset : undefined,
  };
}

/**
 * Widget props for one moment: accounts in attention order (as on the overview), each with its
 * two tightest windows. Windows whose reset has passed by `at` read as fresh (0%), so a timeline
 * entry scheduled at a reset shows the quota coming back without the app running.
 */
export function widgetProps(
  views: AccountView[],
  at: number,
  t: typeof translate = translate,
): UsageWidgetProps {
  const accounts = sortViews(views.filter((v) => v.source === 'auto' && v.snapshot))
    .slice(0, 3)
    .map((v) => ({
      name: v.account.label || v.meta?.name || v.account.providerId,
      meters: visibleMeters(v.snapshot?.meters ?? [])
        .map((m) => toWidgetMeter(m, t))
        .map((m) =>
          m.resetsAt !== undefined && m.resetsAt <= at
            ? { ...m, used: m.used < 0 ? m.used : 0, resetsAt: undefined }
            : m,
        )
        .sort((a, b) => b.used - a.used)
        .slice(0, 2),
    }))
    .filter((a) => a.meters.length > 0);
  return {
    accounts,
    emptyText: t('Open AI Usage to add an account.'),
    resetsLabel: t('Resets'),
  };
}

/** Timeline: now, then one entry per upcoming reset (capped), so the widget stays honest offline. */
export function widgetTimeline(
  views: AccountView[],
  now: number,
  t: typeof translate = translate,
): { date: Date; props: UsageWidgetProps }[] {
  const resets = new Set<number>();
  for (const a of widgetProps(views, now, t).accounts)
    for (const m of a.meters)
      if (m.resetsAt !== undefined && m.resetsAt > now) resets.add(m.resetsAt);
  const times = [now, ...[...resets].sort((a, b) => a - b).slice(0, 8)];
  return times.map((at) => ({ date: new Date(at), props: widgetProps(views, at, t) }));
}

/**
 * Push fresh data to the widget. Never throws: widgets are optional on every platform but iOS.
 * The widget module is loaded only when its native side exists — Expo Go and builds made before
 * the widget extension was added don't have it, and importing it there throws at module load.
 */
export async function syncWidget(views: AccountView[], now: Date): Promise<void> {
  if (Platform.OS !== 'ios' || !requireOptionalNativeModule('ExpoWidgets')) return;
  try {
    const { default: UsageWidget } = await import('@/widgets/usage-widget');
    UsageWidget.updateTimeline(widgetTimeline(views, now.getTime()));
  } catch {
    // no widget extension in this build (e.g. an older development build)
  }
}
