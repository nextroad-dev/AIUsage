import {
  isConnectableProvider,
  providerById,
  providers,
  supportsCredential,
} from '@/providers/registry';

const active = [
  'codex',
  'copilot',
  'kimi-code',
  'kimi-balance',
  'openrouter',
  'minimax',
  'zai',
  'runway',
  'poe',
  'deepseek',
  'command-goat',
  'relay',
  'cline',
  'opencode-go',
];

describe('OAuth/API-key-only provider registry', () => {
  it('keeps 27 unique identities, including unsupported historical metadata', () => {
    expect(providers).toHaveLength(27);
    expect(new Set(providers.map((p) => p.id)).size).toBe(27);
    for (const id of ['command-goat', 'deepseek', 'opencode', 'opencode-go', 'claude', 'cursor'])
      expect(providerById(id)).toBeDefined();
  });

  it('offers exactly the implemented OAuth/API-key providers', () => {
    expect(providers.filter(isConnectableProvider).map((p) => p.id)).toEqual(active);
    for (const p of providers) {
      expect(p.auth.every((m) => ['apiKey', 'deviceCode', 'oauthPkce'].includes(m))).toBe(true);
      if (isConnectableProvider(p)) {
        expect(p.auth.length).toBeGreaterThan(0);
        expect((p.plugin ?? p.spec)?.id).toBe(p.id);
      } else {
        expect(p.automation).toBe('unsupported');
        expect(p.auth).toEqual([]);
        expect(p.note).toBeTruthy();
        expect(p.plugin).toBeUndefined();
        expect(p.spec).toBeUndefined();
      }
    }
    expect(isConnectableProvider(undefined)).toBe(false);
  });

  it('does not offer Cookie or manual modes, including by direct identity lookup', () => {
    for (const id of ['cursor', 'claude', 'opencode', 'perplexity', 'suno'])
      expect(isConnectableProvider(providerById(id))).toBe(false);
    expect(supportsCredential('openrouter', 'manual', { type: 'apiKey', key: 'k' })).toBe(false);
    expect(
      supportsCredential('openrouter', 'webviewSession', {
        type: 'session',
        cookies: { sid: 'k' },
      }),
    ).toBe(false);
    expect(supportsCredential('codex', 'apiKey', { type: 'apiKey', key: 'k' })).toBe(false);
    expect(supportsCredential('deepseek', 'deviceCode', { type: 'oauth', accessToken: 'k' })).toBe(
      false,
    );
    expect(supportsCredential('openrouter', 'oauthPkce', { type: 'apiKey', key: 'k' })).toBe(true);
    expect(supportsCredential('openrouter', 'oauthPkce', { type: 'oauth', accessToken: 'k' })).toBe(
      false,
    );
    expect(supportsCredential('deepseek', 'apiKey', { type: 'apiKey', key: ' ' })).toBe(false);
    expect(supportsCredential('deepseek', 'apiKey')).toBe(false);
  });

  it('sends the ChatGPT browser flow through OAuth tokens and keeps device-code accounts working', () => {
    expect(providerById('codex')?.connect).toBe('codexBrowser');
    expect(providerById('codex')?.auth).toEqual(['oauthPkce', 'deviceCode']);
    expect(providerById('openrouter')?.connect).toBe('openrouterPkce');
    expect(
      supportsCredential('codex', 'oauthPkce', {
        type: 'oauth',
        accessToken: 'access',
        refreshToken: 'refresh',
      }),
    ).toBe(true);
    expect(supportsCredential('codex', 'oauthPkce', { type: 'oauth', accessToken: ' ' })).toBe(
      false,
    );
    expect(supportsCredential('codex', 'oauthPkce', { type: 'apiKey', key: 'k' })).toBe(false);
    expect(supportsCredential('codex', 'deviceCode', { type: 'oauth', accessToken: 'a' })).toBe(
      true,
    );
    expect(supportsCredential('openrouter', 'oauthPkce', { type: 'apiKey', key: 'k' })).toBe(true);
    expect(supportsCredential('openrouter', 'oauthPkce', { type: 'oauth', accessToken: 'a' })).toBe(
      false,
    );
  });
});
