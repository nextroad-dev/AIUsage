import { forecastExhaustion } from '@/core/forecast';
import type { Meter } from '@/core/types';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const H = 3_600_000;

const meter = (id: string, used: number, resetInH: number): Meter => ({
  id,
  label: id,
  kind: { type: 'percent', used },
  scope: { type: 'overall' },
  resetsAt: new Date(NOW + resetInH * H).toISOString(),
});

describe('forecastExhaustion', () => {
  it('projects from the window start when the window length is known', () => {
    // 5-hour window, 2h in, 60% used -> 30%/h -> the last 40% takes 80 minutes, before the reset
    const at = forecastExhaustion(meter('session', 60, 3), [], NOW);
    expect(Math.abs(at! - (NOW + (80 / 60) * H))).toBeLessThan(1000);
  });

  it('uses recorded samples of the current cycle for windows of unknown length', () => {
    const points = [{ at: NOW - 2 * H, used: 0.2 }];
    // 20% -> 60% in 2h -> 20%/h -> 2h left, reset in 10h
    const at = forecastExhaustion(meter('custom', 60, 10), points, NOW);
    expect(Math.abs(at! - (NOW + 2 * H))).toBeLessThan(1000);
  });

  it('says nothing when the window lasts until its reset or there is too little signal', () => {
    expect(forecastExhaustion(meter('session', 20, 3), [], NOW)).toBeUndefined();
    expect(forecastExhaustion(meter('custom', 60, 10), [], NOW)).toBeUndefined();
    expect(
      forecastExhaustion(meter('custom', 60, 10), [{ at: NOW - 5 * 60_000, used: 0.5 }], NOW),
    ).toBeUndefined();
    expect(forecastExhaustion(meter('session', 100, 3), [], NOW)).toBeUndefined();
  });
});
