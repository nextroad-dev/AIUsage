import { DeviceFlowError, type FlowDeps } from '@/authkit/device-flow';
import { jwtClaims, jwtExpiryMs } from '@/authkit/jwt';
import { AuthExpiredError } from '@/core/errors';
import { runSpec } from '@/core/spec-engine';
import type { Credential } from '@/core/types';
import {
  CODEX_CLIENT_ID,
  completeCodexDevice,
  credentialFromTokens,
  refreshCodexCredential,
  startCodexDevice,
} from '@/providers/codex/auth';
import { codexPlugin, codexSpec } from '@/providers/codex';
import { copilotPlugin, metersFromBilling, metersFromInternal } from '@/providers/copilot';
import { beginDeviceSignIn, NotConfiguredError } from '@/providers/device-signin';
import { ctxWith, fakeFetch, NOW } from '@/test-utils/fetch';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims: object) => `h.${b64(claims)}.s`;
const exp = (secs: number) => Math.floor(NOW.getTime() / 1000) + secs;

describe('jwt helpers', () => {
  it('reads claims and expiry', () => {
    const t = jwt({ exp: 1790000000, x: 1 });
    expect(jwtClaims(t)).toMatchObject({ x: 1 });
    expect(jwtExpiryMs(t)).toBe(1790000000_000);
    expect(jwtClaims('nope')).toBeUndefined();
    expect(jwtExpiryMs(jwt({}))).toBeUndefined();
  });
});

// ---------- Codex ----------

type Reply = { status?: number; json?: unknown };
function harness(replies: Record<string, Reply[]>) {
  let t = NOW.getTime();
  const sleeps: number[] = [];
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const queues = Object.fromEntries(Object.entries(replies).map(([k, v]) => [k, [...v]]));
  const deps: FlowDeps = {
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({
        url: u,
        body: String(init?.body),
        headers: { ...(init?.headers as Record<string, string>) },
      });
      const q = queues[u];
      const r = q?.length > 1 ? q.shift()! : q?.[0];
      if (!r) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
    }) as typeof fetch,
  };
  return { deps, sleeps, calls };
}

const ISS = 'https://auth.openai.com';
const idToken = jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1' } });

describe('Codex device sign-in', () => {
  const usercode = `${ISS}/api/accounts/deviceauth/usercode`;
  const poll = `${ISS}/api/accounts/deviceauth/token`;
  const exchange = `${ISS}/oauth/token`;

  it('starts, polls through pending (403/404), exchanges the code and builds the credential', async () => {
    const h = harness({
      [usercode]: [{ json: { device_auth_id: 'dev1', user_code: 'ABCD-1234', interval: '5' } }],
      [poll]: [
        { status: 403 },
        { status: 404 },
        { json: { authorization_code: 'code1', code_challenge: 'c', code_verifier: 'ver1' } },
      ],
      [exchange]: [
        {
          json: { id_token: idToken, access_token: jwt({ exp: exp(3600) }), refresh_token: 'rt1' },
        },
      ],
    });
    const start = await startCodexDevice(h.deps);
    expect(start).toMatchObject({
      deviceAuthId: 'dev1',
      userCode: 'ABCD-1234',
      verificationUri: `${ISS}/codex/device`,
      intervalSec: 5,
    });
    expect(JSON.parse(h.calls[0].body)).toEqual({ client_id: CODEX_CLIENT_ID });

    const cred = await completeCodexDevice(start, { deps: h.deps });
    expect(cred).toMatchObject({ type: 'oauth', refreshToken: 'rt1', accountId: 'acct-1' });
    expect((cred as { expiresAt: number }).expiresAt).toBe(exp(3600) * 1000);
    expect(h.sleeps).toEqual([5000, 5000, 5000]);
    const pollBody = JSON.parse(h.calls.find((c) => c.url === poll)!.body);
    expect(pollBody).toEqual({ device_auth_id: 'dev1', user_code: 'ABCD-1234' });
    const exBody = new URLSearchParams(h.calls.find((c) => c.url === exchange)!.body);
    expect(Object.fromEntries(exBody)).toEqual({
      grant_type: 'authorization_code',
      code: 'code1',
      redirect_uri: `${ISS}/deviceauth/callback`,
      client_id: CODEX_CLIENT_ID,
      code_verifier: 'ver1',
    });
  });

  it('accepts the alternative usercode field name', async () => {
    const h = harness({ [usercode]: [{ json: { device_auth_id: 'd', usercode: 'ZZZZ' } }] });
    expect((await startCodexDevice(h.deps)).userCode).toBe('ZZZZ');
  });

  it('explains when device-code sign-in is not enabled for the account', async () => {
    const h = harness({ [usercode]: [{ status: 404 }] });
    await expect(startCodexDevice(h.deps)).rejects.toMatchObject({
      code: 'failed',
      message: expect.stringContaining('not enabled'),
    });
  });

  it('fails on other errors, expires after 15 minutes and can be cancelled', async () => {
    const start = {
      deviceAuthId: 'd',
      userCode: 'U',
      verificationUri: 'u',
      intervalSec: 5,
      expiresAt: NOW.getTime() + 900_000,
    };
    await expect(
      completeCodexDevice(start, { deps: harness({ [poll]: [{ status: 500 }] }).deps }),
    ).rejects.toMatchObject({ code: 'failed' });
    await expect(
      completeCodexDevice(start, { deps: harness({ [poll]: [{ status: 403 }] }).deps }),
    ).rejects.toMatchObject({ code: 'expired' });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      completeCodexDevice(start, { deps: harness({}).deps, signal: ctrl.signal }),
    ).rejects.toBeInstanceOf(DeviceFlowError);
    await expect(
      completeCodexDevice(start, {
        deps: harness({
          [poll]: [{ json: { authorization_code: 'c', code_verifier: 'v' } }],
          [exchange]: [{ status: 400 }],
        }).deps,
      }),
    ).rejects.toMatchObject({ code: 'failed' });
  });
});

