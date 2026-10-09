import type { AlertEvent } from '@/alerts/evaluate';
import type { AccountView } from '@/data/summary';
import { t } from '@/i18n';

/** What the last refresh saw of each Codex account's weekly window. */
export type WeeklySeen = Record<string, { resetsAt: number; used: number }>;

export const EARLY_RESET_KEY = 'early-reset:v1';

const HOUR = 3_600_000;

function displayName(v: AccountView): string {
  const base = v.meta?.name ?? v.account.providerId;
  return v.account.label && v.account.label !== base
    ? t('{label} ({detail})', { label: base, detail: v.account.label })
    : base;
}

/**
 * A Codex weekly window that restarted well before its scheduled reset: OpenAI reset the quota
 * early (usually a global reset). Detected from the account's own data only, by comparing with
 * the previous refresh:
 * - the new cycle ends more than an hour later than the old one did (a new window started), and
 * - the old cycle still had more than an hour to go (so it is not the normal reset), and
 * - usage went down from a window that was actually in use (at least 1%).
 * The first sighting of an account only records a baseline. Several accounts resetting together
 * give one notification. Returns the events and the state to store for the next refresh.
 */
export function detectEarlyResets(
  views: AccountView[],
  seen: WeeklySeen,
  now: Date,
  enabled: boolean,
): { events: AlertEvent[]; next: WeeklySeen } {
  const next: WeeklySeen = {};
  const hits: { view: AccountView; ruleId: string; cycleKey: string }[] = [];
  for (const v of views) {
    if (v.source !== 'auto' || v.account.providerId !== 'codex') continue;
    const m = v.snapshot?.meters.find((x) => x.id === 'weekly' && x.scope.type === 'overall');
    const at = m?.resetsAt ? Date.parse(m.resetsAt) : NaN;
    if (!m || m.kind.type !== 'percent' || !Number.isFinite(at)) continue;
    const id = v.account.id;
    const used = m.kind.used;
    next[id] = { resetsAt: at, used };
    const prev = seen[id];
    if (
      prev &&
      at > prev.resetsAt + HOUR &&
      now.getTime() < prev.resetsAt - HOUR &&
      prev.used >= 1 &&
      used < prev.used
    ) {
      hits.push({ view: v, ruleId: `${id}|weekly|early-reset`, cycleKey: `${id}:early:${at}` });
    }
  }
  if (!enabled || hits.length === 0) return { events: [], next };
  const [first, ...rest] = hits;
  return {
    events: [
      {
        ruleId: first.ruleId,
        cycleKey: first.cycleKey,
        kind: 'early-reset',
        accountId: first.view.account.id,
        title: t('Codex quota reset early'),
        body: t('{name}: the quota is available again.', {
          name: hits.map((h) => displayName(h.view)).join(', '),
        }),
        // the other accounts are covered by this one notification
        alsoMarkFired: rest.map((h) => ({ ruleId: h.ruleId, cycleKey: h.cycleKey })),
      },
    ],
    next,
  };
}
