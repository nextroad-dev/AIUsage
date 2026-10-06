import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import Animated from 'react-native-reanimated';

import { Screen } from '@/components/screen';
import { Row, Section } from '@/components/section';
import { ThemedText } from '@/components/themed-text';
import { useT } from '@/i18n';
import { isConnectableProvider, providers, type ProviderMeta } from '@/providers/registry';
import { groupProviders } from '@/providers/groups';
import { matchProviders } from '@/providers/search';
import { enterFade, enterItem } from '@/ui/motion';
import { ProviderIcon } from '@/ui/provider-icon';

export default function AddAccountScreen() {
  const router = useRouter();
  const t = useT();
  const [query, setQuery] = useState('');
  const shown = matchProviders(providers.filter(isConnectableProvider), query, (p) => t(p.name));
  const connectHint = (c: ProviderMeta['connect']) =>
    c === 'relay' ? t('Site address + API key') : c && c !== 'apiKey' ? t('Sign in') : t('API key');

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
      {/* grouped by kind; a search keeps only the groups with matches */}
      {groupProviders(shown).map((g, gi) => (
        <Section key={g.key} title={t(g.title)}>
          {g.providers.map((p, i) => (
            <Animated.View key={p.id} entering={enterItem(gi * 3 + i)}>
              <Row
                leading={<ProviderIcon providerId={p.id} label={p.name} />}
                title={t(p.name)}
                hint={connectHint(p.connect)}
                accessibilityHint={connectHint(p.connect)}
                onPress={() => router.push(`/add/${p.id}`)}
              />
            </Animated.View>
          ))}
        </Section>
      ))}
      {shown.length === 0 ? (
        <Animated.View entering={enterFade}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('No provider matches "{query}".', { query: query.trim() })}
          </ThemedText>
        </Animated.View>
      ) : null}
    </Screen>
  );
}
