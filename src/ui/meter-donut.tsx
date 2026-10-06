import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import type { UsageLevel } from '@/core/meter-utils';
import { level } from '@/core/meter-utils';
import { useTheme } from '@/hooks/use-theme';
import { Motion } from '@/ui/motion';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function useLevelColor(l: UsageLevel): string {
  const theme = useTheme();
  return l === 'good'
    ? theme.good
    : l === 'warn'
      ? theme.warn
      : l === 'bad'
        ? theme.bad
        : theme.muted;
}

interface Props {
  /** used fraction 0..1+; undefined draws the bare track (no ratio available, e.g. a balance) */
  fraction?: number;
  size?: number;
  /** text in the hole, e.g. "42%" */
  centerText?: string;
  accessibilityLabel?: string;
}

/**
 * Donut for one usage window: the used share is an arc in the level colour, swept clockwise from
 * 12 o'clock over a quiet track, with the used percentage in the hole. Colour is always paired
 * with that number and the labels under the donut.
 */
export function MeterDonut({ fraction, size = 76, centerText, accessibilityLabel }: Props) {
  const theme = useTheme();
  const color = useLevelColor(level(fraction));
  const shown = fraction === undefined ? 0 : Math.min(1, Math.max(0, fraction));
  const stroke = Math.max(7, size / 9);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  // sweeps open from empty on first paint and glides between values on refresh
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(shown, { duration: Motion.slow + 180, easing: Motion.easing });
  }, [shown, progress]);
  const arc = useAnimatedProps(() => ({
    strokeDashoffset: c * (1 - progress.value),
    // a round cap would leave a dot at 0%
    strokeOpacity: progress.value > 0.001 ? 1 : 0,
  }));

  return (
    <View
      style={{ width: size, height: size }}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={
        fraction === undefined ? undefined : { min: 0, max: 100, now: Math.round(shown * 100) }
      }
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={theme.backgroundSelected}
          strokeWidth={stroke}
          fill="none"
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          animatedProps={arc}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {centerText !== undefined && (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <ThemedText type="smallBold" style={{ fontSize: size / 4.6 }}>
            {centerText}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({ center: { alignItems: 'center', justifyContent: 'center' } });