describe('Codex credentials and refresh', () => {
  it('derives the account id and expiry, keeps the old refresh token when none is sent', () => {
    const prev: Credential = {
      type: 'oauth',
      accessToken: 'old',
      refreshToken: 'keep',
      accountId: 'acct-0',
    };
    const c = credentialFromTokens({ access_token: jwt({ exp: exp(60) }) }, NOW.getTime(), prev);
    expect(c).toMatchObject({ refreshToken: 'keep', accountId: 'acct-0' });
    const flat = credentialFromTokens(
      { access_token: 'opaque', id_token: jwt({ chatgpt_account_id: 'flat' }), expires_in: 100 },
      NOW.getTime(),
    );
    expect(flat).toMatchObject({ accountId: 'flat', expiresAt: NOW.getTime() + 100_000 });
    expect(() => credentialFromTokens({}, 0)).toThrow(AuthExpiredError);
  });

  it('reads the subscription end from the identity claims and keeps it across refreshes', () => {
    const until = '2026-11-20T08:00:00+00:00';
    const c = credentialFromTokens(
      {
        access_token: jwt({ exp: exp(60) }),
        id_token: jwt({
          'https://api.openai.com/auth': {
            chatgpt_account_id: 'acct',
            chatgpt_subscription_active_until: until,
          },
        }),
      },
      NOW.getTime(),
    );
    expect(c).toMatchObject({ subscriptionUntil: Date.parse(until) });
    // a refresh without an id_token keeps what we knew
    expect(
      credentialFromTokens({ access_token: jwt({ exp: exp(60) }) }, NOW.getTime(), c),
    ).toMatchObject({ subscriptionUntil: Date.parse(until) });
  });

  it('refresh posts JSON with the client id and stores the rotated token', async () => {
    const h = harness({
      [`${ISS}/oauth/token`]: [
        {
          json: { access_token: jwt({ exp: exp(3600) }), refresh_token: 'rt2', id_token: idToken },
        },
      ],
    });
    const cred = await refreshCodexCredential(
      { type: 'oauth', accessToken: 'a', refreshToken: 'rt1' },
      h.deps,
    );
    expect(cred).toMatchObject({ refreshToken: 'rt2', accountId: 'acct-1' });
    expect(JSON.parse(h.calls[0].body)).toEqual({
      client_id: CODEX_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: 'rt1',
    });
    expect(h.calls[0].headers['Content-Type']).toBe('application/json');
  });

  it('treats a rejected refresh token as an expired login but a server error as transient', async () => {
    const bad = harness({
      [`${ISS}/oauth/token`]: [{ status: 400, json: { error: 'refresh_token_reused' } }],
    });
    await expect(
      refreshCodexCredential({ type: 'oauth', accessToken: 'a', refreshToken: 'r' }, bad.deps),
    ).rejects.toBeInstanceOf(AuthExpiredError);
    const down = harness({ [`${ISS}/oauth/token`]: [{ status: 503 }] });
    const err = await refreshCodexCredential(
      { type: 'oauth', accessToken: 'a', refreshToken: 'r' },
      down.deps,
    ).catch((e) => e);
    expect(err).not.toBeInstanceOf(AuthExpiredError);
    await expect(
      refreshCodexCredential({ type: 'oauth', accessToken: 'a' }, down.deps),
    ).rejects.toBeInstanceOf(AuthExpiredError);
  });
});

