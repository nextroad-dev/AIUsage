import { useRouter } from 'expo-router';
import Animated from 'react-native-reanimated';

import { Screen } from '@/components/screen';
import { Spacing } from '@/constants/theme';
import { Band, Row } from '@/components/section';
import { useT } from '@/i18n';
import { isConnectableProvider, providers } from '@/providers/registry';
import { enterItem } from '@/ui/motion';
import { ProviderIcon } from '@/ui/provider-icon';

export default function AddAccountScreen() {
  const router = useRouter();
  const t = useT();

  return (
    <Screen safeTop={false}>
      {/* flush the first row against the header: cancel the screen gutter and the band's own top pad */}
      <Band style={{ marginTop: -Spacing.three, paddingTop: Spacing.two }}>
        {providers.filter(isConnectableProvider).map((p, i) => (
          <Animated.View key={p.id} entering={enterItem(i)}>
            <Row
              leading={<ProviderIcon providerId={p.id} label={p.name} />}
              title={p.name}
              hint={p.connect && p.connect !== 'apiKey' ? t('Sign in') : t('API key')}
              accessibilityHint={p.connect && p.connect !== 'apiKey' ? t('Sign in') : t('API key')}
              onPress={() => router.push(`/add/${p.id}`)}
            />
          </Animated.View>
        ))}
      </Band>
    </Screen>
  );
}
