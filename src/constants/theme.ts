import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#FAFAF8',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#ECECF1',
    textSecondary: '#60646C',
    // semantic action tokens (Soft Product: restrained, single action hue)
    // #2563EB keeps white button text at 5.17:1 and reads as text at 4.95:1 on the page bg.
    primary: '#2563EB',
    onPrimary: '#FFFFFF',
    border: '#E7E7EC',
    // usage levels: used with an icon/label too, never color alone
    good: '#1A7F4B',
    // #9E5D00 keeps the warn label readable on card surfaces (5.22:1)
    warn: '#9E5D00',
    bad: '#C62828',
    muted: '#8A8F98',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#1C1C1E',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    primary: '#2563EB',
    onPrimary: '#FFFFFF',
    border: '#2C2C30',
    good: '#4CC38A',
    warn: '#F5A524',
    bad: '#FF6B6B',
    muted: '#8A8F98',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * User-selectable theme (accent) colours. Each replaces `primary` in both schemes, so every one
 * keeps white button text at 4.5:1 or better (checked in the theme tests). Blue is the default.
 */
export const Accents = {
  blue: '#2563EB',
  indigo: '#4F46E5',
  violet: '#7C3AED',
  pink: '#DB2777',
  orange: '#C2410C',
  green: '#15803D',
  teal: '#0F766E',
} as const;

export type AccentName = keyof typeof Accents;

export const DEFAULT_ACCENT: AccentName = 'blue';

export const isAccentName = (v: unknown): v is AccentName =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(Accents, v);

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = { control: 12, pill: 999 } as const;
export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
