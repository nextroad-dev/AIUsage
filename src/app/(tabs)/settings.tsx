import Constants from 'expo-constants';
import { useRouter, type Href } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Linking, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Screen } from '@/components/screen';
import { Row, Section } from '@/components/section';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useAccountViews, useAlertSettings } from '@/data/hooks';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/i18n';
import { usePreferences } from '@/providers/preferences';
import { Button } from '@/ui/controls';
import { enterItem } from '@/ui/motion';
import { ACCENT_LABELS } from '@/ui/settings-labels';

const GITHUB_HANDLE = 'nextroad-dev';
const GITHUB_URL = 'https://github.com/nextroad-dev';
const SPONSOR_URL = 'https://afdian.com/a/nextroad';

/** Small filled square with a white symbol, the familiar settings-menu affordance. */
function MenuIcon({ name }: { name: SymbolViewProps['name'] }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 30,
        height: 30,
        borderRadius: Radius.control - 4,
        backgroundColor: theme.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <SymbolView name={name} size={17} tintColor="#FFFFFF" />
    </View>
  );
}

/**
 * Settings hub: each area opens its own page, and the row shows its current state so most visits
 * need no tap at all.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const t = useT();
  const theme = useTheme();
  const accounts = useAccountViews();
  const { settings } = useAlertSettings();
  const { localeSetting, themeSetting, accentSetting } = usePreferences();

  const language =
    localeSetting === 'system'
      ? t('Follow system')
      : localeSetting === 'zh'
        ? t('Chinese')
        : t('English');
  const appearance =
    themeSetting === 'system'
      ? t('Follow system')
      : themeSetting === 'light'
        ? t('Light')
        : t('Dark');

  const menu: { icon: SymbolViewProps['name']; title: string; value?: string; href: Href }[] = [
    {
      icon: { ios: 'paintbrush.fill', android: 'palette', web: 'palette' },
      title: t('Language & appearance'),
      value: `${language} · ${appearance} · ${t(ACCENT_LABELS[accentSetting])}`,
      href: '/settings/appearance',
    },
    {
      icon: { ios: 'person.2.fill', android: 'group', web: 'group' },
      title: t('Accounts'),
      value: accounts.data ? String(accounts.data.length) : undefined,
      href: '/settings/accounts',
    },
    {
      icon: { ios: 'bell.fill', android: 'notifications', web: 'notifications' },
      title: t('Alerts'),
      value: settings.enabled ? t('On') : t('Off'),
      href: '/settings/alerts',
    },
    {
      icon: { ios: 'externaldrive.fill', android: 'storage', web: 'storage' },
      title: t('Data'),
      href: '/settings/data',
    },
  ];

  return (
    <Screen>
      <ScreenHeader title={t('Settings')} />

      {/* sponsor card: the one rounded surface on the page, so it reads as an invitation, not a setting */}
      <Animated.View
        entering={enterItem(0)}
        style={{
          backgroundColor: theme.backgroundElement,
          borderColor: theme.border,
          borderWidth: 1,
          borderRadius: Radius.control + 4,
          padding: Spacing.three,
          gap: Spacing.two,
        }}
      >
        <ThemedText type="smallBold">{t('Support AI Usage')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t('AI Usage is free and has no ads. If it helps you, consider supporting development.')}
        </ThemedText>
        <Button title={t('Support on Afdian')} onPress={() => Linking.openURL(SPONSOR_URL)} />
      </Animated.View>

      <Section title={t('General')}>
        {menu.map((m, i) => (
          <Animated.View key={m.title} entering={enterItem(i + 1)}>
            <Row
              leading={<MenuIcon name={m.icon} />}
              title={m.title}
              value={m.value}
              onPress={() => router.push(m.href)}
            />
          </Animated.View>
        ))}
      </Section>

      <Section title={t('About')}>
        <Row title={t('Version {version}', { version: Constants.expoConfig?.version ?? '—' })} />
        <Row
          title="GitHub"
          value={GITHUB_HANDLE}
          accessibilityHint={t('Open in the browser')}
          onPress={() => Linking.openURL(`${GITHUB_URL}`)}
        />
      </Section>
    </Screen>
  );
}
