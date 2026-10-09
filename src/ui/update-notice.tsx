import { Linking, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { LatestRelease } from '@/data/update-check';
import { useT } from '@/i18n';
import { haptics } from '@/ui/haptics';

/**
 * New-version notice as plain text under the page title (no pill): the version opens the release
 * page; "Don't show again" dismisses this version for good.
 */
export function UpdateNotice({
  release,
  onDismiss,
}: {
  release: LatestRelease;
  onDismiss: () => void;
}) {
  const t = useT();
  return (
    <View style={styles.row}>
      <ThemedText
        type="linkPrimary"
        accessibilityRole="link"
        accessibilityHint={t('Open in the browser')}
        style={styles.text}
        onPress={() => {
          haptics.tap();
          void Linking.openURL(release.url);
        }}
      >
        {t('New version {version} available', { version: release.version })}
      </ThemedText>
      <ThemedText
        type="small"
        themeColor="textSecondary"
        accessibilityRole="button"
        style={styles.text}
        onPress={() => {
          haptics.select();
          onDismiss();
        }}
      >
        {t('Dismiss this version')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.three },
  text: { lineHeight: 30 },
});
