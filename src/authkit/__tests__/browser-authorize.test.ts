import { createHash } from 'node:crypto';

import {
  BrowserAuthError,
  EXCHANGE_TIMEOUT_MS,
  base64UrlFromBase64,
  base64UrlFromBytes,
  readCallbackCode,
  openAuthSessionAndroid,
  startBrowserAuthorization,
  type BrowserAuthorizeDeps,
  type BrowserAuthorizeInput,
} from '@/authkit/browser-authorize';
import { isAwaitingCallback } from '@/authkit/callback-session';
import { LoopbackPortError, LoopbackUnavailableError } from '@/authkit/loopback';
import type { Credential } from '@/core/types';

const VERIFIER = Buffer.from(new Uint8Array(64).fill(0xab)).toString('base64url');
const STATE = Buffer.from(new Uint8Array(32).fill(0xab)).toString('base64url');
const challengeFor = (verifier: string) =>
  createHash('sha256').update(verifier).digest('base64url');

function callback(params: Record<string, string>, provider = 'codex'): string {
  return `usage://oauth/${provider}?${new URLSearchParams({ state: STATE, ...params })}`;
}

function failureCode(run: () => unknown): string {
  try {
    run();
  } catch (e) {
    return e instanceof BrowserAuthError ? e.code : `unexpected:${String(e)}`;
  }
  return 'no-error';
}

interface Harness {
  deps: Partial<BrowserAuthorizeDeps>;
  clock: { now: number };
  loopback: { provider: string; port: number }[];
  opened: { url: string; redirectUrl: string }[];
  stops: number;
  dismissals: number;
  requests: { url: string; body: unknown; signal?: AbortSignal }[];
}

function harness(
  options: {
    busyPorts?: number[];
    allPortsBusy?: boolean;
    unavailable?: boolean;
    session?: { type: string; url?: string };
    sessionNever?: boolean;
    exchangeStatus?: number;
    exchangeNever?: boolean;
  } = {},
): Harness {
  const h: Harness = {
    clock: { now: 1000 },
    loopback: [],
    opened: [],
    stops: 0,
    dismissals: 0,
    requests: [],
    deps: {},
  };
  let resolveSession: ((result: { type: string; url?: string }) => void) | undefined;
  h.deps = {
    now: () => h.clock.now,
    randomBytes: async (count: number) => new Uint8Array(count).fill(0xab),
    digestBase64: async (value: string) => createHash('sha256').update(value).digest('base64'),
    startLoopback: async (provider, port) => {
      h.loopback.push({ provider, port });
      if (options.unavailable) throw new LoopbackUnavailableError();
      if (options.allPortsBusy || options.busyPorts?.includes(port)) throw new LoopbackPortError();
      return { port };
    },
    stopLoopback: async () => {
      h.stops += 1;
    },
    openAuthSession: async (url, redirectUrl) => {
      h.opened.push({ url, redirectUrl });
      if (options.sessionNever) {
        return new Promise<{ type: string; url?: string }>((resolve) => {
          resolveSession = resolve;
        });
      }
      return options.session ?? { type: 'success', url: callback({ code: 'abc' }) };
    },
    dismissAuthSession: () => {
      h.dismissals += 1;
      resolveSession?.({ type: 'dismiss' });
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      h.requests.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        signal: init?.signal ?? undefined,
      });
      if (options.exchangeNever) return new Promise<Response>(() => undefined);
      return new Response(JSON.stringify({ key: 'issued' }), {
        status: options.exchangeStatus ?? 200,
      });
    }) as typeof fetch,
  };
  return h;
}

function codexInput(
  overrides: { ports?: number[]; timeoutMs?: number } = {},
): BrowserAuthorizeInput {
  return {
    provider: 'codex',
    ports: overrides.ports ?? [1455, 1457],
    timeoutMs: overrides.timeoutMs ?? 600_000,
    buildAuthorizationUrl: ({ redirectUri, codeChallenge, state }) =>
      `https://auth.example/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${codeChallenge}&state=${state}`,
    exchange: async (args, signal, deps): Promise<Credential> => {
      const res = await deps.fetch('https://auth.example/token', {
        method: 'POST',
        body: JSON.stringify(args),
        signal,
      });
      if (!res.ok) throw new BrowserAuthError('failed');
      return { type: 'apiKey', key: (await res.json()).key };
    },
  };
}

describe('base64url helpers', () => {
  it('encodes bytes without padding and converts base64 to base64url', () => {
    expect(base64UrlFromBytes(Uint8Array.from([0xff, 0xff, 0xff]))).toBe('____');
    expect(base64UrlFromBytes(new Uint8Array(0))).toBe('');
    expect(base64UrlFromBytes(Uint8Array.from([0x00]))).toBe('AA');
    expect(base64UrlFromBytes(Uint8Array.from([0xfb, 0xef, 0xbe]))).toBe('----');
    expect(Buffer.from(new Uint8Array(64).fill(0xab)).toString('base64url')).toBe(VERIFIER);
    expect(base64UrlFromBase64('a+b/c==')).toBe('a-b_c');
  });
});

