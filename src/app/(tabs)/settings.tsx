import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Alert, Linking, Platform, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Screen } from '@/components/screen';
import { Section, Row } from '@/components/section';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  useAccountActions,
  useAccountViews,
  useAlertSettings,
  useBackgroundState,
  useNotificationPermission,
} from '@/data/hooks';
import { useT, type LocaleSetting, type ThemeSetting } from '@/i18n';
import { usePreferences } from '@/providers/preferences';
import { Button, Segmented } from '@/ui/controls';
import { haptics } from '@/ui/haptics';
import { enterFade, enterItem, exitFade, layoutShift } from '@/ui/motion';
import { ProviderIcon } from '@/ui/provider-icon';
import { MultiChips, ToggleRow } from '@/ui/toggles';

const GITHUB_HANDLE = 'nextroad-dev';
const GITHUB_URL = 'https://github.com/nextroad-dev';
const SPONSOR_URL = 'https://afdian.com/a/nextroad';

export default function SettingsScreen() {
  const router = useRouter();
  const t = useT();
  const accounts = useAccountViews();
  const views = accounts.data ?? [];
  const actions = useAccountActions();
  const { settings, update } = useAlertSettings();
  const permission = useNotificationPermission();
  const background = useBackgroundState(settings.backgroundRefresh);
  const { localeSetting, themeSetting, setLocaleSetting, setThemeSetting } = usePreferences();

  const confirmClear = () =>
    Alert.alert(
      t('Delete all data?'),
      t('This removes every account, credential and usage history from this device.'),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Delete everything'),
          style: 'destructive',
          onPress: () => {
            haptics.warning();
            actions.removeAll();
          },
        },
      ],
    );

  return (
    <Screen>
      <ScreenHeader title={t('Settings')} />

      <Section title={t('Language & appearance')} bandStyle={{ gap: Spacing.three }}>
        <View style={{ gap: Spacing.two }}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('Language')}
          </ThemedText>
          <Segmented<LocaleSetting>
            options={[
              { value: 'system', label: t('Follow system') },
              { value: 'zh', label: t('Chinese') },
              { value: 'en', label: t('English') },
            ]}
            label={t('Language')}
            value={localeSetting}
            onChange={(v) => setLocaleSetting(v)}
          />
        </View>
        <View style={{ gap: Spacing.two }}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('Appearance')}
          </ThemedText>
          <Segmented<ThemeSetting>
            options={[
              { value: 'system', label: t('Follow system') },
              { value: 'light', label: t('Light') },
              { value: 'dark', label: t('Dark') },
            ]}
            label={t('Appearance')}
            value={themeSetting}
            onChange={(v) => setThemeSetting(v)}
          />
        </View>
      </Section>

      <Section title={t('Accounts')}>
        {accounts.isLoading && !accounts.data ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('Loading…')}
          </ThemedText>
        ) : views.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('No accounts yet')}
          </ThemedText>
        ) : (
          views.map((v, i) => (
            <Animated.View key={v.account.id} entering={enterItem(i)} exiting={exitFade}>
              <Row
                leading={
                  <ProviderIcon
                    providerId={v.account.providerId}
                    label={v.meta?.name ?? v.account.providerId}
                  />
                }
                title={v.meta?.name ?? v.account.providerId}
                hint={v.account.label !== v.meta?.name ? v.account.label : undefined}
                onPress={() => router.push(`/account/${v.account.id}`)}
              />
            </Animated.View>
          ))
        )}
        <Button title={t('Add account')} onPress={() => router.push('/add')} />
      </Section>

      <Section title={t('Alerts')} bandStyle={{ gap: Spacing.three }}>
        <ToggleRow
          label={t('Usage alerts')}
          value={settings.enabled}
          onChange={(v) => update({ enabled: v })}
        />
        {settings.enabled && (
          <Animated.View
            entering={enterFade}
            exiting={exitFade}
            layout={layoutShift}
            style={{ gap: Spacing.three }}
          >
            <View style={{ gap: Spacing.two }}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('Notify when usage reaches')}
              </ThemedText>
              <MultiChips
                options={[0.7, 0.8, 0.9, 0.95].map((v) => ({
                  value: v,
                  label: `${Math.round(v * 100)}%`,
                }))}
                values={settings.thresholds}
                onChange={(thresholds) =>
                  update({ thresholds: [...thresholds].sort((a, b) => a - b) })
                }
              />
            </View>
            <ToggleRow
              label={t('Remind me before a reset')}
              value={settings.resetSoon.enabled}
              onChange={(v) => update({ resetSoon: { ...settings.resetSoon, enabled: v } })}
            />
            {settings.resetSoon.enabled && (
              <Animated.View entering={enterFade} exiting={exitFade} layout={layoutShift}>
                <Segmented
                  options={[3, 6, 12, 24].map((h) => ({ value: h, label: t('{n}h', { n: h }) }))}
                  value={settings.resetSoon.hours}
                  onChange={(hours) => update({ resetSoon: { ...settings.resetSoon, hours } })}
                />
              </Animated.View>
            )}
            <Animated.View layout={layoutShift}>
              <ToggleRow
                label={t('Tell me when a window resets')}
                hint={t('Only for windows that were nearly used up.')}
                value={settings.windowReset}
                onChange={(v) => update({ windowReset: v })}
              />
            </Animated.View>
            <Animated.View layout={layoutShift}>
              <ToggleRow
                label={t('Remind me before a plan ends')}
                value={settings.renewal.enabled}
                onChange={(v) => update({ renewal: { ...settings.renewal, enabled: v } })}
              />
            </Animated.View>
            {settings.renewal.enabled && (
              <Animated.View entering={enterFade} exiting={exitFade} layout={layoutShift}>
                <Segmented
                  label={t('Remind me before a plan ends')}
                  options={[1, 3, 7].map((d) => ({
                    value: d,
                    label: t('{n} days before', { n: d }),
                  }))}
                  value={settings.renewal.days}
                  onChange={(days) => update({ renewal: { ...settings.renewal, days } })}
                />
              </Animated.View>
            )}
            <Animated.View layout={layoutShift}>
              <ToggleRow
                label={t('Tell me when a login expires')}
                value={settings.authExpired}
                onChange={(v) => update({ authExpired: v })}
              />
            </Animated.View>
          </Animated.View>
        )}
        {permission.state !== 'granted' && (
          <Animated.View
            entering={enterFade}
            exiting={exitFade}
            layout={layoutShift}
            style={{ gap: Spacing.two }}
          >
            <ThemedText type="small" themeColor="textSecondary">
              {permission.state === 'denied'
                ? Platform.OS === 'ios'
                  ? t('Notifications are off. Turn them on in iOS Settings.')
                  : t('Notifications are off. Turn them on in system settings.')
                : t('Allow notifications to get alerts.')}
            </ThemedText>
            <Button
              title={
                permission.state === 'denied'
                  ? Platform.OS === 'ios'
                    ? t('Open iOS Settings')
                    : t('Open system settings')
                  : t('Allow notifications')
              }
              onPress={() =>
                permission.state === 'denied' ? Linking.openSettings() : permission.request()
              }
            />
          </Animated.View>
        )}
        <Animated.View layout={layoutShift} style={{ gap: Spacing.three }}>
          <ToggleRow
            label={t('Background refresh')}
            value={settings.backgroundRefresh}
            onChange={(v) => update({ backgroundRefresh: v })}
          />
          {background.data === 'restricted' && (
            <Animated.View entering={enterFade}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('Background refresh is restricted on this device.')}
              </ThemedText>
            </Animated.View>
          )}
        </Animated.View>
      </Section>

      <Section title={t('Data')}>
        <Button title={t('Delete all data')} kind="destructive" onPress={confirmClear} />
      </Section>

      <Section title={t('About')}>
        <Row title={t('Version {version}', { version: Constants.expoConfig?.version ?? '—' })} />
        <Row
          title="GitHub"
          value={GITHUB_HANDLE}
          accessibilityHint={t('Open in the browser')}
          onPress={() => Linking.openURL(`${GITHUB_URL}`)}
        />
        <Row
          title={t('Sponsor')}
          value={t('Afdian')}
          accessibilityHint={t('Open in the browser')}
          onPress={() => Linking.openURL(SPONSOR_URL)}
        />
      </Section>
    </Screen>
  );
}
