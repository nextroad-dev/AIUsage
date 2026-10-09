import { QueryClient } from '@tanstack/react-query';

import { forecastSchema } from '../models';
import {
  CACHE_MS,
  CONSENT_KEY,
  CodexResetService,
  isDataStale,
  SOURCE,
  STALE_MS,
  TIMEOUT_MS,
  USER_AGENT,
} from '../service';
import { fakeFetch } from '@/test-utils/fetch';
import forecast from './fixtures/forecast.json';

const NOW = Date.parse(forecast.updated_at);
const FORECAST = `${SOURCE}api/forecast`;

function setup(routes: Parameters<typeof fakeFetch>[0]) {
  const values = new Map<string, unknown>([
    [
      CONSENT_KEY,
      {
        version: 1,
        source: SOURCE,
        enabled: true,
        acceptedAt: NOW,
      },
    ],
  ]);
  const store = {
    getJson: async <T>(key: string, fallback: T): Promise<T> => (values.get(key) ?? fallback) as T,
    setJson: async (key: string, value: unknown) => {
      values.set(key, JSON.parse(JSON.stringify(value)));
    },
  };
  const clock = { now: NOW };
  const f = fakeFetch(routes);
  const deps = { store, fetch: f.fetch, now: () => clock.now };
  return { deps, service: new CodexResetService(deps), clock, f, values };
}

describe('Codex Reset public contract (real responses captured 2026-10-08)', () => {
  it('parses the real response and uses percent, not a fractional probability', () => {
    expect(forecastSchema.parse(forecast)).toEqual({
      probabilities: { rounded_24h: 15, rounded_48h: 28 },
      updated_at: forecast.updated_at,
    });
  });

  it('degrades missing/invalid probabilities and timestamps safely and keeps nothing else', () => {
    expect(
      forecastSchema.parse({
        probabilities: { rounded_24h: 101, rounded_48h: '28' },
        updated_at: 'invalid',
        last_reset_at: '2026-02-30T00:00:00Z',
        confidence: 'new-value',
      }),
    ).toEqual({
      probabilities: { rounded_24h: null, rounded_48h: null },
      updated_at: null,
    });
    expect(forecastSchema.parse({ probabilities: {} }).probabilities.rounded_24h).toBeUndefined();
    expect(forecastSchema.safeParse({ probabilities: null }).success).toBe(false);
    expect(forecastSchema.safeParse('<html>').success).toBe(false);
  });
});