describe('callback validation', () => {
  it('accepts only the exact provider callback with a matching state', () => {
    expect(readCallbackCode(callback({ code: 'c' }), 'codex', STATE)).toBe('c');
    expect(
      failureCode(() => readCallbackCode(callback({ code: 'c' }, 'openrouter'), 'codex', STATE)),
    ).toBe('failed');
    expect(failureCode(() => readCallbackCode('https://oauth/codex?code=c', 'codex', STATE))).toBe(
      'failed',
    );
    expect(failureCode(() => readCallbackCode('usage://other/codex?code=c', 'codex', STATE))).toBe(
      'failed',
    );
    expect(failureCode(() => readCallbackCode(undefined, 'codex', STATE))).toBe('failed');
    expect(failureCode(() => readCallbackCode('not a url', 'codex', STATE))).toBe('failed');
  });

  it('rejects a mismatched state, a denial and repeated or missing parameters', () => {
    expect(
      failureCode(() => readCallbackCode(callback({ code: 'c', state: 'other' }), 'codex', STATE)),
    ).toBe('state-mismatch');
    expect(
      failureCode(() => readCallbackCode(callback({ error: 'access_denied' }), 'codex', STATE)),
    ).toBe('rejected');
    for (const raw of [
      callback({ code: 'c' }) + '&code=other',
      callback({ code: '' }),
      callback({}),
    ]) {
      expect(failureCode(() => readCallbackCode(raw, 'codex', STATE))).toBe('rejected');
    }
  });
});

