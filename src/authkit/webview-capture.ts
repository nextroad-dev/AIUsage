import type { Credential } from '@/core/types';

/**
 * Session capture for providers without OAuth. The WebView UI (batch 8) loads `loginUrl`,
 * the user signs in themselves, and these helpers decide when enough has been captured and
 * when a stored session is no longer valid.
 */
export interface CaptureSpec {
  loginUrl: string;
  /** cookie domains to read, e.g. ["cursor.com"] */
  cookieDomains: string[];
  /** capture is complete when at least one of these cookie names is present */
  anyOfCookies?: string[];
  /** ...and all of these localStorage keys (e.g. Windsurf's four keys) */
  allOfStorageKeys?: string[];
  /** a navigation to a URL containing one of these means "logged out" */
  loggedOutUrlHints?: string[];
}

export interface Captured {
  cookies: Record<string, string>;
  storage: Record<string, string>;
}

export function isCaptureComplete(spec: CaptureSpec, got: Captured): boolean {
  const cookiesOk =
    !spec.anyOfCookies?.length || spec.anyOfCookies.some((n) => (got.cookies[n] ?? '') !== '');
  const storageOk =
    !spec.allOfStorageKeys?.length ||
    spec.allOfStorageKeys.every((k) => (got.storage[k] ?? '') !== '');
  return cookiesOk && storageOk;
}

export function toSessionCredential(spec: CaptureSpec, got: Captured): Credential {
  const keep = spec.anyOfCookies;
  const cookies = keep?.length
    ? Object.fromEntries(Object.entries(got.cookies).filter(([k]) => keep.includes(k)))
    : got.cookies;
  return { type: 'session', cookies, storage: got.storage };
}

export function looksLoggedOut(spec: CaptureSpec, url: string): boolean {
  return (spec.loggedOutUrlHints ?? []).some((h) => url.includes(h));
}

export { jwtExpiryMs } from '@/authkit/jwt';
