import { AuthExpiredError } from '@/core/errors';
import { requestJson } from '@/core/http';
import type { Credential, FetchContext, Meter, ProviderPlugin, UsageSnapshot } from '@/core/types';

/**
 * Organisation spend on the OpenAI and Anthropic API platforms, from their official Admin APIs.
 * Neither platform exposes a prepaid balance or (outside Enterprise) a spend limit, so the meters
 * are this month's and today's spend.
 *
 * OpenAI (openai/openai-openapi `usage-costs`): `GET /v1/organization/costs?start_time=<unix s>
 *   &bucket_width=1d&limit<=180`, Admin API key as Bearer; `data[].results[].amount
 *   { value, currency: "usd" }`, paginated by `has_more` / `next_page`.
 * Anthropic (platform.claude.com, Get Cost Report): `GET /v1/organizations/cost_report?starting_at=
 *   <RFC 3339>&bucket_width=1d&limit<=31`, Admin key in `x-api-key` plus `anthropic-version`;
 *   `results[].amount` is a decimal string in cents, `currency` "USD".
 */

const MAX_PAGES = 4;

interface Bucket {
  start: number;
  amount: number;
  currency: string;
}

/** 00:00 UTC on the first of the month of `now`, and of the next month. */
export function monthBounds(now: Date): { start: Date; next: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, next };
}

/** This month's and today's spend (UTC days, as both platforms bucket them). */
export function spendMeters(buckets: Bucket[], now: Date): Meter[] {
  const { next } = monthBounds(now);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const currency = buckets.find((b) => b.currency)?.currency ?? 'USD';
  const sum = (list: Bucket[]) => Math.round(list.reduce((s, b) => s + b.amount, 0) * 100) / 100;
  const scope = { type: 'overall' as const };
  return [
    {
      id: 'month',
      label: 'Spend: this month',
      kind: { type: 'amount', used: sum(buckets), unit: currency },
      scope,
      resetsAt: next.toISOString(),
    },
    {
      id: 'today',
      label: 'Spend: today',
      kind: { type: 'amount', used: sum(buckets.filter((b) => b.start >= today)), unit: currency },
      scope,
      resetsAt: new Date(today + 86_400_000).toISOString(),
    },
  ];
}

const keyOf = (cred: Credential): string => {
  if (cred.type !== 'apiKey' || !cred.key.trim()) throw new AuthExpiredError('no admin key');
  return cred.key.trim();
};

function snapshot(
  providerId: string,
  accountId: string,
  buckets: Bucket[],
  ctx: FetchContext,
): UsageSnapshot {
  return {
    providerId,
    accountId,
    fetchedAt: ctx.now().toISOString(),
    meters: spendMeters(buckets, ctx.now()),
    status: { type: 'ok' },
  };
}

export function openaiPlatformPlugin(): ProviderPlugin {
  return {
    id: 'openai-platform',
    async fetchUsage(accountId, cred, ctx) {
      const key = keyOf(cred);
      const { start } = monthBounds(ctx.now());
      const buckets: Bucket[] = [];
      let page: string | undefined;
      for (let i = 0; i < MAX_PAGES; i++) {
        const q = new URLSearchParams({
          start_time: String(Math.floor(start.getTime() / 1000)),
          bucket_width: '1d',
          limit: '31',
        });
        if (page) q.set('page', page);
        const res = await requestJson(`https://api.openai.com/v1/organization/costs?${q}`, {
          headers: { Authorization: `Bearer ${key}` },
          fetch: ctx.fetch,
          // a project key gets 403 here: it is the wrong kind of key, not a temporary failure
          forbiddenIsAuth: true,
        });
        const body = res.json as { data?: unknown; has_more?: unknown; next_page?: unknown };
        if (!Array.isArray(body?.data)) {
          return {
            ...snapshot('openai-platform', accountId, [], ctx),
            meters: [],
            status: { type: 'unsupported' },
          };
        }
        for (const b of body.data as { start_time?: number; results?: unknown }[]) {
          for (const r of Array.isArray(b.results) ? b.results : []) {
            const amount = (r as { amount?: { value?: unknown; currency?: unknown } }).amount;
            const value = typeof amount?.value === 'number' ? amount.value : Number(amount?.value);
            if (!Number.isFinite(value)) continue;
            buckets.push({
              start: (b.start_time ?? 0) * 1000,
              amount: value,
              currency:
                typeof amount?.currency === 'string' ? amount.currency.toUpperCase() : 'USD',
            });
          }
        }
        if (body.has_more !== true || typeof body.next_page !== 'string') break;
        page = body.next_page;
      }
      return snapshot('openai-platform', accountId, buckets, ctx);
    },
  };
}

export function anthropicPlatformPlugin(): ProviderPlugin {
  return {
    id: 'anthropic-platform',
    async fetchUsage(accountId, cred, ctx) {
      const key = keyOf(cred);
      const { start } = monthBounds(ctx.now());
      const buckets: Bucket[] = [];
      let page: string | undefined;
      for (let i = 0; i < MAX_PAGES; i++) {
        const q = new URLSearchParams({
          starting_at: start.toISOString().replace('.000Z', 'Z'),
          bucket_width: '1d',
          limit: '31',
        });
        if (page) q.set('page', page);
        const res = await requestJson(
          `https://api.anthropic.com/v1/organizations/cost_report?${q}`,
          {
            headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
            fetch: ctx.fetch,
            forbiddenIsAuth: true,
          },
        );
        const body = res.json as { data?: unknown; has_more?: unknown; next_page?: unknown };
        if (!Array.isArray(body?.data)) {
          return {
            ...snapshot('anthropic-platform', accountId, [], ctx),
            meters: [],
            status: { type: 'unsupported' },
          };
        }
        for (const b of body.data as { starting_at?: string; results?: unknown }[]) {
          const bucketStart = b.starting_at ? Date.parse(b.starting_at) : NaN;
          for (const r of Array.isArray(b.results) ? b.results : []) {
            const row = r as { amount?: unknown; currency?: unknown };
            const cents = Number(row.amount);
            if (!Number.isFinite(cents)) continue;
            buckets.push({
              start: Number.isFinite(bucketStart) ? bucketStart : 0,
              amount: cents / 100,
              currency: typeof row.currency === 'string' ? row.currency.toUpperCase() : 'USD',
            });
          }
        }
        if (body.has_more !== true || typeof body.next_page !== 'string') break;
        page = body.next_page;
      }
      return snapshot('anthropic-platform', accountId, buckets, ctx);
    },
  };
}
