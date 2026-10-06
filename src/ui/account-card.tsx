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
import { StatusBadge, statusLabel } from '@/ui/status-badge';

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
        {/* one line: logo, name, and the plan on the right, all centred on the same axis */}
        <View style={styles.header}>
          <ProviderIcon providerId={view.account.providerId} label={name} size={24} />
          <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
            {name}
          </ThemedText>
          {subtitle ? (
            <ThemedText
              type="small"
              themeColor="textSecondary"
              numberOfLines={1}
              style={styles.subtitle}
            >
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
        {/* status and plan end sit under the name, indented past the logo */}
        {renewal || statusLabel(status, now, t) ? (
          <View style={styles.meta}>
            <StatusBadge status={status} now={now} />
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
        ) : null}

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
  name: { flexShrink: 1, flexGrow: 1 },
  // the plan yields space to the name first, but never collapses to nothing
  subtitle: { flexShrink: 2, textAlign: 'right', minWidth: 48 },
  // 24pt logo + 8pt gap: aligned with the name above
  meta: {
    marginTop: -Spacing.two,
    paddingLeft: 24 + Spacing.two,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
  },
  meters: { gap: Spacing.two },
});
