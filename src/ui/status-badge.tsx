import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { formatAgo } from '@/core/format';
import type { DisplayStatus } from '@/data/summary';
import { useTheme } from '@/hooks/use-theme';
import { useT, type Translator } from '@/i18n';
import { enterFade, exitFade } from '@/ui/motion';
import { Notice } from '@/ui/notice';

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
        ? t('Error, data from {ago}', { ago: formatAgo(s.lastSuccessAt, now.getTime(), t) })
        : t('Error');
  }
}

// Problems get the notice icon; the rest keep a plain monochrome glyph, so no emoji rendering
// drifts between platforms.
const glyph: Record<DisplayStatus['kind'], string> = {
  ok: '',
  manual: '▤',
  pending: '…',
  authExpired: '',
  unsupported: '',
  error: '',
  stale: '',
};

/** Status as plain text (no pill or border): a glyph and the label, red for problems. */
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
      style={styles.badge}
      accessible
      accessibilityLabel={label}
    >
      {bad ? (
        <Notice color={color}>{label}</Notice>
      ) : (
        <ThemedText type="small" style={{ color }}>
          {glyph[status.kind]} {label}
        </ThemedText>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start' },
});
