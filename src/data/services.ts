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
import { CodexResetService } from '@/data/codex-reset/service';
import { MOCK_DATA, mockFetch, syncMockAccounts } from '@/dev/mock-data';

export interface Services {
  repos: Repos;
  credentials: CredentialStore;
  manager: CredentialManager;
  accounts: AccountService;
  refreshDeps: RefreshDeps;
  /** refresh + alert evaluation + notifications */
  cycleDeps: CycleDeps;
  codexReset: CodexResetService;
  refreshPublicData: () => Promise<void>;
}

let cached: Promise<Services> | undefined;

/** App-wide singletons. Opens the database and runs migrations on first use. */
export function getServices(): Promise<Services> {
  cached ??= (async () => {
    const repos = await getRepos();
    const real: typeof fetch = (...a) => fetch(...a);
    // development builds can answer demo accounts from canned data (see src/dev/mock-data.ts)
    const net = MOCK_DATA ? mockFetch(real) : real;
    const accounts = new AccountService(repos, credentialStore);
    if (__DEV__) await syncMockAccounts(accounts, repos);
    const refreshDeps: RefreshDeps = {
      repos,
      creds: credentialManager,
      fetch: net,
      now: () => new Date(),
    };
    const codexReset = new CodexResetService({
      store: repos.settings,
      fetch: net,
      now: () => Date.now(),
    });
    const refreshPublicData = async () => {
      if (!(await codexReset.getEnabled())) return;
      if (!(await repos.accounts.list()).some((a) => a.providerId === 'codex')) return;
      await codexReset.refresh();
    };
    return {
      repos,
      credentials: credentialStore,
      manager: credentialManager,
      accounts,
      refreshDeps,
      cycleDeps: {
        ...refreshDeps,
        notifier: expoNotifier,
        publish: syncWidget,
        refreshPublicData,
      },
      codexReset,
      refreshPublicData,
    };
  })();
  return cached;
}

export { newId } from '@/data/ids';
