import {
  BrowserAuthError,
  startBrowserAuthorization,
  type BrowserAuthorization,
  type BrowserAuthorizeDeps,
} from '@/authkit/browser-authorize';
import type { Credential } from '@/core/types';

/**
 * OpenRouter PKCE sign-in.
 *
 * Official flow: the user authorizes at `https://openrouter.ai/auth` with a `callback_url` and an
 * S256 `code_challenge`, OpenRouter redirects to that callback with a single-use `code` plus the
 * `state` it was given, and `POST /api/v1/auth/keys` exchanges the code for a user-controlled API
 * key. Only https and localhost/127.0.0.1 callbacks are documented, so the callback is the loopback
 * listener rather than a custom scheme. See docs/provider-api-auth.md.
 */
export const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth';
export const OPENROUTER_EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';
/** Preferred port keeps one stable "localhost:<port>" entry in the user's OpenRouter account. */
export const OPENROUTER_PREFERRED_PORT = 51789;
export const OPENROUTER_TIMEOUT_MS = 10 * 60_000;

const EPHEMERAL_LOW = 49152;
const EPHEMERAL_HIGH = 65535;

/** Preferred port first, then a few random ports in case it is taken. */
export function openRouterCallbackPorts(random: () => number = Math.random, count = 4): number[] {
  const ports = [OPENROUTER_PREFERRED_PORT];
  // Bounded attempts: a degenerate random source must not spin forever.
  for (let attempt = 0; attempt < count * 4 && ports.length < count; attempt += 1) {
    const candidate = Math.min(
      EPHEMERAL_HIGH,
      EPHEMERAL_LOW + Math.floor(random() * (EPHEMERAL_HIGH - EPHEMERAL_LOW + 1)),
    );
    if (!ports.includes(candidate)) ports.push(candidate);
  }
  return ports;
}

export type OpenRouterSignIn = BrowserAuthorization;

export async function startOpenRouterSignIn(
  overrides: Partial<BrowserAuthorizeDeps> = {},
): Promise<OpenRouterSignIn> {
  return startBrowserAuthorization(
    {
      provider: 'openrouter',
      ports: openRouterCallbackPorts(),
      timeoutMs: OPENROUTER_TIMEOUT_MS,
      buildAuthorizationUrl: ({ redirectUri, codeChallenge, state }) => {
        const url = new URL(OPENROUTER_AUTH_URL);
        url.searchParams.set('callback_url', redirectUri);
        url.searchParams.set('code_challenge', codeChallenge);
        url.searchParams.set('code_challenge_method', 'S256');
        url.searchParams.set('state', state);
        url.searchParams.set('key_label', 'AI Usage');
        return url.toString();
      },
      exchange: async ({ code, codeVerifier }, signal, deps) => {
        const res = await deps.fetch(OPENROUTER_EXCHANGE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            code,
            code_verifier: codeVerifier,
            code_challenge_method: 'S256',
          }),
          signal,
        });
        if (res.status === 400 || res.status === 403) throw new BrowserAuthError('rejected');
        if (!res.ok) throw new BrowserAuthError('failed');
        let json: unknown;
        try {
          json = await res.json();
        } catch {
          throw new BrowserAuthError('failed');
        }
        if (
          !json ||
          typeof json !== 'object' ||
          !('key' in json) ||
          typeof json.key !== 'string' ||
          !json.key.trim()
        ) {
          throw new BrowserAuthError('failed');
        }
        // The key is the credential; it is never returned in an error or logged.
        return { type: 'apiKey', key: json.key } satisfies Credential;
      },
    },
    overrides,
  );
}
