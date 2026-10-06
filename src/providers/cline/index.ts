import { AuthExpiredError } from '@/core/errors';
import { requestJson } from '@/core/http';
import type { Credential, FetchContext, Meter, ProviderPlugin, UsageSnapshot } from '@/core/types';

/**
 * Cline: pay-as-you-go credits and the ClinePass subscription, both on the same account and key.
 *
 * Verified against the official docs (docs.cline.bot: Enterprise API reference, ClinePass) and the
 * open-source Cline SDK and extension (sdk/packages/core/src/account/cline-account-service.ts,
 * apps/vscode/webview-ui/src/utils/format.ts):
 * - auth: `Authorization: Bearer <API key>` from app.cline.bot > Settings > API Keys
 * - `GET /api/v1/users/me` -> `{ id, organizations: [{ organizationId, active, ... }] }`
 * - `GET /api/v1/users/{id}/balance` or `/organizations/{orgId}/balance` -> `{ balance }`
 *   in microcredits: the extension shows `balance / 100 / 10000`, i.e. millionths of a dollar
 * - `GET /api/v1/users/me/plan` -> `{ plan: { displayName, name }, currentPeriodEnd, cancelAt }`
 * - `GET /api/v1/users/me/plan/usage-limits` -> `{ limits: [{ type: five_hour | weekly | monthly,
 *   percentUsed, resetsAt }] }` (ClinePass only; other accounts get an error)
 * - responses may be wrapped as `{ success, data }`
 * When an organization is active, its balance is the one Cline itself shows and spends from.
 */
export const CLINE_API = 'https://api.cline.bot';

const MICRO_DOLLARS = 1_000_000;

/** ClinePass windows, mapped onto the meter ids the rest of the app knows (forecasts, widget). */
const PASS_WINDOWS: Record<string, { id: string; label: string }> = {
  five_hour: { id: 'session', label: '5-hour window' },
  weekly: { id: 'weekly', label: 'Weekly' },
  monthly: { id: 'monthly', label: 'Monthly' },
};

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

/** Optional parts (ClinePass, plan) must not fail the account; a rejected key still does. */
async function optional<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof AuthExpiredError) throw e;
    return undefined;
  }
}

export function passMeters(limits: unknown): Meter[] {
  if (!limits || typeof limits !== 'object') return [];
  const list = (limits as { limits?: unknown }).limits;
  if (!Array.isArray(list)) return [];
  const out: Meter[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const l = raw as { type?: unknown; percentUsed?: unknown; resetsAt?: unknown };
    const w = typeof l.type === 'string' ? PASS_WINDOWS[l.type] : undefined;
    if (!w || typeof l.percentUsed !== 'number' || !Number.isFinite(l.percentUsed)) continue;
    const reset = typeof l.resetsAt === 'string' ? Date.parse(l.resetsAt) : NaN;
    out.push({
      id: w.id,
      label: w.label,
      kind: { type: 'percent', used: Math.min(100, Math.max(0, l.percentUsed)) },
      scope: { type: 'overall' },
      resetsAt: Number.isFinite(reset) ? new Date(reset).toISOString() : undefined,
    });
  }
  // always 5-hour, weekly, monthly
  const order = ['session', 'weekly', 'monthly'];
  return out.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

/** Plan name and the date it renews (or ends, when cancelled). */
export function planInfo(plan: Record<string, unknown> | undefined): {
  plan?: string;
  renewsAt?: string;
} {
  if (!plan) return {};
  const p =
    plan.plan && typeof plan.plan === 'object' ? (plan.plan as Record<string, unknown>) : {};
  const name = [p.displayName, p.name].find((v) => typeof v === 'string' && v.trim()) as
    string | undefined;
  const end = [plan.cancelAt, plan.currentPeriodEnd].find(
    (v) => typeof v === 'string' && Number.isFinite(Date.parse(v)),
  ) as string | undefined;
  return { plan: name, renewsAt: end ? new Date(Date.parse(end)).toISOString() : undefined };
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
      const balanceUrl = active
        ? `${CLINE_API}/api/v1/organizations/${encodeURIComponent(active.organizationId)}/balance`
        : `${CLINE_API}/api/v1/users/${encodeURIComponent(userId)}/balance`;

      const [balanceRes, limits, plan] = await Promise.all([
        optional(getJson(balanceUrl, cred.key, ctx)),
        optional(getJson(`${CLINE_API}/api/v1/users/me/plan/usage-limits`, cred.key, ctx)),
        optional(getJson(`${CLINE_API}/api/v1/users/me/plan`, cred.key, ctx)),
      ]);

      const meters = passMeters(limits);
      const balance = balanceRes?.balance;
      if (typeof balance === 'number' && Number.isFinite(balance)) {
        meters.push({
          id: 'credits',
          label: 'Credits balance',
          kind: { type: 'balance', value: balance / MICRO_DOLLARS, unit: 'USD' },
          scope: { type: 'overall' },
        });
      }
      const info = planInfo(plan);
      return {
        ...base,
        plan: info.plan ?? (active?.name ? String(active.name) : undefined),
        renewsAt: info.renewsAt,
        meters,
        status: meters.length > 0 ? { type: 'ok' } : { type: 'unsupported' },
      };
    },
  };
}
