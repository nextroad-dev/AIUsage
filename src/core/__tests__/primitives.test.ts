import { backoffMs, canRefresh, MIN_REFRESH_INTERVAL_MS, parseRetryAfter } from '@/core/backoff';
import { evalNum, evalTime } from '@/core/expr';
import { getPath } from '@/core/path';
import { toIso } from '@/core/time';

describe('getPath', () => {
  const o = { a: { b: [{ c: 1 }, { c: 2 }] }, n: null };
  it('reads nested and indexed paths', () => {
    expect(getPath(o, 'a.b[1].c')).toBe(2);
    expect(getPath(o, '')).toBe(o);
  });
  it('returns undefined for missing or through null', () => {
    expect(getPath(o, 'a.x.y')).toBeUndefined();
    expect(getPath(o, 'n.x')).toBeUndefined();
  });
});

describe('expr', () => {
  const scope = { root: { total: 10, used: '2.5', nested: { v: 7 } }, item: { v: 3, s: 'x' } };
  it('evaluates paths, numeric strings and $root', () => {
    expect(evalNum('v', scope)).toBe(3);
    expect(evalNum('$root.used', scope)).toBe(2.5);
    expect(evalNum('s', scope)).toBeUndefined();
  });
  it('supports arithmetic and coalesce', () => {
    expect(evalNum({ sub: ['$root.total', '$root.used'] }, scope)).toBe(7.5);
    expect(evalNum({ div: [1, 0] }, scope)).toBeUndefined();
    expect(evalNum({ coalesce: ['missing', 'v'] }, scope)).toBe(3);
    expect(evalNum({ sub: ['missing', 1] }, scope)).toBeUndefined();
  });
  it('evaluates times', () => {
    expect(evalTime('t', { root: {}, item: { t: 1790000000 } })).toBe('2026-09-21T14:13:20.000Z');
  });
});

describe('toIso', () => {
  it('accepts seconds, milliseconds, ISO and numeric strings', () => {
    expect(toIso(1790000000)).toBe(toIso(1790000000000));
    expect(toIso('2026-10-06T00:00:00Z')).toBe('2026-10-06T00:00:00.000Z');
    expect(toIso('1790000000')).toBe(toIso(1790000000));
  });
  it('rejects garbage', () => {
    expect(toIso('nope')).toBeUndefined();
    expect(toIso(null)).toBeUndefined();
    expect(toIso(NaN)).toBeUndefined();
  });
});

describe('backoff', () => {
  it('doubles from 1 minute and caps at 30', () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(backoffMs)).toEqual([
      60_000, 120_000, 240_000, 480_000, 960_000, 1_800_000, 1_800_000,
    ]);
    expect(backoffMs(0)).toBe(0);
  });
  it('parses Retry-After seconds and dates', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
    expect(
      parseRetryAfter('Wed, 07 Oct 2026 00:00:10 GMT', Date.parse('2026-10-07T00:00:00Z')),
    ).toBe(10_000);
    expect(parseRetryAfter('garbage')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
  it('rate-limits refresh', () => {
    const now = 1_000_000_000;
    expect(canRefresh({ failures: 0, now })).toBe(true);
    expect(canRefresh({ lastAttemptAt: now - 60_000, failures: 0, now })).toBe(false);
    expect(canRefresh({ lastAttemptAt: now - MIN_REFRESH_INTERVAL_MS, failures: 0, now })).toBe(
      true,
    );
    // manual pull-to-refresh bypasses the minimum interval but not backoff
    expect(canRefresh({ lastAttemptAt: now - 1000, failures: 0, now, force: true })).toBe(true);
    expect(canRefresh({ lastAttemptAt: now - 1000, failures: 2, now, force: true })).toBe(false);
    expect(
      canRefresh({ lastAttemptAt: now - 1000, failures: 0, now, force: true, retryAfterMs: 5000 }),
    ).toBe(false);
  });
});
