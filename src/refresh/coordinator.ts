import { dispatchAlerts, type Notifier } from '@/alerts/dispatch';
import { evaluateAlerts, mergeAlertSettings } from '@/alerts/evaluate';
import { loadViews } from '@/data/load';
import type { AccountView } from '@/data/summary';
import { refreshAll, type RefreshDeps, type RefreshOutcome } from '@/refresh/refresh-account';

export interface CycleDeps extends RefreshDeps {
  notifier: Notifier;
  /** receives the fresh views after each cycle, e.g. to update the home screen widget */
  publish?: (views: AccountView[], now: Date) => Promise<void>;
}

export interface CycleResult {
  outcomes: Record<string, RefreshOutcome>;
  alertsSent: number;
  pruned: boolean;
  /** the time budget ran out before every step finished */
  timedOut: boolean;
}

const DAY = 86_400_000;
const PRUNE_EVERY_MS = DAY;
const ALERT_STATE_KEEP_MS = 180 * DAY;

let running: Promise<CycleResult> | undefined;

/** Test hook: forget an in-flight cycle. */
export function resetCoordinatorForTests(): void {
  running = undefined;
}

async function maintenance(deps: CycleDeps): Promise<boolean> {
  const { repos, now } = deps;
  const nowMs = now().getTime();
  const last = Number((await repos.settings.get('lastPruneAt')) ?? 0);
  if (nowMs - last < PRUNE_EVERY_MS) return false;
  await repos.snapshots.prune(nowMs);
  await repos.alerts.pruneState(nowMs - ALERT_STATE_KEEP_MS);
  await repos.settings.set('lastPruneAt', String(nowMs));
  return true;
}

async function doCycle(deps: CycleDeps, force: boolean): Promise<Omit<CycleResult, 'timedOut'>> {
  const { repos, now } = deps;
  const outcomes = await refreshAll(deps, { force });
  const views = await loadViews(repos, now());
  const settings = mergeAlertSettings(await repos.settings.getJson('alerts', null));
  const events = evaluateAlerts({
    views: views.filter((v) => v.source === 'auto'),
    settings,
    overrides: await repos.alerts.rules(),
    now: now(),
  });
  const { sent } = await dispatchAlerts(events, {
    alerts: repos.alerts,
    notifier: deps.notifier,
    now: () => now().getTime(),
  });
  await deps.publish?.(views, now()).catch(() => {});
  const pruned = await maintenance(deps);
  return { outcomes, alertsSent: sent, pruned };
}

/**
 * One full cycle: refresh every account, evaluate alert rules against the fresh data, send due
 * notifications, then housekeeping (daily retention prune). Used by the foreground (app open,
 * pull to refresh) and the background task. Only one cycle runs at a time; callers arriving
 * while one is in flight share its result. `budgetMs` bounds how long the caller waits (iOS gives
 * background tasks well under a minute).
 */
export function runRefreshCycle(
  deps: CycleDeps,
  opts: { force?: boolean; budgetMs?: number } = {},
): Promise<CycleResult> {
  if (running) return running;
  const budget = opts.budgetMs ?? 25_000;
  const work = doCycle(deps, !!opts.force).then((r) => ({ ...r, timedOut: false }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<CycleResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ outcomes: {}, alertsSent: 0, pruned: false, timedOut: true }),
      budget,
    );
  });
  const p: Promise<CycleResult> = Promise.race([work, timeout])
    .catch(() => ({ outcomes: {}, alertsSent: 0, pruned: false, timedOut: false }) as CycleResult)
    .finally(() => {
      clearTimeout(timer);
    });
  running = p;
  // The slot is released when the real work ends, not when the budget expires, so a slow cycle
  // is never overlapped by a second one.
  work.then(
    () => (running = running === p ? undefined : running),
    () => (running = running === p ? undefined : running),
  );
  return p;
}
