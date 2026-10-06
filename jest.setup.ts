import { setLocale } from '@/i18n';

// Reanimated / Worklets need their native runtime; tests use the bundled mocks, which apply
// animated styles immediately and treat layout animations as no-ops.
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => ({
  ...require('react-native-reanimated/mock'),
  useReducedMotion: () => false,
}));

// Tests assert English text regardless of the machine's locale.
setLocale('en');
