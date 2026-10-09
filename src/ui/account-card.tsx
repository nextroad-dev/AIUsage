import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatPlan } from '@/core/format';
import { visibleMeters } from '@/core/meter-utils';
import { deriveStatus, type AccountView } from '@/data/summary';
import { useT } from '@/i18n';
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
  footer,
}: {
  view: AccountView;
  now: Date;
  onPress: () => void;
  /** extra line under the meters, e.g. the Codex reset odds */
  footer?: ReactNode;
}) {
  const t = useT();
  const status = deriveStatus(view);
  const meters = visibleMeters(view.snapshot?.meters ?? []);
  // a relay is known by its own site name, not the generic "API relay"
  const name =
    view.meta?.id === 'relay' ? view.account.label : (view.meta?.name ?? view.account.providerId);
  // separate texts, spaced by the header's gap rather than joined with a separator
  const subtitle = [
    view.account.label !== name ? view.account.label : undefined,
    // a reported plan is tidied up; a name the user typed is shown as typed
    view.snapshot?.plan ? formatPlan(view.snapshot.plan) : view.account.manual?.planName,
  ].filter((x): x is string => !!x);

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${view.account.label}`}
      onPress={onPress}
      scaleTo={0.985}
    >
      <View style={styles.content}>
        {/* One header line; it wraps instead of truncating when large fonts need the room. */}
        <View style={styles.header}>
          <ProviderIcon providerId={view.account.providerId} label={name} size={20} />
          <ThemedText type="default" numberOfLines={1} style={[styles.shrink, styles.name]}>
            {name}
          </ThemedText>
          {subtitle.map((part) => (
            <ThemedText
              key={part}
              type="small"
              themeColor="textSecondary"
              numberOfLines={1}
              style={styles.shrink}
            >
              {part}
            </ThemedText>
          ))}
          {/* a problem shows as plain text; the plan end lives on the details screen */}
          <View style={styles.trailing}>
            <StatusBadge status={status} now={now} />
          </View>
        </View>

        {meters.length > 0 ? (
          <View style={styles.meters}>
            {meters.map((m) => (
              <MeterRow
                key={keyOf(m.id, m.scope.type === 'model' ? m.scope.name : undefined)}
                meter={m}
                now={now}
                view={view}
                compact
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
        {footer}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.two },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: Spacing.two,
    rowGap: Spacing.one,
  },
  shrink: { flexShrink: 1 },
  name: { fontWeight: 700 },
  trailing: {
    marginLeft: 'auto',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.one,
  },
  meters: { gap: Spacing.one },
});
