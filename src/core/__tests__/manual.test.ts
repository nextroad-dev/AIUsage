import {
  manualMeters,
  manualSnapshot,
  nextReset,
  recordUsage,
  resetBounds,
  type ManualAccountConfig,
} from '@/core/manual';

const d = (s: string) => new Date(s);

describe('resetBounds', () => {
  it('rolling window advances from the anchor', () => {
    const w = { type: 'rolling', hours: 5 } as const;
    const { prev, next } = resetBounds(w, '2026-10-06T00:00:00Z', d('2026-10-06T11:00:00Z'));
    expect(prev.toISOString()).toBe('2026-10-06T10:00:00.000Z');
    expect(next.toISOString()).toBe('2026-10-06T15:00:00.000Z');
  });
  it('weekly and daily', () => {
    expect(
      nextReset(
        { type: 'weekly' },
        '2026-10-01T09:00:00Z',
        d('2026-10-06T12:00:00Z'),
      ).toISOString(),
    ).toBe('2026-10-08T09:00:00.000Z');
    expect(
      nextReset({ type: 'daily' }, '2026-10-01T09:00:00Z', d('2026-10-06T12:00:00Z')).toISOString(),
    ).toBe('2026-10-07T09:00:00.000Z');
  });
  it('handles an anchor in the future (previous cycle)', () => {
    const { prev, next } = resetBounds(
      { type: 'weekly' },
      '2026-10-20T00:00:00Z',
      d('2026-10-06T12:00:00Z'),
    );
    expect(prev.toISOString()).toBe('2026-10-06T00:00:00.000Z');
    expect(next.toISOString()).toBe('2026-10-13T00:00:00.000Z');
  });
  it('monthly clamps to month length and handles leap years', () => {
    const w = { type: 'monthly' } as const;
    expect(nextReset(w, '2026-01-31T00:00:00Z', d('2026-02-10T00:00:00Z')).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
    expect(nextReset(w, '2028-01-31T00:00:00Z', d('2028-02-10T00:00:00Z')).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
    // after Feb clamp, March returns to the 31st
    expect(nextReset(w, '2026-01-31T00:00:00Z', d('2026-03-01T00:00:00Z')).toISOString()).toBe(
      '2026-03-31T00:00:00.000Z',
    );
    // across a year boundary
    expect(nextReset(w, '2026-11-15T00:00:00Z', d('2026-12-20T00:00:00Z')).toISOString()).toBe(
      '2027-01-15T00:00:00.000Z',
    );
  });
});

const config: ManualAccountConfig = {
  planName: 'Max 5x',
  meters: [
    {
      id: 'session',
      label: '5-hour',
      window: { type: 'rolling', hours: 5 },
      anchor: '2026-10-06T00:00:00Z',
      limit: 100,
      unit: '%',
      percent: true,
    },
    {
      id: 'monthly',
      label: 'Monthly',
      window: { type: 'monthly' },
      anchor: '2026-09-15T00:00:00Z',
      limit: 625,
      unit: 'credits',
    },
  ],
};

describe('manual meters', () => {
  const now = d('2026-10-06T11:00:00Z');
  it('starts at zero, computes reset times, marks status manual', () => {
    const snap = manualSnapshot('claude', 'acc', config, {}, now);
    expect(snap.status).toEqual({ type: 'manual' });
    expect(snap.plan).toBe('Max 5x');
    expect(snap.meters[0]).toMatchObject({
      kind: { type: 'percent', used: 0 },
      resetsAt: '2026-10-06T15:00:00.000Z',
    });
    expect(snap.meters[1]).toMatchObject({
      kind: { type: 'amount', used: 0, limit: 625 },
      resetsAt: '2026-10-15T00:00:00.000Z',
    });
  });
  it('records usage by adding within the window', () => {
    let s = recordUsage({}, config.meters[1], now, { add: 100 });
    s = recordUsage(s, config.meters[1], now, { add: 25 });
    expect(manualMeters(config, s, now)[1].kind).toMatchObject({ used: 125 });
    s = recordUsage(s, config.meters[1], now, { set: 10 });
    expect(manualMeters(config, s, now)[1].kind).toMatchObject({ used: 10 });
    s = recordUsage(s, config.meters[1], now, { add: -50 });
    expect(manualMeters(config, s, now)[1].kind).toMatchObject({ used: 0 });
  });
  it('forgets usage recorded before the last reset', () => {
    const s = recordUsage({}, config.meters[0], d('2026-10-06T09:00:00Z'), { set: 80 });
    // 09:00 is in window [05:00,10:00) ... at 11:00 the window is [10:00,15:00)
    expect(manualMeters(config, s, d('2026-10-06T09:30:00Z'))[0].kind).toMatchObject({ used: 80 });
    expect(manualMeters(config, s, now)[0].kind).toMatchObject({ used: 0 });
  });
});
