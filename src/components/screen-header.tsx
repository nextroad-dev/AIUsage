import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

/**
 * Page header for tab screens: title on the left with an optional accessory right after it (e.g.
 * a new-version notice), optional primary action on the right. Keeps every tab screen on the same
 * title size and spacing.
 */
export function ScreenHeader({
  title,
  subtitle,
  accessory,
  action,
}: {
  title: string;
  /** one secondary line under the title, e.g. when the data was last updated */
  subtitle?: string;
  accessory?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.text}>
        <View style={styles.lead}>
          <ThemedText type="subtitle" style={styles.title} numberOfLines={1}>
            {title}
          </ThemedText>
          {accessory}
        </View>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  text: { flexShrink: 1 },
  lead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexShrink: 1 },
  title: { flexShrink: 1 },
});
