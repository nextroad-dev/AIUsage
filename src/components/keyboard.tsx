import type { ComponentType, ReactNode } from 'react';
import { ScrollView, TurboModuleRegistry, type ScrollViewProps } from 'react-native';

/**
 * Keyboard avoidance for forms: with react-native-keyboard-controller the focused field scrolls
 * above the keyboard on iOS and on edge-to-edge Android. The library throws as soon as it is
 * imported when its native module is missing (Expo Go, older builds, tests), so it is loaded only
 * after checking for the module, and everything falls back to a plain ScrollView otherwise.
 */
const hasNative = (() => {
  try {
    return TurboModuleRegistry.get('KeyboardController') != null;
  } catch {
    return false;
  }
})();

type Lib = typeof import('react-native-keyboard-controller');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lib: Lib | null = hasNative ? require('react-native-keyboard-controller') : null;

/** Mount once at the root. */
export function KeyboardProvider({ children }: { children: ReactNode }) {
  if (!lib) return <>{children}</>;
  // the app is edge-to-edge on Android: keep the system bars translucent while tracking the keyboard
  return (
    <lib.KeyboardProvider statusBarTranslucent navigationBarTranslucent>
      {children}
    </lib.KeyboardProvider>
  );
}

/** ScrollView that keeps the focused input `bottomOffset` points above the keyboard. */
export const KeyboardAwareScrollView: ComponentType<ScrollViewProps & { bottomOffset?: number }> =
  lib
    ? (lib.KeyboardAwareScrollView as ComponentType<ScrollViewProps & { bottomOffset?: number }>)
    : ScrollView;
