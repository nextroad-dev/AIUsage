import type { AccountService } from '@/authkit/account-service';
import type { Credential } from '@/core/types';
import type { Account, Repos } from '@/db/repos';

/**
 * Demo data for trying the app on a real device without real subscriptions.
 *
 * Development builds only: set `EXPO_PUBLIC_MOCK_DATA=1` in `.env.local` and reload. A few
 * demo accounts are added (ids start with `mock-`), and network requests that carry a demo
 * credential get canned responses, so the real provider parsing, refresh, forecasts and alerts
 * all run. Requests from real accounts still reach the real services. Codex Reset odds are canned
 * too, once you opt in on a Codex details screen. Turning the flag off removes the demo accounts
 * on the next start. Release builds never include any of this (`__DEV__` is false).
 */
export const MOCK_DATA = __DEV__ && process.env.EXPO_PUBLIC_MOCK_DATA === '1';

const PREFIX = 'mock-';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Reset times stay put across refreshes (like a real window) by counting from app start. */
const START = Date.now();
const cycle = (now: number, period: number, firstAfter: number) => {
  let at = START + firstAfter;
  while (at <= now) at += period;
  return at;
};
const secs = (ms: number) => Math.floor(ms / 1000);

interface Demo {
  account: Omit<Account, 'sortOrder'>;
  cred: Credential;
}

const oauth = (token: string): Credential => ({
  type: 'oauth',
  accessToken: token,
  // far future, so no token refresh is attempted
  expiresAt: Date.now() + 365 * DAY,
  accountId: token,
});
const key = (token: string): Credential => ({ type: 'apiKey', key: token });

export const DEMOS: Demo[] = [
  {
    // busy: 5-hour window ahead of an even pace, weekly heading to run out before its reset
    account: {
      id: 'mock-codex-busy',
      providerId: 'codex',
      label: 'Demo busy',
      authMethod: 'oauthPkce',
      createdAt: 1,
    },
    cred: oauth('mock-codex-busy'),
  },
  {
    // idle: an unstarted 5-hour window keeps reporting a reset a full window ahead
    account: {
      id: 'mock-codex-idle',
      providerId: 'codex',
      label: 'Demo idle',
      authMethod: 'oauthPkce',
      createdAt: 2,
    },
    cred: oauth('mock-codex-idle'),
  },
  {
    // used up: the 5-hour window reads 100% and resets 3 minutes after launch (reset notice);
    // its weekly window then restarts early at 4 minutes (early-reset notice)
    account: {
      id: 'mock-codex-full',
      providerId: 'codex',
      label: 'Demo used up',
      authMethod: 'oauthPkce',
      createdAt: 3,
    },
    cred: oauth('mock-codex-full'),
  },
  {
    account: {
      id: 'mock-copilot',
      providerId: 'copilot',
      label: 'Demo',
      authMethod: 'apiKey',
      createdAt: 4,
    },
    cred: key('mock-copilot'),
  },
  {
    // the service rejects this token: shows the sign-in-again state
    account: {
      id: 'mock-copilot-expired',
      providerId: 'copilot',
      label: 'Demo expired',
      authMethod: 'apiKey',
      createdAt: 5,
    },
    cred: key('mock-copilot-expired'),
  },
  {
    account: {
      id: 'mock-openrouter',
      providerId: 'openrouter',
      label: 'Demo',
      authMethod: 'apiKey',
      createdAt: 6,
    },
    cred: key('mock-openrouter'),
  },
  {
    account: {
      id: 'mock-kimi',
      providerId: 'kimi-code',
      label: 'Demo',
      authMethod: 'apiKey',
      createdAt: 7,
    },
    cred: key('mock-kimi'),
  },
];

/** The used-up demo's weekly window restarts early 4 minutes after launch (early-reset notice). */
const EARLY_RESET_AT = 4 * MIN;

