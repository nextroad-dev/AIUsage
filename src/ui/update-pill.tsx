import { SymbolView } from 'expo-symbols';
import { Linking, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import type { LatestRelease } from '@/data/update-check';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/i18n';
import { haptics } from '@/ui/haptics';
import { enterFade, exitFade, PressableScale } from '@/ui/motion';

/**
 * "New version" pill beside a page title: tapping it opens the release page, the ✕ dismisses this
 * version for good.
 */
export function UpdatePill({
  release,
  onDismiss,
}: {
  release: LatestRelease;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  return (
    <Animated.View
      entering={enterFade}
      exiting={exitFade}
      style={[styles.pill, { backgroundColor: theme.primary }]}
    >
      <PressableScale
        accessibilityRole="link"
        accessibilityLabel={t('New version {version} available', { version: release.version })}
        accessibilityHint={t('Open in the browser')}
        scaleTo={0.94}
        hitSlop={6}
        onPress={() => {
          haptics.tap();
          void Linking.openURL(release.url);
        }}
        style={styles.label}
      >
        <ThemedText type="smallBold" numberOfLines={1} style={{ color: theme.onPrimary }}>
          {t('New v{version}', { version: release.version })}
        </ThemedText>
      </PressableScale>
      <View style={[styles.divider, { backgroundColor: theme.onPrimary }]} />
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('Dismiss this version')}
        scaleTo={0.85}
        hitSlop={8}
        onPress={() => {
          haptics.select();
          onDismiss();
        }}
        style={styles.close}
      >
        <SymbolView
          name={{ ios: 'xmark', android: 'close', web: 'close' }}
          size={11}
          weight="bold"
          tintColor={theme.onPrimary}
        />
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.pill,
    paddingLeft: Spacing.two + 2,
    paddingRight: Spacing.one,
    minHeight: 26,
    flexShrink: 1,
  },
  label: { paddingVertical: 3, flexShrink: 1 },
  divider: { width: StyleSheet.hairlineWidth * 2, height: 12, opacity: 0.4, marginHorizontal: 6 },
  close: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
});
