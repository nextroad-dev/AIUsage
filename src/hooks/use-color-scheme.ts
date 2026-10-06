import { useColorScheme as useSystemScheme } from 'react-native';

import { usePreferences } from '@/providers/preferences';

/**
 * Override-aware color scheme: user appearance setting wins,
 * otherwise follows the OS. Safe in tests (defaults to light).
 */
export function useColorScheme(): 'light' | 'dark' {
  const { themeSetting } = usePreferences();
  const system = useSystemScheme();
  if (themeSetting !== 'system') return themeSetting;
  return system === 'dark' ? 'dark' : 'light';
}
