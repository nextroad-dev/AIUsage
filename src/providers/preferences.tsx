import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { getServices } from '@/data/services';
import { resolveLocale, setLocale, type LocaleSetting, type ThemeSetting } from '@/i18n';

const LOCALE_KEY = 'locale-setting';
const APPEARANCE_KEY = 'appearance-setting';

interface Preferences {
  localeSetting: LocaleSetting;
  themeSetting: ThemeSetting;
  setLocaleSetting: (v: LocaleSetting) => void;
  setThemeSetting: (v: ThemeSetting) => void;
}

const PreferencesContext = createContext<Preferences>({
  localeSetting: 'system',
  themeSetting: 'system',
  setLocaleSetting: () => {},
  setThemeSetting: () => {},
});

/**
 * Language & appearance preferences. Works without QueryClientProvider so unit
 * tests can render themed components bare (defaults = follow system).
 * Persisted in the SQLite settings repo; applied to t() on load and on change.
 */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [localeSetting, setLocaleState] = useState<LocaleSetting>('system');
  const [themeSetting, setThemeState] = useState<ThemeSetting>('system');

  useEffect(() => {
    let cancelled = false;
    getServices()
      .then(async (s) => {
        const [l, a] = await Promise.all([
          s.repos.settings.getJson<LocaleSetting>(LOCALE_KEY, 'system'),
          s.repos.settings.getJson<ThemeSetting>(APPEARANCE_KEY, 'system'),
        ]);
        if (cancelled) return;
        setLocaleState(l);
        setThemeState(a);
        setLocale(resolveLocale(l));
      })
      .catch(() => {
        // storage unavailable: stay on system defaults
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // "Follow system": pick up a language changed in system settings when the app comes back.
  useEffect(() => {
    if (localeSetting !== 'system') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setLocale(resolveLocale('system'));
    });
    return () => sub.remove();
  }, [localeSetting]);

  const setLocaleSetting = useCallback((v: LocaleSetting) => {
    setLocaleState(v);
    setLocale(resolveLocale(v));
    getServices()
      .then((s) => s.repos.settings.setJson(LOCALE_KEY, v))
      .catch(() => {});
  }, []);

  const setThemeSetting = useCallback((v: ThemeSetting) => {
    setThemeState(v);
    getServices()
      .then((s) => s.repos.settings.setJson(APPEARANCE_KEY, v))
      .catch(() => {});
  }, []);

  return (
    <PreferencesContext.Provider
      value={{ localeSetting, themeSetting, setLocaleSetting, setThemeSetting }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): Preferences {
  return useContext(PreferencesContext);
}
