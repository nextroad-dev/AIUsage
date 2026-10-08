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
  // expo-secure-store before SDK 58 can resolve an iOS delete the keychain refused, so a delete
  // only counts once the item is really gone
  delete: async (key) => {
    await SecureStore.deleteItemAsync(key, OPTIONS);
    if ((await SecureStore.getItemAsync(key, OPTIONS)) !== null) {
      throw new Error('keychain item still present after delete');
    }
  },
};
