import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { elapsedFraction, level, usedFraction } from '@/core/meter-utils';
import type { Meter } from '@/core/types';
import { useT } from '@/i18n';
import type { AccountView } from '@/data/summary';
import { useTheme } from '@/hooks/use-theme';
import {
  forecastText,
  meterTitle,
  resetShort,
  resetText,
  useLevelColor,
} from '@/ui/meter-text';
import { windowFor, WindowBar } from '@/ui/window-bar';

/** Above this font scale a one-line row stops fitting; the compact row stacks instead. */
const STACK_AT_FONT_SCALE = 1.3;

export function MeterRow({
  meter,
  now,
  view,
  compact = false,
}: {
  meter: Meter;
  now: Date;
  view?: AccountView;
  /** overview card: one line per meter (name, bar, used %, countdown) */
  compact?: boolean;
}) {
  const t = useT();
  const theme = useTheme();
  const forecast = view ? forecastText(view, meter, now, t) : undefined;
  const color = useLevelColor(level(usedFraction(meter)));
  const reset = resetText(meter, now, t);
  const window = windowFor(meter, t);
  if (compact) return <CompactMeterRow meter={meter} now={now} forecast={forecast} color={color} />;
  return (
    <View style={styles.row}>
      <ThemedText type="smallBold">{meterTitle(meter, t)}</ThemedText>
      <WindowBar
        fraction={window.fraction}
        color={color}
        used={window.used}
        remaining={window.remaining}
        label={window.label}
        pace={elapsedFraction(meter, now)}
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

/**
 * Used share only: remaining is its complement and the details screen shows both. The thin
 * tick on the bar is where an even pace would be by now.
 */
function CompactMeterRow({
  meter,
  now,
  forecast,
  color,
}: {
  meter: Meter;
  now: Date;
  forecast?: string;
  color: string;
}) {
  const t = useT();
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= STACK_AT_FONT_SCALE;
  const title = meterTitle(meter, t);
  const fraction = usedFraction(meter);
  const window = windowFor(meter, t);
  const value =
    fraction === undefined ? window.used : `${Math.round(Math.max(0, fraction) * 100)}%`;
  const reset = resetText(meter, now, t);
  const short = resetShort(meter, now, t);
  const valueColor = fraction !== undefined && fraction >= 0.6 ? color : theme.text;
  const label = [
    title,
    fraction === undefined ? `${window.label ?? t('used')} ${window.used}` : `${t('used')} ${value}`,
    reset,
    forecast,
  ]
    .filter(Boolean)
    .join(', ');

  const bar =
    fraction === undefined ? null : (
      <WindowBar fraction={fraction} color={color} used="" pace={elapsedFraction(meter, now)} bare />
    );

  return (
    <View accessible accessibilityLabel={label} style={styles.compact}>
      {stacked ? (
        <View style={styles.stack}>
          <View style={styles.line}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
              {title}
            </ThemedText>
            <ThemedText type="smallBold" style={[styles.number, { color: valueColor }]}>
              {value}
            </ThemedText>
          </View>
          {bar}
          {reset ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.number}>
              {reset}
            </ThemedText>
          ) : null}
        </View>
      ) : (
        <View style={styles.line}>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            numberOfLines={1}
            // without a bar (balances) the name may take the free width
            style={bar ? styles.title : styles.flex}
          >
            {title}
          </ThemedText>
          {bar ? <View style={styles.flex}>{bar}</View> : null}
          <ThemedText
            type="smallBold"
            numberOfLines={1}
            style={[styles.number, styles.value, { color: valueColor }]}
          >
            {value}
          </ThemedText>
          <ThemedText
            type="small"
            themeColor="textSecondary"
            numberOfLines={1}
            style={[styles.number, styles.reset]}
          >
            {short ?? ''}
          </ThemedText>
        </View>
      )}
      {forecast ? (
        <ThemedText type="small" style={[styles.number, { color: theme.warn }]}>
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
  compact: { gap: Spacing.half },
  stack: { gap: Spacing.one },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 24 },
  flex: { flex: 1 },
  title: { width: 76 },
  value: { minWidth: 40, textAlign: 'right' },
  reset: { minWidth: 52, textAlign: 'right' },
});
