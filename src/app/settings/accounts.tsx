import { useRouter } from 'expo-router';
import Animated from 'react-native-reanimated';

import { Screen } from '@/components/screen';
import { Row, Section } from '@/components/section';
import { ThemedText } from '@/components/themed-text';
import { useAccountViews } from '@/data/hooks';
import { useT } from '@/i18n';
import { Button } from '@/ui/controls';
import { enterItem, exitFade } from '@/ui/motion';
import { ProviderIcon } from '@/ui/provider-icon';
import { RowSkeleton } from '@/ui/skeleton';

export default function AccountsSettingsScreen() {
  const router = useRouter();
  const t = useT();
  const accounts = useAccountViews();
  const views = accounts.data ?? [];

  return (
    <Screen safeTop={false}>
      <Section>
        {accounts.isLoading && !accounts.data ? (
          <RowSkeleton rows={3} leading />
        ) : views.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('No accounts yet')}
          </ThemedText>
        ) : (
          views.map((v, i) => {
            const name =
              v.meta?.id === 'relay' ? v.account.label : (v.meta?.name ?? v.account.providerId);
            return (
              <Animated.View key={v.account.id} entering={enterItem(i)} exiting={exitFade}>
                <Row
                  leading={<ProviderIcon providerId={v.account.providerId} label={name} />}
                  title={name}
                  hint={v.account.label !== name ? v.account.label : undefined}
                  onPress={() => router.push(`/account/${v.account.id}`)}
                />
              </Animated.View>
            );
          })
        )}
        <Button title={t('Add account')} onPress={() => router.push('/add')} />
      </Section>
    </Screen>
  );
}
