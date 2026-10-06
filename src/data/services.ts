import { AccountService } from '@/authkit/account-service';
import { credentialManager, credentialStore } from '@/authkit';
import type { CredentialManager } from '@/authkit/refresh';
import type { CredentialStore } from '@/authkit/secure';
import { getRepos } from '@/db';
import type { Repos } from '@/db/repos';
import { expoNotifier } from '@/alerts/expo-notifier';
import { syncWidget } from '@/widgets/sync';
import type { CycleDeps } from '@/refresh/coordinator';
import type { RefreshDeps } from '@/refresh/refresh-account';

export interface Services {
  repos: Repos;
  credentials: CredentialStore;
  manager: CredentialManager;
  accounts: AccountService;
  refreshDeps: RefreshDeps;
  /** refresh + alert evaluation + notifications */
  cycleDeps: CycleDeps;
}

let cached: Promise<Services> | undefined;

/** App-wide singletons. Opens the database and runs migrations on first use. */
export function getServices(): Promise<Services> {
  cached ??= (async () => {
    const repos = await getRepos();
    const refreshDeps: RefreshDeps = {
      repos,
      creds: credentialManager,
      fetch: (...a) => fetch(...a),
      now: () => new Date(),
    };
    return {
      repos,
      credentials: credentialStore,
      manager: credentialManager,
      accounts: new AccountService(repos, credentialStore),
      refreshDeps,
      cycleDeps: { ...refreshDeps, notifier: expoNotifier, publish: syncWidget },
    };
  })();
  return cached;
}

export { newId } from '@/data/ids';
