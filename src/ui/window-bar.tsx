import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { formatAmount } from '@/core/format';
import { usedFraction } from '@/core/meter-utils';
import type { Meter } from '@/core/types';
import { useTheme } from '@/hooks/use-theme';
import { useT, type Translator } from '@/i18n';
import { Motion } from '@/ui/motion';

/** Text for the current window split; balance meters have no split. */
export function windowFor(
  m: Meter,
  t: Translator,
): { fraction?: number; used: string; remaining?: string; label?: string } {
  const k = m.kind;
  if (k.type === 'percent') {
    const pct = Math.round(k.used);
    return {
      fraction: usedFraction(m),
      used: `${pct}%`,
      remaining: `${Math.max(0, 100 - pct)}%`,
    };
  }
  if (k.type === 'amount') {
    if (k.limit === undefined) return { fraction: undefined, used: formatAmount(k.used, k.unit) };
    return {
      fraction: usedFraction(m),
      used: formatAmount(k.used, k.unit),
      remaining: formatAmount(Math.max(0, k.limit - k.used), k.unit),
    };
  }
  return { fraction: undefined, used: formatAmount(k.value, k.unit), label: t('balance') };
}

/**
 * The current usage window in one row: used amount on the left, the split bar in the middle
 * (used share in the meter's level colour, the rest as a quiet track), remaining on the right.
 * Without a known split (`fraction` undefined) only the amount line is shown.
 */
export function WindowBar({
  fraction,
  color,
  used,
  remaining,
  label,
}: {
  /** used share of the window, 0..1; undefined when there is no split (balance meters) */
  fraction?: number;
  color: string;
  used: string;
  remaining?: string;
  /** left label, defaults to "used"; balance meters pass the balance label */
  label?: string;
}) {
  const theme = useTheme();
  const t = useT();
  const text = label ?? t('used');
  const target = fraction === undefined ? 0 : Math.max(0, Math.min(1, fraction));
  // the used share grows from zero on first paint and slides on refresh
  const grow = useSharedValue(0);
  useEffect(() => {
    grow.value = withTiming(target, { duration: Motion.slow + 180, easing: Motion.easing });
  }, [target, grow]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${grow.value * 100}%` }));

  if (fraction === undefined) {
    return (
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {text} {used}
      </ThemedText>
    );
  }

  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {text} {used}
      </ThemedText>
      <View
        style={[styles.track, { backgroundColor: theme.backgroundSelected }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Animated.View style={[styles.fill, { backgroundColor: color }, fillStyle]} />
      </View>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {remaining === undefined ? '' : `${t('Remaining')} ${remaining}`}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 20 },
  track: {
    flex: 1,
    height: 8,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: Radius.pill },
});
