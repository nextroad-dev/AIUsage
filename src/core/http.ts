import { parseRetryAfter } from './backoff';
import { AuthExpiredError, HttpError, RateLimitedError, TimeoutError } from './errors';

export interface RequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** treat 403 like 401 (session-cookie providers return 403 when logged out) */
  forbiddenIsAuth?: boolean;
}

export interface JsonResponse {
  status: number;
  json: unknown;
  text: string;
}

/**
 * JSON request with timeout. Maps 401 (and optionally 403) to AuthExpiredError,
 * 429 to RateLimitedError (with Retry-After), other non-2xx to HttpError.
 * Never logs or echoes credentials.
 */
export async function requestJson(url: string, opts: RequestOptions = {}): Promise<JsonResponse> {
  const doFetch = opts.fetch ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const hasBody = opts.body !== undefined;
    const res = await doFetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(hasBody && typeof opts.body !== 'string' ? { 'Content-Type': 'application/json' } : {}),
        ...opts.headers,
      },
      body: !hasBody
        ? undefined
        : typeof opts.body === 'string'
          ? opts.body
          : JSON.stringify(opts.body),
      signal: ctrl.signal,
    });
    if (res.status === 401 || (opts.forbiddenIsAuth && res.status === 403)) {
      throw new AuthExpiredError(`HTTP ${res.status}`);
    }
    if (res.status === 429) {
      throw new RateLimitedError(parseRetryAfter(res.headers.get('retry-after')));
    }
    if (!res.ok) throw new HttpError(res.status);
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: res.status, json, text };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new TimeoutError();
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
