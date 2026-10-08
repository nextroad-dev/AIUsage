import { requireOptionalNativeModule } from 'expo-modules-core';

/** Native side of the loopback callback receiver; see `ios/LoopbackServer.swift`. */
export interface LoopbackNativeModule {
  /**
   * Resolves `{ port }` when the listener is ready, or `{ error: 'port-unavailable' }`. Only a
   * callback carrying `state` ends the session; anything else is refused and the wait goes on.
   */
  start(provider: string, port: number, state: string): Promise<{ port?: number; error?: string }>;
  stop(): Promise<void>;
}

/**
 * The module is part of the native build, so it is absent in Expo Go and in builds made before it
 * was added. Callers must explain that a new build is required instead of silently falling back.
 *
 * Resolved on each call: it is a lookup in the native module registry, and caching `null` would
 * keep reporting unavailability after the module exists.
 */
export function loopbackNativeModule(): LoopbackNativeModule | null {
  try {
    return requireOptionalNativeModule<LoopbackNativeModule>('UsageOauthLoopback');
  } catch {
    return null;
  }
}
