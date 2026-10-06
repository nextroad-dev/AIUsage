import { AuthExpiredError } from '@/core/errors';
import { runSpec, type HttpProviderSpec } from '@/core/spec-engine';
import { ctxWith, fakeFetch } from '@/test-utils/fetch';

const spec: HttpProviderSpec = {
  id: 't',
  auth: { type: 'bearer' },
  variants: { a: { host: 'a.test' }, b: { host: 'b.test' } },
  requests: [
    { name: 'main', url: 'https://{host}/main' },
    { name: 'extra', url: 'https://{host}/extra', optional: true },
  ],
  meters: [
    { id: 'm', label: 'M', kind: 'percent', from: 'main', percent: 'p', resetsAt: 'reset' },
    { id: 'x', label: 'X', kind: 'amount', from: 'extra', used: 'u', unit: 'USD' },
  ],
  plan: { from: 'main', path: 'plan' },
};

const key = { type: 'apiKey', key: 'sk-secret' } as const;

describe('runSpec', () => {
  it('sends bearer auth, fills the variant host and maps meters', async () => {
    const f = fakeFetch({
      'https://b.test/main': { json: { p: 42, reset: 1790000000, plan: 'Pro' } },
    });
    const snap = await runSpec(spec, 'acc', key, ctxWith(f.fetch, 'b'));
    expect(f.calls[0].url).toBe('https://b.test/main');
    expect(f.calls[0].headers.Authorization).toBe('Bearer sk-secret');
    expect(snap.status).toEqual({ type: 'ok' });
    expect(snap.plan).toBe('Pro');
    expect(snap.meters).toEqual([
      {
        id: 'm',
        label: 'M',
        kind: { type: 'percent', used: 42 },
        scope: { type: 'overall' },
        resetsAt: '2026-09-21T14:13:20.000Z',
      },
    ]);
  });

  it('defaults to the first variant and ignores a failing optional request', async () => {
    const f = fakeFetch({
      'https://a.test/main': { json: { p: 1 } },
      'https://a.test/extra': { status: 500 },
    });
    const snap = await runSpec(spec, 'acc', key, ctxWith(f.fetch));
    expect(snap.meters.map((m) => m.id)).toEqual(['m']);
  });

  it('returns unsupported when nothing maps (structure changed)', async () => {
    const f = fakeFetch({ 'https://a.test/main': { json: { totally: 'different' } } });
    const snap = await runSpec(spec, 'acc', key, ctxWith(f.fetch));
    expect(snap.status).toEqual({ type: 'unsupported' });
    expect(snap.meters).toEqual([]);
  });

  it('propagates auth failure of a required request', async () => {
    const f = fakeFetch({ 'https://a.test/main': { status: 401 } });
    await expect(runSpec(spec, 'acc', key, ctxWith(f.fetch))).rejects.toBeInstanceOf(
      AuthExpiredError,
    );
  });

  it('builds a Cookie header for session credentials', async () => {
    const cookieSpec: HttpProviderSpec = {
      ...spec,
      auth: { type: 'cookie', names: ['sid'] },
      variants: undefined,
      requests: [{ name: 'main', url: 'https://c.test/main' }],
      forbiddenIsAuth: true,
    };
    const f = fakeFetch({ 'https://c.test/main': { json: { p: 5 } } });
    await runSpec(
      cookieSpec,
      'acc',
      { type: 'session', cookies: { sid: 'abc', other: 'zzz' } },
      ctxWith(f.fetch),
    );
    expect(f.calls[0].headers.Cookie).toBe('sid=abc');
    const f403 = fakeFetch({ 'https://c.test/main': { status: 403 } });
    await expect(
      runSpec(cookieSpec, 'acc', { type: 'session', cookies: { sid: 'x' } }, ctxWith(f403.fetch)),
    ).rejects.toBeInstanceOf(AuthExpiredError);
  });

  it('supports each/where/idBy and skips unmapped ids without a fallback', async () => {
    const eachSpec: HttpProviderSpec = {
      id: 'e',
      auth: { type: 'header', name: 'X-Key' },
      requests: [{ name: 'r', url: 'https://e.test/r' }],
      meters: [
        {
          id: 'x',
          label: 'X',
          kind: 'percent',
          from: 'r',
          each: { path: 'limits', where: { type: 'T' } },
          idBy: { field: 'unit', map: { '3': 'session' } },
          percent: 'pct',
        },
      ],
    };
    const f = fakeFetch({
      'https://e.test/r': {
        json: {
          limits: [
            { type: 'T', unit: 3, pct: 10 },
            { type: 'T', unit: 9, pct: 20 },
            { type: 'O', unit: 3, pct: 30 },
          ],
        },
      },
    });
    const snap = await runSpec(eachSpec, 'acc', key, ctxWith(f.fetch));
    expect(snap.meters.map((m) => [m.id, m.kind])).toEqual([
      ['session', { type: 'percent', used: 10 }],
    ]);
    expect(f.calls[0].headers['X-Key']).toBe('sk-secret');
  });
});
