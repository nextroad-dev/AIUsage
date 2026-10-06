import { evalNum, evalString, evalTime, type Expr, type Scope } from './expr';
import { requestJson } from './http';
import { getPath } from './path';
import type {
  Credential,
  FetchContext,
  Meter,
  MeterKind,
  ProviderPlugin,
  UsageSnapshot,
} from './types';

/**
 * Declarative provider: "send credentialed requests to JSON endpoints, map the
 * responses to Meters". Mapping is tolerant: a field that is missing only drops
 * the Meter that needs it. See docs/provider-api-auth.md for per-provider facts.
 */
export interface RequestSpec {
  name: string;
  /** may contain {vars} from the selected variant, e.g. https://{host}/v1/key */
  url: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  /** failure of an optional request is ignored */
  optional?: boolean;
}

export interface MeterSpec {
  id: string;
  label: string;
  kind: 'percent' | 'amount' | 'balance';
  /** request name whose response this meter reads */
  from: string;
  /** iterate an array in the response; paths below are then relative to each item */
  each?: { path: string; where?: Record<string, unknown> };
  /** derive id (and label) from an item field; unmapped values use fallbackId or are skipped */
  idBy?: {
    field: string;
    map: Record<string, string>;
    labels?: Record<string, string>;
    fallbackId?: string; // "{v}" is replaced with the field value
  };
  /** all of these must evaluate to numbers, otherwise the meter is skipped */
  requires?: Expr[];
  percent?: Expr; // kind=percent: 0..100 used
  used?: Expr; // kind=amount
  limit?: Expr; // kind=amount
  value?: Expr; // kind=balance
  /** may contain {vars}, e.g. "{currency}" */
  unit?: string;
  resetsAt?: Expr;
  /** alternative to resetsAt: seconds from now until reset */
  resetsInSeconds?: Expr;
  /** static model scope */
  model?: string;
  /** model scope read from the item, e.g. "model_name" */
  modelFrom?: string;
}

