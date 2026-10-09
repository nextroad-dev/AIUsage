import {
  attentionScore,
  deriveStatus,
  lastUpdated,
  orderViews,
  sortViews,
  subscriptionTotals,
  type AccountView,
} from '@/data/summary';
import { visibleMeters } from '@/core/meter-utils';
import type { Meter, UsageSnapshot } from '@/core/types';
import type { Health } from '@/db/repos';

const pct = (used: number, resetsAt?: string): Meter => ({
  id: 'w',
  label: 'W',
  kind: { type: 'percent', used },
  scope: { type: 'overall' },
  resetsAt,
});
const snap = (meters: Meter[], at = '2026-10-06T00:00:00.000Z'): UsageSnapshot => ({
  providerId: 'p',
  accountId: 'a',
  fetchedAt: at,
  meters,
  status: { type: 'ok' },
});
const view = (id: string, over: Partial<AccountView> = {}, sortOrder = 0): AccountView => ({
  account: {
    id,
    providerId: 'p',
    label: id,
    authMethod: 'apiKey',
    sortOrder,
    createdAt: sortOrder,
  },
  snapshot: null,
  health: null,
  source: 'auto',
  ...over,
});
const health = (h: Partial<Health>): Health => ({ accountId: 'a', failures: 0, ...h });

describe('deriveStatus', () => {
  it('pending before the first successful fetch', () => {
    expect(deriveStatus(view('a')).kind).toBe('pending');
    expect(deriveStatus(view('a', { snapshot: snap([]) })).kind).toBe('pending');
  });
  it('ok with last success time', () => {
    expect(
      deriveStatus(
        view('a', {
          snapshot: snap([pct(1)]),
          health: health({ statusType: 'ok', lastSuccessAt: 5 }),
        }),
      ),
    ).toEqual({ kind: 'ok', lastSuccessAt: 5 });
  });
  it('failures add a badge but keep the last success time', () => {
    const s = deriveStatus(
      view('a', {
        snapshot: snap([pct(1)]),
        health: health({ statusType: 'stale', errorMessage: 'timeout', lastSuccessAt: 7 }),
      }),
    );
    expect(s).toEqual({ kind: 'stale', message: 'timeout', lastSuccessAt: 7 });
  });
  it('maps authExpired, unsupported and error', () => {
    for (const k of ['authExpired', 'unsupported', 'error'] as const) {
      expect(
        deriveStatus(view('a', { snapshot: snap([pct(1)]), health: health({ statusType: k }) }))
          .kind,
      ).toBe(k);
    }
  });
  it('manual accounts are always manual', () => {
    expect(deriveStatus(view('a', { source: 'legacy' })).kind).toBe('manual');
  });
});

describe('sorting and totals', () => {
  it('puts login problems first, then the most used, then the rest by order', () => {
    const views = [
      view('low', { snapshot: snap([pct(10)]) }, 0),
      view('high', { snapshot: snap([pct(90)]) }, 1),
      view(
        'expired',
        { snapshot: snap([pct(5)]), health: health({ statusType: 'authExpired' }) },
        2,
      ),
      view('nodata', {}, 3),
    ];
    expect(sortViews(views).map((v) => v.account.id)).toEqual(['expired', 'high', 'low', 'nodata']);
    expect(attentionScore(views[3])).toBe(1); // no ratio => -(-1)
  });

  it('orders the overview by problems first, then the user order, never by usage', () => {
    const views = [
      view('low', { snapshot: snap([pct(10)]) }, 0),
      view('high', { snapshot: snap([pct(90)]) }, 1),
      view('broken', { snapshot: snap([pct(5)]), health: health({ statusType: 'error' }) }, 2),
      view(
        'expired',
        { snapshot: snap([pct(5)]), health: health({ statusType: 'authExpired' }) },
        3,
      ),
    ];
    expect(orderViews(views).map((v) => v.account.id)).toEqual([
      'expired',
      'broken',
      'low',
      'high',
    ]);
  });

  it('reports the latest successful fetch across automatic accounts', () => {
    expect(lastUpdated([])).toBeUndefined();
    expect(
      lastUpdated([
        view('a', { snapshot: snap([pct(1)], '2026-10-06T01:00:00.000Z') }),
        view('b', { snapshot: snap([pct(1)], '2026-10-06T03:00:00.000Z') }),
        view('c', { source: 'legacy', snapshot: snap([pct(1)], '2026-10-07T00:00:00.000Z') }),
      ]),
    ).toBe(Date.parse('2026-10-06T03:00:00.000Z'));
  });

  it('sums manual plan prices per currency', () => {
    const v = (price: number | undefined, currency?: string) =>
      view('x', {
        account: {
          ...view('x').account,
          manual: { planName: 'p', priceMonthly: price, currency, meters: [] },
        },
      });
    expect(
      subscriptionTotals([v(20, 'USD'), v(100, 'USD'), v(49, 'CNY'), v(undefined), view('auto')]),
    ).toEqual({ USD: 120, CNY: 49 });
  });

  it('hides empty add-on quotas but never the only meter of an account', () => {
    const credits: Meter = {
      id: 'credits',
      label: 'Credits balance',
      kind: { type: 'balance', value: 0, unit: 'credits' },
      scope: { type: 'overall' },
    };
    const onDemand: Meter = {
      id: 'on_demand',
      label: 'On-demand',
      kind: { type: 'amount', used: 0, unit: 'USD' },
      scope: { type: 'overall' },
    };
    const window = pct(40);
    expect(visibleMeters([window, credits, onDemand])).toEqual([window]);
    expect(visibleMeters([credits])).toEqual([credits]);
    const funded = { ...credits, kind: { type: 'balance' as const, value: 12, unit: 'credits' } };
    expect(visibleMeters([window, funded])).toEqual([window, funded]);
  });
});
