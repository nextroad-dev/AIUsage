import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Linking, Platform } from 'react-native';

import { beginCallbackWait } from '@/authkit/callback-session';
import { LoopbackUnavailableError, startLoopback, stopLoopback } from '@/authkit/loopback';
import type { Credential } from '@/core/types';

export type BrowserProvider = 'codex' | 'openrouter';

export type BrowserAuthErrorCode =
  | 'unavailable'
  | 'port-unavailable'
  | 'cancelled'
  | 'expired'
  | 'state-mismatch'
  | 'rejected'
  | 'failed';

/** Sign-in failure with a code the UI maps to a user-facing message. Never carries secrets. */
export class BrowserAuthError extends Error {
  constructor(public readonly code: BrowserAuthErrorCode) {
    super(code);
    this.name = 'BrowserAuthError';
  }
}

export interface BrowserAuthorizeDeps {
  fetch: typeof fetch;
  now(): number;
  randomBytes(count: number): Promise<Uint8Array>;
  /** Standard base64 digest; converted to base64url for the S256 challenge. */
  digestBase64(value: string): Promise<string>;
  startLoopback(provider: BrowserProvider, port: number): Promise<{ port: number }>;
  stopLoopback(): Promise<void>;
  openAuthSession(url: string, redirectUrl: string): Promise<{ type: string; url?: string }>;
  dismissAuthSession(): void;
}

export const browserAuthorizeDeps: BrowserAuthorizeDeps = {
  fetch: (...args) => fetch(...args),
  now: Date.now,
  randomBytes: Crypto.getRandomBytesAsync,
  digestBase64: (value) =>
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value, {
      encoding: Crypto.CryptoEncoding.BASE64,
    }),
  startLoopback,
  stopLoopback,
  openAuthSession: (url, redirectUrl) =>
    Platform.OS === 'android'
      ? openAuthSessionAndroid(url, redirectUrl)
      : WebBrowser.openAuthSessionAsync(url, redirectUrl),
  dismissAuthSession: () => {
    try {
      WebBrowser.dismissAuthSession();
    } catch {
      /* no session is open */
    }
  },
};

/** How long to keep listening for the callback link after Android reports the browser closed. */
export const ANDROID_LATE_CALLBACK_MS = 1500;

/**
 * Android has no system authorization session: expo-web-browser opens a Custom Tab and races the
 * app link against the app becoming active again. Returning through the callback triggers both,
 * and when "active" wins the session reads as dismissed although the link is on its way. A second
 * listener started before the browser opens catches that late link, so a completed sign-in is
 * never reported as cancelled.
 */
export async function openAuthSessionAndroid(
  url: string,
  redirectUrl: string,
  deps: {
    open: (url: string, redirectUrl: string) => Promise<{ type: string; url?: string }>;
    addUrlListener: (fn: (e: { url: string }) => void) => { remove(): void };
    lateMs: number;
  } = {
    open: (u, r) => WebBrowser.openAuthSessionAsync(u, r),
    addUrlListener: (fn) => Linking.addEventListener('url', fn),
    lateMs: ANDROID_LATE_CALLBACK_MS,
  },
): Promise<{ type: string; url?: string }> {
  let caught: string | undefined;
  let onCaught: (() => void) | undefined;
  const sub = deps.addUrlListener(({ url: link }) => {
    if (!link.startsWith(redirectUrl)) return;
    caught = link;
    onCaught?.();
  });
  try {
    const result = await deps.open(url, redirectUrl);
    if (result.type === 'success') return result;
    if (!caught) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, deps.lateMs);
        onCaught = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
    return caught ? { type: 'success', url: caught } : result;
  } finally {
    sub.remove();
  }
}

/** Upper bound for exchanging the authorization code once the browser hands it back. */
export const EXCHANGE_TIMEOUT_MS = 30_000;

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Unpadded base64url encoding without relying on globals such as btoa. */
export function base64UrlFromBytes(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += BASE64URL_ALPHABET[a >> 2];
    out += BASE64URL_ALPHABET[((a & 0b11) << 4) | ((b ?? 0) >> 4)];
    if (b === undefined) break;
    out += BASE64URL_ALPHABET[((b & 0b1111) << 2) | ((c ?? 0) >> 6)];
    if (c === undefined) break;
    out += BASE64URL_ALPHABET[c & 0b111111];
  }
  return out;
}

