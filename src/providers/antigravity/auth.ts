import {
  BrowserAuthError,
  startBrowserAuthorization,
  type BrowserAuthorizeDeps,
} from '@/authkit/browser-authorize';
import { AuthExpiredError, HttpError } from '@/core/errors';
import { requestJson } from '@/core/http';
import type { Credential, FetchContext } from '@/core/types';

export interface AntigravityClient {
  clientId: string;
  clientSecret: string;
}

// Desktop OAuth client configuration, not a user's Google credentials. See ANTIGRAVITY.md.
export function antigravityClient(): AntigravityClient {
  const clientId = process.env.EXPO_PUBLIC_ANTIGRAVITY_CLIENT_ID?.trim();
  const clientSecret = process.env.EXPO_PUBLIC_ANTIGRAVITY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new BrowserAuthError('configuration-missing');
  return { clientId, clientSecret };
}

export function tokenCredential(value: unknown, now: number, previous?: Credential): Credential {
  const data = value as Record<string, unknown> | null;
  if (
    !data ||
    typeof data.access_token !== 'string' ||
    !data.access_token.trim() ||
    typeof data.expires_in !== 'number' ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0
  ) {
    throw new Error('Invalid token response');
  }
  const old = previous?.type === 'oauth' ? previous : undefined;
  const refreshToken =
    typeof data.refresh_token === 'string' && data.refresh_token.trim()
      ? data.refresh_token
      : old?.refreshToken;
  if (!refreshToken) throw new BrowserAuthError('rejected');
  return {
    ...old,
    type: 'oauth',
    accessToken: data.access_token,
    refreshToken,
    expiresAt: now + data.expires_in * 1000,
  };
}

export async function startAntigravitySignIn(
  deps: Partial<BrowserAuthorizeDeps> = {},
  client = antigravityClient(),
) {
  return startBrowserAuthorization(
    {
      provider: 'antigravity',
      ports: [51121, 51122, 51123],
      timeoutMs: 15 * 60_000,
      buildAuthorizationUrl: ({ redirectUri, codeChallenge, state }) => {
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({
          client_id: client.clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          state,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          scope: 'openid email profile https://www.googleapis.com/auth/cloud-platform',
          access_type: 'offline',
          prompt: 'consent',
        }).toString();
        return url.toString();
      },
      exchange: async ({ code, codeVerifier, redirectUri }, signal, d) => {
        const res = await d.fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: client.clientId,
            client_secret: client.clientSecret,
            grant_type: 'authorization_code',
            code,
            code_verifier: codeVerifier,
            redirect_uri: redirectUri,
          }).toString(),
        });
        if (!res.ok) throw new BrowserAuthError(res.status < 500 ? 'rejected' : 'failed');
        return tokenCredential(await res.json(), d.now());
      },
    },
    deps,
  );
}

export async function refreshAntigravity(
  cred: Credential,
  ctx: FetchContext,
  client = antigravityClient(),
) {
  if (cred.type !== 'oauth' || !cred.refreshToken) throw new AuthExpiredError();
  try {
    const res = await requestJson('https://oauth2.googleapis.com/token', {
      method: 'POST',
      fetch: ctx.fetch,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: cred.refreshToken,
      }).toString(),
    });
    return tokenCredential(res.json, ctx.now().getTime(), cred);
  } catch (e) {
    if (e instanceof HttpError && e.status === 400) throw new AuthExpiredError();
    throw e;
  }
}
