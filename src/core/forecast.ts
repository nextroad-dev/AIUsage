import { usedFraction } from './meter-utils';
import type { Meter } from './types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Window lengths for the meter ids providers use; unknown ids rely on recorded samples only. */
const WINDOW_MS: Record<string, number> = {
  session: 5 * HOUR,
  five_hour: 5 * HOUR,
  daily: DAY,
  weekly: 7 * DAY,
  monthly: 30 * DAY,
};

export interface UsagePoint {
  /** epoch ms the value was observed */
  at: number;
  /** used fraction 0..1+ */
  used: number;
}

/**
 * When will this window run out at the current pace? Linear projection from the earliest point of
 * the current cycle (or the window start, where usage is zero, when the window length is known) to
 * the latest value. Returns the epoch ms of exhaustion only when it lands before the reset — a
 * window that lasts until it resets needs no warning. Undefined when there is not enough signal.
 */
export function forecastExhaustion(
  meter: Meter,
  cyclePoints: UsagePoint[],
  now: number,
): number | undefined {
  const used = usedFraction(meter);
  if (used === undefined || used >= 1) return undefined;
  const resetAt = meter.resetsAt ? Date.parse(meter.resetsAt) : NaN;
  if (!Number.isFinite(resetAt) || resetAt <= now) return undefined;

  const points = [...cyclePoints].filter((p) => p.at <= now).sort((a, b) => a.at - b.at);
  const len = WINDOW_MS[meter.id];
  if (len !== undefined) {
    const start = resetAt - len;
    if (start < now) points.unshift({ at: start, used: 0 });
  }
  points.push({ at: now, used });
  const first = points[0];
  const span = now - first.at;
  // too little history (or no progress) to call a pace
  if (span < 15 * MINUTE || used - first.used <= 0.02) return undefined;

  const rate = (used - first.used) / span;
  const at = now + (1 - used) / rate;
  return at < resetAt ? at : undefined;
}
