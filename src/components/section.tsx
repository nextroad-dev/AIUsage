import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import Animated from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { layoutShift, PressableScale } from '@/ui/motion';

/**
 * Full-bleed grouping surface. Replaces cards: no radius, border or shadow — hierarchy comes
 * from the bands, spacing and section titles instead of chrome.
 * The negative margin cancels the Screen's horizontal gutter so the surface reaches the screen
 * edges while its content stays aligned with the rest of the page.
 * Accepts Reanimated `entering` / `exiting` / `layout` so screens can animate whole bands.
 */
export function Band({
  children,
  style,
  ...rest
}: ComponentProps<typeof Animated.View> & { children: ReactNode }) {
  return (
    <Animated.View style={[styles.band, style]} {...rest}>
      {children}
    </Animated.View>
  );
}

/**
 * A titled group: optional label, one band, optional footnote. Screens compose these instead of
 * stacking cards. Sections glide to their new position when content above them grows or shrinks.
 */
export function Section({
  title,
  footer,
  bandStyle,
  children,
}: {
  title?: string;
  footer?: string;
  bandStyle?: ViewProps['style'];
  children: ReactNode;
}) {
  return (
    <Animated.View style={styles.section} layout={layoutShift}>
      {title ? (
        <ThemedText type="smallBold" themeColor="textSecondary">
          {title}
        </ThemedText>
      ) : null}
      <Band style={bandStyle}>{children}</Band>
      {footer ? (
        <ThemedText type="small" themeColor="textSecondary">
          {footer}
        </ThemedText>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.two },
  band: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    marginHorizontal: -Spacing.three,
    gap: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    minHeight: 44,
  },
  rowText: { flex: 1, gap: Spacing.half },
  rowValue: { flexShrink: 1, textAlign: 'right' },
});

/**
 * One list line: label on the left, optional hint under it, optional value and chevron on the
 * right. Rows are the default way to offer a destination or a value inside a band.
 */
export function Row({
  leading,
  title,
  hint,
  value,
  onPress,
  accessibilityHint,
}: {
  leading?: ReactNode;
  title: string;
  hint?: string;
  value?: string;
  onPress?: () => void;
  accessibilityHint?: string;
}) {
  const body = (
    <>
      {leading}
      <View style={styles.rowText}>
        <ThemedText type="small">{title}</ThemedText>
        {hint ? (
          <ThemedText type="small" themeColor="textSecondary">
            {hint}
          </ThemedText>
        ) : null}
      </View>
      {value ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.rowValue}>
          {value}
        </ThemedText>
      ) : null}
      {onPress ? (
        <ThemedText type="small" themeColor="textSecondary">
          {'›'}
        </ThemedText>
      ) : null}
    </>
  );

  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      scaleTo={0.985}
      style={styles.row}
    >
      {body}
    </PressableScale>
  );
}
