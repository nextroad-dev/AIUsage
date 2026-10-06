import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { DEFAULT_ACCENT, isAccentName, type AccentName } from '@/constants/theme';
import { getServices } from '@/data/services';
import { resolveLocale, setLocale, type LocaleSetting, type ThemeSetting } from '@/i18n';

const LOCALE_KEY = 'locale-setting';
const APPEARANCE_KEY = 'appearance-setting';
const ACCENT_KEY = 'accent-setting';

interface Preferences {
  localeSetting: LocaleSetting;
  themeSetting: ThemeSetting;
  accentSetting: AccentName;
  setLocaleSetting: (v: LocaleSetting) => void;
  setThemeSetting: (v: ThemeSetting) => void;
  setAccentSetting: (v: AccentName) => void;
}

const PreferencesContext = createContext<Preferences>({
  localeSetting: 'system',
  themeSetting: 'system',
  accentSetting: DEFAULT_ACCENT,
  setLocaleSetting: () => {},
  setThemeSetting: () => {},
  setAccentSetting: () => {},
});

/**
 * Language & appearance preferences. Works without QueryClientProvider so unit
 * tests can render themed components bare (defaults = follow system).
 * Persisted in the SQLite settings repo; applied to t() on load and on change.
 */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [localeSetting, setLocaleState] = useState<LocaleSetting>('system');
  const [themeSetting, setThemeState] = useState<ThemeSetting>('system');
  const [accentSetting, setAccentState] = useState<AccentName>(DEFAULT_ACCENT);

  useEffect(() => {
    let cancelled = false;
    getServices()
      .then(async (s) => {
        const [l, a, c] = await Promise.all([
          s.repos.settings.getJson<LocaleSetting>(LOCALE_KEY, 'system'),
          s.repos.settings.getJson<ThemeSetting>(APPEARANCE_KEY, 'system'),
          s.repos.settings.getJson<unknown>(ACCENT_KEY, DEFAULT_ACCENT),
        ]);
        if (cancelled) return;
        setLocaleState(l);
        setThemeState(a);
        // an unknown stored value (e.g. a colour removed in a later version) falls back to the default
        setAccentState(isAccentName(c) ? c : DEFAULT_ACCENT);
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

  const setAccentSetting = useCallback((v: AccentName) => {
    setAccentState(v);
    getServices()
      .then((s) => s.repos.settings.setJson(ACCENT_KEY, v))
      .catch(() => {});
  }, []);

  return (
    <PreferencesContext.Provider
      value={{
        localeSetting,
        themeSetting,
        accentSetting,
        setLocaleSetting,
        setThemeSetting,
        setAccentSetting,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): Preferences {
  return useContext(PreferencesContext);
}
