import { AuthExpiredError, HttpError, RateLimitedError, TimeoutError } from '@/core/errors';
import { requestJson } from '@/core/http';
import { fakeFetch } from '@/test-utils/fetch';

const URL_ = 'https://x.test/a';

describe('requestJson', () => {
  it('returns parsed json', async () => {
    const { fetch } = fakeFetch({ [URL_]: { json: { a: 1 } } });
    expect((await requestJson(URL_, { fetch })).json).toEqual({ a: 1 });
  });
  it('tolerates a non-JSON body', async () => {
    const { fetch } = fakeFetch({ [URL_]: { text: '<html>' } });
    expect((await requestJson(URL_, { fetch })).json).toBeUndefined();
  });
  it('maps 401 to AuthExpiredError, and 403 only when asked', async () => {
    const { fetch } = fakeFetch({ [URL_]: { status: 401 } });
    await expect(requestJson(URL_, { fetch })).rejects.toBeInstanceOf(AuthExpiredError);
    const f403 = fakeFetch({ [URL_]: { status: 403 } }).fetch;
    await expect(requestJson(URL_, { fetch: f403 })).rejects.toBeInstanceOf(HttpError);
    await expect(requestJson(URL_, { fetch: f403, forbiddenIsAuth: true })).rejects.toBeInstanceOf(
      AuthExpiredError,
    );
  });
  it('maps 429 with Retry-After', async () => {
    const { fetch } = fakeFetch({ [URL_]: { status: 429, headers: { 'retry-after': '12' } } });
    await expect(requestJson(URL_, { fetch })).rejects.toMatchObject({ retryAfterMs: 12_000 });
    await expect(requestJson(URL_, { fetch })).rejects.toBeInstanceOf(RateLimitedError);
  });
  it('maps other failures to HttpError', async () => {
    const { fetch } = fakeFetch({ [URL_]: { status: 500 } });
    await expect(requestJson(URL_, { fetch })).rejects.toMatchObject({ status: 500 });
  });
  it('times out', async () => {
    const hang = ((_u: unknown, init?: RequestInit) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () =>
          rej(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      })) as unknown as typeof fetch;
    await expect(requestJson(URL_, { fetch: hang, timeoutMs: 10 })).rejects.toBeInstanceOf(
      TimeoutError,
    );
  });
});
