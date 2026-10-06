import { beginCallbackWait } from '@/authkit/callback-session';
import { redirectOAuthSystemPath } from '@/authkit/oauth-callback-route';

describe('sign-in callback deep links', () => {
  it('drops a callback that no live session can consume, including its code', () => {
    for (const path of [
      'usage://oauth/codex?code=secret&state=s',
      'usage://oauth/openrouter?code=secret',
      'usage://oauth?error=access_denied',
      'USAGE://OAUTH/codex?code=secret',
    ]) {
      expect(redirectOAuthSystemPath({ path, initial: true })).toBe('/add');
      expect(redirectOAuthSystemPath({ path, initial: false })).toBe('/add');
    }
  });

  it('leaves a callback to the live sign-in session on Android instead of navigating away', () => {
    const end = beginCallbackWait();
    try {
      expect(
        redirectOAuthSystemPath({ path: 'usage://oauth/codex?code=c&state=s', initial: false }),
      ).toBe('');
      // a cold start can never belong to a live session
      expect(
        redirectOAuthSystemPath({ path: 'usage://oauth/codex?code=c&state=s', initial: true }),
      ).toBe('/add');
    } finally {
      end();
    }
    expect(
      redirectOAuthSystemPath({ path: 'usage://oauth/codex?code=c&state=s', initial: false }),
    ).toBe('/add');
  });

  it('leaves every other link untouched', () => {
    for (const path of [
      '/account/1',
      '/add/openrouter',
      'https://example.com/callback?code=secret',
      'usage://other/x?code=secret',
      'usage://oauthx/codex',
      'exp://127.0.0.1:8081/--/account/1',
      '',
    ]) {
      expect(redirectOAuthSystemPath({ path, initial: true })).toBe(path);
    }
  });
});
