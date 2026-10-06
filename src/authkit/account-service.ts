import type { CredentialStore } from '@/authkit/secure';
import type { Credential } from '@/core/types';
import type { Account, Repos } from '@/db/repos';
import { supportsCredential } from '@/providers/registry';

/** Account lifecycle that spans the database (metadata, history) and the keychain (secrets). */
export class AccountService {
  constructor(
    private repos: Repos,
    private creds: CredentialStore,
  ) {}

  /** Credential first, so a failure never leaves an account row without its secret. An existing account is never overwritten. */
  async add(account: Omit<Account, 'sortOrder'>, cred?: Credential): Promise<void> {
    if (await this.repos.accounts.get(account.id))
      throw new Error(`account ${account.id} already exists`);
    if (account.manual || !supportsCredential(account.providerId, account.authMethod, cred))
      throw new Error('Only supported OAuth or API-key accounts can be added.');
    if (cred) await this.creds.save(account.id, cred);
    try {
      await this.repos.accounts.create(account);
    } catch (e) {
      if (cred) await this.creds.remove(account.id);
      throw e;
    }
  }

  /** "Sign out and delete credentials": removes secrets and all stored data for the account. */
  async remove(accountId: string): Promise<void> {
    await this.creds.remove(accountId);
    await this.repos.accounts.remove(accountId);
  }

  /** Wipe everything (settings > clear data). */
  async removeAll(): Promise<void> {
    for (const a of await this.repos.accounts.list()) await this.remove(a.id);
  }
}