describe('Codex usage', () => {
  const cred: Credential = { type: 'oauth', accessToken: 'tok', accountId: 'acct-1' };
  const URL = 'https://chatgpt.com/backend-api/wham/usage';

  it('sends the account header and maps both windows, plan and credits', async () => {
    const f = fakeFetch({
      [URL]: {
        json: {
          plan_type: 'plus',
          rate_limit: {
            primary_window: {
              used_percent: 34,
              reset_after_seconds: 3600,
              limit_window_seconds: 18000,
            },
            secondary_window: { used_percent: 12.5, reset_at: 1790000000 },
          },
          credits: { balance: '42' },
        },
      },
    });
    const s = await runSpec(codexSpec, 'a', cred, ctxWith(f.fetch));
    expect(f.calls[0].headers).toMatchObject({
      Authorization: 'Bearer tok',
      'ChatGPT-Account-Id': 'acct-1',
      'User-Agent': 'codex-cli',
    });
    expect(s.plan).toBe('plus');
    expect(s.meters.map((m) => [m.id, m.kind])).toEqual([
      ['session', { type: 'percent', used: 34 }],
      ['weekly', { type: 'percent', used: 12.5 }],
      ['credits', { type: 'balance', value: 42, unit: 'credits' }],
    ]);
    expect(s.meters[0].resetsAt).toBe(new Date(NOW.getTime() + 3_600_000).toISOString());
    expect(s.meters[1].resetsAt).toBe('2026-09-21T14:13:20.000Z');
  });

  it('omits windows the plan does not have', async () => {
    const f = fakeFetch({
      [URL]: { json: { rate_limit: { secondary_window: { used_percent: 5 } } } },
    });
    const s = await runSpec(codexSpec, 'a', cred, ctxWith(f.fetch));
    expect(s.meters.map((m) => m.id)).toEqual(['weekly']);
  });

  it('the plugin refreshes through the Codex token endpoint', async () => {
    const f = fakeFetch({
      [`${ISS}/oauth/token`]: { json: { access_token: jwt({ exp: exp(60) }), refresh_token: 'n' } },
    });
    const next = await codexPlugin().refresh!(
      { type: 'oauth', accessToken: 'a', refreshToken: 'r' },
      ctxWith(f.fetch),
    );
    expect(next).toMatchObject({ refreshToken: 'n' });
  });
});

// ---------- Copilot ----------

