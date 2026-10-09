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
  authExpired: boolean;
  /** notify the moment a time window that was used up (100%) resets */
  windowReset: boolean;
  /** notify when a Codex weekly window restarts well before its scheduled reset */
  earlyReset: boolean;
  /** remind before a paid plan renews or ends */
  renewal: { enabled: boolean; days: number };
  backgroundRefresh: boolean;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  thresholds: [0.8, 0.95],
  authExpired: true,
  windowReset: true,
  earlyReset: true,
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
    authExpired: s.authExpired ?? DEFAULT_ALERT_SETTINGS.authExpired,
    windowReset: s.windowReset ?? DEFAULT_ALERT_SETTINGS.windowReset,
    earlyReset: s.earlyReset ?? DEFAULT_ALERT_SETTINGS.earlyReset,
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

/** A window counts as used up once it reads as 100% (providers round, e.g. 99.6%). */
export const USED_UP = 0.995;

const pctText = (f: number) => `${formatNumber(Math.round(f * 100), 0)}%`;

function displayName(v: AccountView): string {
  const base = v.meta?.name ?? v.account.providerId;
  return v.account.label && v.account.label !== base
    ? t('{label} ({detail})', { label: base, detail: v.account.label })
    : base;
}

function meterName(m: Meter): string {
  return m.scope.type === 'model'
    ? t('{label} ({detail})', { label: t(m.label), detail: m.scope.name })
    : t(m.label);
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
        // short title (it is truncated on the lock screen); the account goes in the body
        title: t('Sign in again'),
        body: t('{name}: the login was rejected, usage cannot update.', { name }),
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
          title: t('Plan ends {date}', { date: formatDate(renewsAt) }),
          body:
            days <= 1
              ? t('{name}: ends or renews within a day.', { name })
              : t('{name}: ends or renews in {n} days.', { name, n: days }),
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
            title: t('{meter} at {pct}', { meter: meterName(m), pct: pctText(f) }),
            body:
              cd && !cd.elapsed
                ? t('{name}: resets in {time}.', { name, time: formatCountdown(cd.label) })
                : name,
            alsoMarkFired: crossed.slice(0, -1).map((th) => ({ ruleId: idOf(th), cycleKey: ck })),
          });
        }
      }

      // --- a used-up time window: count down to its reset, then say the quota is back ---
      // The only reset notice. It starts once a window reads 100%; an unused or partly used
      // window never gets one, even though an idle rolling window keeps reporting a reset time
      // a full window ahead. The dispatcher withdraws a pending notice once nothing asks for it.
      const resetAt = m.resetsAt ? Date.parse(m.resetsAt) : NaN;
      if (
        settings.windowReset &&
        cd &&
        !cd.elapsed &&
        Number.isFinite(resetAt) &&
        f >= USED_UP &&
        !(ov && !ov.enabled)
      ) {
        events.push({
          ruleId: `${v.account.id}|${key}|window-reset`,
          cycleKey: cycleKey(v.account.id, m),
          kind: 'window-reset',
          accountId: v.account.id,
          title: t('{meter} has reset', { meter: meterName(m) }),
          body: t('{name}: the quota is available again.', { name }),
          at: resetAt,
        });
      }
    }
  }
  return events;
}
