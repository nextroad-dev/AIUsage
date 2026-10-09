import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { StyleSheet } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/ui/haptics';
import { PressableScale } from '@/ui/motion';

/** Icon-only action for page headers, same size and feel as the refresh button. */
export function HeaderButton({
  icon,
  label,
  onPress,
}: {
  icon: SymbolViewProps['name'];
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      scaleTo={0.9}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={styles.button}
    >
      <SymbolView name={icon} size={22} weight="semibold" tintColor={theme.text} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
