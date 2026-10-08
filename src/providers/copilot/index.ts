import type { DeviceFlowConfig } from '@/authkit/device-flow';
import { requestJson } from '@/core/http';
import { getPath } from '@/core/path';
import { toIso } from '@/core/time';
import type { Credential, FetchContext, Meter, ProviderPlugin, UsageSnapshot } from '@/core/types';

/**
 * GitHub Copilot usage.
 *
 * Primary source: GET https://api.github.com/copilot_internal/user (the endpoint editors use).
 * It is internal and undocumented, so fields are read defensively. It returns quota_snapshots with
 * entitlement / remaining / percent_remaining per bucket and is cached server-side for a few
 * minutes. GitHub does not publish an included-credit figure on any documented endpoint.
 *
 * Fallback: the documented billing API (premium request usage) needs the user's login (GET /user)
 * and a token allowed to read billing; it reports usage only, so the limit comes from an
 * optional per-plan table that the user can override. ⚠ The fallback has not been verified
 * against a live account.
 */

/**
 * Client id of this app's own GitHub OAuth App ("AI Usage", Device Flow enabled). It is public: the
 * device flow has no client secret. A fork can point EXPO_PUBLIC_GITHUB_CLIENT_ID at its own app.
 * Never reuse another application's client id.
 */
export const GITHUB_CLIENT_ID: string =
  process.env.EXPO_PUBLIC_GITHUB_CLIENT_ID || 'Ov23ligzAKuR0agmn5wO';

export const githubDeviceConfig = (clientId: string): DeviceFlowConfig => ({
  deviceCodeUrl: 'https://github.com/login/device/code',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  clientId,
  scope: 'read:user',
});

const API = 'https://api.github.com';

function token(cred: Credential): string | undefined {
  return cred.type === 'apiKey' ? cred.key : cred.type === 'oauth' ? cred.accessToken : undefined;
}

interface QuotaSnapshot {
  entitlement?: unknown;
  remaining?: unknown;
  quota_remaining?: unknown;
  percent_remaining?: unknown;
  unlimited?: unknown;
  overage_count?: unknown;
}

const num = (x: unknown): number | undefined => {
  const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : x;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

const BUCKETS: { key: string; id: string; label: string; unit: string }[] = [
  { key: 'premium_interactions', id: 'premium', label: 'Premium requests', unit: 'requests' },
  { key: 'chat', id: 'chat', label: 'Chat', unit: 'requests' },
  { key: 'completions', id: 'completions', label: 'Completions', unit: 'requests' },
];

export function metersFromInternal(json: unknown): { meters: Meter[]; plan?: string } {
  const snapshots = getPath(json, 'quota_snapshots') as Record<string, QuotaSnapshot> | undefined;
  const resetsAt = toIso(
    getPath(json, 'quota_reset_date_utc') ?? getPath(json, 'quota_reset_date'),
  );
  const meters: Meter[] = [];
  for (const b of BUCKETS) {
    const q = snapshots?.[b.key];
    if (!q || q.unlimited === true) continue;
    const entitlement = num(q.entitlement);
    // a zero entitlement means the plan has no such allowance, not that it is used up
    if (entitlement === 0) continue;
    const remaining = num(q.remaining) ?? num(q.quota_remaining);
    const percentRemaining = num(q.percent_remaining);
    if (entitlement !== undefined && entitlement > 0 && remaining !== undefined) {
      meters.push({
        id: b.id,
        label: b.label,
        scope: { type: 'overall' },
        resetsAt,
        kind: {
          type: 'amount',
          used: Math.max(0, entitlement - remaining),
          limit: entitlement,
          unit: b.unit,
        },
      });
    } else if (percentRemaining !== undefined) {
      meters.push({
        id: b.id,
        label: b.label,
        scope: { type: 'overall' },
        resetsAt,
        kind: { type: 'percent', used: Math.min(100, Math.max(0, 100 - percentRemaining)) },
      });
    }
  }
  const plan = getPath(json, 'copilot_plan') ?? getPath(json, 'access_type_sku');
  return { meters, plan: typeof plan === 'string' ? plan : undefined };
}

/** Per-plan included premium requests (editable defaults; GitHub changes these). ⚠ verify */
export const DEFAULT_ENTITLEMENT: Record<string, number> = { pro: 300, pro_plus: 1500 };

export function metersFromBilling(json: unknown, entitlement?: number): Meter[] {
  const items = getPath(json, 'usageItems');
  if (!Array.isArray(items)) return [];
  const used = items
    .filter((i) => /premium/i.test(String((i as { sku?: unknown }).sku ?? '')))
    .reduce((sum, i) => sum + (num((i as { grossQuantity?: unknown }).grossQuantity) ?? 0), 0);
  return [
    {
      id: 'premium',
      label: 'Premium requests',
      scope: { type: 'overall' },
      kind: { type: 'amount', used, limit: entitlement, unit: 'requests' },
    },
  ];
}

const HEADERS = {
  Accept: 'application/json',
  'X-GitHub-Api-Version': '2025-04-01',
  'Editor-Version': 'vscode/1.99.0',
  'Editor-Plugin-Version': 'copilot-chat/0.26.7',
  'User-Agent': 'GitHubCopilotChat/0.26.7',
};

async function fetchUsage(
  accountId: string,
  cred: Credential,
  ctx: FetchContext,
): Promise<UsageSnapshot> {
  const t = token(cred);
  const base = { providerId: 'copilot', accountId, fetchedAt: ctx.now().toISOString() };
  if (!t) return { ...base, meters: [], status: { type: 'authExpired' } };

  // 401 here means the token is dead and propagates as AuthExpiredError.
  const internal = await requestJson(`${API}/copilot_internal/user`, {
    headers: { ...HEADERS, Authorization: `token ${t}` },
    fetch: ctx.fetch,
  });
  const { meters, plan } = metersFromInternal(internal.json);
  if (meters.length > 0) return { ...base, plan, meters, status: { type: 'ok' } };

  // Fallback to the documented billing API.
  try {
    const me = await requestJson(`${API}/user`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${t}` },
      fetch: ctx.fetch,
    });
    const login = getPath(me.json, 'login');
    if (typeof login === 'string') {
      const now = ctx.now();
      const billing = await requestJson(
        `${API}/users/${encodeURIComponent(login)}/settings/billing/premium_request/usage?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            Authorization: `Bearer ${t}`,
          },
          fetch: ctx.fetch,
        },
      );
      const planKey = typeof plan === 'string' ? plan.toLowerCase().replace(/[^a-z]+/g, '_') : '';
      const fallback = metersFromBilling(billing.json, DEFAULT_ENTITLEMENT[planKey]);
      if (fallback.length > 0) {
        const reset = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
        ).toISOString();
        return {
          ...base,
          plan,
          meters: fallback.map((m) => ({ ...m, resetsAt: reset })),
          status: { type: 'ok' },
        };
      }
    }
  } catch {
    /* the fallback is best-effort; the primary result stands */
  }
  return { ...base, plan, meters: [], status: { type: 'unsupported' } };
}

export function copilotPlugin(): ProviderPlugin {
  // GitHub OAuth-app tokens do not expire by default, so there is no refresh step.
  return { id: 'copilot', fetchUsage };
}
