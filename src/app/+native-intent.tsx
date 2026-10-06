import { redirectOAuthSystemPath } from '@/authkit/oauth-callback-route';

/**
 * Native link handling: a `usage://oauth/...` callback that the authorization session did not
 * consume carries a code this app can no longer exchange, so it is dropped instead of becoming a
 * route with the code in its query. See `redirectOAuthSystemPath`.
 */
export function redirectSystemPath(options: { path: string; initial: boolean }): string {
  return redirectOAuthSystemPath(options);
}
