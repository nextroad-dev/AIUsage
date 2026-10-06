import { forecastExhaustion } from '@/core/forecast';
import type { UsageSnapshot } from '@/core/types';
import type { Repos } from '@/db/repos';
import { getPrices } from '@/data/prices';
import type { AccountView } from '@/data/summary';
import { providerById } from '@/providers/registry';
import { loadSnapshot } from '@/refresh/refresh-account';

/** Everything the overview needs. Legacy manual/session accounts are historical and read-only. */
export async function loadViews(repos: Repos, now: Date): Promise<AccountView[]> {
  const accounts = await repos.accounts.list();
  const prices = await getPrices(repos);
  return Promise.all(
    accounts.map(async (account) => {
      const legacy =
        !!account.manual ||
        account.authMethod === 'manual' ||
        account.authMethod === 'webviewSession';
      const snapshot = await loadSnapshot(repos, account.id, now);
      return {
        account,
        meta: providerById(account.providerId),
        snapshot,
        health: legacy ? null : await repos.health.get(account.id),
        source: legacy ? ('legacy' as const) : ('auto' as const),
        price: prices[account.id],
        forecasts: legacy || !snapshot ? undefined : await forecasts(repos, snapshot, now),
      };
    }),
  );
}

async function forecasts(
  repos: Repos,
  snapshot: UsageSnapshot,
  now: Date,
): Promise<Record<string, number>> {
  const samples = await repos.snapshots.cycleSamples(snapshot.accountId, snapshot.meters);
  const out: Record<string, number> = {};
  for (const m of snapshot.meters) {
    const key = `${m.id}${m.scope.type === 'model' ? `:${m.scope.name}` : ''}`;
    const at = forecastExhaustion(m, samples[key] ?? [], now.getTime());
    if (at !== undefined) out[key] = at;
  }
  return out;
}

export async function loadView(
  repos: Repos,
  accountId: string,
  now: Date,
): Promise<AccountView | null> {
  return (await loadViews(repos, now)).find((v) => v.account.id === accountId) ?? null;
}
