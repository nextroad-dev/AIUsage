import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { BrowserAuthError, type BrowserAuthorization } from '@/authkit/browser-authorize';
import { startCodexBrowserSignIn } from '@/providers/codex/browser';
import { startOpenRouterSignIn } from '@/providers/openrouter/auth';
import { BrowserSignInPanel } from '@/ui/browser-sign-in';

jest.mock('@/providers/codex/browser', () => ({ startCodexBrowserSignIn: jest.fn() }));
jest.mock('@/providers/openrouter/auth', () => ({ startOpenRouterSignIn: jest.fn() }));

const startCodex = jest.mocked(startCodexBrowserSignIn);
const startOpenRouter = jest.mocked(startOpenRouterSignIn);

function session(
  credential: { type: 'apiKey'; key: string } | { type: 'oauth'; accessToken: string },
) {
  return {
    authorizationUrl: 'https://auth.openai.com/oauth/authorize?x=1',
    redirectUri: 'http://127.0.0.1:1455/auth/callback',
    expiresAt: Date.now() + 600_000,
    authorize: jest.fn(async () => credential),
    cancel: jest.fn(),
  } satisfies BrowserAuthorization;
}

beforeEach(() => jest.clearAllMocks());

describe('browser sign-in panel', () => {
  it('signs in through the system browser and hands over the credential once', async () => {
    const info = session({ type: 'oauth', accessToken: 'token' });
    startCodex.mockResolvedValueOnce(info);
    const onCredential = jest.fn(async () => undefined);
    await render(<BrowserSignInPanel provider="codex" onCredential={onCredential} />);

    expect(screen.queryByLabelText('Authorization code')).toBeNull();
    expect(screen.getByText('Sign in with browser')).toBeTruthy();
    await fireEvent.press(screen.getByText('Sign in with browser'));

    expect(startCodex).toHaveBeenCalledTimes(1);
    expect(startOpenRouter).not.toHaveBeenCalled();
    expect(info.authorize).toHaveBeenCalledTimes(1);
    expect(onCredential).toHaveBeenCalledTimes(1);
    expect(onCredential).toHaveBeenCalledWith({ type: 'oauth', accessToken: 'token' });
    expect(screen.queryByText('Waiting for the browser…')).toBeNull();
  });

  it('uses the OpenRouter session for the OpenRouter provider', async () => {
    const info = session({ type: 'apiKey', key: 'sk-issued' });
    startOpenRouter.mockResolvedValueOnce(info);
    const onCredential = jest.fn(async () => undefined);
    await render(<BrowserSignInPanel provider="openrouter" onCredential={onCredential} />);
    await fireEvent.press(screen.getByText('Sign in with browser'));
    expect(startOpenRouter).toHaveBeenCalledTimes(1);
    expect(startCodex).not.toHaveBeenCalled();
    expect(onCredential).toHaveBeenCalledWith({ type: 'apiKey', key: 'sk-issued' });
  });

  it('shows the waiting state and cancels the session on request', async () => {
    let finish!: (value: { type: 'oauth'; accessToken: string }) => void;
    const info = session({ type: 'oauth', accessToken: 'late' });
    info.authorize = jest.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    startCodex.mockResolvedValueOnce(info);
    const onCredential = jest.fn();
    await render(<BrowserSignInPanel provider="codex" onCredential={onCredential} />);
    const pressing = fireEvent.press(screen.getByText('Sign in with browser'));
    await waitFor(() => expect(screen.getByText('Waiting for the browser…')).toBeTruthy());
    await fireEvent.press(screen.getByText('Cancel'));
    expect(info.cancel).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ type: 'oauth', accessToken: 'late' });
      await pressing;
    });
    // A cancelled session must not connect the account.
    expect(onCredential).not.toHaveBeenCalled();
    expect(screen.queryByText('Waiting for the browser…')).toBeNull();
  });

  it.each([
    ['unavailable', 'Browser sign-in is not in this build. Install the current development build.'],
    [
      'port-unavailable',
      'Could not start the local sign-in listener. Close other apps and try again.',
    ],
    ['cancelled', 'Sign-in was cancelled.'],
    ['expired', 'The sign-in session expired. Start again.'],
    ['rejected', 'The authorization was rejected or expired. Start again.'],
    ['state-mismatch', 'The authorization was rejected or expired. Start again.'],
  ] as const)('explains %s without exposing details', async (code, message) => {
    const info = session({ type: 'oauth', accessToken: 'x' });
    info.authorize = jest.fn(async () => {
      throw new BrowserAuthError(code);
    });
    startCodex.mockResolvedValueOnce(info);
    await render(<BrowserSignInPanel provider="codex" onCredential={jest.fn()} />);
    await fireEvent.press(screen.getByText('Sign in with browser'));
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByText(String(code))).toBeNull();
  });

  it('keeps an unexpected failure generic', async () => {
    const info = session({ type: 'oauth', accessToken: 'x' });
    info.authorize = jest.fn(async () => {
      throw new TypeError('Bearer sk-secret');
    });
    startCodex.mockResolvedValueOnce(info);
    await render(<BrowserSignInPanel provider="codex" onCredential={jest.fn()} />);
    await fireEvent.press(screen.getByText('Sign in with browser'));
    expect(screen.getByText('Could not complete authorization. Start again.')).toBeTruthy();
    expect(screen.queryByText(/sk-secret/)).toBeNull();
  });

  it('cancels a session that resolves after unmount and never connects it', async () => {
    let finish!: (credential: { type: 'oauth'; accessToken: string }) => void;
    const info = session({ type: 'oauth', accessToken: 'late' });
    info.authorize = jest.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    startCodex.mockResolvedValueOnce(info);
    const onCredential = jest.fn();
    const view = await render(<BrowserSignInPanel provider="codex" onCredential={onCredential} />);
    const pressing = fireEvent.press(screen.getByText('Sign in with browser'));
    await waitFor(() => expect(startCodex).toHaveBeenCalledTimes(1));
    await view.unmount();
    expect(info.cancel).toHaveBeenCalled();
    await act(async () => {
      finish({ type: 'oauth', accessToken: 'late' });
      await pressing;
    });
    expect(onCredential).not.toHaveBeenCalled();
  });

  it('does not start while the account is being saved', async () => {
    await render(<BrowserSignInPanel provider="codex" onCredential={jest.fn()} busy />);
    await fireEvent.press(screen.getByText('Sign in with browser'));
    expect(startCodex).not.toHaveBeenCalled();
  });
});