describe('Copilot usage', () => {
  const INTERNAL = 'https://api.github.com/copilot_internal/user';
  const internalBody = {
    copilot_plan: 'individual_pro',
    quota_reset_date_utc: '2026-11-01T00:00:00.000Z',
    quota_snapshots: {
      premium_interactions: {
        entitlement: 300,
        remaining: 120,
        percent_remaining: 40,
        unlimited: false,
      },
      chat: { unlimited: true },
      completions: { unlimited: true },
    },
  };

  it('maps premium requests with entitlement, skipping unlimited buckets', () => {
    const { meters, plan } = metersFromInternal(internalBody);
    expect(plan).toBe('individual_pro');
    expect(meters).toEqual([
      {
        id: 'premium',
        label: 'Premium requests',
        scope: { type: 'overall' },
        resetsAt: '2026-11-01T00:00:00.000Z',
        kind: { type: 'amount', used: 180, limit: 300, unit: 'requests' },
      },
    ]);
  });

  it('falls back to percent when no entitlement is reported', () => {
    const { meters } = metersFromInternal({
      quota_snapshots: { premium_interactions: { percent_remaining: 25 } },
    });
    expect(meters[0].kind).toEqual({ type: 'percent', used: 75 });
    expect(metersFromInternal({}).meters).toEqual([]);
  });

  it('uses the token scheme and editor headers and returns an ok snapshot', async () => {
    const f = fakeFetch({ [INTERNAL]: { json: internalBody } });
    const s = await copilotPlugin().fetchUsage(
      'a',
      { type: 'oauth', accessToken: 'gho_x' },
      ctxWith(f.fetch),
    );
    expect(f.calls[0].headers).toMatchObject({
      Authorization: 'token gho_x',
      'X-GitHub-Api-Version': '2025-04-01',
    });
    expect(s.status).toEqual({ type: 'ok' });
    expect(s.meters).toHaveLength(1);
  });

  it('a pasted token (apiKey credential) works too, and a dead token surfaces as expired', async () => {
    const ok = fakeFetch({ [INTERNAL]: { json: internalBody } });
    expect(
      (await copilotPlugin().fetchUsage('a', { type: 'apiKey', key: 'ghp_x' }, ctxWith(ok.fetch)))
        .status,
    ).toEqual({ type: 'ok' });
    const dead = fakeFetch({ [INTERNAL]: { status: 401 } });
    await expect(
      copilotPlugin().fetchUsage('a', { type: 'apiKey', key: 'x' }, ctxWith(dead.fetch)),
    ).rejects.toBeInstanceOf(AuthExpiredError);
  });

  it('falls back to the billing API when the internal endpoint has no quota data', async () => {
    const f = fakeFetch({
      [INTERNAL]: { json: { copilot_plan: 'pro' } },
      'https://api.github.com/user': { json: { login: 'octo' } },
      'https://api.github.com/users/octo/settings/billing/premium_request/usage?year=2026&month=10':
        {
          json: {
            usageItems: [
              { sku: 'Copilot Premium Request', grossQuantity: 40 },
              { sku: 'Actions minutes', grossQuantity: 999 },
              { sku: 'Copilot Premium Request', grossQuantity: 10 },
            ],
          },
        },
    });
    const s = await copilotPlugin().fetchUsage(
      'a',
      { type: 'apiKey', key: 'ghp' },
      ctxWith(f.fetch),
    );
    expect(s.status).toEqual({ type: 'ok' });
    expect(s.meters[0].kind).toEqual({ type: 'amount', used: 50, limit: 300, unit: 'requests' });
    expect(s.meters[0].resetsAt).toBe('2026-11-01T00:00:00.000Z');
  });

  it('reports unsupported when neither source yields data', async () => {
    const f = fakeFetch({
      [INTERNAL]: { json: {} },
      'https://api.github.com/user': { status: 403 },
    });
    const s = await copilotPlugin().fetchUsage('a', { type: 'apiKey', key: 'x' }, ctxWith(f.fetch));
    expect(s.status).toEqual({ type: 'unsupported' });
  });

  it('billing mapping ignores unrelated items', () => {
    expect(metersFromBilling({ usageItems: [] })[0].kind).toMatchObject({ used: 0 });
    expect(metersFromBilling({})).toEqual([]);
  });
});

describe('beginDeviceSignIn', () => {
  it('GitHub: requires a configured client id', async () => {
    await expect(
      beginDeviceSignIn('githubDevice', undefined, { githubClientId: '' }),
    ).rejects.toBeInstanceOf(NotConfiguredError);
  });

  it('GitHub: runs the RFC 8628 flow and returns an oauth credential', async () => {
    const h = harness({
      'https://github.com/login/device/code': [
        {
          json: {
            device_code: 'dc',
            user_code: 'WXYZ-1234',
            verification_uri: 'https://github.com/login/device',
            interval: 5,
            expires_in: 900,
          },
        },
      ],
      'https://github.com/login/oauth/access_token': [
        { json: { error: 'authorization_pending' } },
        { json: { access_token: 'gho_abc', token_type: 'bearer' } },
      ],
    });
    const si = await beginDeviceSignIn('githubDevice', h.deps, { githubClientId: 'cid' });
    expect(si).toMatchObject({
      userCode: 'WXYZ-1234',
      verificationUri: 'https://github.com/login/device',
    });
    const cred = await si.wait();
    expect(cred).toMatchObject({ type: 'oauth', accessToken: 'gho_abc' });
    expect(new URLSearchParams(h.calls[0].body).get('scope')).toBe('read:user');
  });

  it('Codex: exposes the code and verification page', async () => {
    const h = harness({
      [`${ISS}/api/accounts/deviceauth/usercode`]: [
        { json: { device_auth_id: 'd', user_code: 'CODE' } },
      ],
    });
    const si = await beginDeviceSignIn('codexDevice', h.deps);
    expect(si).toMatchObject({ userCode: 'CODE', verificationUri: `${ISS}/codex/device` });
  });
});
