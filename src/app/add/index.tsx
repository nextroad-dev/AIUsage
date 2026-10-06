import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import Animated from 'react-native-reanimated';

import { Screen } from '@/components/screen';
import { Band, Row } from '@/components/section';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useT } from '@/i18n';
import { isConnectableProvider, providers } from '@/providers/registry';
import { matchProviders } from '@/providers/search';
import { enterFade, enterItem } from '@/ui/motion';
import { ProviderIcon } from '@/ui/provider-icon';

export default function AddAccountScreen() {
  const router = useRouter();
  const t = useT();
  const [query, setQuery] = useState('');
  const shown = matchProviders(providers.filter(isConnectableProvider), query);

  return (
    <Screen safeTop={false}>
      <Stack.Screen
        options={{
          headerSearchBarOptions: {
            placeholder: t('Search providers'),
            hideWhenScrolling: false,
            autoCapitalize: 'none',
            onChangeText: (e) => setQuery(e.nativeEvent.text),
            onCancelButtonPress: () => setQuery(''),
          },
        }}
      />
      {/* flush the first row against the header: cancel the screen gutter and the band's own top pad */}
      <Band style={{ marginTop: -Spacing.three, paddingTop: Spacing.two }}>
        {shown.map((p, i) => (
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
        {shown.length === 0 ? (
          <Animated.View entering={enterFade}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('No provider matches "{query}".', { query: query.trim() })}
            </ThemedText>
          </Animated.View>
        ) : null}
      </Band>
    </Screen>
  );
}
