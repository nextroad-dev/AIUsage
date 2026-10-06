import { createHash } from 'node:crypto';

import type { BrowserAuthorizeDeps } from '@/authkit/browser-authorize';
import { CODEX_BROWSER_TIMEOUT_MS, startCodexBrowserSignIn } from '@/providers/codex/browser';
import { CODEX_CLIENT_ID } from '@/providers/codex/auth';

const VERIFIER = Buffer.from(new Uint8Array(64).fill(0xab)).toString('base64url');
const STATE = Buffer.from(new Uint8Array(32).fill(0xab)).toString('base64url');
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
const ACCESS_TOKEN = `h.${b64({ exp: 1_790_000_000 })}.s`;
const ID_TOKEN = `h.${b64({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1' } })}.s`;

function harness(
  options: {
    busyPorts?: number[];
    response?: { status?: number; json?: unknown; text?: string };
  } = {},
) {
  const calls = {
    loopback: [] as { provider: string; port: number }[],
    opened: [] as { url: string; redirectUrl: string }[],
    token: [] as { url: string; init: RequestInit; body: URLSearchParams }[],
    stops: 0,
  };
  const deps: Partial<BrowserAuthorizeDeps> = {
    now: () => 1_000_000,
    randomBytes: async (count: number) => new Uint8Array(count).fill(0xab),
    digestBase64: async (value: string) => createHash('sha256').update(value).digest('base64'),
    startLoopback: async (provider, port) => {
      calls.loopback.push({ provider, port });
      if (options.busyPorts?.includes(port)) throw new Error('port in use');
      return { port };
    },
    stopLoopback: async () => {
      calls.stops += 1;
    },
    openAuthSession: async (url, redirectUrl) => {
      calls.opened.push({ url, redirectUrl });
      return { type: 'success', url: `usage://oauth/codex?code=CODE&state=${STATE}` };
    },
    dismissAuthSession: () => undefined,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.token.push({
        url: String(input),
        init: init ?? {},
        body: new URLSearchParams(String(init?.body)),
      });
      const response = options.response ?? { json: { access_token: ACCESS_TOKEN } };
      return new Response(response.text ?? JSON.stringify(response.json ?? {}), {
        status: response.status ?? 200,
      });
    }) as typeof fetch,
  };
  return { deps, calls };
}

describe('Codex browser sign-in', () => {
  it('builds the CLI authorization request for the registered loopback callback', async () => {
    const h = harness();
    const session = await startCodexBrowserSignIn(h.deps);
    expect(h.calls.loopback).toEqual([{ provider: 'codex', port: 1455 }]);
    expect(session.redirectUri).toBe('http://127.0.0.1:1455/auth/callback');
    expect(session.expiresAt).toBe(1_000_000 + CODEX_BROWSER_TIMEOUT_MS);
    await expect(session.authorize()).resolves.toMatchObject({ type: 'oauth' });
    expect(h.calls.opened[0].redirectUrl).toBe('usage://oauth/codex');

    const url = new URL(h.calls.opened[0].url);
    expect(url.origin + url.pathname).toBe('https://auth.openai.com/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe(CODEX_CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(session.redirectUri);
    expect(url.searchParams.get('code_challenge')).toBe(CHALLENGE);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(STATE);
    expect(url.searchParams.get('scope')).toBe(
      'openid profile email offline_access api.connectors.read api.connectors.invoke',
    );
    expect(url.searchParams.get('id_token_add_organizations')).toBe('true');
    expect(url.searchParams.get('codex_cli_simplified_flow')).toBe('true');
    expect(url.searchParams.get('originator')).toBe('codex_cli_rs');
    expect(h.calls.opened[0].url).not.toContain(VERIFIER);
  });

  it('uses the registered fallback port when the default port is taken', async () => {
    const h = harness({ busyPorts: [1455] });
    const session = await startCodexBrowserSignIn(h.deps);
    expect(h.calls.loopback.map((c) => c.port)).toEqual([1455, 1457]);
    expect(session.redirectUri).toBe('http://127.0.0.1:1457/auth/callback');
  });

  it('exchanges the code for OAuth tokens and stops the listener', async () => {
    const h = harness({
      response: {
        json: {
          access_token: ACCESS_TOKEN,
          id_token: ID_TOKEN,
          refresh_token: 'refresh-1',
          expires_in: 3600,
        },
      },
    });
    const session = await startCodexBrowserSignIn(h.deps);
    await expect(session.authorize()).resolves.toEqual({
      type: 'oauth',
      accessToken: ACCESS_TOKEN,
      refreshToken: 'refresh-1',
      expiresAt: 1_790_000_000_000,
      accountId: 'acct-1',
    });
    expect(h.calls.token).toHaveLength(1);
    const exchange = h.calls.token[0];
    expect(exchange.url).toBe('https://auth.openai.com/oauth/token');
    expect(exchange.init.method).toBe('POST');
    expect((exchange.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(Object.fromEntries(exchange.body)).toEqual({
      grant_type: 'authorization_code',
      code: 'CODE',
      redirect_uri: 'http://127.0.0.1:1455/auth/callback',
      client_id: CODEX_CLIENT_ID,
      code_verifier: VERIFIER,
    });
    expect(h.calls.stops).toBe(1);
  });

  it('treats a rejected or unusable code as final and does not retry', async () => {
    for (const status of [400, 401, 403]) {
      const h = harness({ response: { status, json: { error: 'invalid_grant' } } });
      const session = await startCodexBrowserSignIn(h.deps);
      await expect(session.authorize()).rejects.toMatchObject({ code: 'rejected' });
      expect(h.calls.token).toHaveLength(1);
      expect(h.calls.stops).toBe(1);
    }
  });

  it('reports server and body problems as a sanitized failure', async () => {
    const cases = [
      { status: 500, json: { error: 'secret-server-text' } },
      { text: 'not json: secret-body' },
      { json: { refresh_token: 'no-access-token' } },
    ];
    for (const response of cases) {
      const h = harness({ response });
      const session = await startCodexBrowserSignIn(h.deps);
      const error = await session.authorize().catch((e: unknown) => e);
      expect(error).toMatchObject({ code: 'failed' });
      expect(String((error as Error).message)).not.toMatch(/secret/);
      expect(h.calls.stops).toBe(1);
    }
  });

  it('propagates a transport failure without leaving the listener running', async () => {
    const h = harness();
    h.deps.fetch = (async () => {
      throw new TypeError('Network request failed');
    }) as typeof fetch;
    const session = await startCodexBrowserSignIn(h.deps);
    await expect(session.authorize()).rejects.toBeInstanceOf(TypeError);
    expect(h.calls.stops).toBe(1);
  });
});
