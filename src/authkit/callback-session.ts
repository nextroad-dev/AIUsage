/**
 * Whether a browser sign-in is waiting for its `usage://oauth/...` callback right now.
 *
 * On iOS the system authorization session intercepts the callback itself. On Android the callback
 * arrives as an ordinary app link that both the sign-in session and the router receive; while a
 * session is waiting, the router must leave that link alone (see `redirectOAuthSystemPath`).
 */
let waiting = 0;

export function beginCallbackWait(): () => void {
  waiting += 1;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    waiting -= 1;
  };
}

export const isAwaitingCallback = (): boolean => waiting > 0;
