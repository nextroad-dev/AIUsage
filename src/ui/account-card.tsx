import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { daysUntil, formatCountdown, formatDate, meterText } from '@/core/format';
import { countdown, usedFraction } from '@/core/meter-utils';
import type { Meter } from '@/core/types';
import { deriveStatus, type AccountView } from '@/data/summary';
import { useTheme } from '@/hooks/use-theme';
import { useT, type Translator } from '@/i18n';
import { MeterDonut } from '@/ui/meter-donut';
import { PressableScale } from '@/ui/motion';
import { ProviderIcon } from '@/ui/provider-icon';
import { StatusBadge } from '@/ui/status-badge';

export function meterTitle(m: Meter, t: Translator): string {
  return m.scope.type === 'model' ? `${t(m.label)} · ${m.scope.name}` : t(m.label);
}

export function resetText(m: Meter, now: Date, t: Translator): string | undefined {
  const c = countdown(m.resetsAt, now);
  if (!c) return undefined;
  return c.elapsed ? t('Reset due') : t('Resets in {time}', { time: formatCountdown(c.label, t) });
}

/**
 * One usage window as a donut: the arc shows the used share with the percentage in the hole, and
 * the window name, the amounts and the reset countdown sit under it so colour is never the only cue.
 */
function MeterDonutCell({
  view,
  meter,
  now,
  width,
}: {
  view: AccountView;
  meter: Meter;
  now: Date;
  width: `${number}%`;
}) {
  const t = useT();
  const theme = useTheme();
  const forecast = forecastText(view, meter, now, t);
  const title = meterTitle(meter, t);
  const text = meterText(meter, t);
  const reset = resetText(meter, now, t);
  const fraction = usedFraction(meter);
  const percent = meter.kind.type === 'percent';
  return (
    <View style={[styles.cell, { width }]}>
      <MeterDonut
        fraction={fraction}
        centerText={fraction === undefined ? undefined : `${Math.round(fraction * 100)}%`}
        accessibilityLabel={`${title} ${text.primary}`}
      />
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} style={styles.center}>
        {title}
      </ThemedText>
      {/* percent windows already read in the hole; amounts and balances need their figures */}
      {percent ? null : (
        <ThemedText type="smallBold" numberOfLines={2} style={styles.center}>
          {text.primary} {text.secondary}
        </ThemedText>
      )}
      {reset ? (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} style={styles.center}>
          {reset}
        </ThemedText>
      ) : null}
      {forecast ? (
        <ThemedText type="small" numberOfLines={2} style={[styles.center, { color: theme.warn }]}>
          {'▲ '}
          {forecast}
        </ThemedText>
      ) : null}
    </View>
  );
}

const keyOf = (m: Meter) => `${m.id}${m.scope.type === 'model' ? `:${m.scope.name}` : ''}`;

/** "Runs out in 1h 20m at this pace" when the current pace empties the window before it resets. */
export function forecastText(
  view: AccountView,
  m: Meter,
  now: Date,
  t: Translator,
): string | undefined {
  const at = view.forecasts?.[keyOf(m)];
  if (at === undefined) return undefined;
  const c = countdown(new Date(at).toISOString(), now);
  if (!c || c.elapsed) return undefined;
  return t('Runs out in {time} at this pace', { time: formatCountdown(c.label, t) });
}

/** Plan end / renewal line, flagged when it is a week away or less. */
export function renewalInfo(
  view: AccountView,
  now: Date,
  t: Translator,
): { text: string; soon: boolean } | undefined {
  const at = view.snapshot?.renewsAt ? Date.parse(view.snapshot.renewsAt) : NaN;
  if (!Number.isFinite(at) || at < now.getTime()) return undefined;
  const days = daysUntil(at, now.getTime());
  const left = days <= 1 ? t('within a day') : t('{n} days left', { n: days });
  return { text: t('Plan until {date} · {left}', { date: formatDate(at), left }), soon: days <= 7 };
}

export function AccountCard({
  view,
  now,
  onPress,
}: {
  view: AccountView;
  now: Date;
  onPress: () => void;
}) {
  const t = useT();
  const theme = useTheme();
  const status = deriveStatus(view);
  const renewal = renewalInfo(view, now, t);
  const meters = view.snapshot?.meters ?? [];
  const name = view.meta?.name ?? view.account.providerId;
  // up to three donuts per row; two windows (5-hour + weekly) split the card in half
  const columns = Math.min(3, Math.max(1, meters.length));
  const cellWidth = `${100 / columns}%` as const;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${view.account.label}`}
      onPress={onPress}
      scaleTo={0.985}
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <ProviderIcon providerId={view.account.providerId} label={name} size={24} />
          <View style={styles.titles}>
            <ThemedText type="smallBold">{name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {[
                view.account.label !== name ? view.account.label : undefined,
                view.snapshot?.plan ?? view.account.manual?.planName,
              ]
                .filter(Boolean)
                .join(' · ')}
            </ThemedText>
            {renewal ? (
              <ThemedText
                type="small"
                style={{ color: renewal.soon ? theme.warn : theme.textSecondary }}
              >
                {renewal.soon ? '▲ ' : ''}
                {renewal.text}
              </ThemedText>
            ) : null}
          </View>
          <StatusBadge status={status} now={now} />
        </View>

        {meters.length > 0 ? (
          <View style={styles.donuts}>
            {meters.map((m) => (
              <MeterDonutCell
                view={view}
                key={`${m.id}:${m.scope.type === 'model' ? m.scope.name : ''}`}
                meter={m}
                now={now}
                width={cellWidth}
              />
            ))}
          </View>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {status.kind === 'authExpired'
              ? t('Open this account to sign in again.')
              : status.kind === 'pending'
                ? t('Tap refresh to load usage.')
                : status.message
                  ? t(status.message)
                  : t('No usage data.')}
          </ThemedText>
        )}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.three },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  titles: { gap: Spacing.half, flexShrink: 1, flexGrow: 1 },
  donuts: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Spacing.three },
  cell: { alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.one },
  center: { textAlign: 'center' },
});
