import { fireEvent, render, screen } from '@testing-library/react-native';

import AddAccountScreen from '@/app/add';
import AddProviderScreen from '@/app/add/[providerId]';
import AccountDetailScreen from '@/app/account/[id]';
import type { AccountView } from '@/data/summary';
import { providerById } from '@/providers/registry';
import { fakeFetch, NOW } from '@/test-utils/fetch';

let mockParams: { providerId?: string; id?: string } = {};
let mockView: AccountView | undefined;
const mockAdd = jest.fn(async () => undefined);
const mockSave = jest.fn(async () => undefined);
const mockHealth = jest.fn(async () => undefined);
const mockDismiss = jest.fn();
const mockInvalidate = jest.fn(async () => undefined);
const mockRefresh = jest.fn();
const mockRemove = jest.fn(async () => undefined);
const mockServices = {
  accounts: { add: mockAdd, remove: mockRemove },
  repos: { snapshots: { save: mockSave }, health: { recordSuccess: mockHealth } },
};

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: jest.fn(), dismissAll: mockDismiss, back: jest.fn() }),
}));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));
// Public-data query/consent behavior is exercised separately with a real QueryClient.
jest.mock('@/data/codex-reset/hooks', () => ({ useRefreshCodexReset: () => jest.fn() }));
jest.mock('@/components/screen', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/data/services', () => ({ newId: () => 'new-account' }));
jest.mock('@/data/hooks', () => ({
  keys: { views: ['views'] },
  useServices: () => ({ data: mockServices }),
  useNow: () => new Date('2026-10-06T12:00:00.000Z'),
  useAccountView: () => ({ data: mockView }),
  useRefreshAccount: () => ({ mutate: mockRefresh, isPending: false }),
  useAccountActions: () => ({ rename: jest.fn(), remove: jest.fn() }),
  useAlertOverrides: () => ({ rules: [], set: jest.fn() }),
}));
let mockLoopback = true;
jest.mock('@/authkit/loopback', () => ({ isLoopbackAvailable: () => mockLoopback }));
jest.mock('@/ui/device-sign-in', () => ({
  DeviceSignInPanel: ({ flow }: { flow: string }) => {
    const React = jest.requireActual('react');
    const { Text } = jest.requireActual('react-native');
    return React.createElement(Text, null, `Device sign-in ${flow}`);
  },
}));
jest.mock('@/ui/browser-sign-in', () => ({
  BrowserSignInPanel: ({
    provider,
    onCredential,
  }: {
    provider: 'codex' | 'openrouter';
    onCredential: (
      c: { type: 'apiKey'; key: string } | { type: 'oauth'; accessToken: string },
    ) => void;
  }) => {
    const React = jest.requireActual('react');
    const { Pressable, Text } = jest.requireActual('react-native');
    return React.createElement(
      Pressable,
      {
        onPress: () =>
          onCredential(
            provider === 'codex'
              ? { type: 'oauth', accessToken: 'access-token' }
              : { type: 'apiKey', key: 'issued' },
          ),
      },
      React.createElement(Text, null, `Authorize test ${provider}`),
    );
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockView = undefined;
  mockLoopback = true;
});

describe('connection screens', () => {
  it('only lists implemented OAuth/API-key providers, not manual or Cookie entries', async () => {
    await render(<AddAccountScreen />);
    for (const name of ['DeepSeek Open Platform', 'Command Code', 'OpenCode Go', 'OpenRouter'])
      expect(screen.getByText(name)).toBeTruthy();
    for (const name of [
      'Cursor',
      'Claude / Claude Code',
      'OpenCode Zen',
      'Manual only',
      'Track by hand for now',
    ])
      expect(screen.queryByText(name)).toBeNull();
  });

  it.each(['claude', 'cursor', 'opencode'])(
    'guards direct unsupported routes: %s',
    async (providerId) => {
      mockParams = { providerId };
      await render(<AddProviderScreen />);
      expect(
        screen.getByText('This provider has no supported OAuth or API-key usage connection.'),
      ).toBeTruthy();
      expect(screen.queryByText('Check and add')).toBeNull();
      expect(screen.queryByText('Manual')).toBeNull();
      expect(screen.queryByText('Cookie')).toBeNull();
      expect(mockAdd).not.toHaveBeenCalled();
    },
  );

  it('removes a half-saved account so the suggested retry cannot duplicate it', async () => {
    mockParams = { providerId: 'openrouter' };
    mockSave.mockRejectedValueOnce(new Error('disk full'));
    const original = global.fetch;
    global.fetch = fakeFetch({
      'https://openrouter.ai/api/v1/key': { json: { data: { usage_daily: 0 } } },
      'https://openrouter.ai/api/v1/credits': { status: 403 },
    }).fetch;
    try {
      await render(<AddProviderScreen />);
      await fireEvent.press(screen.getByText('Authorize test openrouter'));
      expect(mockAdd).toHaveBeenCalled();
      expect(mockRemove).toHaveBeenCalledWith('new-account');
      expect(mockDismiss).not.toHaveBeenCalled();
      expect(screen.getByText('Could not save the account. Please try again.')).toBeTruthy();
    } finally {
      global.fetch = original;
    }
  });

  it('validates PKCE-issued key before saving oauthPkce provenance and initial snapshot', async () => {
    mockParams = { providerId: 'openrouter' };
    const f = fakeFetch({
      'https://openrouter.ai/api/v1/key': { json: { data: { usage_daily: 0 } } },
      'https://openrouter.ai/api/v1/credits': { status: 403 },
    });
    const original = global.fetch;
    global.fetch = f.fetch;
    try {
      await render(<AddProviderScreen />);
      await fireEvent.press(screen.getByText('Authorize test openrouter'));
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'openrouter',
          authMethod: 'oauthPkce',
          id: 'new-account',
        }),
        { type: 'apiKey', key: 'issued' },
      );
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'new-account', providerId: 'openrouter' }),
      );
      expect(mockHealth).toHaveBeenCalled();
      expect(mockDismiss).toHaveBeenCalled();
      expect(f.calls[0].headers.Authorization).toBe('Bearer issued');
    } finally {
      global.fetch = original;
    }
  });

  it('connects Codex through the browser flow with OAuth tokens and no device-code step', async () => {
    mockParams = { providerId: 'codex' };
    const f = fakeFetch({
      'https://chatgpt.com/backend-api/wham/usage': {
        json: {
          plan_type: 'pro',
          rate_limit: { primary_window: { used_percent: 12, reset_after_seconds: 3600 } },
        },
      },
    });
    const original = global.fetch;
    global.fetch = f.fetch;
    try {
      await render(<AddProviderScreen />);
      expect(screen.queryByText('Sign-in code')).toBeNull();
      await fireEvent.press(screen.getByText('Authorize test codex'));
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'codex',
          authMethod: 'oauthPkce',
          id: 'new-account',
        }),
        { type: 'oauth', accessToken: 'access-token' },
      );
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: 'new-account', providerId: 'codex' }),
      );
      expect(f.calls[0].headers.Authorization).toBe('Bearer access-token');
      expect(f.calls[0].headers['ChatGPT-Account-Id']).toBeUndefined();
    } finally {
      global.fetch = original;
    }
  });

  it('falls back to a sign-in code for Codex and an API key for OpenRouter without the browser listener', async () => {
    mockLoopback = false;
    mockParams = { providerId: 'codex' };
    await render(<AddProviderScreen />);
    expect(screen.queryByText('Authorize test codex')).toBeNull();
    expect(screen.getByText('Device sign-in codexDevice')).toBeTruthy();
    expect(screen.getByText(/so a sign-in code is used instead/)).toBeTruthy();

    mockParams = { providerId: 'openrouter' };
    await render(<AddProviderScreen />);
    expect(screen.queryByText('Authorize test openrouter')).toBeNull();
    expect(screen.getByLabelText('API key')).toBeTruthy();
    expect(screen.getByText(/Use an API key, or install/)).toBeTruthy();
  });

  it('does not persist a rejected issued key and has no manual fallback', async () => {
    mockParams = { providerId: 'openrouter' };
    const original = global.fetch;
    global.fetch = fakeFetch({ 'https://openrouter.ai/api/v1/key': { status: 401 } }).fetch;
    try {
      await render(<AddProviderScreen />);
      await fireEvent.press(screen.getByText('Authorize test openrouter'));
      expect(mockAdd).not.toHaveBeenCalled();
      expect(mockSave).not.toHaveBeenCalled();
      expect(screen.getByText('Could not add this account')).toBeTruthy();
      expect(screen.queryByText('Manual')).toBeNull();
    } finally {
      global.fetch = original;
    }
  });

  it.each(['manual', 'webviewSession'] as const)(
    'shows historical %s accounts without refresh or recording controls',
    async (authMethod) => {
      const providerId = authMethod === 'manual' ? 'claude' : 'cursor';
      mockParams = { id: 'old' };
      mockView = {
        account: {
          id: 'old',
          providerId,
          label: 'Old account',
          authMethod,
          createdAt: 1,
          sortOrder: 0,
        },
        meta: providerById(providerId),
        source: 'legacy',
        health: null,
        snapshot: {
          accountId: 'old',
          providerId,
          fetchedAt: NOW.toISOString(),
          status: { type: 'manual' },
          meters: [
            {
              id: 'weekly',
              label: 'Weekly',
              scope: { type: 'overall' },
              kind: { type: 'percent', used: 40 },
            },
          ],
        },
      };
      await render(<AccountDetailScreen />);
      expect(screen.getAllByText('Historical account (read-only)').length).toBeGreaterThan(0);
      for (const name of ['Record usage', 'Edit plan', 'Refresh now', 'Cookie', 'Save'])
        expect(screen.queryByText(name)).toBeNull();
      expect(screen.getByText('Meters')).toBeTruthy();
      expect(screen.getByText('Remove account')).toBeTruthy();
      expect(mockRefresh).not.toHaveBeenCalled();
    },
  );
});
