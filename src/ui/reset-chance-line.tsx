import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { chanceBand, chanceBandText } from '@/data/codex-reset/format';
import { useCodexResetForecast } from '@/data/codex-reset/hooks';
import { useCodexResetPreference } from '@/data/codex-reset/preferences';
import { isDataStale } from '@/data/codex-reset/service';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/i18n';
import { CompactRow } from '@/ui/meter-row';
import { Notice } from '@/ui/notice';

/**
 * The Codex global reset odds on the usage page, as two rows in the same grid as the quota rows:
 * "24H reset chance  ██░░░  22%  Low". Accent-coloured bars, so they never read as quota used.
 * Only after opt-in and once odds are cached; never changes an account's status.
 */
export function ResetChanceLine({ now, heading }: { now: Date; heading?: string }) {
  const preference = useCodexResetPreference();
  if (!preference.enabled) return null;
  return <Odds now={now} heading={heading} />;
}

/** `heading` is shown above the rows, and only when there are odds to show. */
function Odds({ now, heading }: { now: Date; heading?: string }) {
  const t = useT();
  const theme = useTheme();
  const entry = useCodexResetForecast().data;
  const forecast = entry?.data;
  if (!entry || !forecast) return null;
  const stale = isDataStale(entry, forecast.updated_at, now.getTime());
  const rows = [
    [t('24H reset chance'), forecast.probabilities.rounded_24h],
    [t('48H reset chance'), forecast.probabilities.rounded_48h],
  ] as const;
  return (
    <View style={{ gap: Spacing.one }}>
      {heading ? (
        <ThemedText type="small" themeColor="textSecondary">
          {heading}
        </ThemedText>
      ) : null}
      {rows.map(([title, percent]) => {
        const value = percent == null ? '—' : `${percent}%`;
        const band = percent == null ? undefined : chanceBandText(chanceBand(percent), t);
        return (
          <CompactRow
            key={title}
            title={title}
            fraction={percent == null ? undefined : percent / 100}
            color={theme.primary}
            value={value}
            valueColor={theme.primary}
            trailing={band}
            accessibilityLabel={[title, value, band].filter(Boolean).join(', ')}
          />
        );
      })}
      {stale ? <Notice color={theme.warn}>{t('Outdated data')}</Notice> : null}
    </View>
  );
}
