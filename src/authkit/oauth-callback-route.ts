/**
 * Deep links that arrive outside a live sign-in session.
 *
 * The sign-in callback normally never reaches the app as a system link: the system authorization
 * session intercepts `usage://oauth/<provider>` and hands it to the running session, which is the
 * only holder of the PKCE verifier and state. A link that arrives here is therefore either stale or
 * arrived after the app was restarted — the code cannot be exchanged, and it must not be: keeping a
 * half-finished authorization around would defeat PKCE.
 *
 * The sensitive query is dropped and the user lands on the add-account list to start again.
 */
export function redirectOAuthSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    // Only an absolute app callback is treated as a sign-in link; relative routes pass through.
    return /^usage:\/\/oauth[/?#]/i.test(path.trim()) ? '/add' : path;
  } catch {
    // Never crash inside the router hook.
    return path;
  }
}
