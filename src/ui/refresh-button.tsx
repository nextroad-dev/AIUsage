import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/i18n';
import { haptics } from '@/ui/haptics';
import { PressableScale } from '@/ui/motion';

/**
 * Icon-only refresh control for page and navigation headers. The arrow spins while a refresh is
 * in flight (under reduced motion it dims instead) and ignores taps until it finishes.
 */
export function RefreshButton({
  refreshing,
  onPress,
}: {
  refreshing: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const reduced = useReducedMotion();
  const turn = useSharedValue(0);

  useEffect(() => {
    if (!refreshing) {
      cancelAnimation(turn);
      // finish the current turn instead of snapping back
      turn.value = withTiming(Math.ceil(turn.value), {
        duration: 240,
        easing: Easing.out(Easing.cubic),
      });
      return;
    }
    if (reduced) return;
    turn.value = withRepeat(
      withTiming(turn.value + 1, { duration: 800, easing: Easing.linear }),
      -1,
      false,
    );
  }, [refreshing, reduced, turn]);

  const spin = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value * 360}deg` }],
    opacity: refreshing && reduced ? 0.4 : 1,
  }));

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t('Refresh')}
      accessibilityState={{ busy: refreshing, disabled: refreshing }}
      disabled={refreshing}
      hitSlop={8}
      scaleTo={0.9}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={styles.button}
    >
      <Animated.View style={spin}>
        <SymbolView name="arrow.clockwise" size={20} weight="semibold" tintColor={theme.text} />
      </Animated.View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
