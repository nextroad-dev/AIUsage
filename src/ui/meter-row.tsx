import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { level, usedFraction } from '@/core/meter-utils';
import type { Meter } from '@/core/types';
import { useT } from '@/i18n';
import type { AccountView } from '@/data/summary';
import { useTheme } from '@/hooks/use-theme';
import { forecastText, meterTitle, resetText } from '@/ui/account-card';
import { useLevelColor } from '@/ui/meter-donut';
import { windowFor, WindowBar } from '@/ui/window-bar';

export function MeterRow({ meter, now, view }: { meter: Meter; now: Date; view?: AccountView }) {
  const t = useT();
  const theme = useTheme();
  const forecast = view ? forecastText(view, meter, now, t) : undefined;
  const color = useLevelColor(level(usedFraction(meter)));
  const reset = resetText(meter, now, t);
  const window = windowFor(meter, t);
  return (
    <View style={styles.row}>
      <View style={styles.top}>
        <ThemedText type="smallBold" style={styles.grow}>
          {meterTitle(meter, t)}
        </ThemedText>
        {reset ? (
          <ThemedText type="small" themeColor="textSecondary">
            {reset}
          </ThemedText>
        ) : null}
      </View>
      <WindowBar
        fraction={window.fraction}
        color={color}
        used={window.used}
        remaining={window.remaining}
        label={window.label}
      />
      {forecast ? (
        <ThemedText type="small" style={{ color: theme.warn }}>
          {'▲ '}
          {forecast}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: Spacing.one, paddingVertical: Spacing.one },
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  grow: { flexShrink: 1 },
});
