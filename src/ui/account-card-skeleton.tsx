import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/i18n';
import { useBreathe } from '@/ui/skeleton';

/**
 * Placeholder that mirrors the AccountCard's single-column header and meter while the first
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
        <View style={[styles.line, styles.narrow, block]} />
      </View>
      <View style={styles.body}>
        <View style={[styles.line, styles.title, block]} />
        <View style={[styles.line, styles.narrow, block]} />
        <View style={[styles.track, block]} />
        <View style={[styles.line, styles.narrow, block]} />
        <View style={[styles.line, styles.wide, block]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.two },
  header: { gap: Spacing.two, alignItems: 'flex-start' },
  body: { gap: Spacing.one, paddingTop: Spacing.one },
  line: { height: 12, borderRadius: Radius.pill },
  title: { width: 132 },
  wide: { width: '72%' },
  narrow: { width: '44%' },
  icon: { width: 24, height: 24, borderRadius: Radius.control },
  track: { width: '100%', height: 8, borderRadius: Radius.pill },
});
