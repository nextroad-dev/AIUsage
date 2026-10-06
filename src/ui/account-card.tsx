import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { visibleMeters } from '@/core/meter-utils';
import { deriveStatus, type AccountView } from '@/data/summary';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/i18n';
import { renewalInfo } from '@/ui/meter-text';
import { MeterRow } from '@/ui/meter-row';
import { PressableScale } from '@/ui/motion';
import { ProviderIcon } from '@/ui/provider-icon';
import { StatusBadge } from '@/ui/status-badge';

export { forecastText, meterTitle, renewalInfo, resetText } from '@/ui/meter-text';

const keyOf = (id: string, model?: string) => `${id}:${model ?? ''}`;

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
  const meters = visibleMeters(view.snapshot?.meters ?? []);
  // a relay is known by its own site name, not the generic "API relay"
  const name =
    view.meta?.id === 'relay' ? view.account.label : (view.meta?.name ?? view.account.providerId);
  const subtitle = [
    view.account.label !== name ? view.account.label : undefined,
    view.snapshot?.plan ?? view.account.manual?.planName,
  ]
    .filter(Boolean)
    .join(' · ');

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
          {/* empty lines are left out so a lone title centres on the icon */}
          <View style={styles.titles}>
            <ThemedText type="smallBold">{name}</ThemedText>
            {subtitle ? (
              <ThemedText type="small" themeColor="textSecondary">
                {subtitle}
              </ThemedText>
            ) : null}
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
          <View style={styles.meters}>
            {meters.map((m) => (
              <MeterRow
                key={keyOf(m.id, m.scope.type === 'model' ? m.scope.name : undefined)}
                meter={m}
                now={now}
                view={view}
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
  titles: { gap: Spacing.half, flexShrink: 1, flexGrow: 1, justifyContent: 'center' },
  meters: { gap: Spacing.two },
});
