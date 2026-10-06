import * as LocalAuthentication from 'expo-local-authentication';

export interface Biometric {
  isAvailable(): Promise<boolean>;
  authenticate(promptMessage: string): Promise<boolean>;
}

export const expoBiometric: Biometric = {
  async isAvailable() {
    return (
      (await LocalAuthentication.hasHardwareAsync()) &&
      (await LocalAuthentication.isEnrolledAsync())
    );
  },
  async authenticate(promptMessage) {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage });
    return r.success;
  },
};

/**
 * Re-lock policy: lock after the app has been in the background longer than `graceMs`.
 * (Face ID is not available in Expo Go; verify in a development build.)
 */
export function shouldRelock(opts: {
  enabled: boolean;
  backgroundedAt?: number;
  now: number;
  graceMs?: number;
}): boolean {
  if (!opts.enabled) return false;
  if (opts.backgroundedAt === undefined) return false;
  return opts.now - opts.backgroundedAt >= (opts.graceMs ?? 30_000);
}
