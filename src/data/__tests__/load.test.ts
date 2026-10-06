import { loadView, loadViews } from '@/data/load';
import { newId } from '@/data/ids';
import { migrate } from '@/db/migrations';
import { createRepos } from '@/db/repos';
import { NOW } from '@/test-utils/fetch';
import { memoryDriver } from '@/test-utils/sqlite';

describe('loadViews', () => {
  async function setup() {
    const db = memoryDriver();
    await migrate(db);
    return createRepos(db);
  }

  it('combines accounts, provider metadata, snapshots and health', async () => {
    const repos = await setup();
    await repos.accounts.create({
      id: 'a',
      providerId: 'poe',
      label: 'Poe',
      authMethod: 'apiKey',
      createdAt: 1,
    });
    await repos.snapshots.save({
      providerId: 'poe',
      accountId: 'a',
      fetchedAt: NOW.toISOString(),
      status: { type: 'ok' },
      meters: [
        {
          id: 'points',
          label: 'Points',
          kind: { type: 'balance', value: 5, unit: 'points' },
          scope: { type: 'overall' },
        },
      ],
    });
    await repos.health.recordSuccess('a', NOW.getTime());
    await repos.accounts.create({
      id: 'm',
      providerId: 'claude',
      label: 'Claude',
      authMethod: 'manual',
      createdAt: 2,
      manual: {
        planName: 'Pro',
        meters: [
          {
            id: 'weekly',
            label: 'Weekly',
            window: { type: 'weekly' },
            anchor: '2026-10-01T00:00:00Z',
            unit: '%',
            percent: true,
          },
        ],
      },
    });
    const views = await loadViews(repos, NOW);
    expect(views.map((v) => [v.account.id, v.source, v.meta?.name])).toEqual([
      ['a', 'auto', 'OpenRouter'.length ? 'Poe' : ''],
      ['m', 'legacy', 'Claude / Claude Code'],
    ]);
    expect(views[0].health?.statusType).toBe('ok');
    expect(views[1].snapshot?.meters[0].resetsAt).toBe('2026-10-08T00:00:00.000Z');
    expect(views[1].health).toBeNull();
    expect((await loadView(repos, 'm', NOW))?.account.id).toBe('m');
    expect(await loadView(repos, 'nope', NOW)).toBeNull();
  });
});

describe('newId', () => {
  it('is unique and keychain-safe', () => {
    const ids = new Set(Array.from({ length: 200 }, newId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});
