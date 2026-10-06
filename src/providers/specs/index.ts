// Declarative specs migrated from tools/probe. Field names marked "unverified" in
// docs/provider-api-auth.md must be confirmed with `node tools/probe/probe.mjs <id>`.
import type { HttpProviderSpec } from '@/core/spec-engine';

export const openrouter: HttpProviderSpec = {
  id: 'openrouter',
  auth: { type: 'bearer' },
  requests: [
    { name: 'key', url: 'https://openrouter.ai/api/v1/key' },
    // Account-wide credits require a management key; ordinary/PKCE keys still expose /key.
    { name: 'credits', url: 'https://openrouter.ai/api/v1/credits', optional: true },
  ],
  meters: [
    {
      id: 'credits',
      label: 'Credits balance',
      kind: 'balance',
      from: 'credits',
      value: { sub: ['data.total_credits', 'data.total_usage'] },
      unit: 'USD',
    },
    {
      id: 'key_limit',
      label: 'Key spend limit',
      kind: 'amount',
      from: 'key',
      requires: ['data.limit'],
      used: { coalesce: ['data.usage', 0] },
      limit: 'data.limit',
      unit: 'USD',
    },
    {
      id: 'usage_daily',
      label: 'Spend: today',
      kind: 'amount',
      from: 'key',
      used: 'data.usage_daily',
      unit: 'USD',
    },
    {
      id: 'usage_weekly',
      label: 'Spend: this week',
      kind: 'amount',
      from: 'key',
      used: 'data.usage_weekly',
      unit: 'USD',
    },
    {
      id: 'usage_monthly',
      label: 'Spend: this month',
      kind: 'amount',
      from: 'key',
      used: 'data.usage_monthly',
      unit: 'USD',
    },
  ],
};

export const poe: HttpProviderSpec = {
  id: 'poe',
  auth: { type: 'bearer' },
  requests: [
    { name: 'balance', url: 'https://api.poe.com/usage/current_balance' },
    { name: 'history', url: 'https://api.poe.com/usage/points_history', optional: true },
  ],
  meters: [
    {
      id: 'points',
      label: 'Points balance',
      kind: 'balance',
      from: 'balance',
      // official: GET /usage/current_balance -> { current_point_balance: <int> }
      value: 'current_point_balance',
      unit: 'points',
    },
  ],
};

export const kimiBalance: HttpProviderSpec = {
  id: 'kimi-balance',
  auth: { type: 'bearer' },
  variants: {
    intl: { host: 'api.moonshot.ai', currency: 'USD' },
    cn: { host: 'api.moonshot.cn', currency: 'CNY' },
  },
  defaultVariant: 'intl',
  requests: [{ name: 'balance', url: 'https://{host}/v1/users/me/balance' }],
  meters: [
    {
      id: 'balance',
      label: 'Available balance',
      kind: 'balance',
      from: 'balance',
      value: 'data.available_balance',
      unit: '{currency}',
    },
  ],
};

export const kimiCode: HttpProviderSpec = {
  id: 'kimi-code',
  auth: { type: 'bearer' },
  variants: { intl: { host: 'api.kimi.ai' }, cn: { host: 'api.kimi.com' } },
  defaultVariant: 'intl',
  requests: [{ name: 'usages', url: 'https://{host}/coding/v1/usages' }],
  meters: [
    {
      id: 'monthly',
      label: 'Monthly',
      kind: 'amount',
      from: 'usages',
      requires: ['usage.limit'],
      used: { coalesce: ['usage.used', { sub: ['usage.limit', 'usage.remaining'] }] },
      limit: 'usage.limit',
      unit: 'units',
      resetsAt: 'usage.resetTime',
    },
    {
      id: 'session',
      label: '5-hour window',
      kind: 'amount',
      from: 'usages',
      each: { path: 'limits' },
      requires: ['detail.limit'],
      used: { coalesce: ['detail.used', { sub: ['detail.limit', 'detail.remaining'] }] },
      limit: 'detail.limit',
      unit: 'units',
      resetsAt: 'detail.resetTime',
    },
  ],
};

export const runway: HttpProviderSpec = {
  id: 'runway',
  auth: { type: 'bearer' },
  requests: [
    {
      name: 'org',
      url: 'https://api.dev.runwayml.com/v1/organization',
      headers: { 'X-Runway-Version': '2024-11-06' },
    },
  ],
  meters: [
    {
      id: 'credits',
      label: 'API credit balance',
      kind: 'balance',
      from: 'org',
      value: 'creditBalance',
      unit: 'credits',
    },
  ],
};

