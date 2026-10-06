import {
  countdown,
  cycleKey,
  level,
  mostConstrained,
  remaining,
  usedFraction,
} from '@/core/meter-utils';
import type { Meter } from '@/core/types';

const pct = (id: string, used: number, resetsAt?: string): Meter => ({
  id,
  label: id,
  kind: { type: 'percent', used },
  scope: { type: 'overall' },
  resetsAt,
});
const amt = (id: string, used: number, limit?: number): Meter => ({
  id,
  label: id,
  kind: { type: 'amount', used, limit, unit: 'USD' },
  scope: { type: 'overall' },
});
const bal = (id: string, value: number): Meter => ({
  id,
  label: id,
  kind: { type: 'balance', value, unit: 'USD' },
  scope: { type: 'overall' },
});

describe('usage level', () => {
  it('uses 60% / 85% thresholds', () => {
    expect([0, 0.59, 0.6, 0.84, 0.85, 1.2].map(level)).toEqual([
      'good',
      'good',
      'warn',
      'warn',
      'bad',
      'bad',
    ]);
    expect(level(undefined)).toBe('unknown');
  });
  it('computes fraction and remaining per kind', () => {
    expect(usedFraction(pct('a', 40))).toBeCloseTo(0.4);
    expect(usedFraction(amt('a', 5, 20))).toBe(0.25);
    expect(usedFraction(amt('a', 5))).toBeUndefined();
    expect(usedFraction(bal('a', 5))).toBeUndefined();
    expect(remaining(pct('a', 130))).toBe(0);
    expect(remaining(amt('a', 5, 20))).toBe(15);
    expect(remaining(bal('a', 7))).toBe(7);
  });
});

describe('countdown', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  it('formats days, hours, minutes', () => {
    expect(countdown('2026-10-08T15:30:00Z', now)?.label).toBe('2d 3h');
    expect(countdown('2026-10-06T15:12:00Z', now)?.label).toBe('3h 12m');
    expect(countdown('2026-10-06T12:12:30Z', now)?.label).toBe('12m');
    expect(countdown('2026-10-06T12:00:30Z', now)?.label).toBe('<1m');
  });
  it('flags elapsed and invalid times', () => {
    expect(countdown('2026-10-06T11:00:00Z', now)).toMatchObject({ elapsed: true, ms: 0 });
    expect(countdown(undefined, now)).toBeUndefined();
    expect(countdown('nope', now)).toBeUndefined();
  });
});

describe('mostConstrained / cycleKey', () => {
  it('picks the highest used fraction; unknown ratios rank last', () => {
    expect(mostConstrained([bal('b', 1), pct('p', 30), amt('a', 9, 10)])?.id).toBe('a');
    expect(mostConstrained([bal('b', 1)])?.id).toBe('b');
    expect(mostConstrained([])).toBeUndefined();
  });
  it('changes key when the reset cycle changes', () => {
    const a = cycleKey('acc', pct('weekly', 90, '2026-10-10T00:00:00Z'));
    const b = cycleKey('acc', pct('weekly', 5, '2026-10-17T00:00:00Z'));
    expect(a).not.toBe(b);
    expect(cycleKey('acc', { ...pct('w', 1), scope: { type: 'model', name: 'opus' } })).toContain(
      ':opus:',
    );
  });
});
