import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/** Line height of the `small` / `smallBold` text styles the notice sits next to. */
const LINE = 20;
const ICON = 14;

/** Circled exclamation mark: SF Symbol on iOS, Material Symbol on Android. Decorative only. */
export function NoticeIcon({ color, size = ICON }: { color: string; size?: number }) {
  return (
    <SymbolView
      name={{ ios: 'exclamationmark.circle', android: 'error', web: 'error' }}
      size={size}
      tintColor={color}
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/**
 * A hint or warning line: the notice icon, then wrapping text in the same color. The icon sits
 * in a box exactly one text line tall and is centred in it, so it lines up with the first line
 * on both platforms; box and icon follow the system font scale like the text does.
 */
export function Notice({
  color,
  bold = false,
  children,
}: {
  color: string;
  bold?: boolean;
  children: ReactNode;
}) {
  const { fontScale } = useWindowDimensions();
  const line = LINE * fontScale;
  const size = Math.round(ICON * fontScale);
  return (
    <View style={styles.row}>
      <View style={[styles.icon, { height: line, width: size }]}>
        <NoticeIcon color={color} size={size} />
      </View>
      <ThemedText type={bold ? 'smallBold' : 'small'} style={[styles.text, { color }]}>
        {children}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one },
  icon: { alignItems: 'center', justifyContent: 'center' },
  // shrink, not flex: in a content-sized parent (a card header) flex: 1 would collapse it
  text: { flexShrink: 1, fontVariant: ['tabular-nums'] },
});
