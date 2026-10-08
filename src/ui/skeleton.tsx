import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/i18n';

/**
 * The gentle opacity pulse every placeholder shares, so loading looks the same everywhere. Under
 * reduced motion it stays still, which is just as readable.
 */
export function useBreathe() {
  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    pulse.value = withRepeat(
      withTiming(0.45, { duration: 800, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => cancelAnimation(pulse);
  }, [reduced, pulse]);
  return useAnimatedStyle(() => ({ opacity: pulse.value }));
}

/**
 * Placeholder lines shaped like `Row` (optional leading icon, a label, optionally a value on the
 * right), for settings pages whose content is still being read from storage.
 */
export function RowSkeleton({
  rows = 3,
  leading = false,
  value = false,
}: {
  rows?: number;
  leading?: boolean;
  value?: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  const breathe = useBreathe();
  const block = { backgroundColor: theme.backgroundSelected };
  // varied widths read as text rather than as a stack of bars
  const widths = ['58%', '42%', '66%', '50%'] as const;

  return (
    <Animated.View
      style={[styles.list, breathe]}
      accessible
      accessibilityLabel={t('Loading…')}
      accessibilityState={{ busy: true }}
    >
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.row}>
          {leading ? <View style={[styles.icon, block]} /> : null}
          <View style={[styles.line, { width: widths[i % widths.length] }, block]} />
          {value ? <View style={[styles.line, styles.value, block]} /> : null}
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.three },
  // same height and spacing as a Row, so nothing shifts when the content replaces it
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 44 },
  icon: { width: 24, height: 24, borderRadius: Radius.control },
  line: { height: 12, borderRadius: Radius.pill },
  value: { width: 48, marginLeft: 'auto' },
});
