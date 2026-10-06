import { daysUntil, formatCountdown, formatDate, formatNumber } from '@/core/format';
import { countdown, cycleKey, usedFraction } from '@/core/meter-utils';
import type { Meter } from '@/core/types';
import { deriveStatus, type AccountView } from '@/data/summary';
import type { AlertKind, AlertRule } from '@/db/repos';
import { t } from '@/i18n';

export interface AlertSettings {
  enabled: boolean;
  /** used-fraction thresholds, ascending, e.g. [0.8, 0.95] */
  thresholds: number[];
  resetSoon: {
    enabled: boolean;
    /** notify when a reset is within this many hours... */
    hours: number;
    /** ...and at most this fraction has been used */
    maxUsedFraction: number;
  };
  authExpired: boolean;
  /** notify the moment a window that was nearly used up resets */
  windowReset: boolean;
  /** remind before a paid plan renews or ends */
  renewal: { enabled: boolean; days: number };
  backgroundRefresh: boolean;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  thresholds: [0.8, 0.95],
  resetSoon: { enabled: false, hours: 6, maxUsedFraction: 0.5 },
  authExpired: true,
  windowReset: true,
  renewal: { enabled: true, days: 3 },
  backgroundRefresh: true,
};

export function mergeAlertSettings(
  stored: Partial<AlertSettings> | null | undefined,
): AlertSettings {
  const s = stored ?? {};
  const thresholds = Array.isArray(s.thresholds)
    ? [...new Set(s.thresholds.filter((x) => typeof x === 'number' && x > 0 && x <= 1.5))].sort(
        (a, b) => a - b,
      )
    : DEFAULT_ALERT_SETTINGS.thresholds;
  return {
    enabled: s.enabled ?? DEFAULT_ALERT_SETTINGS.enabled,
    thresholds,
    resetSoon: { ...DEFAULT_ALERT_SETTINGS.resetSoon, ...s.resetSoon },
    authExpired: s.authExpired ?? DEFAULT_ALERT_SETTINGS.authExpired,
    windowReset: s.windowReset ?? DEFAULT_ALERT_SETTINGS.windowReset,
    renewal: { ...DEFAULT_ALERT_SETTINGS.renewal, ...s.renewal },
    backgroundRefresh: s.backgroundRefresh ?? DEFAULT_ALERT_SETTINGS.backgroundRefresh,
  };
}

export interface AlertEvent {
  /** stable id of the rule instance, used with cycleKey for once-per-cycle de-duplication */
  ruleId: string;
  cycleKey: string;
  kind: AlertKind;
  accountId: string;
  title: string;
  body: string;
  /** thresholds already below this event's threshold in the same cycle; recorded silently */
  alsoMarkFired?: { ruleId: string; cycleKey: string }[];
  /**
   * Deliver at this epoch ms instead of now. Scheduled events are idempotent: re-sending one
   * replaces the pending notification with the same `ruleId`, so they skip de-duplication.
   */
  at?: number;
}

export const meterKey = (m: Meter): string =>
  `${m.id}${m.scope.type === 'model' ? `:${m.scope.name}` : ''}`;

/** per-meter override: matches by account + meter id + model */
export function overrideFor(
  rules: AlertRule[],
  accountId: string,
  m: Meter,
): AlertRule | undefined {
  const model = m.scope.type === 'model' ? m.scope.name : undefined;
  return rules.find(
    (r) =>
      r.accountId === accountId &&
      r.kind === 'usage-over' &&
      r.meterId === m.id &&
      r.model === model,
  );
}

export type OverrideChoice = 'default' | 'off' | number;

/** Current per-meter override as a UI choice. */
export function choiceFor(rules: AlertRule[], accountId: string, m: Meter): OverrideChoice {
  const r = overrideFor(rules, accountId, m);
  if (!r) return 'default';
  return r.enabled ? r.threshold : 'off';
}

const pctText = (f: number) => `${formatNumber(Math.round(f * 100), 0)}%`;

function displayName(v: AccountView): string {
  const base = v.meta?.name ?? v.account.providerId;
  return v.account.label && v.account.label !== base ? `${base} · ${v.account.label}` : base;
}

function meterName(m: Meter): string {
  return m.scope.type === 'model' ? `${t(m.label)} · ${m.scope.name}` : t(m.label);
}

/**
 * Pure rule evaluation: which alerts are due for these accounts right now? De-duplication
 * (once per reset cycle) is applied by the dispatcher using ruleId + cycleKey.
 */
