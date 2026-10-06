import type { ProviderMeta } from '@/providers/registry';

/**
 * How the add-account list is organised: plans you subscribe to, pay-as-you-go API platforms,
 * then relays. Within a group, the most widely used come first. A provider missing here still
 * shows up, in a trailing "Other" group, so adding one never hides it.
 */
export const PROVIDER_GROUPS: { key: string; title: string; ids: string[] }[] = [
  {
    key: 'subscriptions',
    title: 'Subscriptions',
    ids: [
      'codex',
      'copilot',
      'cline',
      'kimi-code',
      'zai',
      'minimax',
      'command-goat',
      'opencode-go',
      'poe',
    ],
  },
  {
    key: 'platforms',
    title: 'Open platforms',
    ids: [
      'openai-platform',
      'anthropic-platform',
      'openrouter',
      'deepseek',
      'kimi-balance',
      'runway',
    ],
  },
  { key: 'relays', title: 'Relays', ids: ['relay'] },
];

export function groupProviders(
  list: ProviderMeta[],
): { key: string; title: string; providers: ProviderMeta[] }[] {
  const byId = new Map(list.map((p) => [p.id, p]));
  const placed = new Set<string>();
  const groups = PROVIDER_GROUPS.map((g) => ({
    key: g.key,
    title: g.title,
    providers: g.ids.flatMap((id) => {
      const p = byId.get(id);
      if (!p) return [];
      placed.add(id);
      return [p];
    }),
  }));
  const rest = list.filter((p) => !placed.has(p.id));
  if (rest.length) groups.push({ key: 'other', title: 'Other', providers: rest });
  return groups.filter((g) => g.providers.length > 0);
}
