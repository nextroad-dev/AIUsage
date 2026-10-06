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
  accessory,
  action,
}: {
  title: string;
  accessory?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.lead}>
        <ThemedText type="subtitle" style={styles.title} numberOfLines={1}>
          {title}
        </ThemedText>
        {accessory}
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
  lead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexShrink: 1 },
  title: { flexShrink: 1 },
});