describe('Codex Reset cache and network isolation', () => {
  it.each([
    null,
    {},
    { version: 1, source: SOURCE, enabled: true },
    {
      version: 1,
      source: SOURCE,
      enabled: false,
      acceptedAt: NOW,
    },
  ])('makes no public requests without valid opt-in: %j', async (consent) => {
    const s = setup({ [FORECAST]: { json: forecast } });
    s.values.set(CONSENT_KEY, consent);
    expect(await s.service.getEnabled()).toBe(false);
    expect((await s.service.load('forecast')).data).toBeUndefined();
    await s.service.refresh();
    expect(s.f.calls).toHaveLength(0);
  });

  it('persists explicit consent across restarts and blocks cached/manual/background reads after disabling', async () => {
    const s = setup({ [FORECAST]: { json: forecast } });
    s.values.delete(CONSENT_KEY);
    await s.service.setEnabled(true);
    expect(s.values.get(CONSENT_KEY)).toMatchObject({
      enabled: true,
      acceptedAt: NOW,
      source: SOURCE,
    });
    const restarted = new CodexResetService(s.deps);
    expect(await restarted.getEnabled()).toBe(true);
    expect((await restarted.load('forecast')).data).toBeDefined();
    await restarted.setEnabled(false);
    expect((await restarted.load('forecast')).data).toBeUndefined();
    await restarted.refresh();
    expect(s.f.calls).toHaveLength(1);
    expect(await new CodexResetService(s.deps).getEnabled()).toBe(false);
  });

  it('does not let stored consent hydration re-enable a newly disabled preference', async () => {
    const s = setup({ [FORECAST]: { json: forecast } });
    await s.service.setEnabled(false);
    expect(await s.service.getEnabled()).toBe(false);
    await s.service.refresh();
    expect(s.f.calls).toHaveLength(0);
  });

  it('fails closed when saving consent fails', async () => {
    const s = setup({ [FORECAST]: { json: forecast } });
    s.values.delete(CONSENT_KEY);
    s.deps.store.setJson = async () => {
      throw new Error('disk full');
    };
    await expect(s.service.setEnabled(true)).rejects.toThrow('disk full');
    expect(await s.service.getEnabled()).toBe(false);
    await s.service.refresh();
    expect(s.f.calls).toHaveLength(0);
  });

  it('keeps the latest revocation persisted when an earlier opt-in write is slow', async () => {
    const s = setup({ [FORECAST]: { json: forecast } });
    s.values.delete(CONSENT_KEY);
    const write = s.deps.store.setJson;
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    s.deps.store.setJson = async (key, value) => {
      if (key === CONSENT_KEY && (value as { enabled: boolean }).enabled) {
        started();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      await write(key, value);
    };
    const enabling = s.service.setEnabled(true);
    await ready;
    const disabling = s.service.setEnabled(false);
    expect(await s.service.getEnabled()).toBe(false);
    release();
    await Promise.all([enabling, disabling]);
    expect(await s.service.getEnabled()).toBe(false);
    expect(await new CodexResetService(s.deps).getEnabled()).toBe(false);
    await s.service.refresh();
    expect(s.f.calls).toHaveLength(0);
  });

  it('aborts in-flight public reads and discards late data when consent is revoked', async () => {
    const s = setup({});
    let finish!: (response: Response) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let signal: AbortSignal | null | undefined;
    s.deps.fetch = (async (_url, init) => {
      signal = init?.signal;
      started();
      return await new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }) as typeof fetch;
    const work = s.service.load('forecast');
    await ready;
    await s.service.setEnabled(false);
    expect(signal?.aborted).toBe(true);
    finish(new Response(JSON.stringify(forecast)));
    expect((await work).data).toBeUndefined();
    expect(s.values.get('codex-reset:v1:forecast')).not.toHaveProperty('data');
  });

  it('deduplicates simultaneous loads and manual/TanStack/background requests for 5 minutes', async () => {
    const s = setup({ [FORECAST]: { json: forecast } });
    const [a, b] = await Promise.all([s.service.load('forecast'), s.service.load('forecast')]);
    expect(a).toBe(b);
    const client = new QueryClient();
    const options = {
      queryKey: ['codexReset', 'forecast'],
      queryFn: () => s.service.load('forecast'),
      staleTime: CACHE_MS,
    };
    await client.fetchQuery(options);
    await client.fetchQuery(options);
    await s.service.refresh();
    // the forecast is the only public endpoint requested
    expect(s.f.calls.map((c) => c.url)).toEqual([FORECAST]);
    s.clock.now += CACHE_MS;
    await s.service.load('forecast');
    expect(s.f.calls.filter((c) => c.url === FORECAST)).toHaveLength(2);
    client.clear();
  });

  it('identifies native readers and sends no account headers/credentials', async () => {
    const s = setup({ [FORECAST]: { json: forecast } });
    await s.service.load('forecast');
    expect(s.f.calls[0]).toEqual({
      url: FORECAST,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
  });

  it('keeps Retry-After across restarts, even for manual refresh', async () => {
    const s = setup({
      [FORECAST]: { status: 429, headers: { 'retry-after': '1200' } },
    });
    const first = await s.service.load('forecast');
    expect(first.error).toBe('rate-limited');
    expect(first.retryAt).toBe(NOW + 1_200_000);
    s.clock.now += CACHE_MS;
    await s.service.load('forecast');
    const restarted = new CodexResetService(s.deps);
    await restarted.refresh();
    expect((await restarted.load('forecast')).error).toBe('rate-limited');
    expect(s.f.calls).toHaveLength(1);
    s.clock.now = first.retryAt;
    await restarted.load('forecast');
    expect(s.f.calls).toHaveLength(2);
  });

  it('honours an HTTP-date Retry-After and applies a minimum retry interval', async () => {
    jest.useFakeTimers({ now: NOW });
    try {
      const s = setup({
        [FORECAST]: {
          status: 429,
          headers: { 'retry-after': new Date(NOW + 600_000).toUTCString() },
        },
      });
      expect((await s.service.load('forecast')).retryAt).toBe(
        Date.parse(new Date(NOW + 600_000).toUTCString()),
      );
      const short = setup({
        [FORECAST]: { status: 429, headers: { 'retry-after': '1' } },
      });
      expect((await short.service.load('forecast')).retryAt).toBe(NOW + CACHE_MS);
    } finally {
      jest.useRealTimers();
    }
  });

  it('times out native fetch and backs off without throwing into account refresh', async () => {
    jest.useFakeTimers();
    try {
      const s = setup({});
      s.deps.fetch = ((_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        })) as typeof fetch;
      const pending = s.service.load('forecast');
      await jest.advanceTimersByTimeAsync(TIMEOUT_MS);
      expect(await pending).toMatchObject({
        error: 'timeout',
        retryAt: NOW + CACHE_MS,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('loads persistent cache offline after restart and preserves it after network failure', async () => {
    const s = setup({ [FORECAST]: { json: forecast } });
    const good = await s.service.load('forecast');
    const offlineFetch = jest.fn(async () => {
      throw new TypeError('offline');
    });
    const restarted = new CodexResetService({ ...s.deps, fetch: offlineFetch });
    expect((await restarted.load('forecast')).data).toEqual(good.data);
    expect(offlineFetch).not.toHaveBeenCalled();
    s.clock.now += CACHE_MS;
    const failed = await restarted.load('forecast');
    expect(failed.data).toEqual(good.data);
    expect(failed.fetchedAt).toBe(good.fetchedAt);
    expect(failed.error).toBe('unavailable');
    expect(isDataStale(failed, forecast.updated_at, s.clock.now)).toBe(true);
  });

  it('rejects incompatible responses but keeps previous good data and retries with backoff', async () => {
    const s = setup({ [FORECAST]: { json: forecast } });
    const good = await s.service.load('forecast');
    s.deps.fetch = fakeFetch({ [FORECAST]: { text: '<html>' } }).fetch;
    for (let i = 1; i <= 5; i++) {
      s.clock.now = (await s.service.load('forecast')).retryAt;
      const fail = await s.service.load('forecast');
      expect(fail).toMatchObject({
        error: 'invalid',
        failures: i,
        data: good.data,
      });
      if (i === 5) expect(fail.retryAt - s.clock.now).toBe(16 * 60_000);
    }
  });

  it('marks old, missing, future or explicitly stale upstream data and expired published copies', () => {
    const entry = {
      data: forecast,
      fetchedAt: NOW,
      retryAt: NOW + CACHE_MS,
      failures: 0,
    };
    expect(isDataStale(entry, forecast.updated_at, NOW)).toBe(false);
    expect(isDataStale(entry, forecast.updated_at, NOW + STALE_MS)).toBe(true);
    expect(isDataStale(entry, null, NOW)).toBe(true);
    expect(isDataStale(entry, new Date(NOW + 120_000).toISOString(), NOW)).toBe(true);
    expect(isDataStale(entry, forecast.updated_at, NOW, true)).toBe(true);
    expect(
      isDataStale(
        { ...entry, publishedExpiresAt: new Date(NOW).toISOString() },
        forecast.updated_at,
        NOW,
      ),
    ).toBe(true);
  });

  it('captures published freshness headers and treats public 401 as data failure', async () => {
    const s = setup({
      [FORECAST]: {
        json: forecast,
        headers: {
          'x-published-checked-at': forecast.updated_at,
          'x-published-expires-at': new Date(NOW + 180_000).toISOString(),
        },
      },
    });
    expect(await s.service.load('forecast')).toMatchObject({
      publishedCheckedAt: forecast.updated_at,
    });
    const unauthorized = setup({ [FORECAST]: { status: 401 } });
    expect((await unauthorized.service.load('forecast')).error).toBe('unavailable');
  });
});
