import { createHash } from 'node:crypto';
import {
  antigravityPlugin,
  parseSummary,
  parseBuckets,
  parseModels,
} from '@/providers/antigravity';
import {
  startAntigravitySignIn,
  tokenCredential,
  refreshAntigravity,
} from '@/providers/antigravity/auth';
import { AuthExpiredError, RateLimitedError } from '@/core/errors';
import { supportsCredential } from '@/providers/registry';
import { validateCredential } from '@/providers/service';
import type { FetchContext, Credential } from '@/core/types';

const client = { clientId: 'test-client', clientSecret: 'test-client-secret' };
const cred: Credential = {
  type: 'oauth',
  accessToken: 'test-access',
  refreshToken: 'test-refresh',
};
const summary = {
  groups: [
    {
      displayName: 'Gemini Models',
      buckets: [
        {
          bucketId: 'weekly',
          displayName: 'Weekly',
          remainingFraction: 0,
          resetTime: '2026-11-01T00:00:00Z',
        },
        { bucketId: 'session', remaining: { case: 'remainingFraction', value: 1 } },
      ],
    },
  ],
};
function context(responses: { json?: unknown; status?: number }[]) {
  const fetch = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error('Unexpected request');
    return new Response(JSON.stringify(next.json ?? {}), { status: next.status ?? 200 });
  });
  return { fetch, now: () => new Date('2026-10-31T00:00:00Z') } satisfies FetchContext;
}
const project = { json: { cloudaicompanionProject: 'test-project', paidTier: { name: 'Pro' } } };

describe('Antigravity quotas', () => {
  it('preserves exhausted and untouched measured windows', () => {
    const meters = parseSummary({ response: summary });
    expect(meters.map((m) => m.kind)).toEqual([
      { type: 'percent', used: 100 },
      { type: 'percent', used: 0 },
    ]);
    expect(meters[0].resetsAt).toBe('2026-11-01T00:00:00.000Z');
    expect(parseSummary({ code: 403, ...summary })).toEqual([]);
    expect(
      parseSummary({
        groups: [
          {
            displayName: 'Gemini',
            buckets: [
              { id: 'a', disabled: true, remainingFraction: 1 },
              { id: 'b', remainingFraction: -1 },
              { id: 'c' },
              { id: 'd', remainingFraction: '1' },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });
  it('deduplicates model buckets conservatively and skips internal models', () => {
    expect(
      parseBuckets({
        buckets: [
          { modelId: 'm', remainingFraction: 1 },
          { modelId: 'm', remainingFraction: 0.5 },
        ],
      })[0].kind,
    ).toEqual({ type: 'percent', used: 50 });
    expect(
      parseModels({
        models: {
          hidden: { isInternal: true, displayName: 'Hidden', quotaInfo: { remainingFraction: 1 } },
        },
      }),
    ).toEqual([]);
  });
  it('registers browser OAuth and validates without requiring device-code support', async () => {
    expect(supportsCredential('antigravity', 'oauthPkce', cred)).toBe(true);
    expect(supportsCredential('antigravity', 'deviceCode', cred)).toBe(false);
    const ctx = context([project, { json: summary }]);
    expect((await validateCredential('antigravity', cred, ctx)).ok).toBe(true);
    expect(JSON.parse(String(ctx.fetch.mock.calls[0]?.[1]?.body))).toEqual({
      metadata: {
        ideType: 'ANTIGRAVITY',
        platform: 'PLATFORM_UNSPECIFIED',
        pluginType: 'GEMINI',
      },
    });
  });
  it('does not accept all-full availability or missing projects as quota', async () => {
    const ctx = context([
      project,
      { status: 404 },
      { json: { models: { m: { displayName: 'Model', quotaInfo: { remainingFraction: 1 } } } } },
      { status: 403 },
    ]);
    expect((await antigravityPlugin().fetchUsage('a', cred, ctx)).status.type).toBe('unsupported');
    const missing = context([{ json: {} }]);
    expect((await antigravityPlugin().fetchUsage('a', cred, missing)).status.type).toBe(
      'unsupported',
    );
    expect(missing.fetch).toHaveBeenCalledTimes(1);
  });
  it('uses measured bucket fallback and propagates auth and rate limits', async () => {
    const ctx = context([
      project,
      { status: 404 },
      { status: 403 },
      { json: { buckets: [{ modelId: 'm', remainingFraction: 1 }] } },
    ]);
    expect((await antigravityPlugin().fetchUsage('a', cred, ctx)).meters[0].kind).toEqual({
      type: 'percent',
      used: 0,
    });
    for (const [status, error] of [
      [401, AuthExpiredError],
      [429, RateLimitedError],
    ] as const) {
      const failed = context([project, { status }]);
      await expect(antigravityPlugin().fetchUsage('a', cred, failed)).rejects.toBeInstanceOf(error);
      expect(failed.fetch).toHaveBeenCalledTimes(2);
    }
  });
});

describe('Antigravity desktop OAuth', () => {
  it('round trips state, PKCE and a single-use authorization code through the phone callback', async () => {
    let authUrl = '';
    const stop = jest.fn(async () => {});
    const fetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('client_secret')).toBe(client.clientSecret);
      expect(body.get('redirect_uri')).toBe('http://127.0.0.1:51121/auth/callback');
      expect(body.get('code_verifier')).toBeTruthy();
      return new Response(
        JSON.stringify({ access_token: 'test', refresh_token: 'refresh', expires_in: 3600 }),
      );
    });
    const session = await startAntigravitySignIn(
      {
        now: () => 1000,
        randomBytes: async (n) => new Uint8Array(n).fill(1),
        digestBase64: async (s) => createHash('sha256').update(s).digest('base64'),
        startLoopback: async (_p, port) => ({ port }),
        stopLoopback: stop,
        dismissAuthSession: () => {},
        fetch,
        openAuthSession: async (url) => {
          authUrl = url;
          return {
            type: 'success',
            url: `usage://oauth/antigravity?code=test&state=${new URL(url).searchParams.get('state')}`,
          };
        },
      },
      client,
    );
    await expect(session.authorize()).resolves.toMatchObject({
      expiresAt: 3601000,
      refreshToken: 'refresh',
    });
    expect(new URL(authUrl).searchParams.get('access_type')).toBe('offline');
    expect(authUrl).not.toContain(client.clientSecret);
    await expect(session.authorize()).rejects.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalled();
  });
  it('preserves refresh tokens, refreshes and handles rejected grants', async () => {
    expect(tokenCredential({ access_token: 'new', expires_in: 60 }, 0, cred)).toMatchObject({
      refreshToken: 'test-refresh',
    });
    const ctx = context([{ json: { access_token: 'new', expires_in: 60 } }]);
    expect(await refreshAntigravity(cred, ctx, client)).toMatchObject({
      accessToken: 'new',
      refreshToken: 'test-refresh',
    });
    await expect(
      refreshAntigravity(cred, context([{ status: 400 }]), client),
    ).rejects.toBeInstanceOf(AuthExpiredError);
    expect(() => tokenCredential({ access_token: 'new', expires_in: 0 }, 0)).toThrow();
  });
});
