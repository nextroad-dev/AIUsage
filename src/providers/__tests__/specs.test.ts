import { runSpec } from '@/core/spec-engine';
import { specs } from '@/providers/specs';
import { ctxWith, fakeFetch } from '@/test-utils/fetch';

const key = { type: 'apiKey', key: 'k' } as const;
const run = (
  spec: Parameters<typeof runSpec>[0],
  routes: Parameters<typeof fakeFetch>[0],
  region?: string,
) => runSpec(spec, 'acc', key, ctxWith(fakeFetch(routes).fetch, region));

describe('openrouter', () => {
  it('maps balance, key limit and spend windows', async () => {
    const s = await run(specs.openrouter, {
      'https://openrouter.ai/api/v1/credits': {
        json: { data: { total_credits: 10, total_usage: 2.5 } },
      },
      'https://openrouter.ai/api/v1/key': {
        json: {
          data: { limit: 5, usage: 1, usage_daily: 0.2, usage_weekly: 0.7, usage_monthly: 1 },
        },
      },
    });
    expect(s.meters.map((m) => m.id)).toEqual([
      'credits',
      'key_limit',
      'usage_daily',
      'usage_weekly',
      'usage_monthly',
    ]);
    expect(s.meters[0].kind).toEqual({ type: 'balance', value: 7.5, unit: 'USD' });
    expect(s.meters[1].kind).toEqual({ type: 'amount', used: 1, limit: 5, unit: 'USD' });
  });
  it('omits key_limit when the key has no limit (null)', async () => {
    const s = await run(specs.openrouter, {
      'https://openrouter.ai/api/v1/credits': {
        json: { data: { total_credits: 1, total_usage: 0 } },
      },
      'https://openrouter.ai/api/v1/key': { json: { data: { limit: null, usage: 0.3 } } },
    });
    expect(s.meters.map((m) => m.id)).toEqual(['credits']);
  });
});

describe('minimax', () => {
  it('derives used from the REMAINING count, per model, with a ms reset time', async () => {
    const s = await run(specs.minimax, {
      'https://platform.minimax.io/v1/api/openplatform/coding_plan/remains': {
        json: {
          model_remains: [
            {
              model_name: 'MiniMax-M2',
              current_interval_total_count: 1500,
              current_interval_usage_count: 1245,
              end_time: 1790000000000,
            },
            {
              model_name: 'other',
              current_interval_total_count: 100,
              current_interval_usage_count: 100,
              end_time: 1790000000000,
            },
          ],
        },
      },
    });
    expect(s.meters).toHaveLength(2);
    expect(s.meters[0]).toMatchObject({
      id: 'session',
      scope: { type: 'model', name: 'MiniMax-M2' },
      kind: { type: 'amount', used: 255, limit: 1500, unit: 'prompts' },
      resetsAt: '2026-09-21T14:13:20.000Z',
    });
    expect(s.meters[1].kind).toMatchObject({ used: 0, limit: 100 });
  });
  it('uses the China host for the cn region and skips entries missing counts', async () => {
    const s = await run(
      specs.minimax,
      {
        'https://platform.minimaxi.com/v1/api/openplatform/coding_plan/remains': {
          json: { model_remains: [{ model_name: 'x' }] },
        },
      },
      'cn',
    );
    expect(s.status).toEqual({ type: 'unsupported' });
  });
});

describe('poe', () => {
  it('reads the balance even when history fails', async () => {
    const s = await run(specs.poe, {
      'https://api.poe.com/usage/current_balance': { json: { current_point_balance: 1234 } },
      'https://api.poe.com/usage/points_history': { status: 500 },
    });
    expect(s.meters[0].kind).toEqual({ type: 'balance', value: 1234, unit: 'points' });
  });
  it('is unsupported if the balance field is renamed', async () => {
    const s = await run(specs.poe, {
      'https://api.poe.com/usage/current_balance': { json: { whatever: 1 } },
    });
    expect(s.status).toEqual({ type: 'unsupported' });
  });
});

describe('kimi balance', () => {
  it('uses the regional host and currency', async () => {
    const body = { data: { available_balance: 49.5 } };
    const intl = await run(specs.kimiBalance, {
      'https://api.moonshot.ai/v1/users/me/balance': { json: body },
    });
    const cn = await run(
      specs.kimiBalance,
      { 'https://api.moonshot.cn/v1/users/me/balance': { json: body } },
      'cn',
    );
    expect(intl.meters[0].kind).toEqual({ type: 'balance', value: 49.5, unit: 'USD' });
    expect(cn.meters[0].kind).toEqual({ type: 'balance', value: 49.5, unit: 'CNY' });
  });
});

describe('kimi code', () => {
  it('maps the monthly pool and 5-hour window (used or remaining form)', async () => {
    const s = await run(specs.kimiCode, {
      'https://api.kimi.ai/coding/v1/usages': {
        json: {
          usage: { limit: '100', remaining: '40', resetTime: '2026-11-01T00:00:00Z' },
          limits: [{ detail: { limit: '50', used: '10', resetTime: '2026-10-06T15:00:00Z' } }],
        },
      },
    });
    expect(s.meters.find((m) => m.id === 'monthly')?.kind).toEqual({
      type: 'amount',
      used: 60,
      limit: 100,
      unit: 'units',
    });
    expect(s.meters.find((m) => m.id === 'session')?.kind).toEqual({
      type: 'amount',
      used: 10,
      limit: 50,
      unit: 'units',
    });
  });
});

describe('runway', () => {
  it('sends the version header and maps the credit balance', async () => {
    const f = fakeFetch({
      'https://api.dev.runwayml.com/v1/organization': { json: { creditBalance: 5000 } },
    });
    const s = await runSpec(specs.runway, 'acc', key, ctxWith(f.fetch));
    expect(f.calls[0].headers['X-Runway-Version']).toBe('2024-11-06');
    expect(s.meters[0].kind).toEqual({ type: 'balance', value: 5000, unit: 'credits' });
  });
});

describe('z.ai', () => {
  it('splits 5-hour and weekly by unit and ignores non-token limits', async () => {
    const s = await run(specs.zai, {
      'https://api.z.ai/api/monitor/usage/quota/limit': {
        json: {
          data: {
            limits: [
              { type: 'TOKENS_LIMIT', unit: 3, percentage: 40, nextResetTime: 1790000000000 },
              { type: 'TOKENS_LIMIT', unit: 6, percentage: 10, nextResetTime: 1790500000000 },
              { type: 'TOKENS_LIMIT', unit: 9, percentage: 1 },
              { type: 'TIME_LIMIT', unit: 5, percentage: 99 },
            ],
          },
        },
      },
    });
    expect(s.meters.map((m) => [m.id, m.label])).toEqual([
      ['session', '5-hour window'],
      ['weekly', 'Weekly'],
      ['tokens_unit_9', 'Tokens'],
    ]);
    expect(s.meters[0].resetsAt).toBe('2026-09-21T14:13:20.000Z');
  });
});
