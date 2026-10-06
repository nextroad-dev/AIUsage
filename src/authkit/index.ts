import { keychainKv } from '@/authkit/keychain';
import { CredentialManager } from '@/authkit/refresh';
import { CredentialStore } from '@/authkit/secure';

export const credentialStore = new CredentialStore(keychainKv);
export const credentialManager = new CredentialManager(credentialStore);
