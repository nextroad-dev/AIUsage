import { detectEarlyResets, type WeeklySeen } from '@/alerts/early-reset';
import type { Meter } from '@/core/types';
import type { AccountView } from '@/data/summary';

const NOW = new Date('2026-10-06T12:00:00Z');
const HOUR = 3_600_000;
const at = (h: number) => NOW.getTime() + h * HOUR;

const view = (
  id: string,
  used: number,
  resetsInHours: number,
  providerId = 'codex',
): AccountView => {
  const weekly: Meter = {
    id: 'weekly',
    label: 'Weekly',
    kind: { type: 'percent', used },
    scope: { type: 'overall' },
    resetsAt: new Date(at(resetsInHours)).toISOString(),
  };
  return {
    account: { id, providerId, label: id, authMethod: 'oauthPkce', sortOrder: 0, createdAt: 1 },
    meta: { id: providerId, name: 'ChatGPT / Codex', automation: 'plugin', auth: ['oauthPkce'] },
    snapshot: {
      providerId,
      accountId: id,
      fetchedAt: NOW.toISOString(),
      meters: [weekly],
      status: { type: 'ok' },
    },
    health: null,
    source: 'auto',
  };
};

it('notifies when the weekly window restarts days before its scheduled reset', () => {
  const seen: WeeklySeen = { a: { resetsAt: at(48), used: 81 } };
  const { events, next } = detectEarlyResets([view('a', 0, 7 * 24)], seen, NOW, true);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    kind: 'early-reset',
    title: 'Codex quota reset early',
    body: 'ChatGPT / Codex (a): the quota is available again.',
    cycleKey: `a:early:${at(7 * 24)}`,
  });
  expect(next.a).toEqual({ resetsAt: at(7 * 24), used: 0 });
});

it('stays quiet for the normal reset, the first sighting, an idle window and small time drift', () => {
  // normal reset: the old cycle had already ended
  expect(
    detectEarlyResets([view('a', 0, 7 * 24)], { a: { resetsAt: at(-0.5), used: 81 } }, NOW, true)
      .events,
  ).toEqual([]);
  // first sighting only records a baseline
  expect(detectEarlyResets([view('a', 0, 7 * 24)], {}, NOW, true).events).toEqual([]);
  // an unused window has nothing to give back
  expect(
    detectEarlyResets([view('a', 0, 7 * 24)], { a: { resetsAt: at(48), used: 0 } }, NOW, true)
      .events,
  ).toEqual([]);
  // the reset time wobbling by minutes is not a new window
  expect(
    detectEarlyResets([view('a', 40, 48.1)], { a: { resetsAt: at(48), used: 41 } }, NOW, true)
      .events,
  ).toEqual([]);
  // other providers are not covered
  expect(
    detectEarlyResets(
      [view('c', 0, 7 * 24, 'cline')],
      { c: { resetsAt: at(48), used: 81 } },
      NOW,
      true,
    ).events,
  ).toEqual([]);
});

it('sends one notification for several accounts and keeps tracking with the setting off', () => {
  const seen: WeeklySeen = {
    a: { resetsAt: at(48), used: 81 },
    b: { resetsAt: at(30), used: 20 },
  };
  const views = [view('a', 0, 7 * 24), view('b', 0, 7 * 24)];
  const { events } = detectEarlyResets(views, seen, NOW, true);
  expect(events).toHaveLength(1);
  expect(events[0].body).toBe(
    'ChatGPT / Codex (a), ChatGPT / Codex (b): the quota is available again.',
  );
  expect(events[0].alsoMarkFired).toEqual([
    { ruleId: 'b|weekly|early-reset', cycleKey: `b:early:${at(7 * 24)}` },
  ]);

  const off = detectEarlyResets(views, seen, NOW, false);
  expect(off.events).toEqual([]);
  expect(Object.keys(off.next)).toEqual(['a', 'b']);
});
