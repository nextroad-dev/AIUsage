import { AuthExpiredError } from '@/core/errors';
import { requestJson } from '@/core/http';
import type { Credential, FetchContext, Meter, ProviderPlugin, UsageSnapshot } from '@/core/types';

/**
 * Cline account credits (prepaid, pay-as-you-go).
 *
 * Verified against the official docs (docs.cline.bot, Enterprise API reference) and the open-source
 * Cline SDK/CLI (sdk/packages/core/src/account/cline-account-service.ts, apps/cli/src/utils/output.ts):
 * - auth: `Authorization: Bearer <API key>` from app.cline.bot > Settings > API Keys
 * - `GET /api/v1/users/me` -> `{ id, organizations: [{ organizationId, active, ... }] }`
 * - `GET /api/v1/users/{id}/balance` and `GET /api/v1/organizations/{orgId}/balance` -> `{ balance }`
 * - responses may be wrapped as `{ success, data }`; balances are millionths of a dollar
 * When an organization is active, its balance is the one Cline itself shows and spends from.
 */
export const CLINE_API = 'https://api.cline.bot';

const MICRO_DOLLARS = 1_000_000;

/** Unwraps `{ success, data }` envelopes; plain payloads pass through. */
export function unwrapCline(json: unknown): Record<string, unknown> | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const o = json as Record<string, unknown>;
  if (typeof o.success === 'boolean') {
    if (!o.success || !o.data || typeof o.data !== 'object') return undefined;
    return o.data as Record<string, unknown>;
  }
  return o;
}

async function getJson(url: string, token: string, ctx: FetchContext) {
  const res = await requestJson(url, {
    headers: { Authorization: `Bearer ${token}` },
    fetch: ctx.fetch,
  });
  return unwrapCline(res.json);
}

export function clinePlugin(): ProviderPlugin {
  return {
    id: 'cline',
    async fetchUsage(
      accountId: string,
      cred: Credential,
      ctx: FetchContext,
    ): Promise<UsageSnapshot> {
      if (cred.type !== 'apiKey' || !cred.key.trim()) throw new AuthExpiredError('no API key');
      const base: Omit<UsageSnapshot, 'meters' | 'status'> = {
        providerId: 'cline',
        accountId,
        fetchedAt: ctx.now().toISOString(),
      };
      const me = await getJson(`${CLINE_API}/api/v1/users/me`, cred.key, ctx);
      const userId = typeof me?.id === 'string' ? me.id : undefined;
      if (!userId) return { ...base, meters: [], status: { type: 'unsupported' } };

      const orgs = Array.isArray(me?.organizations) ? me.organizations : [];
      const active = orgs.find(
        (o): o is { organizationId: string; name?: string } =>
          !!o &&
          typeof o === 'object' &&
          (o as { active?: unknown }).active === true &&
          typeof (o as { organizationId?: unknown }).organizationId === 'string',
      );
      const url = active
        ? `${CLINE_API}/api/v1/organizations/${encodeURIComponent(active.organizationId)}/balance`
        : `${CLINE_API}/api/v1/users/${encodeURIComponent(userId)}/balance`;
      const balance = (await getJson(url, cred.key, ctx))?.balance;
      if (typeof balance !== 'number' || !Number.isFinite(balance)) {
        return { ...base, meters: [], status: { type: 'unsupported' } };
      }
      const meter: Meter = {
        id: 'credits',
        label: 'Credits balance',
        kind: { type: 'balance', value: balance / MICRO_DOLLARS, unit: 'USD' },
        scope: { type: 'overall' },
      };
      return {
        ...base,
        plan: active?.name ? String(active.name) : undefined,
        meters: [meter],
        status: { type: 'ok' },
      };
    },
  };
}
