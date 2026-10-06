import * as SecureStore from 'expo-secure-store';

import type { KeyValueStore } from '@/authkit/secure';

/**
 * iOS Keychain via expo-secure-store. AFTER_FIRST_UNLOCK lets background refresh read tokens;
 * *_THIS_DEVICE_ONLY keeps them out of iCloud Keychain and device backups.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const keychainKv: KeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key, OPTIONS),
  set: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
  delete: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
};
