import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { formatAgo } from '@/core/format';
import { Radius, Spacing } from '@/constants/theme';
import type { DisplayStatus } from '@/data/summary';
import { useTheme } from '@/hooks/use-theme';
import { useT, type Translator } from '@/i18n';
import { enterFade, exitFade } from '@/ui/motion';

/** Text for a status, so tests and screens agree on wording. */
export function statusLabel(s: DisplayStatus, now: Date, t: Translator): string | undefined {
  switch (s.kind) {
    case 'ok':
    // a failed refresh that kept the last data shows that data without a staleness warning
    case 'stale':
      return undefined;
    case 'manual':
      return t('Historical account (read-only)');
    case 'pending':
      return t('Not loaded yet');
    case 'authExpired':
      return t('Login expired');
    case 'unsupported':
      return t('Unsupported');
    case 'error':
      return s.lastSuccessAt
        ? t('Error · data from {ago}', { ago: formatAgo(s.lastSuccessAt, now.getTime(), t) })
        : t('Error');
  }
}

// One glyph family for every status: same monochrome geometric set as the meter level symbols
// (● ▲ ■ ○), so no emoji rendering drifts between platforms.
const glyph: Record<DisplayStatus['kind'], string> = {
  ok: '',
  manual: '▤',
  pending: '…',
  authExpired: '⊘',
  unsupported: '▲',
  error: '▲',
  stale: '',
};

export function StatusBadge({ status, now }: { status: DisplayStatus; now: Date }) {
  const theme = useTheme();
  const t = useT();
  const label = statusLabel(status, now, t);
  if (!label) return null;
  const bad =
    status.kind === 'authExpired' || status.kind === 'error' || status.kind === 'unsupported';
  const color = bad ? theme.bad : theme.textSecondary;
  return (
    <Animated.View
      key={status.kind}
      entering={enterFade}
      exiting={exitFade}
      style={[styles.badge, { borderColor: color }]}
      accessible
      accessibilityLabel={label}
    >
      <ThemedText type="small" style={{ color }}>
        {glyph[status.kind]} {label}
      </ThemedText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
  },
});
