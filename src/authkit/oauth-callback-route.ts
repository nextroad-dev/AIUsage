import { isAwaitingCallback } from '@/authkit/callback-session';

/**
 * Sign-in callback deep links (`usage://oauth/<provider>`) as seen by the router.
 *
 * - A live sign-in session is the only holder of the PKCE verifier and state, so it must get the
 *   link. On iOS the system authorization session intercepts it before the router ever sees it. On
 *   Android it arrives as an ordinary app link that the session's own listener also receives, so
 *   while a session is waiting the router ignores it (empty path = no navigation) instead of
 *   leaving the sign-in screen.
 * - Any other callback is stale or arrived after a restart: the code cannot be exchanged, and it
 *   must not be (keeping a half-finished authorization around would defeat PKCE). The sensitive
 *   query is dropped and the user lands on the add-account list to start again.
 */
export function redirectOAuthSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string {
  try {
    // Only an absolute app callback is treated as a sign-in link; relative routes pass through.
    if (!/^usage:\/\/oauth[/?#]/i.test(path.trim())) return path;
    return !initial && isAwaitingCallback() ? '' : '/add';
  } catch {
    // Never crash inside the router hook.
    return path;
  }
}
