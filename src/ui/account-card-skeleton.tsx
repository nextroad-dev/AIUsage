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
 * Placeholder that mirrors the AccountCard geometry (badge + ring + two lines) while the first
 * snapshot loads. It breathes gently to signal work in progress; under reduced motion it stays
 * still, which is just as readable. It reports no progress value, since none is known yet.
 */
export function AccountCardSkeleton() {
  const theme = useTheme();
  const t = useT();
  const reduced = useReducedMotion();
  const block = { backgroundColor: theme.backgroundSelected };
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
  const breathe = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View style={[styles.root, breathe]} accessible accessibilityLabel={t('Loading…')}>
      <View style={styles.header}>
        <View style={[styles.line, styles.title, block]} />
        <View style={[styles.pill, block]} />
      </View>
      <View style={styles.body}>
        <View style={[styles.ring, block]} />
        <View style={styles.lines}>
          <View style={[styles.line, styles.wide, block]} />
          <View style={[styles.line, styles.narrow, block]} />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.two },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  body: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.one },
  lines: { gap: Spacing.two, flexShrink: 1, flexGrow: 1 },
  line: { height: 12, borderRadius: Radius.pill },
  title: { width: 132 },
  wide: { width: '72%' },
  narrow: { width: '44%' },
  pill: { width: 64, height: 20, borderRadius: Radius.pill },
  ring: { width: 72, height: 72, borderRadius: 36 },
});
