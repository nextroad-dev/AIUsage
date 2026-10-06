/** OAuth 2.0 Device Authorization Grant (RFC 8628), used for GitHub Copilot and ChatGPT/Codex. */

export interface DeviceFlowConfig {
  deviceCodeUrl: string;
  tokenUrl: string;
  clientId: string;
  scope?: string;
  /** extra form fields for the token request */
  extraTokenParams?: Record<string, string>;
}

export interface DeviceFlowStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  /** seconds between polls */
  interval: number;
  /** epoch ms */
  expiresAt: number;
}

export interface DeviceFlowTokens {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms, when the server reports expires_in */
  expiresAt?: number;
  raw: Record<string, unknown>;
}

export class DeviceFlowError extends Error {
  constructor(
    public readonly code: 'expired' | 'denied' | 'cancelled' | 'failed',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'DeviceFlowError';
  }
}

export interface FlowDeps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export const realDeps: FlowDeps = {
  fetch: (...a) => fetch(...a),
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new DeviceFlowError('cancelled'));
      });
    }),
};

const form = (o: Record<string, string | undefined>) =>
  Object.entries(o)
    .filter((e): e is [string, string] => e[1] !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

async function postForm(deps: FlowDeps, url: string, body: string, signal?: AbortSignal) {
  const res = await deps.fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal,
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON error body */
  }
  return { status: res.status, json };
}

export async function startDeviceFlow(
  cfg: DeviceFlowConfig,
  deps: FlowDeps = realDeps,
): Promise<DeviceFlowStart> {
  const { status, json } = await postForm(
    deps,
    cfg.deviceCodeUrl,
    form({ client_id: cfg.clientId, scope: cfg.scope }),
  );
  const deviceCode = json.device_code;
  const userCode = json.user_code;
  const uri = json.verification_uri ?? json.verification_url;
  if (
    status >= 400 ||
    typeof deviceCode !== 'string' ||
    typeof userCode !== 'string' ||
    typeof uri !== 'string'
  ) {
    throw new DeviceFlowError('failed', `device code request failed (HTTP ${status})`);
  }
  return {
    deviceCode,
    userCode,
    verificationUri: uri,
    verificationUriComplete:
      typeof json.verification_uri_complete === 'string'
        ? json.verification_uri_complete
        : undefined,
    interval: typeof json.interval === 'number' && json.interval > 0 ? json.interval : 5,
    expiresAt: deps.now() + (typeof json.expires_in === 'number' ? json.expires_in : 900) * 1000,
  };
}

/**
 * Polls until the user approves. Handles authorization_pending, slow_down (+5 s as RFC 8628
 * requires), expiry, denial and cancellation via `signal`.
 */
export async function pollDeviceFlow(
  cfg: DeviceFlowConfig,
  start: DeviceFlowStart,
  opts: { signal?: AbortSignal; deps?: FlowDeps } = {},
): Promise<DeviceFlowTokens> {
  const deps = opts.deps ?? realDeps;
  let intervalMs = start.interval * 1000;
  for (;;) {
    if (opts.signal?.aborted) throw new DeviceFlowError('cancelled');
    if (deps.now() >= start.expiresAt) throw new DeviceFlowError('expired');
    await deps.sleep(intervalMs, opts.signal);
    if (deps.now() >= start.expiresAt) throw new DeviceFlowError('expired');

    const { json } = await postForm(
      deps,
      cfg.tokenUrl,
      form({
        client_id: cfg.clientId,
        device_code: start.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        ...cfg.extraTokenParams,
      }),
      opts.signal,
    );

    if (typeof json.access_token === 'string') {
      return {
        accessToken: json.access_token,
        refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
        expiresAt:
          typeof json.expires_in === 'number' ? deps.now() + json.expires_in * 1000 : undefined,
        raw: json,
      };
    }
    switch (json.error) {
      case 'authorization_pending':
        break;
      case 'slow_down':
        intervalMs += 5000;
        break;
      case 'expired_token':
        throw new DeviceFlowError('expired');
      case 'access_denied':
        throw new DeviceFlowError('denied');
      default:
        throw new DeviceFlowError(
          'failed',
          typeof json.error === 'string' ? json.error : 'unexpected response',
        );
    }
  }
}
