import { AuthExpiredError } from '@/core/errors';
import {
  anthropicPlatformPlugin,
  monthBounds,
  openaiPlatformPlugin,
} from '@/providers/platform-costs';
import { ctxWith, fakeFetch, NOW } from '@/test-utils/fetch';

const key = { type: 'apiKey' as const, key: 'sk-admin-1' };
const monthStart = monthBounds(NOW).start; // 2026-10-01T00:00:00Z
const day = (d: number) => Date.UTC(2026, 9, d) / 1000;

const openaiUrl = (page?: string) => {
  const q = new URLSearchParams({
    start_time: String(monthStart.getTime() / 1000),
    bucket_width: '1d',
    limit: '31',
  });
  if (page) q.set('page', page);
  return `https://api.openai.com/v1/organization/costs?${q}`;
};
const anthropicUrl = () =>
  `https://api.anthropic.com/v1/organizations/cost_report?${new URLSearchParams({
    starting_at: '2026-10-01T00:00:00Z',
    bucket_width: '1d',
    limit: '31',
  })}`;

describe('OpenAI API platform spend', () => {
  it('sums this month and today across pages, in the reported currency', async () => {
    const f = fakeFetch({
      [openaiUrl()]: {
        json: {
          data: [
            { start_time: day(1), results: [{ amount: { value: 1.25, currency: 'usd' } }] },
            { start_time: day(5), results: [{ amount: { value: 2, currency: 'usd' } }] },
          ],
          has_more: true,
          next_page: 'p2',
        },
      },
      [openaiUrl('p2')]: {
        json: {
          data: [{ start_time: day(6), results: [{ amount: { value: 0.5, currency: 'usd' } }] }],
          has_more: false,
        },
      },
    });
    const s = await openaiPlatformPlugin().fetchUsage('a', key, ctxWith(f.fetch));
    expect(s.meters.map((m) => [m.id, m.kind])).toEqual([
      ['month', { type: 'amount', used: 3.75, unit: 'USD' }],
      ['today', { type: 'amount', used: 0.5, unit: 'USD' }],
    ]);
    expect(s.meters[0].resetsAt).toBe('2026-11-01T00:00:00.000Z');
    expect(f.calls[0].headers.Authorization).toBe('Bearer sk-admin-1');
  });

  it('treats a project key (403) as the wrong credential', async () => {
    const f = fakeFetch({ [openaiUrl()]: { status: 403 } });
    await expect(
      openaiPlatformPlugin().fetchUsage('a', key, ctxWith(f.fetch)),
    ).rejects.toBeInstanceOf(AuthExpiredError);
  });
});

describe('Anthropic API platform spend', () => {
  it('converts cent strings to dollars and sends the admin headers', async () => {
    const f = fakeFetch({
      [anthropicUrl()]: {
        json: {
          data: [
            {
              starting_at: '2026-10-02T00:00:00Z',
              results: [
                { amount: '12345.6', currency: 'USD' },
                { amount: '55', currency: 'USD' },
              ],
            },
            { starting_at: '2026-10-06T00:00:00Z', results: [{ amount: '250', currency: 'USD' }] },
            { starting_at: '2026-10-03T00:00:00Z', results: [] },
          ],
          has_more: false,
          next_page: null,
        },
      },
    });
    const s = await anthropicPlatformPlugin().fetchUsage('a', key, ctxWith(f.fetch));
    expect(s.meters.map((m) => [m.id, m.kind])).toEqual([
      ['month', { type: 'amount', used: 126.51, unit: 'USD' }],
      ['today', { type: 'amount', used: 2.5, unit: 'USD' }],
    ]);
    expect(f.calls[0].headers['x-api-key']).toBe('sk-admin-1');
    expect(f.calls[0].headers['anthropic-version']).toBe('2023-06-01');
  });

  it('reports an unrecognised response as unsupported', async () => {
    const f = fakeFetch({ [anthropicUrl()]: { json: { nope: true } } });
    expect((await anthropicPlatformPlugin().fetchUsage('a', key, ctxWith(f.fetch))).status).toEqual(
      {
        type: 'unsupported',
      },
    );
  });
});