export const zai: HttpProviderSpec = {
  id: 'zai',
  auth: { type: 'bearer' },
  variants: { intl: { host: 'api.z.ai' }, cn: { host: 'open.bigmodel.cn' } },
  defaultVariant: 'intl',
  requests: [{ name: 'quota', url: 'https://{host}/api/monitor/usage/quota/limit' }],
  meters: [
    {
      id: 'tokens',
      label: 'Tokens',
      kind: 'percent',
      from: 'quota',
      each: { path: 'data.limits', where: { type: 'TOKENS_LIMIT' } },
      // unit 3 = 5-hour window, 6 = weekly (community-reported; verify)
      idBy: {
        field: 'unit',
        map: { '3': 'session', '6': 'weekly' },
        labels: { session: '5-hour window', weekly: 'Weekly' },
        fallbackId: 'tokens_unit_{v}',
      },
      percent: 'percentage',
      resetsAt: 'nextResetTime',
    },
  ],
};

// MiniMax Coding Plan. Response shape from community tools (unverified, probe it):
// { model_remains: [{ model_name, current_interval_total_count, current_interval_usage_count (REMAINING),
//   start_time, end_time (ms) }] }. Weekly fields exist but their names are not documented yet.
export const minimax: HttpProviderSpec = {
  id: 'minimax',
  auth: { type: 'bearer' },
  variants: { intl: { host: 'platform.minimax.io' }, cn: { host: 'platform.minimaxi.com' } },
  defaultVariant: 'intl',
  requests: [{ name: 'remains', url: 'https://{host}/v1/api/openplatform/coding_plan/remains' }],
  meters: [
    {
      id: 'session',
      label: '5-hour window',
      kind: 'amount',
      from: 'remains',
      each: { path: 'model_remains' },
      requires: ['current_interval_total_count', 'current_interval_usage_count'],
      used: { sub: ['current_interval_total_count', 'current_interval_usage_count'] },
      limit: 'current_interval_total_count',
      unit: 'prompts',
      resetsAt: 'end_time',
      modelFrom: 'model_name',
    },
  ],
};

// Official DeepSeek balance API. Currency-specific meters avoid merging CNY and USD.
export const deepseek: HttpProviderSpec = {
  id: 'deepseek',
  auth: { type: 'bearer' },
  requests: [{ name: 'balance', url: 'https://api.deepseek.com/user/balance' }],
  meters: ['CNY', 'USD'].map((currency) => ({
    id: `balance_${currency.toLowerCase()}`,
    label: 'Available balance',
    kind: 'balance',
    from: 'balance',
    each: { path: 'balance_infos', where: { currency } },
    value: 'total_balance',
    unit: currency,
  })),
};

// Shape checked against the published command-code@1.74.3 CLI. /alpha is not a stable API.
export const commandGoat: HttpProviderSpec = {
  id: 'command-goat',
  auth: { type: 'bearer' },
  requests: [{ name: 'credits', url: 'https://api.commandcode.ai/alpha/billing/credits' }],
  meters: [
    ...['fiveHour', 'weekly'].map((window) => ({
      id: window === 'fiveHour' ? 'session' : 'weekly',
      label: window === 'fiveHour' ? '5-hour window' : 'Weekly',
      kind: 'amount' as const,
      from: 'credits',
      requires: [`windowLimits.${window}.used`, `windowLimits.${window}.cap`],
      used: `windowLimits.${window}.used`,
      limit: `windowLimits.${window}.cap`,
      resetsAt: `windowLimits.${window}.resetAt`,
      unit: 'USD',
    })),
    ...[
      ['monthlyCredits', 'Monthly credits remaining'],
      ['purchasedCredits', 'Purchased credits remaining'],
      ['freeCredits', 'Free credits remaining'],
    ].map(([field, label]) => ({
      id: field,
      label,
      kind: 'balance' as const,
      from: 'credits',
      value: `credits.${field}`,
      unit: 'USD',
    })),
  ],
};

// Official console route: packages/console/app/src/routes/zen/go/v1/usage.ts.
export const opencodeGo: HttpProviderSpec = {
  id: 'opencode-go',
  auth: { type: 'bearer' },
  requests: [{ name: 'usage', url: 'https://opencode.ai/zen/go/v1/usage' }],
  meters: ['rolling', 'weekly', 'monthly'].map((window) => ({
    id: window === 'rolling' ? 'session' : window,
    label: window === 'rolling' ? '5-hour window' : window === 'weekly' ? 'Weekly' : 'Monthly',
    kind: 'percent',
    from: 'usage',
    percent: `usage.${window}.percent`,
    resetsAt: `usage.${window}.resetsAt`,
  })),
};

export const specs = {
  openrouter,
  poe,
  kimiBalance,
  kimiCode,
  runway,
  zai,
  minimax,
  deepseek,
  commandGoat,
  opencodeGo,
};
