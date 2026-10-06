import { openExpoDriver } from '@/db/expo-driver';
import { migrate } from '@/db/migrations';
import { createRepos, type Repos } from '@/db/repos';

let ready: Promise<Repos> | undefined;

/** Opens the app database once, applies migrations, and returns the repositories. */
export function getRepos(): Promise<Repos> {
  ready ??= (async () => {
    const db = await openExpoDriver();
    await migrate(db);
    return createRepos(db);
  })();
  return ready;
}
