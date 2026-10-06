import {
  BrowserAuthError,
  startBrowserAuthorization,
  type BrowserAuthorization,
  type BrowserAuthorizeDeps,
} from '@/authkit/browser-authorize';
import {
  CODEX_CALLBACK_PORTS,
  CODEX_CLIENT_ID,
  CODEX_ISSUER,
  CODEX_ORIGINATOR,
  CODEX_SCOPES,
  credentialFromTokens,
  type TokenResponse,
} from '@/providers/codex/auth';

/**
 * Browser sign-in for ChatGPT / Codex, mirroring the CLI authorization request documented in
 * docs/provider-api-auth.md: PKCE S256, the CLI client id, and the loopback callback the issuer
 * accepts. These endpoints are not public API, so the request shape is verified against the
 * open-source CLI rather than against the live service.
 */
export const CODEX_BROWSER_TIMEOUT_MS = 15 * 60_000;

export type CodexBrowserSignIn = BrowserAuthorization;

export async function startCodexBrowserSignIn(
  overrides: Partial<BrowserAuthorizeDeps> = {},
): Promise<CodexBrowserSignIn> {
  return startBrowserAuthorization(
    {
      provider: 'codex',
      ports: [...CODEX_CALLBACK_PORTS],
      timeoutMs: CODEX_BROWSER_TIMEOUT_MS,
      buildAuthorizationUrl: ({ redirectUri, codeChallenge, state }) => {
        const url = new URL(`${CODEX_ISSUER}/oauth/authorize`);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', CODEX_CLIENT_ID);
        url.searchParams.set('redirect_uri', redirectUri);
        url.searchParams.set('code_challenge', codeChallenge);
        url.searchParams.set('code_challenge_method', 'S256');
        url.searchParams.set('state', state);
        url.searchParams.set('scope', CODEX_SCOPES);
        url.searchParams.set('id_token_add_organizations', 'true');
        url.searchParams.set('codex_cli_simplified_flow', 'true');
        url.searchParams.set('originator', CODEX_ORIGINATOR);
        return url.toString();
      },
      exchange: async ({ code, codeVerifier, redirectUri }, signal, deps) => {
        const res = await deps.fetch(`${CODEX_ISSUER}/oauth/token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: CODEX_CLIENT_ID,
            code_verifier: codeVerifier,
          }).toString(),
          signal,
        });
        // The code is single use: a rejection is final, a transport failure is not retried either.
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          throw new BrowserAuthError('rejected');
        }
        if (!res.ok) throw new BrowserAuthError('failed');
        let json: unknown;
        try {
          json = await res.json();
        } catch {
          throw new BrowserAuthError('failed');
        }
        try {
          return credentialFromTokens(json as TokenResponse, deps.now());
        } catch {
          throw new BrowserAuthError('failed');
        }
      },
    },
    overrides,
  );
}
