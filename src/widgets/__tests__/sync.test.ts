import type { Meter } from '@/core/types';
import type { AccountView } from '@/data/summary';
import { widgetProps, widgetTimeline } from '@/widgets/sync';

const NOW = Date.parse('2026-10-06T12:00:00Z');
const H = 3_600_000;

const pct = (id: string, used: number, resetInH?: number): Meter => ({
  id,
  label: id === 'weekly' ? 'Weekly' : '5-hour window',
  kind: { type: 'percent', used },
  scope: { type: 'overall' },
  resetsAt: resetInH === undefined ? undefined : new Date(NOW + resetInH * H).toISOString(),
});

const view = (id: string, meters: Meter[]): AccountView => ({
  account: {
    id,
    providerId: 'codex',
    label: id,
    authMethod: 'oauthPkce',
    sortOrder: 0,
    createdAt: 1,
  },
  snapshot: {
    providerId: 'codex',
    accountId: id,
    fetchedAt: new Date(NOW).toISOString(),
    meters,
    status: { type: 'ok' },
  },
  health: null,
  source: 'auto',
});

describe('widget data', () => {
  it('lists accounts in attention order with their tightest windows first', () => {
    const p = widgetProps(
      [view('calm', [pct('weekly', 10)]), view('busy', [pct('weekly', 30), pct('session', 90, 2)])],
      NOW,
    );
    expect(p.accounts.map((a) => a.name)).toEqual(['busy', 'calm']);
    expect(p.accounts[0].meters.map((m) => [m.short, m.used])).toEqual([
      ['5h', 0.9],
      ['Week', 0.3],
    ]);
  });

  it('adds a timeline entry at each reset where the window reads as fresh', () => {
    const entries = widgetTimeline(
      [view('busy', [pct('session', 90, 2), pct('weekly', 30, 50)])],
      NOW,
    );
    expect(entries.map((e) => e.date.getTime())).toEqual([NOW, NOW + 2 * H, NOW + 50 * H]);
    const afterFirst = entries[1].props.accounts[0].meters;
    expect(afterFirst.find((m) => m.short === '5h')?.used).toBe(0);
    expect(afterFirst.find((m) => m.short === 'Week')?.used).toBe(0.3);
  });
});
