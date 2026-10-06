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
    expect(f.calls.map((c) => c.url)).toContain(orgBalance('o1'));
    expect(f.calls.map((c) => c.url)).not.toContain(userBalance('u1'));
  });

  it('adds the ClinePass 5-hour, weekly and monthly windows, the plan and its period end', async () => {
    const f = fakeFetch({
      [ME]: { json: { success: true, data: { id: 'u1', organizations: [] } } },
      [userBalance('u1')]: { json: { success: true, data: { balance: 0 } } },
      [`${CLINE_API}/api/v1/users/me/plan/usage-limits`]: {
        json: {
          success: true,
          data: {
            limits: [
              { type: 'monthly', percentUsed: 12.5, resetsAt: '2026-11-01T00:00:00Z' },
              { type: 'five_hour', percentUsed: 140, resetsAt: '2026-10-06T15:00:00Z' },
              { type: 'weekly', percentUsed: 40, resetsAt: null },
              { type: 'mystery', percentUsed: 1 },
            ],
          },
        },
      },
      [`${CLINE_API}/api/v1/users/me/plan`]: {
        json: {
          success: true,
          data: { plan: { displayName: 'ClinePass' }, currentPeriodEnd: '2026-11-01T00:00:00Z' },
        },
      },
    });
    const s = await clinePlugin().fetchUsage('a', key, ctxWith(f.fetch));
    expect(s.plan).toBe('ClinePass');
    expect(s.renewsAt).toBe('2026-11-01T00:00:00.000Z');
    expect(s.meters.map((m) => [m.id, m.kind])).toEqual([
      ['session', { type: 'percent', used: 100 }],
      ['weekly', { type: 'percent', used: 40 }],
      ['monthly', { type: 'percent', used: 12.5 }],
      ['credits', { type: 'balance', value: 0, unit: 'USD' }],
    ]);
    expect(s.meters[0].resetsAt).toBe('2026-10-06T15:00:00.000Z');
    expect(s.meters[1].resetsAt).toBeUndefined();
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
