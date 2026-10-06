import type { AuthMethod, Credential, ProviderPlugin } from '@/core/types';
import type { HttpProviderSpec } from '@/core/spec-engine';
import { clinePlugin } from '@/providers/cline';
import { codexPlugin, codexSpec } from '@/providers/codex';
import { copilotPlugin } from '@/providers/copilot';
import { relayPlugin } from '@/providers/relay';
import { specs } from '@/providers/specs';

export type Automation = 'spec' | 'plugin' | 'unsupported';
export type ConnectFlow =
  'apiKey' | 'codexDevice' | 'codexBrowser' | 'githubDevice' | 'openrouterPkce' | 'relay';
export type ConnectionAuth = Exclude<AuthMethod, 'manual' | 'webviewSession'>;

export interface ProviderMeta {
  id: string;
  name: string;
  automation: Automation;
  auth: ConnectionAuth[];
  spec?: HttpProviderSpec;
  plugin?: ProviderPlugin;
  connect?: ConnectFlow;
  regions?: { key: string; label: string }[];
  note?: string;
}

const REGIONS = [
  { key: 'intl', label: 'International' },
  { key: 'cn', label: 'China' },
];

// Unsupported metadata is retained for old account names, never as a connection option.
export const providers: ProviderMeta[] = [
  {
    id: 'codex',
    name: 'ChatGPT / Codex',
    automation: 'plugin',
    // deviceCode stays accepted so existing device-code accounts keep working; new connections
    // use the browser callback.
    auth: ['oauthPkce', 'deviceCode'],
    spec: codexSpec,
    plugin: codexPlugin(),
    connect: 'codexBrowser',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    automation: 'plugin',
    auth: ['deviceCode', 'apiKey'],
    plugin: copilotPlugin(),
    connect: 'githubDevice',
  },
  {
    id: 'kimi-code',
    name: 'Kimi Code',
    automation: 'spec',
    auth: ['apiKey'],
    spec: specs.kimiCode,
    regions: REGIONS,
  },
  {
    id: 'kimi-balance',
    name: 'Kimi Open Platform balance',
    automation: 'spec',
    auth: ['apiKey'],
    spec: specs.kimiBalance,
    regions: REGIONS,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    automation: 'spec',
    auth: ['oauthPkce', 'apiKey'],
    spec: specs.openrouter,
    connect: 'openrouterPkce',
    note: 'Balance needs a management key; other keys show their own usage.',
  },
  {
    id: 'minimax',
    name: 'MiniMax Token Plan',
    automation: 'spec',
    auth: ['apiKey'],
    spec: specs.minimax,
    regions: REGIONS,
  },
  {
    id: 'zai',
    name: 'GLM Coding Plan (z.ai)',
    automation: 'spec',
    auth: ['apiKey'],
    spec: specs.zai,
    regions: REGIONS,
  },
  {
    id: 'runway',
    name: 'Runway',
    automation: 'spec',
    auth: ['apiKey'],
    spec: specs.runway,
    note: 'API organization only, not web subscription credits.',
  },
  { id: 'poe', name: 'Poe', automation: 'spec', auth: ['apiKey'], spec: specs.poe },
  { id: 'deepseek', name: 'DeepSeek', automation: 'spec', auth: ['apiKey'], spec: specs.deepseek },
  {
    id: 'command-goat',
    name: 'Command Code',
    automation: 'spec',
    auth: ['apiKey'],
    spec: specs.commandGoat,
    note: 'Experimental endpoint used by the official CLI; it may change.',
  },
  {
    id: 'relay',
    name: 'API relay',
    automation: 'plugin',
    auth: ['apiKey'],
    plugin: relayPlugin(),
    connect: 'relay',
    note: 'New API, Sub2API, One API and other OpenAI-compatible relays: enter the site address and key, the rest is detected.',
  },
  {
    id: 'cline',
    name: 'Cline / ClinePass',
    automation: 'plugin',
    auth: ['apiKey'],
    plugin: clinePlugin(),
    note: 'Shows your Cline credits and, with ClinePass, the 5-hour, weekly and monthly limits. Create an API key at app.cline.bot under Settings > API Keys.',
  },
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    automation: 'spec',
    auth: ['apiKey'],
    spec: specs.opencodeGo,
    note: 'Needs an OpenCode Go subscription; shows Go quota only.',
  },
  {
    id: 'opencode',
    name: 'OpenCode Zen',
    automation: 'unsupported',
    auth: [],
    note: 'Balance is not available yet.',
  },
  {
    id: 'claude',
    name: 'Claude / Claude Code',
    automation: 'unsupported',
    auth: [],
    note: 'Anthropic terms block third-party usage collection.',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    automation: 'unsupported',
    auth: [],
    note: 'Cookie sign-in removed; existing accounts are read-only.',
  },
  ...[
    ['gemini', 'Gemini'],
    ['perplexity', 'Perplexity'],
    ['grok', 'Grok / SuperGrok'],
    ['windsurf', 'Windsurf'],
    ['kiro', 'Kiro'],
    ['jetbrains', 'JetBrains AI'],
    ['augment', 'Augment Code'],
    ['factory', 'Factory / Droid'],
    ['amp', 'Amp'],
    ['suno', 'Suno'],
  ].map(([id, name]): ProviderMeta => ({
    id,
    name,
    automation: 'unsupported',
    auth: [],
    note: 'No usage connection yet.',
  })),
];

export const providerById = (id: string): ProviderMeta | undefined =>
  providers.find((p) => p.id === id);

/** Shared by discovery, direct routes and service-layer validation. */
export function isConnectableProvider(
  p: ProviderMeta | undefined,
): p is ProviderMeta & { automation: 'spec' | 'plugin' } {
  return !!p && p.automation !== 'unsupported' && !!(p.spec || p.plugin) && p.auth.length > 0;
}

export function supportsAuthMethod(providerId: string, method: AuthMethod): boolean {
  const p = providerById(providerId);
  return isConnectableProvider(p) && p.auth.some((m) => m === method);
}

export function supportsCredential(
  providerId: string,
  method: AuthMethod,
  cred?: Credential,
): boolean {
  if (!supportsAuthMethod(providerId, method) || !cred) return false;
  if (method === 'deviceCode') return cred.type === 'oauth' && !!cred.accessToken.trim();
  if (method === 'apiKey') return cred.type === 'apiKey' && !!cred.key.trim();
  if (method === 'oauthPkce') {
    // The two browser flows differ: OpenRouter issues an API key, Codex returns OAuth tokens.
    return providerId === 'codex'
      ? cred.type === 'oauth' && !!cred.accessToken.trim()
      : cred.type === 'apiKey' && !!cred.key.trim();
  }
  return false;
}
