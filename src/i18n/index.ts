import { useEffect, useMemo, useReducer } from 'react';

import { zh } from '@/i18n/zh';

/**
 * Minimal i18n: the English source text is the key. Other locales map it to a translation;
 * anything missing falls back to English, so a missing entry is never a blank label.
 * `{name}` placeholders are interpolated.
 *
 * IMPORTANT (React Compiler): components must translate through `useT()`, not the module-level
 * `t()`. With `experiments.reactCompiler` enabled, the compiler caches calls to imported
 * functions whose arguments are constants into a dependency-free slot, so a plain module-level
 * translation call inside a component freezes on the first language it was rendered with —
 * re-rendering does not re-run it. The translator returned by `useT()` changes identity with
 * the locale, which makes every call that uses it a reactive dependency again.
 */
export type Locale = 'en' | 'zh';

export type Translator = (en: string, params?: Record<string, string | number>) => string;

/** User-facing language choice. `system` follows the device locale. */
export type LocaleSetting = 'system' | Locale;

/** User-facing appearance choice. `system` follows the OS color scheme. */
export type ThemeSetting = 'system' | 'light' | 'dark';

export function systemLocale(): Locale {
  try {
    const l = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
    return l.startsWith('zh') ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}

let current: Locale = systemLocale();

const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Subscribe to language changes; returns the active locale. Call in any component using t(). */
export function useLocale(): Locale {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeLocale(bump), []);
  return current;
}

export const getLocale = (): Locale => current;
export const setLocale = (l: Locale): void => {
  if (current === l) return;
  current = l;
  notify();
};

/** Resolve a user setting to the locale actually used for rendering. */
export const resolveLocale = (s: LocaleSetting): Locale => (s === 'system' ? systemLocale() : s);

const dictionaries: Record<Locale, Record<string, string>> = { en: {}, zh };

/** Look a key up without touching the module-level locale; used by t() and translator bindings. */
export function translate(
  locale: Locale,
  en: string,
  params?: Record<string, string | number>,
): string {
  const text = dictionaries[locale][en] ?? en;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/**
 * Non-React translation (services, background alerts, module scope).
 * Inside React components use `useT()` so the compiler keeps the call reactive.
 */
export function t(en: string, params?: Record<string, string | number>): string {
  return translate(current, en, params);
}

/** Bind a translator to one locale. Called by useT() so the identity tracks the language. */
export function createTranslator(locale: Locale): Translator {
  return (en, params) => translate(locale, en, params);
}

/**
 * Language-bound translator for components. The returned function has a new identity whenever
 * the language changes, which is what keeps memoized `t(...)` calls up to date.
 *
 *   const t = useT();
 *   <ThemedText>{t('Settings')}</ThemedText>
 */
export function useT(): Translator {
  const locale = useLocale();
  return useMemo(() => createTranslator(locale), [locale]);
}

/** BCP-47 tag for Intl formatting, so number/currency output follows the app language. */
export const intlLocale = (): string => (current === 'zh' ? 'zh-CN' : 'en-US');

export const dictionary = (l: Locale): Record<string, string> => dictionaries[l];
