import { AuthExpiredError } from '@/core/errors';
import { relayMeters, relayPlugin } from '@/providers/relay';
import {
  htmlTitle,
  newApiDisplay,
  inspectProvider,
  normalizeBaseUrl,
  refreshBilling,
} from '@/providers/relay/inspect';
import { ctxWith, fakeFetch, type FakeRoute } from '@/test-utils/fetch';

const BASE = 'https://api.example.com';
const at = (routes: Record<string, FakeRoute>) =>
  fakeFetch(Object.fromEntries(Object.entries(routes).map(([p, r]) => [`${BASE}${p}`, r])));
const inspect = (f: ReturnType<typeof fakeFetch>, key = 'sk-test') =>
  inspectProvider({ baseUrl: BASE, apiKey: key, fetch: f.fetch, timeoutMs: 1000 });

const newApiSite = {
  '/api/status': {
    json: {
      success: true,
      data: { system_name: '小猫 API', version: 'v0.9.7', quota_per_unit: 500_000 },
    },
  },
  '/api/usage/token/': {
    json: {
      code: true,
      data: {
        object: 'token_usage',
        total_granted: 10_000_000,
        total_used: 1_710_000,
        total_available: 8_290_000,
        unlimited_quota: false,
      },
    },
  },
  '/v1/models': { json: { object: 'list', data: [{ id: 'gpt-4o' }] } },
};