describe('browser authorization session', () => {
  it('binds the loopback port before the browser opens, with a PKCE challenge and a private verifier', async () => {
    const h = harness();
    const session = await startBrowserAuthorization(codexInput(), h.deps);
    expect(h.loopback).toEqual([{ provider: 'codex', port: 1455 }]);
    expect(session.redirectUri).toBe('http://127.0.0.1:1455/auth/callback');
    expect(session.expiresAt).toBe(601_000);
    await expect(session.authorize()).resolves.toEqual({ type: 'apiKey', key: 'issued' });
    expect(h.opened).toHaveLength(1);
    expect(h.opened[0].redirectUrl).toBe('usage://oauth/codex');

    const url = new URL(h.opened[0].url);
    expect(url.searchParams.get('code_challenge')).toBe(challengeFor(VERIFIER));
    expect(url.searchParams.get('state')).toBe(STATE);
    expect(url.searchParams.get('redirect_uri')).toBe(session.redirectUri);
    expect(h.opened[0].url).not.toContain(VERIFIER);
    expect(session.authorizationUrl).toBe(h.opened[0].url);
  });

  it('falls back to the next port when the earlier one is taken', async () => {
    const h = harness({ busyPorts: [1455] });
    const session = await startBrowserAuthorization(codexInput(), h.deps);
    expect(h.loopback).toEqual([
      { provider: 'codex', port: 1455 },
      { provider: 'codex', port: 1457 },
    ]);
    expect(session.redirectUri).toBe('http://127.0.0.1:1457/auth/callback');
  });

  it('reports a missing native module and unusable ports without opening the browser', async () => {
    await expect(
      startBrowserAuthorization(codexInput(), harness({ unavailable: true }).deps),
    ).rejects.toMatchObject({ code: 'unavailable' });
    const busy = harness({ allPortsBusy: true });
    await expect(startBrowserAuthorization(codexInput(), busy.deps)).rejects.toMatchObject({
      code: 'port-unavailable',
    });
    expect(busy.opened).toEqual([]);
  });

  it('exchanges the code once and always stops the listener', async () => {
    const h = harness();
    const session = await startBrowserAuthorization(codexInput(), h.deps);
    await expect(session.authorize()).resolves.toEqual({ type: 'apiKey', key: 'issued' });
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]).toMatchObject({
      url: 'https://auth.example/token',
      body: {
        code: 'abc',
        codeVerifier: VERIFIER,
        redirectUri: 'http://127.0.0.1:1455/auth/callback',
      },
    });
    expect(h.stops).toBe(1);
    // A single-use code is never exchanged twice, even after a successful attempt.
    await expect(session.authorize()).rejects.toMatchObject({ code: 'failed' });
    expect(h.requests).toHaveLength(1);
  });

  it('treats a closed browser as cancelled without exchanging', async () => {
    for (const result of [{ type: 'cancel' }, { type: 'dismiss' }]) {
      const h = harness({ session: result });
      const session = await startBrowserAuthorization(codexInput(), h.deps);
      await expect(session.authorize()).rejects.toMatchObject({ code: 'cancelled' });
      expect(h.requests).toEqual([]);
      expect(h.stops).toBe(1);
    }
  });

  it('fails when the browser reports success without a callback URL', async () => {
    const h = harness({ session: { type: 'success' } });
    const session = await startBrowserAuthorization(codexInput(), h.deps);
    await expect(session.authorize()).rejects.toMatchObject({ code: 'failed' });
    expect(h.requests).toEqual([]);
  });

  it('rejects a mismatched state without exchanging', async () => {
    const h = harness({ session: { type: 'success', url: callback({ code: 'abc', state: 'x' }) } });
    const session = await startBrowserAuthorization(codexInput(), h.deps);
    await expect(session.authorize()).rejects.toMatchObject({ code: 'state-mismatch' });
    expect(h.requests).toEqual([]);
    expect(h.stops).toBe(1);
  });

  it('cancels the session, aborts a pending exchange and stops listening', async () => {
    const h = harness({ exchangeNever: true });
    const session = await startBrowserAuthorization(codexInput(), h.deps);
    const pending = session.authorize();
    await Promise.resolve();
    session.cancel();
    expect(h.dismissals).toBe(1);
    expect(h.requests[0].signal?.aborted).toBe(true);
    expect(h.stops).toBe(1);
    // The provider may still answer after the cancel; the caller must not receive that credential.
    await expect(Promise.race([pending, Promise.resolve('pending')])).resolves.toBe('pending');
  });

  it('expires the session, dismisses the browser and stops listening', async () => {
    jest.useFakeTimers();
    try {
      const h = harness({ sessionNever: true });
      const session = await startBrowserAuthorization(codexInput({ timeoutMs: 1000 }), h.deps);
      const pending = session.authorize();
      await Promise.resolve();
      jest.advanceTimersByTime(1001);
      await expect(pending).rejects.toMatchObject({ code: 'expired' });
      expect(h.dismissals).toBe(1);
      expect(h.requests).toEqual([]);
      expect(h.stops).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('marks the session as waiting for its callback only while it runs', async () => {
    const h = harness();
    let duringOpen: boolean | undefined;
    const session = await startBrowserAuthorization(codexInput(), {
      ...h.deps,
      openAuthSession: async (url, redirectUrl) => {
        duringOpen = isAwaitingCallback();
        return h.deps.openAuthSession!(url, redirectUrl);
      },
    });
    expect(isAwaitingCallback()).toBe(false);
    await session.authorize();
    expect(duringOpen).toBe(true);
    expect(isAwaitingCallback()).toBe(false);
  });

  it('gives up on a stalled code exchange instead of connecting forever', async () => {
    jest.useFakeTimers();
    try {
      const h = harness({ exchangeNever: true });
      const session = await startBrowserAuthorization(codexInput(), h.deps);
      const pending = session.authorize();
      const outcome = expect(pending).rejects.toMatchObject({ code: 'failed' });
      await jest.advanceTimersByTimeAsync(EXCHANGE_TIMEOUT_MS + 1);
      await outcome;
      expect(h.requests[0].signal?.aborted).toBe(true);
      expect(h.stops).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops listening when the exchange fails', async () => {
    const h = harness({ exchangeStatus: 500 });
    const session = await startBrowserAuthorization(codexInput(), h.deps);
    await expect(session.authorize()).rejects.toMatchObject({ code: 'failed' });
    expect(h.stops).toBe(1);
  });
});

describe('Android auth session', () => {
  const REDIRECT = 'usage://oauth/codex';

  function android(
    result: { type: string; url?: string },
    linkAfterClose?: string,
    linkBeforeClose?: string,
  ) {
    let listener: ((e: { url: string }) => void) | undefined;
    let removed = false;
    const deps = {
      lateMs: 50,
      addUrlListener: (fn: (e: { url: string }) => void) => {
        listener = fn;
        return { remove: () => (removed = true) };
      },
      open: async () => {
        if (linkBeforeClose) listener?.({ url: linkBeforeClose });
        if (linkAfterClose) setTimeout(() => listener?.({ url: linkAfterClose }), 10);
        return result;
      },
    };
    return { deps, removed: () => removed };
  }

  it('passes a normal success straight through', async () => {
    const a = android({ type: 'success', url: `${REDIRECT}?code=c` });
    await expect(openAuthSessionAndroid('https://auth', REDIRECT, a.deps)).resolves.toEqual({
      type: 'success',
      url: `${REDIRECT}?code=c`,
    });
    expect(a.removed()).toBe(true);
  });

  it('recovers a callback that lands just after the app became active', async () => {
    const a = android({ type: 'dismiss' }, `${REDIRECT}?code=late&state=s`);
    await expect(openAuthSessionAndroid('https://auth', REDIRECT, a.deps)).resolves.toEqual({
      type: 'success',
      url: `${REDIRECT}?code=late&state=s`,
    });
  });

  it('keeps a real dismissal and ignores unrelated links', async () => {
    const a = android({ type: 'dismiss' }, 'usage://account/1');
    await expect(openAuthSessionAndroid('https://auth', REDIRECT, a.deps)).resolves.toEqual({
      type: 'dismiss',
    });
    expect(a.removed()).toBe(true);
  });
});
