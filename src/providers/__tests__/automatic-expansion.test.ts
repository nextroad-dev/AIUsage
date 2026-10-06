import { AuthExpiredError, HttpError } from '@/core/errors';
import { runSpec } from '@/core/spec-engine';
import { specs } from '@/providers/specs';
import { validateCredential } from '@/providers/service';
import { ctxWith, fakeFetch } from '@/test-utils/fetch';

const key = { type: 'apiKey', key: 'k' } as const;
const ds = 'https://api.deepseek.com/user/balance';
const cmd = 'https://api.commandcode.ai/alpha/billing/credits';
const go = 'https://opencode.ai/zen/go/v1/usage';
const run = (spec: Parameters<typeof runSpec>[0], url: string, json: unknown) =>
  runSpec(spec, 'a', key, ctxWith(fakeFetch({ [url]: { json } }).fetch));

describe('DeepSeek balance', () => {
  it('keeps currencies separate and does not double-count balance components', async () => {
    const s = await run(specs.deepseek, ds, {
      is_available: true,
      balance_infos: [
        {
          currency: 'CNY',
          total_balance: '10.50',
          granted_balance: '1',
          topped_up_balance: '9.50',
        },
        { currency: 'USD', total_balance: '0', granted_balance: '0', topped_up_balance: '0' },
      ],
    });
    expect(s.meters.map((m) => [m.id, m.kind])).toEqual([
      ['balance_cny', { type: 'balance', value: 10.5, unit: 'CNY' }],
      ['balance_usd', { type: 'balance', value: 0, unit: 'USD' }],
    ]);
    expect(s.meters.every((m) => m.resetsAt === undefined)).toBe(true);
  });
  it('does not invent balances for missing, invalid or unknown fields', async () => {
    for (const body of [
      {},
      { balance_infos: [{ currency: 'EUR', total_balance: '4' }] },
      { balance_infos: [{ currency: 'USD', total_balance: 'not a number' }, { currency: 'CNY' }] },
    ])
      expect((await run(specs.deepseek, ds, body)).status).toEqual({ type: 'unsupported' });
  });
});

describe('Command GOAT official CLI shape', () => {
  it('maps real windows and remaining balances without estimating monthly usage', async () => {
    const reset = '2026-10-08T00:00:00Z';
    const s = await run(specs.commandGoat, cmd, {
      credits: { monthlyCredits: 0, purchasedCredits: 12.5, freeCredits: 1 },
      windowLimits: {
        fiveHour: { used: 2, cap: 14, resetAt: reset },
        weekly: { used: 0, cap: 35, resetAt: 1791417600000 },
      },
    });
    expect(s.meters.map((m) => m.id)).toEqual([
      'session',
      'weekly',
      'monthlyCredits',
      'purchasedCredits',
      'freeCredits',
    ]);
    expect(s.meters[0]).toMatchObject({
      kind: { type: 'amount', used: 2, limit: 14, unit: 'USD' },
      resetsAt: '2026-10-08T00:00:00.000Z',
    });
    expect(s.meters[1].kind).toMatchObject({ used: 0, limit: 35 });
    expect(s.meters[2].kind).toEqual({ type: 'balance', value: 0, unit: 'USD' });
    expect(s.meters[2].resetsAt).toBeUndefined();
    expect(s.meters.some((m) => m.id === 'monthly')).toBe(false);
  });
  it('skips missing fields instead of replacing them with zeros or a guessed plan cap', async () => {
    const s = await run(specs.commandGoat, cmd, {
      credits: { monthlyCredits: 5 },
      windowLimits: { fiveHour: { used: 1 } },
    });
    expect(s.meters.map((m) => m.id)).toEqual(['monthlyCredits']);
    expect((await run(specs.commandGoat, cmd, { renamed: {} })).status).toEqual({
      type: 'unsupported',
    });
  });
});

describe('OpenCode Go official usage route', () => {
  it('maps server percentages and reset times, not Zen monetary balance', async () => {
    const s = await run(specs.opencodeGo, go, {
      usage: {
        rolling: { percent: 0, resetsAt: '2026-10-06T13:00:00Z' },
        weekly: { percent: 31, resetsAt: '2026-10-08T00:00:00Z' },
        monthly: { percent: 70, resetsAt: '2026-11-01T00:00:00Z' },
      },
    });
    expect(s.meters.map((m) => m.kind)).toEqual([
      { type: 'percent', used: 0 },
      { type: 'percent', used: 31 },
      { type: 'percent', used: 70 },
    ]);
    expect(s.meters[0].resetsAt).toBe('2026-10-06T13:00:00.000Z');
    expect(s.meters.map((m) => m.id)).toEqual(['session', 'weekly', 'monthly']);
  });
  it('drops only unknown windows, and fails unsupported when all are absent', async () => {
    expect(
      (await run(specs.opencodeGo, go, { usage: { rolling: { percent: 20 }, weekly: {} } })).meters,
    ).toHaveLength(1);
    expect((await run(specs.opencodeGo, go, {})).status).toEqual({ type: 'unsupported' });
  });
  it('distinguishes missing subscription rights from an invalid key', async () => {
    const result = await validateCredential(
      'opencode-go',
      key,
      ctxWith(fakeFetch({ [go]: { status: 403 } }).fetch),
    );
    expect(result).toMatchObject({
      ok: false,
      kind: 'server',
      message: 'The service returned HTTP 403.',
    });
  });
});

it('auth failures do not become empty successful snapshots for any new provider', async () => {
  for (const [spec, url] of [
    [specs.deepseek, ds],
    [specs.commandGoat, cmd],
    [specs.opencodeGo, go],
  ] as const) {
    await expect(
      runSpec(spec, 'a', key, ctxWith(fakeFetch({ [url]: { status: 401 } }).fetch)),
    ).rejects.toBeInstanceOf(AuthExpiredError);
    await expect(
      runSpec(spec, 'a', key, ctxWith(fakeFetch({ [url]: { status: 403 } }).fetch)),
    ).rejects.toBeInstanceOf(HttpError);
  }
});

it('OpenRouter ordinary keys work without management balance access; primary key auth is mandatory', async () => {
  const routes = {
    'https://openrouter.ai/api/v1/key': {
      json: { data: { usage_daily: 0, usage_weekly: 1, usage_monthly: 2 } },
    },
    'https://openrouter.ai/api/v1/credits': { status: 403 },
  };
  const snapshot = await runSpec(specs.openrouter, 'a', key, ctxWith(fakeFetch(routes).fetch));
  expect(snapshot.status).toEqual({ type: 'ok' });
  expect(snapshot.meters.map((m) => m.id)).toEqual([
    'usage_daily',
    'usage_weekly',
    'usage_monthly',
  ]);
  expect(snapshot.meters.some((m) => m.id === 'credits')).toBe(false);
  await expect(
    runSpec(
      specs.openrouter,
      'a',
      key,
      ctxWith(
        fakeFetch({
          ...routes,
          'https://openrouter.ai/api/v1/key': { status: 401 },
        }).fetch,
      ),
    ),
  ).rejects.toBeInstanceOf(AuthExpiredError);
});
