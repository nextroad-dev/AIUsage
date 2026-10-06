/**
 * API relay ("中转站") inspector: from a base URL and an API key, recognise the relay software,
 * its site name and how to read the key's balance, and normalise the result.
 *
 *   URL + key → probes (cached, short timeouts, staged and concurrent) → fingerprint scores
 *   → adapter → metadata (site name, version) → billing → normalised result
 *
 * Runs on the user's device and talks only to the URL the user entered, so the server-side SSRF
 * concerns of a hosted inspector do not apply; a self-hosted relay on the LAN works too. The key
 * is sent only as a Bearer header to that host and is never logged or returned.
 *
 * Endpoint shapes follow the relay projects' public handlers:
 * - New API: GET /api/status (system_name, version, quota_per_unit) and GET /api/usage/token/
 *   (`object: "token_usage"`, quota in units of quota_per_unit)
 * - Sub2API: GET /api/v1/settings/public (site_name) and GET /v1/usage (remaining / quota / usage)
 * - One API and forks: OpenAI-style GET /v1/dashboard/billing/subscription (hard_limit_usd) and
 *   /v1/dashboard/billing/usage (total_usage in cents), also without the /v1 prefix
 * - any OpenAI-compatible endpoint: GET /v1/models
 */

export type RelayType = 'new-api' | 'sub2api' | 'one-api' | 'openai-compatible' | 'unknown';

export interface BillingInfo {
  supported: boolean;
  currency?: string;
  total?: number;
  used?: number;
  remaining?: number;
  unlimited?: boolean;
}

export interface RelayInspection {
  provider: {
    type: RelayType;
    name: string;
    baseUrl: string;
    version?: string;
    confidence: number;
  };
  billing: BillingInfo;
  /** null when no probe could tell either way (e.g. every key endpoint is disabled) */
  key: { valid: boolean | null };
  capabilities: { models: boolean; balance: boolean };
  /** the adapter to use on later refreshes */
  adapter: RelayType;
}

export interface ProbeResponse {
  /** HTTP status; 0 for network errors and timeouts */
  status: number;
  json?: unknown;
  text?: string;
}

export const PROBE_TIMEOUT_MS = 4000;
/** New API's default quota units per US dollar */
export const DEFAULT_QUOTA_PER_UNIT = 500_000;

// ---------------------------------------------------------------- URL & probe client

/** Trims, adds https:// when missing, drops trailing slashes and a trailing /v1 or /api. */
export function normalizeBaseUrl(input: string): string {
  let s = input.trim();
  if (!s) throw new Error('empty base URL');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const url = new URL(s);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported scheme');
  let path = url.pathname.replace(/\/+$/, '');
  path = path.replace(/\/(v1|api)$/i, '');
  return `${url.protocol}//${url.host}${path}`;
}

export interface DetectContext {
  baseUrl: string;
  apiKey: string;
  fetch: typeof fetch;
  cache: Map<string, Promise<ProbeResponse>>;
  timeoutMs: number;
}

export function createContext(
  baseUrl: string,
  apiKey: string,
  doFetch: typeof fetch,
  timeoutMs = PROBE_TIMEOUT_MS,
): DetectContext {
  return { baseUrl, apiKey, fetch: doFetch, cache: new Map(), timeoutMs };
}

/** GET a path once per inspection; later callers share the same response. Never throws. */
export function probe(ctx: DetectContext, path: string, auth: boolean): Promise<ProbeResponse> {
  const key = `${auth ? 'k' : 'p'}:${path}`;
  const hit = ctx.cache.get(key);
  if (hit) return hit;
  const run = (async (): Promise<ProbeResponse> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ctx.timeoutMs);
    try {
      const res = await ctx.fetch(`${ctx.baseUrl}${path}`, {
        method: 'GET',
        headers: {
          Accept: path === '/' ? 'text/html,application/json' : 'application/json',
          ...(auth ? { Authorization: `Bearer ${ctx.apiKey}` } : {}),
        },
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = undefined;
      }
      return { status: res.status, json, text };
    } catch {
      return { status: 0 };
    } finally {
      clearTimeout(timer);
    }
  })();
  ctx.cache.set(key, run);
  return run;
}

