import { Alert, Linking, StyleSheet, View } from 'react-native';

import { Section } from '@/components/section';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { chanceBand, chanceBandText, errorText, localEventTime } from '@/data/codex-reset/format';
import { useCodexResetForecast } from '@/data/codex-reset/hooks';
import { useCodexResetPreference } from '@/data/codex-reset/preferences';
import { isDataStale, SOURCE } from '@/data/codex-reset/service';
import { useTheme } from '@/hooks/use-theme';
import { useLocale, useT } from '@/i18n';
import { Button } from '@/ui/controls';

const open = (url: string) => void Linking.openURL(url).catch(() => {});

/**
 * Auxiliary public information below the personal meters; it never changes their status.
 * Only the source's global reset odds are shown: the next 24 and 48 hours.
 */
export function CodexResetSection({ now }: { now: Date }) {
  const t = useT();
  const preference = useCodexResetPreference();
  const save = (enabled: boolean) => {
    void preference
      .setEnabled(enabled)
      .catch(() =>
        Alert.alert(
          t('Could not save the public data setting'),
          t('Try changing the switch again.'),
        ),
      );
  };
  const change = (enabled: boolean) => {
    if (!enabled) {
      save(false);
      return;
    }
    Alert.alert(
      t('Enable Codex Reset?'),
      t(
        'Reset odds are fetched directly from codex-reset.com, an independent service, not OpenAI. Your API keys, ChatGPT access tokens, account IDs and personal usage are never sent to this site. Predictions do not guarantee your personal quota will recover. Allow public requests while this switch is on, including background refresh when available?',
      ),
      [
        { text: t('Cancel'), style: 'cancel' },
        { text: t('Agree and enable'), onPress: () => save(true) },
      ],
    );
  };
  if (!preference.loaded) return null;
  if (!preference.enabled) {
    return (
      <Section title={t('Reset chance')}>
        <ThemedText type="small" themeColor="textSecondary">
          {t(
            "See how likely OpenAI is to reset everyone's Codex limits early. Data comes from codex-reset.com, an independent site; you confirm before anything is requested.",
          )}
        </ThemedText>
        <Button
          kind="secondary"
          title={t('Turn on')}
          disabled={preference.pending}
          onPress={() => change(true)}
        />
      </Section>
    );
  }
  return <ResetChance now={now} turningOff={preference.pending} onTurnOff={() => change(false)} />;
}

function ResetChance({
  now,
  turningOff,
  onTurnOff,
}: {
  now: Date;
  turningOff: boolean;
  onTurnOff: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const query = useCodexResetForecast();
  const entry = query.data;
  const forecast = entry?.data;
  const stale = !!entry && isDataStale(entry, forecast?.updated_at, now.getTime());

  return (
    <Section
      title={t('Reset chance')}
      footer={t(
        'Independent prediction, not an OpenAI quota API. A global reset does not guarantee your personal quota will recover.',
      )}
    >
      {forecast ? (
        <View style={styles.pair}>
          <Chance label={t('Next 24 hours')} percent={forecast.probabilities.rounded_24h} />
          <Chance label={t('Next 48 hours')} percent={forecast.probabilities.rounded_48h} />
        </View>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {query.isLoading ? t('Loading…') : t('No public data available.')}
        </ThemedText>
      )}

      <View style={styles.notes}>
        {entry?.error ? (
          <ThemedText type="small" themeColor="textSecondary">
            {errorText(entry.error, t)}
          </ThemedText>
        ) : null}
        {stale && forecast ? (
          <ThemedText type="small" themeColor="warn">
            {t('Outdated data — showing the last available copy.')}
          </ThemedText>
        ) : null}
        <View style={styles.source}>
          {forecast ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.shrink}>
              {t('Source updated {time}', {
                time: localEventTime(forecast.updated_at, locale, now),
              })}
            </ThemedText>
          ) : null}
          <ThemedText type="linkPrimary" accessibilityRole="link" onPress={() => open(SOURCE)}>
            Data: codex-reset.com
          </ThemedText>
        </View>
        <Button
          kind="secondary"
          title={t('Turn off reset chance')}
          disabled={turningOff}
          onPress={onTurnOff}
        />
      </View>
    </Section>
  );
}

/** One window: the source's rounded percentage, large, with its band in words. */
function Chance({ label, percent }: { label: string; percent: number | null | undefined }) {
  const t = useT();
  const theme = useTheme();
  const value = percent == null ? t('Unknown') : `${percent}%`;
  const band = chanceBandText(chanceBand(percent), t);
  return (
    <View style={styles.chance} accessible accessibilityLabel={`${label}: ${value}, ${band}`}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="subtitle" style={[styles.number, { color: theme.primary }]}>
        {value}
      </ThemedText>
      {percent == null ? null : (
        <ThemedText type="smallBold" style={{ color: theme.primary }}>
          {band}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  number: { fontVariant: ['tabular-nums'] },
  shrink: { flexShrink: 1 },
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.four },
  chance: { flexGrow: 1, flexBasis: 120, gap: Spacing.half },
  notes: { gap: Spacing.one },
  source: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
});
