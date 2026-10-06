import type { ReactNode } from 'react';
import { RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareScrollView } from '@/components/keyboard';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { haptics } from '@/ui/haptics';

export function Screen({
  children,
  onRefresh,
  refreshing,
  safeTop = true,
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** false when a navigation header already covers the status bar */
  safeTop?: boolean;
}) {
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView
        style={styles.safe}
        edges={safeTop ? ['top', 'left', 'right'] : ['left', 'right']}
      >
        {/* a focused field always scrolls clear of the keyboard, with a little breathing room */}
        <KeyboardAwareScrollView
          bottomOffset={Spacing.four}
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={!!refreshing}
                onRefresh={() => {
                  haptics.refresh();
                  onRefresh();
                }}
              />
            ) : undefined
          }
        >
          {children}
        </KeyboardAwareScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    paddingBottom: Spacing.six,
  },
});
