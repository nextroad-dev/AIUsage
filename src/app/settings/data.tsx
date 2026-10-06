import { useRouter } from 'expo-router';
import { Alert } from 'react-native';

import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { useAccountActions } from '@/data/hooks';
import { useT } from '@/i18n';
import { Button } from '@/ui/controls';
import { haptics } from '@/ui/haptics';

export default function DataSettingsScreen() {
  const router = useRouter();
  const t = useT();
  const actions = useAccountActions();

  const confirmClear = () =>
    Alert.alert(
      t('Delete all data?'),
      t('This removes every account, credential and usage history from this device.'),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Delete everything'),
          style: 'destructive',
          onPress: async () => {
            haptics.warning();
            await actions.removeAll();
            router.back();
          },
        },
      ],
    );

  return (
    <Screen safeTop={false}>
      <Section
        footer={t(
          'Accounts, credentials and usage history live only on this device. Nothing is sent to any server of ours.',
        )}
      >
        <Button title={t('Delete all data')} kind="destructive" onPress={confirmClear} />
      </Section>
    </Screen>
  );
}