export function evaluateAlerts(input: {
  views: AccountView[];
  settings: AlertSettings;
  overrides: AlertRule[];
  now: Date;
}): AlertEvent[] {
  const { views, settings, overrides, now } = input;
  if (!settings.enabled) return [];
  const events: AlertEvent[] = [];

  for (const v of views) {
    if (v.source === 'legacy') continue;
    const name = displayName(v);

    if (settings.authExpired && deriveStatus(v).kind === 'authExpired') {
      events.push({
        ruleId: `${v.account.id}|auth-expired`,
        cycleKey: `${v.account.id}:auth:${v.health?.lastSuccessAt ?? 0}`,
        kind: 'auth-expired',
        accountId: v.account.id,
        title: t('{name}: sign in again', { name }),
        body: t('The saved credential was rejected, so usage can no longer be updated.'),
      });
    }

    // --- paid plan renews or ends soon ---
    const renewsAt = v.snapshot?.renewsAt ? Date.parse(v.snapshot.renewsAt) : NaN;
    if (settings.renewal.enabled && Number.isFinite(renewsAt) && renewsAt > now.getTime()) {
      const days = daysUntil(renewsAt, now.getTime());
      if (days <= settings.renewal.days) {
        events.push({
          ruleId: `${v.account.id}|renewal-soon`,
          cycleKey: `${v.account.id}:renew:${renewsAt}`,
          kind: 'renewal-soon',
          accountId: v.account.id,
          title: t('{name}: plan ends or renews {date}', { name, date: formatDate(renewsAt) }),
          body:
            days <= 1
              ? t('Within a day. Check your subscription if you do not plan to keep it.')
              : t('In {n} days. Check your subscription if you do not plan to keep it.', {
                  n: days,
                }),
        });
      }
    }

    for (const m of v.snapshot?.meters ?? []) {
      const f = usedFraction(m);
      if (f === undefined) continue;
      const cd = countdown(m.resetsAt, now);
      // A snapshot whose reset time has passed describes the previous cycle; don't alert on it.
      if (cd?.elapsed && v.source === 'auto') continue;
      const key = meterKey(m);
      const ov = overrideFor(overrides, v.account.id, m);

      // --- usage over threshold ---
      if (!(ov && !ov.enabled)) {
        const thresholds = ov ? [ov.threshold] : settings.thresholds;
        const crossed = thresholds.filter((th) => f >= th).sort((a, b) => a - b);
        if (crossed.length > 0) {
          const top = crossed[crossed.length - 1];
          const ck = cycleKey(v.account.id, m);
          const idOf = (th: number) => `${v.account.id}|${key}|usage-over|${th}`;
          events.push({
            ruleId: idOf(top),
            cycleKey: ck,
            kind: 'usage-over',
            accountId: v.account.id,
            title: t('{name}: {meter} at {pct}', { name, meter: meterName(m), pct: pctText(f) }),
            body:
              cd && !cd.elapsed
                ? t('Resets in {time}.', { time: formatCountdown(cd.label) })
                : t('Open the app to see details.'),
            alsoMarkFired: crossed.slice(0, -1).map((th) => ({ ruleId: idOf(th), cycleKey: ck })),
          });
        }
      }

      // --- a nearly used-up window resets: schedule "quota is back" for the reset moment ---
      const resetAt = m.resetsAt ? Date.parse(m.resetsAt) : NaN;
      const nearlyOut = Math.min(...settings.thresholds, 0.8);
      if (
        settings.windowReset &&
        cd &&
        !cd.elapsed &&
        Number.isFinite(resetAt) &&
        f >= nearlyOut &&
        !(ov && !ov.enabled)
      ) {
        events.push({
          ruleId: `${v.account.id}|${key}|window-reset`,
          cycleKey: cycleKey(v.account.id, m),
          kind: 'window-reset',
          accountId: v.account.id,
          title: t('{name}: {meter} has reset', { name, meter: meterName(m) }),
          body: t('The quota is available again.'),
          at: resetAt,
        });
      }

      // --- big reset coming up with most of the quota unused ---
      if (settings.resetSoon.enabled && cd && !cd.elapsed && !(ov && !ov.enabled)) {
        const hoursLeft = cd.ms / 3_600_000;
        if (hoursLeft <= settings.resetSoon.hours && f <= settings.resetSoon.maxUsedFraction) {
          events.push({
            ruleId: `${v.account.id}|${key}|reset-soon-unused`,
            cycleKey: cycleKey(v.account.id, m),
            kind: 'reset-soon-unused',
            accountId: v.account.id,
            title: t('{name}: {meter} resets soon', { name, meter: meterName(m) }),
            body: t('{pct} unused, resets in {time}.', {
              pct: pctText(1 - f),
              time: formatCountdown(cd.label),
            }),
          });
        }
      }
    }
  }
  return events;
}
