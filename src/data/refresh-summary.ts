import type { AccountView } from '@/data/summary';
import type { CycleResult } from '@/refresh/coordinator';
import type { RefreshOutcome } from '@/refresh/refresh-account';

/** What a manual refresh achieved, for the notice shown after the refresh button. */
export type RefreshSummary =
  | { kind: 'ok'; updated: number }
  | { kind: 'partial'; updated: number; failed: { name: string; message: string }[] }
  | { kind: 'timeout' };

export function accountName(v: AccountView): string {
  return v.meta?.id === 'relay' ? v.account.label : (v.meta?.name ?? v.account.providerId);
}

/**
 * Successes and failures of one refresh. Accounts skipped as legacy or read-only are neither: they
 * were never meant to refresh. A failure keeps the account's name and the short, translatable
 * reason the refresh recorded.
 */
export function summarizeOutcomes(
  outcomes: Record<string, RefreshOutcome>,
  views: AccountView[],
): RefreshSummary {
  const byId = new Map(views.map((v) => [v.account.id, v]));
  let updated = 0;
  const failed: { name: string; message: string }[] = [];
  for (const [id, o] of Object.entries(outcomes)) {
    if (o.type === 'ok') updated++;
    else if (o.type === 'failed') {
      const v = byId.get(id);
      failed.push({ name: v ? accountName(v) : id, message: o.message });
    }
  }
  return failed.length ? { kind: 'partial', updated, failed } : { kind: 'ok', updated };
}

export function summarizeCycle(result: CycleResult, views: AccountView[]): RefreshSummary {
  if (result.timedOut) return { kind: 'timeout' };
  return summarizeOutcomes(result.outcomes, views);
}
