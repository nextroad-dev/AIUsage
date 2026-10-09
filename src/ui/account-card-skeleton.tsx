import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/i18n';
import { useBreathe } from '@/ui/skeleton';

/**
 * Placeholder that mirrors the AccountCard's one-line header and meter rows while the first
 * snapshot loads, with the shared breathing pulse (`useBreathe`). It reports no progress value,
 * since none is known yet.
 */
export function AccountCardSkeleton() {
  const theme = useTheme();
  const t = useT();
  const block = { backgroundColor: theme.backgroundSelected };
  const breathe = useBreathe();

  return (
    <Animated.View style={[styles.root, breathe]} accessible accessibilityLabel={t('Loading…')}>
      <View style={styles.header}>
        <View style={[styles.icon, block]} />
        <View style={[styles.line, styles.title, block]} />
        <View style={[styles.line, styles.plan, block]} />
      </View>
      {[0, 1].map((i) => (
        <View key={i} style={styles.meter}>
          <View style={[styles.line, styles.label, block]} />
          <View style={[styles.track, block]} />
          <View style={[styles.line, styles.value, block]} />
        </View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.two },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  meter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 24 },
  line: { height: 12, borderRadius: Radius.pill },
  title: { width: 96 },
  plan: { width: 48 },
  label: { width: 76 },
  value: { width: 96 },
  icon: { width: 20, height: 20, borderRadius: Radius.control },
  track: { flex: 1, height: 6, borderRadius: Radius.pill },
});
