import { specToPlugin, type HttpProviderSpec } from '@/core/spec-engine';
import type { ProviderPlugin } from '@/core/types';
import { refreshCodexCredential } from '@/providers/codex/auth';

/**
 * ChatGPT / Codex usage. GET /wham/usage is the endpoint the Codex CLI itself uses; it is not a
 * public API. Field names come from CLI-adjacent tooling (CodexBar docs): rate_limit.primary_window
 * (session lane) and rate_limit.secondary_window (weekly lane) with used_percent and
 * reset_at / reset_after_seconds. The credits shape is not documented anywhere reliable, so it is
 * mapped defensively and may be absent. Verify with a real account before trusting.
 */
export const codexSpec: HttpProviderSpec = {
  id: 'codex',
  auth: { type: 'bearer', accountHeader: 'ChatGPT-Account-Id' },
  requests: [
    {
      name: 'usage',
      url: 'https://chatgpt.com/backend-api/wham/usage',
      headers: { 'User-Agent': 'codex-cli' },
    },
  ],
  plan: { from: 'usage', path: 'plan_type' },
  meters: [
    {
      id: 'session',
      label: 'Session window',
      kind: 'percent',
      from: 'usage',
      percent: 'rate_limit.primary_window.used_percent',
      resetsAt: 'rate_limit.primary_window.reset_at',
      resetsInSeconds: 'rate_limit.primary_window.reset_after_seconds',
    },
    {
      id: 'weekly',
      label: 'Weekly',
      kind: 'percent',
      from: 'usage',
      percent: 'rate_limit.secondary_window.used_percent',
      resetsAt: 'rate_limit.secondary_window.reset_at',
      resetsInSeconds: 'rate_limit.secondary_window.reset_after_seconds',
    },
    {
      id: 'credits',
      label: 'Credits balance',
      kind: 'balance',
      from: 'usage',
      value: { coalesce: ['credits.balance', 'credits.remaining'] },
      unit: 'credits',
    },
  ],
};

export function codexPlugin(): ProviderPlugin {
  const base = specToPlugin(codexSpec);
  return {
    ...base,
    // the usage endpoint has no subscription dates; the sign-in identity claims do
    async fetchUsage(accountId, cred, ctx) {
      const snapshot = await base.fetchUsage(accountId, cred, ctx);
      const until = cred.type === 'oauth' ? cred.subscriptionUntil : undefined;
      return until && !snapshot.renewsAt
        ? { ...snapshot, renewsAt: new Date(until).toISOString() }
        : snapshot;
    },
    refresh: (cred, ctx) =>
      refreshCodexCredential(cred, { fetch: ctx.fetch, now: () => ctx.now().getTime() }),
  };
}