export function base64UrlFromBase64(value: string): string {
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface BrowserAuthorizeInput {
  provider: BrowserProvider;
  /** Loopback ports to try in order; the first one that binds wins. */
  ports: number[];
  timeoutMs: number;
  buildAuthorizationUrl(args: {
    redirectUri: string;
    codeChallenge: string;
    state: string;
  }): string;
  exchange(
    args: { code: string; codeVerifier: string; redirectUri: string },
    signal: AbortSignal,
    deps: BrowserAuthorizeDeps,
  ): Promise<Credential>;
}

export interface BrowserAuthorization {
  authorizationUrl: string;
  redirectUri: string;
  expiresAt: number;
  /** Opens the system browser, waits for the loopback callback and exchanges it once. */
  authorize(signal?: AbortSignal): Promise<Credential>;
  cancel(): void;
}

/**
 * Validates the URL the system browser hands back. Only the exact app callback for this provider
 * is accepted, the state must match, and repeated or missing parameters are rejected.
 */
export function readCallbackCode(
  rawUrl: string | undefined,
  provider: BrowserProvider,
  expectedState: string,
): string {
  if (!rawUrl) throw new BrowserAuthError('failed');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BrowserAuthError('failed');
  }
  if (url.protocol !== 'usage:' || url.hostname !== 'oauth' || url.pathname !== `/${provider}`) {
    throw new BrowserAuthError('failed');
  }
  const params = url.searchParams;
  if (params.getAll('code').length > 1 || params.getAll('state').length > 1) {
    throw new BrowserAuthError('rejected');
  }
  if (params.get('error')) throw new BrowserAuthError('rejected');
  const state = params.get('state');
  if (!state || state !== expectedState) throw new BrowserAuthError('state-mismatch');
  const code = params.get('code');
  if (!code || !code.trim()) throw new BrowserAuthError('rejected');
  return code;
}

/**
 * Browser sign-in over a loopback redirect: the listener binds before the browser opens, the
 * verifier and state stay in memory, and the authorization code is exchanged at most once.
 * Every exit path stops the listener.
 */
export async function startBrowserAuthorization(
  input: BrowserAuthorizeInput,
  overrides: Partial<BrowserAuthorizeDeps> = {},
): Promise<BrowserAuthorization> {
  const deps: BrowserAuthorizeDeps = { ...browserAuthorizeDeps, ...overrides };
  // 64 random bytes as the verifier and 32 as the state, both RFC 7636 unreserved base64url.
  const codeVerifier = base64UrlFromBytes(await deps.randomBytes(64));
  const codeChallenge = base64UrlFromBase64(await deps.digestBase64(codeVerifier));
  const state = base64UrlFromBytes(await deps.randomBytes(32));
  const expiresAt = deps.now() + input.timeoutMs;

  let port: number | undefined;
  for (const candidate of input.ports) {
    if (deps.now() >= expiresAt) break;
    try {
      port = (await deps.startLoopback(input.provider, candidate)).port;
      break;
    } catch (e) {
      if (e instanceof LoopbackUnavailableError) throw new BrowserAuthError('unavailable');
      // Port in use: try the next candidate.
    }
  }
  if (port === undefined) throw new BrowserAuthError('port-unavailable');

  const redirectUri = `http://127.0.0.1:${port}/auth/callback`;
  const authorizationUrl = input.buildAuthorizationUrl({ redirectUri, codeChallenge, state });
  const appCallbackUrl = `usage://oauth/${input.provider}`;
  const abort = new AbortController();

  let closed = false;
  let started = false;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stopListening = async () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    await deps.stopLoopback().catch(() => undefined);
  };

  let endWait: () => void = () => undefined;

  const session: BrowserAuthorization = {
    authorizationUrl,
    redirectUri,
    expiresAt,
    async authorize(signal) {
      if (closed) throw new BrowserAuthError('cancelled');
      if (started) throw new BrowserAuthError('failed');
      started = true;
      const onAbort = () => session.cancel();
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(
        () => {
          timedOut = true;
          deps.dismissAuthSession();
        },
        Math.max(0, expiresAt - deps.now()),
      );
      // while waiting, an Android callback link belongs to this session, not to the router
      endWait = beginCallbackWait();
      try {
        if (deps.now() >= expiresAt) throw new BrowserAuthError('expired');
        const result = await deps.openAuthSession(authorizationUrl, appCallbackUrl);
        if (timedOut) throw new BrowserAuthError('expired');
        if (closed) throw new BrowserAuthError('cancelled');
        if (result?.type !== 'success') throw new BrowserAuthError('cancelled');
        const code = readCallbackCode(result.url, input.provider, state);
        // A single-use code must never be sent twice, so there is no retry here. A stalled network
        // must not leave the sign-in "connecting" forever, so the exchange has its own deadline.
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const stalled = new Promise<never>((_, reject) => {
          deadline = setTimeout(() => {
            abort.abort();
            reject(new BrowserAuthError('failed'));
          }, EXCHANGE_TIMEOUT_MS);
        });
        try {
          return await Promise.race([
            input.exchange({ code, codeVerifier, redirectUri }, abort.signal, deps),
            stalled,
          ]);
        } finally {
          clearTimeout(deadline);
        }
      } finally {
        endWait();
        signal?.removeEventListener('abort', onAbort);
        await stopListening();
      }
    },
    cancel() {
      if (closed) return;
      closed = true;
      // a cancelled session must not keep claiming callback links, even if its exchange hangs
      endWait();
      abort.abort();
      deps.dismissAuthSession();
      void stopListening();
    },
  };
  return session;
}