function codexUsage(token: string, now: number): unknown {
  const weekly = (used: number, firstAfter: number) => ({
    used_percent: used,
    limit_window_seconds: secs(7 * DAY),
    reset_at: secs(cycle(now, 7 * DAY, firstAfter)),
  });
  const fullWeekly = () =>
    now < START + EARLY_RESET_AT
      ? weekly(64, 4 * DAY)
      : {
          used_percent: 0,
          limit_window_seconds: secs(7 * DAY),
          reset_at: secs(START + EARLY_RESET_AT + 7 * DAY),
        };
  if (token === 'mock-codex-busy') {
    return {
      plan_type: 'plus',
      rate_limit: {
        primary_window: {
          used_percent: 72,
          limit_window_seconds: secs(5 * HOUR),
          reset_at: secs(cycle(now, 5 * HOUR, 2 * HOUR + 13 * MIN)),
        },
        secondary_window: weekly(81, 2 * DAY + 5 * HOUR),
      },
      credits: { balance: 12.4 },
    };
  }
  if (token === 'mock-codex-full' && now < START + 3 * MIN) {
    return {
      plan_type: 'pro',
      rate_limit: {
        primary_window: {
          used_percent: 100,
          limit_window_seconds: secs(5 * HOUR),
          reset_at: secs(START + 3 * MIN),
        },
        secondary_window: fullWeekly(),
      },
    };
  }
  // idle (and the used-up account after its reset): the window has not started
  return {
    plan_type: token === 'mock-codex-full' ? 'pro' : 'plus',
    rate_limit: {
      primary_window: {
        used_percent: 0,
        limit_window_seconds: secs(5 * HOUR),
        reset_after_seconds: secs(5 * HOUR),
        reset_at: secs(now + 5 * HOUR),
      },
      secondary_window: token === 'mock-codex-full' ? fullWeekly() : weekly(3, 6 * DAY + 20 * HOUR),
    },
    credits: { balance: 0 },
  };
}

function copilotUser(now: number): unknown {
  const d = new Date(now);
  return {
    copilot_plan: 'individual_pro',
    quota_reset_date_utc: new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1),
    ).toISOString(),
    quota_snapshots: {
      premium_interactions: { entitlement: 300, remaining: 90, unlimited: false },
      chat: { unlimited: true },
      completions: { unlimited: true },
    },
  };
}

function kimiUsages(now: number): unknown {
  return {
    usage: {
      limit: 2000,
      used: 1200,
      resetTime: new Date(cycle(now, 30 * DAY, 11 * DAY)).toISOString(),
    },
    limits: [
      {
        detail: {
          limit: 100,
          used: 90,
          resetTime: new Date(cycle(now, 5 * HOUR, 47 * MIN)).toISOString(),
        },
      },
    ],
  };
}

function route(
  url: string,
  token: string | undefined,
  now: number,
): { status: number; json?: unknown } | undefined {
  if (url === 'https://codex-reset.com/api/forecast') {
    return {
      status: 200,
      json: {
        probabilities: { rounded_24h: 22, rounded_48h: 41 },
        updated_at: new Date(now - 2 * MIN).toISOString(),
      },
    };
  }
  if (!token?.startsWith(PREFIX)) return undefined;
  if (token === 'mock-copilot-expired')
    return { status: 401, json: { message: 'Bad credentials' } };
  if (url === 'https://chatgpt.com/backend-api/wham/usage')
    return { status: 200, json: codexUsage(token, now) };
  if (url === 'https://api.github.com/copilot_internal/user')
    return { status: 200, json: copilotUser(now) };
  if (url === 'https://openrouter.ai/api/v1/key') {
    return {
      status: 200,
      json: {
        data: { limit: 20, usage: 13.5, usage_daily: 0.82, usage_weekly: 4.1, usage_monthly: 13.5 },
      },
    };
  }
  if (url === 'https://openrouter.ai/api/v1/credits') {
    return { status: 200, json: { data: { total_credits: 25, total_usage: 16.8 } } };
  }
  if (url.endsWith('/coding/v1/usages')) return { status: 200, json: kimiUsages(now) };
  return { status: 404 };
}

function bearer(init?: RequestInit): string | undefined {
  const h = new Headers(init?.headers);
  const auth = h.get('authorization');
  return auth?.replace(/^(Bearer|token)\s+/i, '');
}

/** Wraps the real fetch: demo credentials and Codex Reset get canned answers after a short delay. */
export function mockFetch(real: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const answer = route(url, bearer(init), Date.now());
    if (!answer) return real(input, init);
    // a little latency so loading states and pull to refresh are visible
    await new Promise((resolve) => setTimeout(resolve, 400 + Math.random() * 600));
    return new Response(answer.json === undefined ? '' : JSON.stringify(answer.json), {
      status: answer.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

/** Adds the demo accounts that are missing; removes them all when demo mode is off. Never throws. */
export async function syncMockAccounts(accounts: AccountService, repos: Repos): Promise<void> {
  try {
    const existing = new Set((await repos.accounts.list()).map((a) => a.id));
    if (!MOCK_DATA) {
      if (!__DEV__) return;
      for (const id of existing)
        if (id.startsWith(PREFIX)) await accounts.remove(id).catch(() => {});
      return;
    }
    for (const d of DEMOS) {
      if (!existing.has(d.account.id)) await accounts.add(d.account, d.cred).catch(() => {});
    }
  } catch {
    // demo data is a convenience; the app works without it
  }
}
