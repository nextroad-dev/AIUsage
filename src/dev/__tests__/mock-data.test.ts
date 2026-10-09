import { usedFraction } from '@/core/meter-utils';
import { forecastSchema } from '@/data/codex-reset/models';
import { pluginFor } from '@/providers/service';
import { DEMOS, mockFetch } from '../mock-data';

jest.useFakeTimers();

const real = jest.fn(async () => new Response('real', { status: 200 })) as unknown as typeof fetch;
const net = mockFetch(real);

async function snapshot(id: string) {
  const demo = DEMOS.find((d) => d.account.id === id)!;
  const plugin = pluginFor(demo.account.providerId)!;
  const work = plugin.fetchUsage(id, demo.cred, { fetch: net, now: () => new Date() });
  await jest.runAllTimersAsync();
  return work;
}

it('feeds every demo account through the real provider parsing', async () => {
  const busy = await snapshot('mock-codex-busy');
  expect(busy.meters.map((m) => [m.id, usedFraction(m)])).toEqual([
    ['session', 0.72],
    ['weekly', 0.81],
    ['credits', undefined],
  ]);
  expect(busy.meters[0].resetsAt).toBeDefined();

  const full = await snapshot('mock-codex-full');
  expect(usedFraction(full.meters[0])).toBe(1);

  const idle = await snapshot('mock-codex-idle');
  expect(usedFraction(idle.meters[0])).toBe(0);

  const copilot = await snapshot('mock-copilot');
  expect(copilot.meters).toHaveLength(1);
  expect(usedFraction(copilot.meters[0])).toBeCloseTo(0.7);

  const openrouter = await snapshot('mock-openrouter');
  expect(openrouter.meters.map((m) => m.id)).toEqual([
    'credits',
    'key_limit',
    'usage_daily',
    'usage_weekly',
    'usage_monthly',
  ]);

  const kimi = await snapshot('mock-kimi');
  expect(kimi.meters.map((m) => [m.id, usedFraction(m)])).toEqual([
    ['monthly', 0.6],
    ['session', 0.9],
  ]);

  // rejected token: the refresh pipeline turns this into the sign-in-again state
  const demo = DEMOS.find((d) => d.account.id === 'mock-copilot-expired')!;
  const expired = pluginFor('copilot')!
    .fetchUsage(demo.account.id, demo.cred, { fetch: net, now: () => new Date() })
    .then(
      () => 'ok',
      (e: Error) => e.name,
    );
  await jest.runAllTimersAsync();
  expect(await expired).toBe('AuthExpiredError');
});

it('answers Codex Reset with odds the app accepts and leaves real accounts on the network', async () => {
  const res = net('https://codex-reset.com/api/forecast');
  await jest.runAllTimersAsync();
  const forecast = forecastSchema.parse(await (await res).json());
  expect(forecast.probabilities).toEqual({ rounded_24h: 22, rounded_48h: 41 });

  await net('https://chatgpt.com/backend-api/wham/usage', {
    headers: { Authorization: 'Bearer real-token' },
  });
  expect(real).toHaveBeenCalledTimes(1);
});
