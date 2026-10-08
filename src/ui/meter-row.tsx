import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { level, usedFraction } from '@/core/meter-utils';
import type { Meter } from '@/core/types';
import { useT } from '@/i18n';
import type { AccountView } from '@/data/summary';
import { useTheme } from '@/hooks/use-theme';
import { forecastText, meterTitle, resetText, useLevelColor } from '@/ui/meter-text';
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
      <ThemedText type="smallBold">{meterTitle(meter, t)}</ThemedText>
      <WindowBar
        fraction={window.fraction}
        color={color}
        used={window.used}
        remaining={window.remaining}
        label={window.label}
      />
      {reset ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.number}>
          {reset}
        </ThemedText>
      ) : null}
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
  number: { fontVariant: ['tabular-nums'] },
});