// ---------------------------------------------------------------- helpers

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : undefined;
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** `{ success|code, data }` envelopes and plain payloads alike. */
function dataOf(r: ProbeResponse): Obj | undefined {
  if (r.status < 200 || r.status >= 300 || !isObj(r.json)) return undefined;
  const j = r.json;
  return isObj(j.data) ? j.data : j;
}

const ok = (r: ProbeResponse) => r.status >= 200 && r.status < 300;
/** the route exists even if this key may not use it */
const exists = (r: ProbeResponse) => ok(r) || r.status === 401 || r.status === 403;

export function htmlTitle(html: string | undefined): string | undefined {
  const m = html?.match(/<title[^>]*>([^<]{1,120})<\/title>/i);
  return m
    ? str(
        m[1]
          .replace(/&amp;/g, '&')
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"'),
      )
    : undefined;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

// ---------------------------------------------------------------- adapters

export interface RelayAdapter {
  type: RelayType;
  /** fingerprint score from the probes (higher is more certain) */
  detect(ctx: DetectContext): Promise<number>;
  billing(ctx: DetectContext): Promise<BillingInfo>;
}

const unsupported: BillingInfo = { supported: false };

const newApi: RelayAdapter = {
  type: 'new-api',
  async detect(ctx) {
    const [status, token] = await Promise.all([
      probe(ctx, '/api/status', false),
      probe(ctx, '/api/usage/token/', true),
    ]);
    const s = dataOf(status);
    let score = 0;
    if (s && num(s.quota_per_unit) !== undefined) score += 30;
    if (s && str(s.system_name)) score += 10;
    if (dataOf(token)?.object === 'token_usage') score += 60;
    return score;
  },
  async billing(ctx) {
    const [status, token] = await Promise.all([
      probe(ctx, '/api/status', false),
      probe(ctx, '/api/usage/token/', true),
    ]);
    const d = dataOf(token);
    if (!d || d.object !== 'token_usage') return oneApi.billing(ctx);
    const s = dataOf(status);
    const display = newApiDisplay(s);
    const unlimited = d.unlimited_quota === true;
    const granted = num(d.total_granted);
    const used = num(d.total_used);
    const available = num(d.total_available);
    const conv = (q: number | undefined) =>
      q === undefined ? undefined : round(q * display.factor);
    return {
      supported: used !== undefined || available !== undefined,
      currency: display.currency,
      unlimited,
      total: unlimited ? undefined : conv(granted),
      used: conv(used),
      remaining: unlimited ? undefined : conv(available),
    };
  },
};

/**
 * How the site itself shows quota (New API `/api/status`): USD by default, CNY at the site's
 * `usd_exchange_rate`, a custom symbol at `custom_currency_exchange_rate`, or raw tokens. Older
 * versions only have `display_in_currency`. Returns the multiplier from raw quota units.
 */
export function newApiDisplay(s: Obj | undefined): { currency: string; factor: number } {
  const perUnit = num(s?.quota_per_unit) || DEFAULT_QUOTA_PER_UNIT;
  const usd = 1 / perUnit;
  const type =
    str(s?.quota_display_type)?.toUpperCase() ??
    (s?.display_in_currency === false ? 'TOKENS' : 'USD');
  if (type === 'TOKENS') return { currency: 'tokens', factor: 1 };
  if (type === 'CNY') {
    const rate = num(s?.usd_exchange_rate);
    // without a rate the CNY figure cannot be derived; stay truthful in dollars
    return rate && rate > 0
      ? { currency: 'CNY', factor: rate / perUnit }
      : { currency: 'USD', factor: usd };
  }
  if (type === 'CUSTOM') {
    const rate = num(s?.custom_currency_exchange_rate);
    const symbol = str(s?.custom_currency_symbol);
    return rate && rate > 0 && symbol
      ? { currency: symbol, factor: rate / perUnit }
      : { currency: 'USD', factor: usd };
  }
  return { currency: 'USD', factor: usd };
}

const sub2api: RelayAdapter = {
  type: 'sub2api',
  async detect(ctx) {
    const [settings, usage] = await Promise.all([
      probe(ctx, '/api/v1/settings/public', false),
      probe(ctx, '/v1/usage', true),
    ]);
    let score = 0;
    if (str(dataOf(settings)?.site_name)) score += 50;
    const u = dataOf(usage);
    if (u && (u.remaining !== undefined || isObj(u.quota) || isObj(u.usage))) score += 30;
    // only worth a request once the site already looks like Sub2API
    if (score > 0 && exists(await probe(ctx, '/v1/sub2api/billing', true))) score += 50;
    return score;
  },
  async billing(ctx) {
    const u = dataOf(await probe(ctx, '/v1/usage', true));
    if (!u) return unsupported;
    const quota = isObj(u.quota) ? u.quota : undefined;
    const usage = isObj(u.usage) && isObj(u.usage.total) ? u.usage.total : undefined;
    const total = num(quota?.limit);
    const used = num(quota?.used) ?? num(usage?.cost);
    const remaining = num(u.remaining) ?? num(quota?.remaining);
    if (total === undefined && used === undefined && remaining === undefined) return unsupported;
    return {
      supported: true,
      currency: str(u.unit) ?? 'USD',
      total,
      used:
        used ??
        (total !== undefined && remaining !== undefined ? round(total - remaining) : undefined),
      remaining:
        remaining ?? (total !== undefined && used !== undefined ? round(total - used) : undefined),
    };
  },
};

/** OpenAI-style dashboard billing, with and without the /v1 prefix. */
async function dashboardBilling(ctx: DetectContext): Promise<BillingInfo> {
  for (const prefix of ['/v1', '']) {
    const sub = dataOf(await probe(ctx, `${prefix}/dashboard/billing/subscription`, true));
    const limit = num(sub?.hard_limit_usd) ?? num(sub?.system_hard_limit_usd);
    if (limit === undefined) continue;
    const usage = dataOf(await probe(ctx, `${prefix}/dashboard/billing/usage`, true));
    const cents = num(usage?.total_usage);
    const used = cents === undefined ? undefined : round(cents / 100);
    // One API reports a huge limit for unlimited keys
    const unlimited = limit >= 100_000_000;
    return {
      supported: true,
      currency: 'USD',
      unlimited,
      total: unlimited ? undefined : limit,
      used,
      remaining: unlimited || used === undefined ? undefined : round(limit - used),
    };
  }
  return unsupported;
}

const oneApi: RelayAdapter = {
  type: 'one-api',
  async detect(ctx) {
    const sub = dataOf(await probe(ctx, '/v1/dashboard/billing/subscription', true));
    return sub && num(sub.hard_limit_usd) !== undefined ? 40 : 0;
  },
  billing: dashboardBilling,
};

const openaiCompatible: RelayAdapter = {
  type: 'openai-compatible',
  async detect(ctx) {
    const models = dataOf(await probe(ctx, '/v1/models', true));
    return models && Array.isArray(models.data) ? 10 : 0;
  },
  // nothing specific to read; many such sites still answer the dashboard billing routes
  billing: dashboardBilling,
};

export const ADAPTERS: RelayAdapter[] = [sub2api, newApi, oneApi, openaiCompatible];

export const adapterFor = (type: string): RelayAdapter | undefined =>
  ADAPTERS.find((a) => a.type === type);

// ---------------------------------------------------------------- metadata & key

async function siteName(ctx: DetectContext): Promise<string> {
  const [settings, status, home] = await Promise.all([
    probe(ctx, '/api/v1/settings/public', false),
    probe(ctx, '/api/status', false),
    probe(ctx, '/', false),
  ]);
  return (
    str(dataOf(settings)?.site_name) ??
    str(dataOf(status)?.system_name) ??
    htmlTitle(home.text) ??
    new URL(ctx.baseUrl).host
  );
}

async function siteVersion(ctx: DetectContext): Promise<string | undefined> {
  const [status, settings] = await Promise.all([
    probe(ctx, '/api/status', false),
    probe(ctx, '/api/v1/settings/public', false),
  ]);
  return str(dataOf(status)?.version) ?? str(dataOf(settings)?.version);
}

/** Valid if any key endpoint accepted it, invalid only if every one that exists refused it. */
async function keyValidity(ctx: DetectContext): Promise<boolean | null> {
  const paths = [
    '/v1/models',
    '/api/usage/token/',
    '/v1/usage',
    '/v1/dashboard/billing/subscription',
  ];
  const results = await Promise.all(paths.map((p) => probe(ctx, p, true)));
  if (results.some(ok)) return true;
  const answered = results.filter((r) => r.status === 401 || r.status === 403);
  return answered.length > 0 ? false : null;
}

// ---------------------------------------------------------------- inspect

export interface InspectInput {
  baseUrl: string;
  apiKey: string;
  fetch: typeof fetch;
  timeoutMs?: number;
}

/**
 * Full inspection for adding a relay: public probes and key probes run concurrently, every
 * adapter scores the shared (cached) responses, the best one reads the balance.
 */
export async function inspectProvider(input: InspectInput): Promise<RelayInspection> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const ctx = createContext(baseUrl, input.apiKey.trim(), input.fetch, input.timeoutMs);

  // stage 1 + 2: public fingerprints and key capabilities, all at once
  await Promise.all([
    probe(ctx, '/api/status', false),
    probe(ctx, '/api/v1/settings/public', false),
    probe(ctx, '/', false),
    probe(ctx, '/api/usage/token/', true),
    probe(ctx, '/v1/usage', true),
    probe(ctx, '/v1/dashboard/billing/subscription', true),
    probe(ctx, '/v1/models', true),
  ]);

  const scored = await Promise.all(ADAPTERS.map(async (a) => ({ a, score: await a.detect(ctx) })));
  scored.sort((x, y) => y.score - x.score);
  const best = scored[0];
  const type: RelayType = best && best.score > 0 ? best.a.type : 'unknown';

  // stage 3: only what the chosen adapter needs
  const [billing, name, version, valid, models] = await Promise.all([
    best && best.score > 0 ? best.a.billing(ctx) : dashboardBilling(ctx),
    siteName(ctx),
    siteVersion(ctx),
    keyValidity(ctx),
    probe(ctx, '/v1/models', true),
  ]);

  return {
    provider: {
      type,
      name,
      baseUrl,
      version,
      confidence: best ? Math.min(1, best.score / 100) : 0,
    },
    billing,
    key: { valid },
    capabilities: {
      models: Array.isArray(dataOf(models)?.data),
      balance: billing.supported,
    },
    adapter: type,
  };
}

/**
 * Refresh: read the balance with the saved adapter only; fall back to a full inspection when that
 * fails (the site was upgraded or moved to different software).
 */
export async function refreshBilling(input: InspectInput & { adapter?: string }): Promise<{
  billing: BillingInfo;
  adapter: RelayType;
  keyRejected: boolean;
}> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const saved = input.adapter ? adapterFor(input.adapter) : undefined;
  if (saved) {
    const ctx = createContext(baseUrl, input.apiKey.trim(), input.fetch, input.timeoutMs);
    const billing = await saved.billing(ctx);
    if (billing.supported) return { billing, adapter: saved.type, keyRejected: false };
  }
  const full = await inspectProvider({ ...input, baseUrl });
  return { billing: full.billing, adapter: full.adapter, keyRejected: full.key.valid === false };
}

export const RELAY_TYPE_NAMES: Record<RelayType, string> = {
  'new-api': 'New API',
  sub2api: 'Sub2API',
  'one-api': 'One API',
  'openai-compatible': 'OpenAI Compatible',
  unknown: 'Unknown',
};
