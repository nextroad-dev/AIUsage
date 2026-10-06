import type { CookieSource } from '@/authkit/web-session';

/**
 * iOS WebKit cookie store via @preeternal/react-native-cookie-manager (includes HttpOnly cookies,
 * which `document.cookie` cannot see). The native module is not part of Expo Go; there the require
 * fails and `available` is false, so callers fall back to pasting a cookie.
 */
interface CookieModule {
  get(
    url: string,
    opts?: { iosCookieStore?: 'webKit' | 'foundation' },
  ): Promise<Record<string, { value: string }>>;
  clearAll(opts?: { iosCookieStore?: 'webKit' | 'foundation' }): Promise<boolean>;
}

function load(): CookieModule | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('@preeternal/react-native-cookie-manager');
    return (m.default ?? m) as CookieModule;
  } catch {
    return undefined;
  }
}

export const cookieModuleAvailable = (): boolean => load() !== undefined;

export const webKitCookies: CookieSource = {
  async get(url) {
    const mod = load();
    if (!mod) throw new Error('cookie manager unavailable');
    const all = await mod.get(url, { iosCookieStore: 'webKit' });
    return Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.value]));
  },
  async clear() {
    await load()?.clearAll({ iosCookieStore: 'webKit' });
  },
};
