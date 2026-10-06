import {
  isCaptureComplete,
  toSessionCredential,
  type CaptureSpec,
  type Captured,
} from '@/authkit/webview-capture';
import type { Credential } from '@/core/types';

/** Reads cookies for a URL (the iOS WebKit store in the app, a stub in tests). */
export interface CookieSource {
  get(url: string): Promise<Record<string, string>>;
  clear?(): Promise<void>;
}

/**
 * Collect cookies for every domain of the capture spec and merge them. Later domains do not
 * overwrite earlier ones, so the primary domain wins on name clashes.
 */
export async function readCookies(
  spec: CaptureSpec,
  source: CookieSource,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const domain of spec.cookieDomains) {
    let got: Record<string, string> = {};
    try {
      got = await source.get(`https://${domain}`);
    } catch {
      continue; // a missing store for one domain must not hide the others
    }
    for (const [k, v] of Object.entries(got)) if (!(k in out) && v !== '') out[k] = v;
  }
  return out;
}

/** One capture attempt: a credential once the signed-in state is visible, otherwise null. */
export async function tryCapture(
  spec: CaptureSpec,
  source: CookieSource,
  storage: Record<string, string> = {},
): Promise<Credential | null> {
  const captured: Captured = { cookies: await readCookies(spec, source), storage };
  return isCaptureComplete(spec, captured) ? toSessionCredential(spec, captured) : null;
}

/**
 * Parse a pasted `Cookie:` header ("a=1; b=2") or a bare token into cookies. This is the fallback
 * for accounts whose provider blocks sign-in inside an embedded browser (Google/Apple SSO): the
 * user copies the cookie from a desktop browser's developer tools.
 */
export function parseCookieHeader(input: string): Record<string, string> {
  const out: Record<string, string> = {};
  const text = input.trim().replace(/^cookie:\s*/i, '');
  for (const part of text.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (name && value) out[name] = value;
  }
  return out;
}

/** Credential from a pasted cookie header; null if none of the expected cookies are present. */
export function credentialFromCookieHeader(spec: CaptureSpec, input: string): Credential | null {
  const cookies = parseCookieHeader(input);
  return isCaptureComplete(spec, { cookies, storage: {} })
    ? toSessionCredential(spec, { cookies, storage: {} })
    : null;
}
