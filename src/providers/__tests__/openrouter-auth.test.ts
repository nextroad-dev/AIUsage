import { createHash } from 'node:crypto';

import type { BrowserAuthorizeDeps } from '@/authkit/browser-authorize';
import {
  OPENROUTER_PREFERRED_PORT,
  OPENROUTER_TIMEOUT_MS,
  openRouterCallbackPorts,
  startOpenRouterSignIn,
} from '@/providers/openrouter/auth';

const VERIFIER = Buffer.from(new Uint8Array(64).fill(0xab)).toString('base64url');
const STATE = Buffer.from(new Uint8Array(32).fill(0xab)).toString('base64url');
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

function harness(options: { response?: { status?: number; json?: unknown; text?: string } } = {}) {
  const calls = {
    opened: [] as { url: string; redirectUrl: string }[],
    exchange: [] as { url: string; init: RequestInit; body: Record<string, unknown> }[],
    stops: 0,
  };
  const deps: Partial<BrowserAuthorizeDeps> = {
    now: () => 2_000_000,
    randomBytes: async (count: number) => new Uint8Array(count).fill(0xab),
    digestBase64: async (value: string) => createHash('sha256').update(value).digest('base64'),
    startLoopback: async (_provider, port) => ({ port }),
    stopLoopback: async () => {
      calls.stops += 1;
    },
    openAuthSession: async (url, redirectUrl) => {
      calls.opened.push({ url, redirectUrl });
      return { type: 'success', url: `usage://oauth/openrouter?code=CODE&state=${STATE}` };
    },
    dismissAuthSession: () => undefined,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.exchange.push({
        url: String(input),
        init: init ?? {},
        body: JSON.parse(String(init?.body)),
      });
      const response = options.response ?? { json: { key: 'sk-issued' } };
      return new Response(response.text ?? JSON.stringify(response.json ?? {}), {
        status: response.status ?? 200,
      });
    }) as typeof fetch,
  };
  return { deps, calls };
}

describe('OpenRouter browser sign-in', () => {
  it('uses the documented callback_url, S256 challenge and state instead of a headless copy step', async () => {
    const h = harness();
    const session = await startOpenRouterSignIn(h.deps);
    expect(session.redirectUri).toBe(`http://127.0.0.1:${OPENROUTER_PREFERRED_PORT}/auth/callback`);
    expect(session.expiresAt).toBe(2_000_000 + OPENROUTER_TIMEOUT_MS);
    await expect(session.authorize()).resolves.toEqual({ type: 'apiKey', key: 'sk-issued' });
    expect(h.calls.opened[0].redirectUrl).toBe('usage://oauth/openrouter');

    const url = new URL(h.calls.opened[0].url);
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');
    expect(url.searchParams.get('callback_url')).toBe(session.redirectUri);
    expect(url.searchParams.get('code_challenge')).toBe(CHALLENGE);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(STATE);
    expect(url.searchParams.get('key_label')).toBe('AI Usage');
    expect(url.searchParams.has('code_verifier')).toBe(false);
  });

  it('prefers a stable port and only then falls back to unique ephemeral ones', () => {
    let step = 0;
    const varying = () => ((step++ % 50) + 1) / 100;
    const ports = openRouterCallbackPorts(varying);
    expect(ports).toHaveLength(4);
    expect(ports[0]).toBe(OPENROUTER_PREFERRED_PORT);
    expect(new Set(ports).size).toBe(4);
    for (const port of ports.slice(1)) {
      expect(port).toBeGreaterThanOrEqual(49152);
      expect(port).toBeLessThanOrEqual(65535);
    }
    // A degenerate random source cannot produce duplicates, and must not spin forever.
    expect(openRouterCallbackPorts(() => 0)).toEqual([OPENROUTER_PREFERRED_PORT, 49152]);
    expect(openRouterCallbackPorts(() => 1)).toEqual([OPENROUTER_PREFERRED_PORT, 65535]);
    expect(openRouterCallbackPorts(() => 1.5)).toEqual([OPENROUTER_PREFERRED_PORT, 65535]);
  });

  it('exchanges the code for an API key with the PKCE verifier and stops listening', async () => {
    const h = harness();
    const session = await startOpenRouterSignIn(h.deps);
    await expect(session.authorize()).resolves.toEqual({ type: 'apiKey', key: 'sk-issued' });
    expect(h.calls.exchange).toHaveLength(1);
    const exchange = h.calls.exchange[0];
    expect(exchange.url).toBe('https://openrouter.ai/api/v1/auth/keys');
    expect(exchange.init.method).toBe('POST');
    expect((exchange.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    expect(exchange.body).toEqual({
      code: 'CODE',
      code_verifier: VERIFIER,
      code_challenge_method: 'S256',
    });
    expect(h.calls.stops).toBe(1);
  });

  it.each([
    { status: 403, json: { error: 'code=secret' }, expected: 'rejected' },
    { status: 400, json: {}, expected: 'rejected' },
    { status: 500, json: { key: 'never-accept-on-error' }, expected: 'failed' },
    { json: { key: ' ' }, expected: 'failed' },
    { json: { access_token: 'wrong-protocol' }, expected: 'failed' },
    { text: 'not-json: sk-secret', expected: 'failed' },
  ])(
    'sanitizes a failed exchange and never retries the consumed code: $expected',
    async ({ expected, ...response }) => {
      const h = harness({ response });
      const session = await startOpenRouterSignIn(h.deps);
      const error = await session.authorize().catch((e: unknown) => e);
      expect(error).toMatchObject({ code: expected });
      expect(String((error as Error).message)).not.toContain('sk-secret');
      expect(h.calls.exchange).toHaveLength(1);
      expect(h.calls.stops).toBe(1);
    },
  );

  it('does not exchange when the browser closes without authorizing', async () => {
    const h = harness();
    h.deps.openAuthSession = async () => ({ type: 'cancel' });
    const session = await startOpenRouterSignIn(h.deps);
    await expect(session.authorize()).rejects.toMatchObject({ code: 'cancelled' });
    expect(h.calls.exchange).toEqual([]);
    expect(h.calls.stops).toBe(1);
  });
});
