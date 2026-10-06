/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { useColorScheme as useSystemScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { usePreferences } from '@/providers/preferences';

function effectiveScheme(
  themeSetting: 'system' | 'light' | 'dark',
  system: string | null | undefined,
): 'light' | 'dark' {
  if (themeSetting !== 'system') return themeSetting;
  return system === 'dark' ? 'dark' : 'light';
}

/**
 * App theme: the user's appearance override (system/light/dark) wins,
 * otherwise follows the OS scheme. Safe in tests (defaults to light).
 */
export function useTheme() {
  const { themeSetting } = usePreferences();
  const system = useSystemScheme();
  return Colors[effectiveScheme(themeSetting, system)];
}

/** Effective scheme name, for components that branch on light/dark directly. */
export function useEffectiveScheme(): 'light' | 'dark' {
  const { themeSetting } = usePreferences();
  const system = useSystemScheme();
  return effectiveScheme(themeSetting, system);
}
