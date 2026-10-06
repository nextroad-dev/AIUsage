import {
  credentialFromCookieHeader,
  parseCookieHeader,
  readCookies,
  tryCapture,
  type CookieSource,
} from '@/authkit/web-session';
import type { CaptureSpec } from '@/authkit/webview-capture';
import { runSpec } from '@/core/spec-engine';
import { AuthExpiredError } from '@/core/errors';
import { cursorCapture, cursorSpec } from '@/providers/cursor';
import { providerById } from '@/providers/registry';
import { ctxWith, fakeFetch } from '@/test-utils/fetch';

const source = (byUrl: Record<string, Record<string, string>>): CookieSource => ({
  get: async (url) => {
    if (!(url in byUrl)) throw new Error('no store');
    return byUrl[url];
  },
});

const spec: CaptureSpec = {
  loginUrl: 'https://x.test/login',
  cookieDomains: ['x.test', 'auth.x.test'],
  anyOfCookies: ['sid'],
};

describe('readCookies / tryCapture', () => {
  it('merges domains, primary domain wins, empty values and failing stores are ignored', async () => {
    const s = source({
      'https://x.test': { sid: 'main', empty: '' },
      'https://auth.x.test': { sid: 'other', extra: 'e' },
    });
    expect(await readCookies(spec, s)).toEqual({ sid: 'main', extra: 'e' });
    expect(await readCookies(spec, source({ 'https://auth.x.test': { a: '1' } }))).toEqual({
      a: '1',
    });
  });

  it('returns a session credential only once the expected cookie exists, keeping only wanted cookies', async () => {
    expect(await tryCapture(spec, source({ 'https://x.test': { tracking: 't' } }))).toBeNull();
    const c = await tryCapture(spec, source({ 'https://x.test': { sid: 'v', tracking: 't' } }));
    expect(c).toEqual({ type: 'session', cookies: { sid: 'v' }, storage: {} });
  });
});

describe('parseCookieHeader', () => {
  it('parses a Cookie header with or without the prefix, values containing "="', () => {
    expect(parseCookieHeader('Cookie: a=1; b=two=2;  c = 3 ')).toEqual({
      a: '1',
      b: 'two=2',
      c: '3',
    });
    expect(parseCookieHeader('a=1')).toEqual({ a: '1' });
  });
  it('ignores junk', () => {
    expect(parseCookieHeader('')).toEqual({});
    expect(parseCookieHeader('novalue; =x; y=')).toEqual({});
  });
  it('turns a pasted header into a credential only when the session cookie is present', () => {
    expect(credentialFromCookieHeader(spec, 'other=1')).toBeNull();
    expect(credentialFromCookieHeader(spec, 'sid=abc; junk=1')).toEqual({
      type: 'session',
      cookies: { sid: 'abc' },
      storage: {},
    });
  });
});

describe('Cursor', () => {
  const URL = 'https://cursor.com/api/usage-summary';
  const cred = {
    type: 'session',
    cookies: { WorkosCursorSessionToken: 'user_1%3A%3Ajwt', unrelated: 'x' },
  } as const;
  const body = {
    membershipType: 'pro',
    billingCycleEnd: '2026-11-01T00:00:00.000Z',
    individualUsage: {
      plan: { used: 500, limit: 2000, remaining: 1500 },
      onDemand: { used: 0, limit: 5000 },
    },
  };

  it('sends only the session cookie and maps plan and on-demand usage as ratios', async () => {
    const f = fakeFetch({ [URL]: { json: body } });
    const s = await runSpec(cursorSpec, 'a', cred, ctxWith(f.fetch));
    expect(f.calls[0].headers.Cookie).toBe('WorkosCursorSessionToken=user_1%3A%3Ajwt');
    expect(s.plan).toBe('pro');
    expect(s.meters.map((m) => [m.id, m.kind])).toEqual([
      ['monthly', { type: 'percent', used: 25 }],
      ['on_demand', { type: 'percent', used: 0 }],
    ]);
    expect(s.meters[0].resetsAt).toBe('2026-11-01T00:00:00.000Z');
  });

  it('skips on-demand when it is not enabled (no limit) and unlimited plans yield no meters', async () => {
    const f = fakeFetch({
      [URL]: { json: { ...body, individualUsage: { plan: { used: 10, limit: 100 } } } },
    });
    expect(
      (await runSpec(cursorSpec, 'a', cred, ctxWith(f.fetch))).meters.map((m) => m.id),
    ).toEqual(['monthly']);
    const g = fakeFetch({ [URL]: { json: { individualUsage: { plan: { used: 10, limit: 0 } } } } });
    expect((await runSpec(cursorSpec, 'a', cred, ctxWith(g.fetch))).status).toEqual({
      type: 'unsupported',
    });
  });

  it('treats 401 and 403 as a logged-out session', async () => {
    for (const status of [401, 403]) {
      const f = fakeFetch({ [URL]: { status } });
      await expect(runSpec(cursorSpec, 'a', cred, ctxWith(f.fetch))).rejects.toBeInstanceOf(
        AuthExpiredError,
      );
    }
  });

  it('keeps legacy cookie parsing but no longer offers a Cursor connection', () => {
    expect(
      credentialFromCookieHeader(cursorCapture, 'WorkosCursorSessionToken=abc'),
    ).not.toBeNull();
    expect(credentialFromCookieHeader(cursorCapture, 'foo=bar')).toBeNull();
    const meta = providerById('cursor')!;
    expect(meta).toMatchObject({ automation: 'unsupported', auth: [] });
    expect(meta.spec).toBeUndefined();
  });
});