describe('relay inspection', () => {
  it('recognises New API, its site name and the key balance in dollars', async () => {
    const r = await inspect(at(newApiSite));
    expect(r.provider).toMatchObject({
      type: 'new-api',
      name: '小猫 API',
      version: 'v0.9.7',
      baseUrl: BASE,
    });
    expect(r.provider.confidence).toBeGreaterThanOrEqual(0.95);
    expect(r.billing).toEqual({
      supported: true,
      currency: 'USD',
      unlimited: false,
      total: 20,
      used: 3.42,
      remaining: 16.58,
    });
    expect(r.key.valid).toBe(true);
    expect(r.capabilities).toEqual({ models: true, balance: true });
    expect(r.adapter).toBe('new-api');
  });

  it('recognises Sub2API from its public settings and usage endpoint', async () => {
    const r = await inspect(
      at({
        '/api/v1/settings/public': { json: { data: { site_name: 'Jude AI', version: '1.2.0' } } },
        '/v1/usage': { json: { remaining: 12.34, unit: 'USD', usage: { total: { cost: 3.21 } } } },
        '/v1/sub2api/billing': { status: 401 },
      }),
    );
    expect(r.provider).toMatchObject({ type: 'sub2api', name: 'Jude AI', version: '1.2.0' });
    expect(r.provider.confidence).toBe(1);
    expect(r.billing).toMatchObject({ supported: true, remaining: 12.34, used: 3.21 });
  });

  it('reads a Sub2API quota object when the site reports one', async () => {
    const r = await inspect(
      at({
        '/api/v1/settings/public': { json: { data: { site_name: 'Q' } } },
        '/v1/usage': { json: { quota: { used: 10, limit: 50, remaining: 40 } } },
      }),
    );
    expect(r.billing).toMatchObject({ total: 50, used: 10, remaining: 40, currency: 'USD' });
  });

  it('falls back to One API billing and takes the name from the page title', async () => {
    const r = await inspect(
      at({
        '/': { text: '<html><head><title>Old Relay</title></head></html>' },
        '/v1/dashboard/billing/subscription': { json: { hard_limit_usd: 100 } },
        '/v1/dashboard/billing/usage': { json: { total_usage: 2350 } },
      }),
    );
    expect(r.provider).toMatchObject({ type: 'one-api', name: 'Old Relay' });
    expect(r.billing).toMatchObject({ total: 100, used: 23.5, remaining: 76.5 });
  });

  it('finds billing routes without the /v1 prefix and names the site after its host', async () => {
    const r = await inspect(
      at({
        '/v1/models': { json: { data: [] } },
        '/dashboard/billing/subscription': { json: { hard_limit_usd: 5 } },
        '/dashboard/billing/usage': { json: { total_usage: 100 } },
      }),
    );
    expect(r.provider).toMatchObject({ type: 'openai-compatible', name: 'api.example.com' });
    expect(r.billing).toMatchObject({ supported: true, total: 5, used: 1, remaining: 4 });
  });

  it('reports a rejected key and a site without any balance', async () => {
    const rejected = await inspect(
      at({
        '/api/status': newApiSite['/api/status'],
        '/api/usage/token/': { status: 401 },
        '/v1/models': { status: 401 },
      }),
    );
    expect(rejected.key.valid).toBe(false);
    expect(rejected.billing.supported).toBe(false);

    const unknown = await inspect(at({}));
    expect(unknown.provider).toMatchObject({ type: 'unknown', confidence: 0 });
    expect(unknown.key.valid).toBeNull();
  });

  it('sends the key only as a Bearer header, never to public probes', async () => {
    const f = at(newApiSite);
    await inspect(f, 'sk-secret');
    const keyed = f.calls.filter((c) => c.headers.Authorization);
    expect(keyed.every((c) => c.headers.Authorization === 'Bearer sk-secret')).toBe(true);
    expect(
      f.calls.find((c) => c.url === `${BASE}/api/status`)?.headers.Authorization,
    ).toBeUndefined();
    expect(f.calls.every((c) => !c.url.includes('sk-secret'))).toBe(true);
    // each path is requested once, however many adapters look at it
    const urls = f.calls.map((c) => c.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe('New API display currency', () => {
  it('shows the balance in the currency the site is configured for', async () => {
    const r = await inspect(
      at({
        ...newApiSite,
        '/api/status': {
          json: {
            success: true,
            data: {
              system_name: 'CN Relay',
              quota_per_unit: 500_000,
              quota_display_type: 'CNY',
              usd_exchange_rate: 7.3,
            },
          },
        },
      }),
    );
    // $16.58 at 7.3 CNY per USD
    expect(r.billing).toMatchObject({ currency: 'CNY', remaining: 121.034, total: 146 });
  });

  it('covers custom symbols, raw tokens, the legacy flag and missing rates', () => {
    expect(newApiDisplay({ quota_per_unit: 500_000 })).toEqual({
      currency: 'USD',
      factor: 0.000002,
    });
    expect(
      newApiDisplay({
        quota_per_unit: 500_000,
        quota_display_type: 'CUSTOM',
        custom_currency_symbol: '点',
        custom_currency_exchange_rate: 10,
      }),
    ).toEqual({ currency: '点', factor: 0.00002 });
    expect(newApiDisplay({ quota_display_type: 'TOKENS' })).toEqual({
      currency: 'tokens',
      factor: 1,
    });
    expect(newApiDisplay({ display_in_currency: false })).toEqual({
      currency: 'tokens',
      factor: 1,
    });
    // CNY without a rate cannot be converted honestly
    expect(newApiDisplay({ quota_display_type: 'CNY' }).currency).toBe('USD');
  });
});

describe('relay helpers', () => {
  it('normalises the address the user typed', () => {
    expect(normalizeBaseUrl(' api.example.com/ ')).toBe(BASE);
    expect(normalizeBaseUrl('https://api.example.com/v1')).toBe(BASE);
    expect(normalizeBaseUrl('http://192.168.1.5:3000/api/')).toBe('http://192.168.1.5:3000');
    expect(normalizeBaseUrl('https://x.dev/relay/v1')).toBe('https://x.dev/relay');
    expect(() => normalizeBaseUrl('  ')).toThrow();
  });

  it('reads page titles', () => {
    expect(htmlTitle('<title>A &amp; B</title>')).toBe('A & B');
    expect(htmlTitle('<p>none</p>')).toBeUndefined();
  });

  it('maps billing to one meter: quota with a limit, else balance, else usage', () => {
    expect(
      relayMeters({ supported: true, total: 20, used: 3.42, remaining: 16.58 })[0].kind,
    ).toEqual({
      type: 'amount',
      used: 3.42,
      limit: 20,
      unit: 'USD',
    });
    expect(relayMeters({ supported: true, remaining: 12.34, currency: 'CNY' })[0].kind).toEqual({
      type: 'balance',
      value: 12.34,
      unit: 'CNY',
    });
    expect(relayMeters({ supported: true, unlimited: true, used: 2 })[0].kind).toEqual({
      type: 'amount',
      used: 2,
      unit: 'USD',
    });
    expect(relayMeters({ supported: false })).toEqual([]);
  });
});

describe('relay refresh', () => {
  it('uses the saved adapter without re-detecting', async () => {
    const f = at(newApiSite);
    const r = await refreshBilling({
      baseUrl: BASE,
      apiKey: 'sk-test',
      adapter: 'new-api',
      fetch: f.fetch,
      timeoutMs: 1000,
    });
    expect(r).toMatchObject({ adapter: 'new-api', billing: { remaining: 16.58 } });
    expect(f.calls.map((c) => c.url.replace(BASE, '')).sort()).toEqual([
      '/api/status',
      '/api/usage/token/',
    ]);
  });

  it('re-detects when the saved adapter no longer works', async () => {
    const f = at({
      '/api/v1/settings/public': { json: { data: { site_name: 'Moved' } } },
      '/v1/usage': { json: { remaining: 3 } },
    });
    const r = await refreshBilling({
      baseUrl: BASE,
      apiKey: 'k',
      adapter: 'new-api',
      fetch: f.fetch,
      timeoutMs: 1000,
    });
    expect(r).toMatchObject({ adapter: 'sub2api', billing: { remaining: 3 } });
  });

  it('turns a rejected key into an expired login for the account', async () => {
    const f = at({ '/v1/models': { status: 401 }, '/api/usage/token/': { status: 401 } });
    await expect(
      relayPlugin().fetchUsage(
        'a',
        { type: 'apiKey', key: 'k', baseUrl: BASE, adapter: 'new-api' },
        ctxWith(f.fetch),
      ),
    ).rejects.toBeInstanceOf(AuthExpiredError);
  });
});
