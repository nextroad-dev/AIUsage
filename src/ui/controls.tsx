import { useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/ui/haptics';
import { Motion, PressableScale } from '@/ui/motion';
import { useOptionGrid } from '@/ui/option-grid';

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'destructive';
  disabled?: boolean;
  loading?: boolean;
}) {
  const theme = useTheme();
  const bg = kind === 'primary' ? theme.primary : theme.backgroundSelected;
  const fg = kind === 'primary' ? theme.onPrimary : kind === 'destructive' ? theme.bad : theme.text;
  const off = disabled || loading;
  const dim = useAnimatedStyle(() => ({
    opacity: withTiming(disabled ? 0.5 : 1, { duration: Motion.fast }),
  }));
  return (
    <Animated.View style={dim}>
      <PressableScale
        accessibilityRole="button"
        accessibilityState={{ disabled: !!off, busy: !!loading }}
        disabled={off}
        onPress={() => {
          haptics.tap();
          onPress();
        }}
        style={[styles.button, { backgroundColor: bg }]}
      >
        {/* the label keeps its space while busy, so the button never changes width */}
        <ThemedText type="smallBold" style={{ color: fg, opacity: loading ? 0 : 1 }}>
          {title}
        </ThemedText>
        {loading ? (
          <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
            <ActivityIndicator size="small" color={fg} />
          </View>
        ) : null}
      </PressableScale>
    </Animated.View>
  );
}

export function Field({
  label,
  hint,
  onFocus,
  onBlur,
  ...rest
}: TextInputProps & { label: string; hint?: string }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const ring = useAnimatedStyle(() => ({
    borderColor: withTiming(focused ? theme.primary : 'transparent', { duration: Motion.fast }),
  }));
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <Animated.View
        style={[styles.inputWrap, { backgroundColor: theme.backgroundSelected }, ring]}
      >
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          selectionColor={theme.primary}
          {...rest}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, { color: theme.text }]}
        />
      </Animated.View>
      {hint ? (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

/**
 * One selectable tile shared by Segmented (radio) and MultiChips (checkbox): the fill and label
 * colours cross-fade on selection and the tile gives press feedback.
 */
export function OptionTile({
  label,
  selected,
  role,
  onPress,
  style,
}: {
  label: string;
  selected: boolean;
  role: 'radio' | 'checkbox';
  onPress: () => void;
  style?: object;
}) {
  const theme = useTheme();
  const fill = useAnimatedStyle(() => ({
    backgroundColor: withTiming(selected ? theme.primary : theme.backgroundSelected, {
      duration: Motion.base,
    }),
  }));
  const ink = useAnimatedStyle(() => ({
    color: withTiming(selected ? theme.onPrimary : theme.text, { duration: Motion.base }),
  }));
  return (
    <PressableScale
      accessibilityRole={role}
      accessibilityState={{ checked: selected }}
      onPress={() => {
        // a radio that is already on changes nothing, so it stays silent
        if (role === 'checkbox' || !selected) haptics.select();
        onPress();
      }}
      scaleTo={0.95}
      style={[styles.seg, style]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.segFill, fill]} />
      <Animated.Text
        numberOfLines={2}
        style={[styles.segLabel, { fontSize: 14, lineHeight: 20, fontWeight: '500' }, ink]}
      >
        {label}
      </Animated.Text>
    </PressableScale>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  columns,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  /** group label, announced before the options */
  label?: string;
  /** override the automatic column count */
  columns?: number;
}) {
  const grid = useOptionGrid(
    options.map((o) => o.label),
    columns,
  );
  return (
    // a value selector, not navigation: radio semantics keep VoiceOver accurate
    <View
      onLayout={grid.onLayout}
      style={[styles.segmented, { gap: grid.gap }]}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
    >
      {options.map((o) => (
        <OptionTile
          key={String(o.value)}
          role="radio"
          label={o.label}
          selected={o.value === value}
          onPress={() => onChange(o.value)}
          style={grid.itemStyle}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    borderRadius: Radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  field: { gap: Spacing.one },
  inputWrap: { borderRadius: Radius.control, borderWidth: 1.5 },
  input: {
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  segmented: { flexDirection: 'row', flexWrap: 'wrap' },
  seg: {
    minHeight: 44,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  segFill: { borderRadius: Radius.control },
  segLabel: { textAlign: 'center' },
});
