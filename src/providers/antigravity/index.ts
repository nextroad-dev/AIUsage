import { AuthExpiredError, HttpError, TimeoutError } from '@/core/errors';
import { requestJson } from '@/core/http';
import type { Meter, ProviderPlugin } from '@/core/types';
import { refreshAntigravity } from './auth';

const API = 'https://cloudcode-pa.googleapis.com/v1internal:';
const SUMMARY = 'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary';
const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const string = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function meter(
  id: string,
  name: string,
  label: string,
  fraction: unknown,
  reset: unknown,
): Meter[] {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1)
    return [];
  const date = string(reset);
  return [
    {
      id,
      label,
      scope: { type: 'model', name },
      kind: { type: 'percent', used: (1 - fraction) * 100 },
      ...(date && Number.isFinite(Date.parse(date))
        ? { resetsAt: new Date(date).toISOString() }
        : {}),
    },
  ];
}

export function parseSummary(value: unknown): Meter[] {
  const root = object(value);
  if (root.code !== undefined && root.code !== 0 && root.code !== 'OK') return [];
  const payload = object(root.response ?? root.summary ?? root);
  return array(payload.groups).flatMap((g) => {
    const group = object(g);
    const name = string(group.displayName ?? group.name);
    if (!name) return [];
    return array(group.buckets).flatMap((b) => {
      const bucket = object(b),
        remaining = object(bucket.remaining);
      const id = string(bucket.bucketId ?? bucket.id);
      if (!id || bucket.disabled === true) return [];
      const fraction =
        bucket.remainingFraction ??
        remaining.remainingFraction ??
        (remaining.case === 'remainingFraction' ? remaining.value : undefined);
      return meter(
        `group:${name}:${id}`,
        name,
        string(bucket.displayName ?? bucket.name) ?? id,
        fraction,
        bucket.resetTime,
      );
    });
  });
}

export function parseBuckets(value: unknown): Meter[] {
  const meters = new Map<string, Meter>();
  for (const entry of array(object(value).buckets)) {
    const b = object(entry),
      id = string(b.modelId);
    if (!id) continue;
    const next = meter(`model:${id}`, id, id, b.remainingFraction, b.resetTime)[0];
    const previous = meters.get(id);
    if (
      next?.kind.type === 'percent' &&
      (!previous || (previous.kind.type === 'percent' && next.kind.used > previous.kind.used))
    )
      meters.set(id, next);
  }
  return [...meters.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function parseModels(value: unknown): Meter[] {
  return Object.entries(object(object(value).models))
    .flatMap(([id, entry]) => {
      const m = object(entry),
        q = object(m.quotaInfo);
      const name = string(m.displayName);
      if (m.isInternal === true || !name) return [];
      return meter(`model:${id}`, name, name, q.remainingFraction, q.resetTime);
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function antigravityPlugin(): ProviderPlugin {
  return {
    id: 'antigravity',
    refresh: refreshAntigravity,
    async fetchUsage(accountId, cred, ctx) {
      if (cred.type !== 'oauth') throw new AuthExpiredError();
      const post = async (url: string, body: unknown, timeoutMs = 10_000) =>
        (
          await requestJson(url, {
            method: 'POST',
            body,
            fetch: ctx.fetch,
            timeoutMs,
            headers: {
              Authorization: `Bearer ${cred.accessToken}`,
              'User-Agent': 'antigravity/hub/2.9.1 linux/arm64',
            },
          })
        ).json;
      const optional = async (url: string, body: unknown, timeout?: number) => {
        try {
          return await post(url, body, timeout);
        } catch (e) {
          if (
            e instanceof TimeoutError ||
            (e instanceof HttpError && [403, 404, 501].includes(e.status))
          )
            return undefined;
          throw e;
        }
      };
      const info = object(
        await post(`${API}loadCodeAssist`, {
          metadata: {
            ideType: 'ANTIGRAVITY',
            platform: 'PLATFORM_UNSPECIFIED',
            pluginType: 'GEMINI',
          },
        }),
      );
      const project =
        string(info.cloudaicompanionProject) ?? string(object(info.cloudaicompanionProject).id);
      const plan = string(object(info.paidTier).name) ?? string(object(info.currentTier).name);
      let meters: Meter[] = [];
      // Never onboard or accept placeholder quota without an existing Antigravity project.
      if (project) {
        const body = { project };
        meters = parseSummary(await optional(SUMMARY, body, 2000));
        if (!meters.length) {
          const models = parseModels(await optional(`${API}fetchAvailableModels`, body));
          meters =
            models.length && models.some((m) => m.kind.type === 'percent' && m.kind.used > 0.1)
              ? models
              : parseBuckets(await optional(`${API}retrieveUserQuota`, body));
        }
      }
      return {
        providerId: 'antigravity',
        accountId,
        fetchedAt: ctx.now().toISOString(),
        plan,
        meters,
        status: { type: meters.length ? 'ok' : 'unsupported' },
      };
    },
  };
}
