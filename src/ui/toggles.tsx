import { StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { OptionTile } from '@/ui/controls';
import { haptics } from '@/ui/haptics';
import { useOptionGrid } from '@/ui/option-grid';

export function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.text}>
        <ThemedText type="small">{label}</ThemedText>
        {hint ? (
          <ThemedText type="small" themeColor="textSecondary">
            {hint}
          </ThemedText>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        trackColor={{ true: theme.primary }}
        onValueChange={(v) => {
          haptics.select();
          onChange(v);
        }}
      />
    </View>
  );
}

/** Several independent on/off chips (e.g. which thresholds to alert at). */
export function MultiChips<T extends number | string>({
  options,
  values,
  onChange,
  columns,
}: {
  options: { value: T; label: string }[];
  values: T[];
  onChange: (v: T[]) => void;
  columns?: number;
}) {
  const grid = useOptionGrid(
    options.map((o) => o.label),
    columns,
  );
  return (
    <View onLayout={grid.onLayout} style={[styles.chips, { gap: grid.gap }]}>
      {options.map((o) => {
        const on = values.includes(o.value);
        return (
          <OptionTile
            key={String(o.value)}
            role="checkbox"
            label={o.label}
            selected={on}
            onPress={() =>
              onChange(on ? values.filter((x) => x !== o.value) : [...values, o.value])
            }
            style={grid.itemStyle}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  text: { flex: 1, gap: Spacing.half },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
});
