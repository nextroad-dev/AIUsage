import { isConnectableProvider, providers } from '@/providers/registry';
import { matchProviders } from '@/providers/search';

const connectable = providers.filter(isConnectableProvider);
const names = (q: string) => matchProviders(connectable, q).map((p) => p.name);

describe('provider search', () => {
  it('lists everything for an empty query', () => {
    expect(matchProviders(connectable, '  ')).toHaveLength(connectable.length);
  });

  it('matches names and ids, ignoring case, spaces and punctuation', () => {
    expect(names('cline')).toEqual(['Cline']);
    expect(names('OPEN router')).toEqual(['OpenRouter']);
    expect(names('chatgpt/codex')).toEqual(['ChatGPT / Codex']);
    expect(names('command-goat')).toEqual(['Command Code']);
  });

  it('returns nothing for an unknown provider', () => {
    expect(names('no-such-provider')).toEqual([]);
  });
});
