import { DeviceFlowError, realDeps, type FlowDeps } from '@/authkit/device-flow';
import { jwtClaims, jwtExpiryMs } from '@/authkit/jwt';
import { AuthExpiredError } from '@/core/errors';
import type { Credential } from '@/core/types';

/**
 * Codex / ChatGPT sign-in, as implemented by the open-source Codex CLI (openai/codex,
 * codex-rs/login). These are not public, documented endpoints: they can change, and device-code
 * login must be enabled for the account in ChatGPT Settings > Security. Everything here is
 * verified against the CLI source, not against the live service; see docs/provider-api-auth.md.
 */
export const CODEX_ISSUER = 'https://auth.openai.com';
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
/** Browser sign-in scope, as requested by the official CLI authorization request. */
export const CODEX_SCOPES =
  'openid profile email offline_access api.connectors.read api.connectors.invoke';
/** Client identity the CLI sends with its own authorization request. */
export const CODEX_ORIGINATOR = 'codex_cli_rs';
/** Loopback ports registered for this client: the issuer accepts no other callback. */
export const CODEX_CALLBACK_PORTS = [1455, 1457];

const MAX_WAIT_MS = 15 * 60_000;

export interface CodexDeviceStart {
  deviceAuthId: string;
  userCode: string;
  /** page where the user types the code */
  verificationUri: string;
  intervalSec: number;
  expiresAt: number;
}

export interface TokenResponse {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

async function postJson(
  deps: FlowDeps,
  url: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await deps.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* empty or non-JSON body */
  }
  return { status: res.status, json };
}

export async function startCodexDevice(
  deps: FlowDeps = realDeps,
  issuer = CODEX_ISSUER,
): Promise<CodexDeviceStart> {
  const base = issuer.replace(/\/$/, '');
  const { status, json } = await postJson(deps, `${base}/api/accounts/deviceauth/usercode`, {
    client_id: CODEX_CLIENT_ID,
  });
  const userCode = (json.user_code ?? json.usercode) as unknown;
  const id = json.device_auth_id as unknown;
  if (status >= 400 || typeof userCode !== 'string' || typeof id !== 'string') {
    throw new DeviceFlowError(
      'failed',
      status === 404
        ? 'Device-code sign-in is not enabled for this ChatGPT account.'
        : `Could not start sign-in (HTTP ${status}).`,
    );
  }
  const interval = Number(json.interval);
  return {
    deviceAuthId: id,
    userCode,
    verificationUri: `${base}/codex/device`,
    intervalSec: Number.isFinite(interval) && interval > 0 ? interval : 5,
    expiresAt: deps.now() + MAX_WAIT_MS,
  };
}

/** Parse the token response into our credential. Expiry comes from the access token's `exp`. */
export function credentialFromTokens(
  t: TokenResponse,
  now: number,
  previous?: Credential,
): Credential {
  if (!t.access_token) throw new AuthExpiredError('token response had no access token');
  const prev = previous?.type === 'oauth' ? previous : undefined;
  const idClaims = t.id_token ? jwtClaims(t.id_token) : undefined;
  const authClaims = (idClaims?.['https://api.openai.com/auth'] ?? idClaims) as
    Record<string, unknown> | undefined;
  const accountId =
    typeof authClaims?.chatgpt_account_id === 'string'
      ? authClaims.chatgpt_account_id
      : prev?.accountId;
  const subscriptionUntil =
    claimTimeMs(authClaims?.chatgpt_subscription_active_until) ?? prev?.subscriptionUntil;
  const exp =
    jwtExpiryMs(t.access_token) ??
    (typeof t.expires_in === 'number' ? now + t.expires_in * 1000 : undefined);
  return {
    type: 'oauth',
    accessToken: t.access_token,
    // refresh tokens rotate: keep the old one only if the server did not send a new one
    refreshToken: t.refresh_token ?? prev?.refreshToken,
    expiresAt: exp,
    accountId,
    subscriptionUntil,
  };
}

/**
 * ChatGPT identity tokens carry the subscription end as `chatgpt_subscription_active_until`.
 * ⚠ The claim is not documented; accept an ISO string or epoch seconds/ms and ignore anything else.
 */
export function claimTimeMs(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}

/**
 * Polls until the user approves the code at the verification page, then exchanges the returned
 * authorization code (PKCE verifier supplied by the server) for tokens.
 */
export async function completeCodexDevice(
  start: CodexDeviceStart,
  opts: { signal?: AbortSignal; deps?: FlowDeps; issuer?: string } = {},
): Promise<Credential> {
  const deps = opts.deps ?? realDeps;
  const base = (opts.issuer ?? CODEX_ISSUER).replace(/\/$/, '');
  for (;;) {
    if (opts.signal?.aborted) throw new DeviceFlowError('cancelled');
    const left = start.expiresAt - deps.now();
    if (left <= 0) throw new DeviceFlowError('expired');
    await deps.sleep(Math.min(start.intervalSec * 1000, left), opts.signal);

    const { status, json } = await postJson(
      deps,
      `${base}/api/accounts/deviceauth/token`,
      { device_auth_id: start.deviceAuthId, user_code: start.userCode },
      opts.signal,
    );
    if (status === 403 || status === 404) continue; // not approved yet
    const code = json.authorization_code;
    const verifier = json.code_verifier;
    if (status >= 400 || typeof code !== 'string' || typeof verifier !== 'string') {
      throw new DeviceFlowError('failed', `Sign-in failed (HTTP ${status}).`);
    }

    const res = await deps.fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${base}/deviceauth/callback`,
        client_id: CODEX_CLIENT_ID,
        code_verifier: verifier,
      }).toString(),
      signal: opts.signal,
    });
    if (!res.ok) throw new DeviceFlowError('failed', `Token exchange failed (HTTP ${res.status}).`);
    return credentialFromTokens((await res.json()) as TokenResponse, deps.now());
  }
}

/**
 * Refresh-token grant. The refresh token rotates, so the caller must persist the result before
 * using it (CredentialManager does). "expired / reused / invalidated" mean the user must sign in
 * again, which surfaces as AuthExpiredError.
 */
export async function refreshCodexCredential(
  cred: Credential,
  deps: Pick<FlowDeps, 'fetch' | 'now'> = realDeps,
  issuer = CODEX_ISSUER,
): Promise<Credential> {
  if (cred.type !== 'oauth' || !cred.refreshToken) throw new AuthExpiredError('no refresh token');
  const res = await deps.fetch(`${issuer.replace(/\/$/, '')}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: CODEX_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: cred.refreshToken,
    }),
  });
  if (res.status === 401 || res.status === 400 || res.status === 403) {
    throw new AuthExpiredError('refresh token rejected');
  }
  if (!res.ok) throw new Error(`refresh failed (HTTP ${res.status})`); // transient: keep credential
  return credentialFromTokens((await res.json()) as TokenResponse, deps.now(), cred);
}
