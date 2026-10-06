import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import type { RefreshSummary } from '@/data/refresh-summary';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/i18n';
import { exitFade, layoutShift, Motion, PressableScale } from '@/ui/motion';

const SHOW_OK_MS = 2500;
const SHOW_FAILED_MS = 7000;

/**
 * Result of a manual refresh, shown under the page header: a short confirmation when everything
 * updated, or the accounts that failed with their reasons. It hides by itself (later when
 * something failed) and on tap.
 */
export function RefreshNotice({
  summary,
  onClose,
}: {
  summary: RefreshSummary;
  onClose: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const failed = summary.kind !== 'ok';

  useEffect(() => {
    const timer = setTimeout(onClose, failed ? SHOW_FAILED_MS : SHOW_OK_MS);
    return () => clearTimeout(timer);
  }, [summary, failed, onClose]);

  const color = failed ? theme.warn : theme.good;
  return (
    <Animated.View
      entering={FadeInDown.duration(Motion.base).easing(Motion.easing)}
      exiting={exitFade}
      layout={layoutShift}
    >
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('Dismiss')}
        accessibilityLiveRegion="polite"
        scaleTo={0.98}
        onPress={onClose}
        style={{
          backgroundColor: theme.backgroundElement,
          borderColor: color,
          borderWidth: 1,
          borderRadius: Radius.control,
          paddingHorizontal: Spacing.three,
          paddingVertical: Spacing.two,
          gap: Spacing.one,
        }}
      >
        {summary.kind === 'ok' ? (
          <ThemedText type="small" style={{ color }}>
            {'✓ '}
            {summary.updated === 1
              ? t('Updated 1 account')
              : t('Updated {n} accounts', { n: summary.updated })}
          </ThemedText>
        ) : summary.kind === 'timeout' ? (
          <ThemedText type="small" style={{ color }}>
            {'▲ '}
            {t('Refresh took too long. Some accounts may update a little later.')}
          </ThemedText>
        ) : (
          <>
            <ThemedText type="smallBold" style={{ color }}>
              {'▲ '}
              {summary.failed.length === 1
                ? t('1 account could not be refreshed')
                : t('{n} accounts could not be refreshed', { n: summary.failed.length })}
            </ThemedText>
            {summary.failed.map((f) => (
              <View key={f.name} style={{ flexDirection: 'row', gap: Spacing.one }}>
                <ThemedText type="small" style={{ flexShrink: 0 }}>
                  {f.name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={{ flexShrink: 1 }}>
                  {t(f.message)}
                </ThemedText>
              </View>
            ))}
          </>
        )}
      </PressableScale>
    </Animated.View>
  );
}
