import { AuthExpiredError } from '@/core/errors';
import { CLINE_API, clinePlugin } from '@/providers/cline';
import { ctxWith, fakeFetch } from '@/test-utils/fetch';

const ME = `${CLINE_API}/api/v1/users/me`;
const userBalance = (id: string) => `${CLINE_API}/api/v1/users/${id}/balance`;
const orgBalance = (id: string) => `${CLINE_API}/api/v1/organizations/${id}/balance`;
const key = { type: 'apiKey' as const, key: 'cline-key' };

describe('Cline credits', () => {
  it('reads the personal balance in millionths of a dollar, from enveloped responses', async () => {
    const f = fakeFetch({
      [ME]: { json: { success: true, data: { id: 'u1', organizations: [] } } },
      [userBalance('u1')]: { json: { success: true, data: { balance: 4_250_000, userId: 'u1' } } },
    });
    const s = await clinePlugin().fetchUsage('a', key, ctxWith(f.fetch));
    expect(s.status).toEqual({ type: 'ok' });
    expect(s.meters).toEqual([
      expect.objectContaining({
        id: 'credits',
        kind: { type: 'balance', value: 4.25, unit: 'USD' },
      }),
    ]);
    expect(f.calls[0].headers.Authorization).toBe('Bearer cline-key');
  });

  it('uses the active organization balance, as the Cline CLI does, and accepts plain payloads', async () => {
    const f = fakeFetch({
      [ME]: {
        json: {
          id: 'u1',
          organizations: [
            { organizationId: 'o-old', active: false },
            { organizationId: 'o1', active: true, name: 'Team' },
          ],
        },
      },
      [orgBalance('o1')]: { json: { balance: 12_000_000 } },
    });
    const s = await clinePlugin().fetchUsage('a', key, ctxWith(f.fetch));
    expect(s.plan).toBe('Team');
    expect(s.meters[0].kind).toEqual({ type: 'balance', value: 12, unit: 'USD' });
    expect(f.calls.map((c) => c.url)).toEqual([ME, orgBalance('o1')]);
  });

  it('reports a rejected key as an expired login and an unknown shape as unsupported', async () => {
    await expect(
      clinePlugin().fetchUsage('a', key, ctxWith(fakeFetch({ [ME]: { status: 401 } }).fetch)),
    ).rejects.toBeInstanceOf(AuthExpiredError);
    const odd = fakeFetch({
      [ME]: { json: { id: 'u1' } },
      [userBalance('u1')]: { json: { credits: 'lots' } },
    });
    expect((await clinePlugin().fetchUsage('a', key, ctxWith(odd.fetch))).status).toEqual({
      type: 'unsupported',
    });
  });
});
