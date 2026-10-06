import type { Repos } from '@/db/repos';

/** What the user pays for an account's plan per month; providers don't report prices. */
export interface Price {
  amount: number;
  currency: 'USD' | 'CNY';
}

const KEY = 'prices';

export async function getPrices(repos: Repos): Promise<Record<string, Price>> {
  const raw = await repos.settings.getJson<Record<string, Price>>(KEY, {});
  const out: Record<string, Price> = {};
  for (const [id, p] of Object.entries(raw ?? {})) {
    if (
      p &&
      typeof p.amount === 'number' &&
      p.amount > 0 &&
      (p.currency === 'USD' || p.currency === 'CNY')
    )
      out[id] = p;
  }
  return out;
}

/** Set or clear (`null`) the monthly price of one account. */
export async function setPrice(
  repos: Repos,
  accountId: string,
  price: Price | null,
): Promise<void> {
  const all = await getPrices(repos);
  if (price && price.amount > 0) all[accountId] = price;
  else delete all[accountId];
  await repos.settings.setJson(KEY, all);
}

export async function clearPrices(repos: Repos): Promise<void> {
  await repos.settings.setJson(KEY, {});
}
