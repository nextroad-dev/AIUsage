import { groupProviders } from '@/providers/groups';
import { isConnectableProvider, providers } from '@/providers/registry';
import { matchProviders } from '@/providers/search';

const connectable = providers.filter(isConnectableProvider);

describe('add-account groups', () => {
  it('places every connectable provider in a named group, in order', () => {
    const groups = groupProviders(connectable);
    expect(groups.map((g) => g.key)).toEqual(['subscriptions', 'platforms', 'relays']);
    expect(groups.flatMap((g) => g.providers)).toHaveLength(connectable.length);
    expect(groups[0].providers[0].id).toBe('codex');
    expect(groups[1].providers.map((p) => p.id)).toContain('deepseek');
  });

  it('keeps only the groups with matches when searching, and never hides an unknown provider', () => {
    expect(groupProviders(matchProviders(connectable, 'open platform')).map((g) => g.key)).toEqual([
      'platforms',
    ]);
    const stray = { ...connectable[0], id: 'brand-new' };
    expect(groupProviders([stray]).map((g) => g.key)).toEqual(['other']);
  });
});
