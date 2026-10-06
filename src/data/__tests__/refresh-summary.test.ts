import { summarizeCycle, summarizeOutcomes } from '@/data/refresh-summary';
import type { AccountView } from '@/data/summary';

const view = (id: string, providerId: string, name: string, label = name): AccountView => ({
  account: { id, providerId, label, authMethod: 'apiKey', sortOrder: 0, createdAt: 0 },
  meta: { id: providerId, name, automation: 'spec', auth: ['apiKey'] },
  snapshot: null,
  health: null,
  source: 'auto',
});

const views = [
  view('a', 'deepseek', 'DeepSeek Open Platform'),
  view('b', 'relay', 'API relay', '小猫 API'),
  view('c', 'cline', 'Cline / ClinePass'),
];
const ok = { type: 'ok' as const, snapshot: {} as never };

describe('refresh summary', () => {
  it('counts updated accounts and ignores ones that never refresh', () => {
    expect(
      summarizeOutcomes({ a: ok, c: ok, b: { type: 'skipped', reason: 'legacy-account' } }, views),
    ).toEqual({ kind: 'ok', updated: 2 });
  });

  it('names each failed account (relays by their site name) with its reason', () => {
    expect(
      summarizeOutcomes(
        {
          a: ok,
          b: { type: 'failed', kind: 'network', message: 'The request timed out.' },
          c: {
            type: 'failed',
            kind: 'invalid-credential',
            message: 'The credential was rejected.',
          },
        },
        views,
      ),
    ).toEqual({
      kind: 'partial',
      updated: 1,
      failed: [
        { name: '小猫 API', message: 'The request timed out.' },
        { name: 'Cline / ClinePass', message: 'The credential was rejected.' },
      ],
    });
  });

  it('reports a cycle that ran out of time', () => {
    expect(
      summarizeCycle({ outcomes: {}, alertsSent: 0, pruned: false, timedOut: true }, views),
    ).toEqual({ kind: 'timeout' });
  });
});
