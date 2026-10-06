import { AuthExpiredError, HttpError, RateLimitedError, TimeoutError } from '@/core/errors';
import { classifyError, pluginFor, validateCredential } from '@/providers/service';
import { ctxWith, fakeFetch } from '@/test-utils/fetch';

const key = { type: 'apiKey', key: 'k' } as const;

describe('pluginFor', () => {
  it('exists for spec providers only', () => {
    expect(pluginFor('openrouter')).toBeDefined();
    expect(pluginFor('minimax')).toBeDefined();
    expect(pluginFor('claude')).toBeUndefined();
    expect(pluginFor('codex')?.refresh).toBeDefined();
    expect(pluginFor('copilot')).toBeDefined();
    expect(pluginFor('cursor')).toBeUndefined();
    expect(pluginFor('deepseek')).toBeDefined();
    expect(pluginFor('command-goat')).toBeDefined();
    expect(pluginFor('opencode-go')).toBeDefined();
    expect(pluginFor('opencode')).toBeUndefined();
    expect(pluginFor('perplexity')).toBeUndefined(); // planned, not built
    expect(pluginFor('nope')).toBeUndefined();
  });
});

describe('classifyError', () => {
  it('maps every error class to a status and backoff behavior', () => {
    expect(classifyError(new AuthExpiredError())).toMatchObject({
      kind: 'invalid-credential',
      status: { type: 'authExpired' },
      countsAsFailure: false,
    });
    expect(classifyError(new RateLimitedError(5000))).toMatchObject({
      kind: 'rate-limited',
      retryAfterMs: 5000,
      status: { type: 'stale' },
      countsAsFailure: true,
    });
    expect(classifyError(new TimeoutError())).toMatchObject({
      kind: 'network',
      countsAsFailure: true,
    });
    expect(classifyError(new HttpError(503))).toMatchObject({
      kind: 'server',
      status: { type: 'error', message: 'The service returned HTTP 503.' },
    });
    expect(classifyError(new TypeError('Network request failed'))).toMatchObject({
      kind: 'network',
    });
  });
  it('never leaks raw error text into user messages', () => {
    expect(classifyError(new Error('Bearer sk-secret was rejected')).message).not.toContain(
      'sk-secret',
    );
  });
});

describe('validateCredential', () => {
  const routes = (balance: object) => ({ 'https://api.poe.com/usage/current_balance': balance });

  it('accepts a working key and returns the snapshot', async () => {
    const f = fakeFetch(routes({ json: { current_point_balance: 100 } }));
    const r = await validateCredential('poe', key, ctxWith(f.fetch));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.snapshot.meters[0].kind).toMatchObject({ type: 'balance', value: 100 });
  });

  it('reports a rejected key', async () => {
    const r = await validateCredential(
      'poe',
      key,
      ctxWith(fakeFetch(routes({ status: 401 })).fetch),
    );
    expect(r).toMatchObject({ ok: false, kind: 'invalid-credential' });
  });

  it('distinguishes an unrecognized response from a bad key', async () => {
    const r = await validateCredential(
      'poe',
      key,
      ctxWith(fakeFetch(routes({ json: { other: 1 } })).fetch),
    );
    expect(r).toMatchObject({ ok: false, kind: 'unsupported' });
  });

  it('reports network failure and rate limiting', async () => {
    const offline = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    expect(await validateCredential('poe', key, ctxWith(offline))).toMatchObject({
      ok: false,
      kind: 'network',
    });
    const limited = fakeFetch(routes({ status: 429 }));
    expect(await validateCredential('poe', key, ctxWith(limited.fetch))).toMatchObject({
      ok: false,
      kind: 'rate-limited',
    });
  });

  it('refuses providers without automatic collection', async () => {
    expect(await validateCredential('claude', key, ctxWith(fakeFetch({}).fetch))).toMatchObject({
      ok: false,
      kind: 'no-plugin',
    });
  });
});