export interface HttpProviderSpec {
  id: string;
  auth:
    | { type: 'bearer'; accountHeader?: string }
    | { type: 'header'; name: string; prefix?: string }
    | { type: 'cookie'; names?: string[] };
  /** region/variant -> template variables */
  variants?: Record<string, Record<string, string>>;
  defaultVariant?: string;
  requests: RequestSpec[];
  meters: MeterSpec[];
  plan?: { from: string; path: Expr };
  /** when the paid plan renews or ends (ISO string or epoch), e.g. the billing cycle end */
  renewsAt?: { from: string; path: Expr };
  /** treat 403 as "logged out" (cookie providers) */
  forbiddenIsAuth?: boolean;
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

function authHeaders(spec: HttpProviderSpec, cred: Credential): Record<string, string> {
  const a = spec.auth;
  if (a.type === 'cookie') {
    if (cred.type !== 'session' || !cred.cookies) return {};
    const entries = Object.entries(cred.cookies).filter(([k]) => !a.names || a.names.includes(k));
    return entries.length ? { Cookie: entries.map(([k, v]) => `${k}=${v}`).join('; ') } : {};
  }
  const token =
    cred.type === 'apiKey' ? cred.key : cred.type === 'oauth' ? cred.accessToken : undefined;
  if (!token) return {};
  if (a.type === 'bearer') {
    const h: Record<string, string> = { Authorization: `Bearer ${token}` };
    // e.g. ChatGPT-Account-Id for ChatGPT/Codex OAuth tokens
    if (a.accountHeader && cred.type === 'oauth' && cred.accountId)
      h[a.accountHeader] = cred.accountId;
    return h;
  }
  return { [a.name]: `${a.prefix ?? ''}${token}` };
}

function resolveReset(m: MeterSpec, scope: Scope, now: Date): string | undefined {
  const direct = m.resetsAt === undefined ? undefined : evalTime(m.resetsAt, scope);
  if (direct) return direct;
  const secs = m.resetsInSeconds === undefined ? undefined : evalNum(m.resetsInSeconds, scope);
  return secs === undefined ? undefined : new Date(now.getTime() + secs * 1000).toISOString();
}

function evalMeters(
  spec: HttpProviderSpec,
  responses: Record<string, unknown>,
  vars: Record<string, string>,
  now: Date,
): Meter[] {
  const out: Meter[] = [];
  for (const m of spec.meters) {
    if (!(m.from in responses)) continue;
    const root = responses[m.from];
    let items: unknown[] = [root];
    if (m.each) {
      const arr = getPath(root, m.each.path);
      if (!Array.isArray(arr)) continue;
      const where = Object.entries(m.each.where ?? {});
      items = arr.filter((it) => where.every(([k, v]) => getPath(it, k) === v));
    }
    for (const item of items) {
      const scope = { root, item };
      let id = m.id;
      let label = m.label;
      if (m.idBy) {
        const v = getPath(item, m.idBy.field);
        const mapped = m.idBy.map[String(v)];
        if (mapped) {
          id = mapped;
          label = m.idBy.labels?.[mapped] ?? m.label;
        } else if (m.idBy.fallbackId) {
          id = m.idBy.fallbackId.replace('{v}', String(v));
        } else continue;
      }
      if (m.requires && m.requires.some((e) => evalNum(e, scope) === undefined)) continue;
      const unit = fill(m.unit ?? '', vars);
      let kind: MeterKind | undefined;
      if (m.kind === 'percent') {
        const p = m.percent === undefined ? undefined : evalNum(m.percent, scope);
        if (p !== undefined) kind = { type: 'percent', used: p };
      } else if (m.kind === 'amount') {
        const used = m.used === undefined ? undefined : evalNum(m.used, scope);
        if (used !== undefined) {
          const limit = m.limit === undefined ? undefined : evalNum(m.limit, scope);
          kind = { type: 'amount', used, limit, unit };
        }
      } else {
        const value = m.value === undefined ? undefined : evalNum(m.value, scope);
        if (value !== undefined) kind = { type: 'balance', value, unit };
      }
      if (!kind) continue;
      out.push({
        id,
        label,
        kind,
        scope: ((): Meter['scope'] => {
          const name = m.model ?? (m.modelFrom ? evalString(m.modelFrom, scope) : undefined);
          return name ? { type: 'model', name } : { type: 'overall' };
        })(),
        resetsAt: resolveReset(m, scope, now),
      });
    }
  }
  return out;
}

export async function runSpec(
  spec: HttpProviderSpec,
  accountId: string,
  cred: Credential,
  ctx: FetchContext,
): Promise<UsageSnapshot> {
  const variantKey = ctx.region ?? spec.defaultVariant ?? Object.keys(spec.variants ?? {})[0];
  const vars = (variantKey && spec.variants?.[variantKey]) || {};
  const auth = authHeaders(spec, cred);
  const responses: Record<string, unknown> = {};

  for (const r of spec.requests) {
    try {
      const res = await requestJson(fill(r.url, vars), {
        method: r.method,
        body: r.body,
        headers: { ...r.headers, ...auth },
        fetch: ctx.fetch,
        forbiddenIsAuth: spec.forbiddenIsAuth,
      });
      responses[r.name] = res.json;
    } catch (e) {
      if (!r.optional) throw e;
    }
  }

  const meters = evalMeters(spec, responses, vars, ctx.now());
  let plan: string | undefined;
  if (spec.plan && spec.plan.from in responses) {
    plan = evalString(spec.plan.path, {
      root: responses[spec.plan.from],
      item: responses[spec.plan.from],
    });
  }
  let renewsAt: string | undefined;
  if (spec.renewsAt && spec.renewsAt.from in responses) {
    const root = responses[spec.renewsAt.from];
    renewsAt = evalTime(spec.renewsAt.path, { root, item: root });
  }
  return {
    providerId: spec.id,
    accountId,
    plan,
    renewsAt,
    fetchedAt: ctx.now().toISOString(),
    meters,
    status: meters.length > 0 ? { type: 'ok' } : { type: 'unsupported' },
  };
}

export function specToPlugin(spec: HttpProviderSpec): ProviderPlugin {
  return { id: spec.id, fetchUsage: (accountId, cred, ctx) => runSpec(spec, accountId, cred, ctx) };
}
