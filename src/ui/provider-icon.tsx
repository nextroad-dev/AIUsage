import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { providerIcons } from '@/ui/provider-icons';

/**
 * Monochrome provider mark. Rendered from path data rather than an XML string so the geometry is
 * always drawn, and filled with the theme text colour so the same mark stays legible in light and
 * dark mode. Providers without a bundled mark fall back to a letter tile.
 *
 * Decorative: the provider name next to it already carries the meaning.
 */
export function ProviderIcon({
  providerId,
  label,
  size = 24,
}: {
  providerId: string;
  /** used for the monogram when no mark is bundled */
  label?: string;
  size?: number;
}) {
  const theme = useTheme();
  const mark = providerIcons[providerId];

  if (!mark) {
    return (
      <View
        accessible={false}
        style={[
          styles.monogram,
          { width: size, height: size, backgroundColor: theme.backgroundSelected },
        ]}
      >
        <ThemedText type="small" themeColor="textSecondary" style={{ fontSize: size * 0.46 }}>
          {(label ?? providerId).trim().charAt(0).toUpperCase()}
        </ThemedText>
      </View>
    );
  }

  return (
    <Svg width={size} height={size} viewBox={mark.viewBox} accessible={false}>
      {mark.paths.map((path, index) => (
        <Path
          key={index}
          d={path.d}
          fill={theme.text}
          fillRule={path.evenOdd ? 'evenodd' : 'nonzero'}
        />
      ))}
    </Svg>
  );
}

const styles = StyleSheet.create({
  monogram: { borderRadius: Radius.control, alignItems: 'center', justifyContent: 'center' },
});
