import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { chanceBand } from '@/data/codex-reset/format';
import { useCodexResetForecast } from '@/data/codex-reset/hooks';
import { useCodexResetPreference } from '@/data/codex-reset/preferences';
import { isDataStale } from '@/data/codex-reset/service';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/i18n';

/**
 * Overview hint that a global reset looks possible. Only after opt-in, only with fresh data and
 * only when worth a glance (a "possible" band or better, or an official signal). It never changes
 * the account's own status or alerts.
 */
export function CodexResetChip({ now }: { now: Date }) {
  const preference = useCodexResetPreference();
  if (!preference.enabled) return null;
  return <ForecastChip now={now} />;
}

function ForecastChip({ now }: { now: Date }) {
  const t = useT();
  const theme = useTheme();
  const query = useCodexResetForecast();
  const entry = query.data;
  const forecast = entry?.data;
  if (!entry || !forecast || isDataStale(entry, forecast.updated_at, now.getTime())) return null;
  const percent = forecast.probabilities.rounded_24h;
  const band = chanceBand(percent);
  const signal = !!forecast.official_signal;
  if (!signal && (band === undefined || band === 'low')) return null;
  const text = signal
    ? t('Global reset signal')
    : t('Global reset {percent}%', { percent: percent ?? 0 });
  return (
    <View
      style={[styles.chip, { borderColor: theme.primary }]}
      accessible
      accessibilityLabel={
        signal
          ? t('Global reset signal reported, not confirmed')
          : t('Global reset chance in 24 hours: {percent}%', { percent: percent ?? 0 })
      }
    >
      <ThemedText type="small" style={{ color: theme.primary }}>
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
  },
});
