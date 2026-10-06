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
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/i18n';
import { usePreferences } from '@/providers/preferences';
import { Button } from '@/ui/controls';
import { haptics } from '@/ui/haptics';
import { enterFade, enterItem, exitFade, layoutShift, PressableScale } from '@/ui/motion';

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

/** Settings hub: each area opens its own page; the hub itself stays a short, quiet list. */
export default function SettingsScreen() {
  const router = useRouter();
  const t = useT();
  const theme = useTheme();
  const { sponsorDismissed, setSponsorDismissed } = usePreferences();

  const menu: { icon: SymbolViewProps['name']; title: string; href: Href }[] = [
    {
      icon: { ios: 'paintbrush.fill', android: 'palette', web: 'palette' },
      title: t('Language & appearance'),
      href: '/settings/appearance',
    },
    {
      icon: { ios: 'person.2.fill', android: 'group', web: 'group' },
      title: t('Accounts'),
      href: '/settings/accounts',
    },
    {
      icon: { ios: 'bell.fill', android: 'notifications', web: 'notifications' },
      title: t('Alerts'),
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

      {/* sponsor card: the one rounded surface on the page, so it reads as an invitation, not a
          setting. It can be closed for good; About then keeps a quiet link instead. */}
      {sponsorDismissed ? null : (
        <Animated.View
          entering={enterItem(0)}
          exiting={exitFade}
          layout={layoutShift}
          style={{
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            borderWidth: 1,
            borderRadius: Radius.control + 4,
            padding: Spacing.three,
            gap: Spacing.two,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
            <ThemedText type="smallBold" style={{ flex: 1 }}>
              {t('Support AI Usage')}
            </ThemedText>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t('Close')}
              hitSlop={10}
              scaleTo={0.85}
              onPress={() => {
                haptics.tap();
                setSponsorDismissed(true);
              }}
              style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
            >
              <SymbolView
                name={{ ios: 'xmark', android: 'close', web: 'close' }}
                size={14}
                weight="semibold"
                tintColor={theme.textSecondary}
              />
            </PressableScale>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {t(
              'AI Usage is free and has no ads. If it helps you, consider supporting development.',
            )}
          </ThemedText>
          <Button title={t('Support on Afdian')} onPress={() => Linking.openURL(SPONSOR_URL)} />
        </Animated.View>
      )}

      <Animated.View layout={layoutShift}>
        <Section title={t('General')}>
          {menu.map((m, i) => (
            <Animated.View key={m.title} entering={enterItem(i + 1)}>
              <Row
                leading={<MenuIcon name={m.icon} />}
                title={m.title}
                onPress={() => router.push(m.href)}
              />
            </Animated.View>
          ))}
        </Section>
      </Animated.View>

      <Animated.View layout={layoutShift}>
        <Section title={t('About')}>
          <Row title={t('Version {version}', { version: Constants.expoConfig?.version ?? '—' })} />
          <Row
            title="GitHub"
            value={GITHUB_HANDLE}
            accessibilityHint={t('Open in the browser')}
            onPress={() => Linking.openURL(`${GITHUB_URL}`)}
          />
          {sponsorDismissed ? (
            <Animated.View entering={enterFade}>
              <Row
                title={t('Tip the author')}
                value={t('Afdian')}
                accessibilityHint={t('Open in the browser')}
                onPress={() => Linking.openURL(SPONSOR_URL)}
              />
            </Animated.View>
          ) : null}
        </Section>
      </Animated.View>
    </Screen>
  );
}
