export const MIN_REFRESH_INTERVAL_MS = 2 * 60_000;
const BASE_MS = 60_000;
const CAP_MS = 30 * 60_000;

/** failures=1 -> 1 min, 2 -> 2 min, 3 -> 4 min ... capped at 30 min */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(CAP_MS, BASE_MS * 2 ** (failures - 1));
}

/** Retry-After header: delta-seconds or HTTP date -> ms (undefined if unparsable) */
export function parseRetryAfter(
  value: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : Math.max(0, t - now);
}

/** Whether an account may be refreshed now, given its last attempt and consecutive failures. */
export function canRefresh(opts: {
  lastAttemptAt?: number;
  failures: number;
  now: number;
  force?: boolean;
  retryAfterMs?: number;
}): boolean {
  if (opts.lastAttemptAt == null) return true;
  const wait = Math.max(
    opts.force ? 0 : MIN_REFRESH_INTERVAL_MS,
    backoffMs(opts.failures),
    opts.retryAfterMs ?? 0,
  );
  return opts.now - opts.lastAttemptAt >= wait;
}
