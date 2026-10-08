import { loopbackNativeModule } from '../../modules/usage-oauth-loopback';

export type LoopbackProvider = 'codex' | 'openrouter';

/** The native module is missing (Expo Go, or a build made before it was added). */
export class LoopbackUnavailableError extends Error {
  constructor() {
    super('loopback module unavailable');
    this.name = 'LoopbackUnavailableError';
  }
}

/** The native module refused to listen on the requested port. */
export class LoopbackPortError extends Error {
  constructor() {
    super('loopback port unavailable');
    this.name = 'LoopbackPortError';
  }
}

export const isLoopbackAvailable = (): boolean => loopbackNativeModule() !== null;

/**
 * Binds one loopback port and resolves with the port actually in use. The listener only forwards a
 * callback whose `state` matches, so another local process cannot use up the session.
 */
export async function startLoopback(
  provider: LoopbackProvider,
  port: number,
  state: string,
): Promise<{ port: number }> {
  const native = loopbackNativeModule();
  if (!native) throw new LoopbackUnavailableError();
  const result = await native.start(provider, port, state);
  if (!result || typeof result.port !== 'number' || result.port <= 0) {
    throw new LoopbackPortError();
  }
  return { port: result.port };
}

/** Never throws: the listener is already gone when the app is killed. */
export async function stopLoopback(): Promise<void> {
  const native = loopbackNativeModule();
  if (!native) return;
  try {
    await native.stop();
  } catch {
    /* the native side already stopped the session */
  }
}
