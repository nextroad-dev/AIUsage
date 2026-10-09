import { Alert, Linking, Platform, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAlertSettings, useBackgroundState, useNotificationPermission } from '@/data/hooks';
import { expoNotifier } from '@/alerts/expo-notifier';
import { useT } from '@/i18n';
import { haptics } from '@/ui/haptics';
import { Button, Segmented } from '@/ui/controls';
import { exitFade } from '@/ui/motion';
import { MultiChips, ToggleRow } from '@/ui/toggles';

export default function AlertSettingsScreen() {
  const t = useT();
  const { settings, loaded, update } = useAlertSettings();
  const permission = useNotificationPermission();
  const background = useBackgroundState(settings.backgroundRefresh, loaded);
  const sendTest = () => {
    haptics.tap();
    expoNotifier
      .send({
        ruleId: 'test',
        cycleKey: 'test',
        kind: 'usage-over',
        accountId: '',
        title: t('Test notification'),
        body: t('Alerts from AI Usage look like this.'),
      })
      .catch(() =>
        Alert.alert(t('Could not send the notification'), t('Check the notification permission.')),
      );
  };

  // Until both the stored settings and the permission are known (a local read, near instant),
  // show nothing: rendering the defaults first would flash the permission banner and toggles.
  if (!loaded || permission.state === undefined) return <Screen safeTop={false}>{null}</Screen>;

  return (
    <Screen safeTop={false}>
      {permission.state !== 'granted' && (
        <Animated.View exiting={exitFade}>
          <Section bandStyle={{ gap: Spacing.two }}>
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
          </Section>
        </Animated.View>
      )}

      <Section title={t('Quota')} bandStyle={{ gap: Spacing.three }}>
        <ToggleRow
          label={t('Usage alerts')}
          value={settings.enabled}
          onChange={(v) => update({ enabled: v })}
        />
        {settings.enabled && (
          <Animated.View exiting={exitFade} style={{ gap: Spacing.three }}>
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
            <View style={{ gap: Spacing.three }}>
              <ToggleRow
                label={t('Tell me when a window resets')}
                value={settings.windowReset}
                onChange={(v) => update({ windowReset: v })}
              />
              <ToggleRow
                label={t('Tell me when Codex resets early')}
                value={settings.earlyReset}
                onChange={(v) => update({ earlyReset: v })}
              />
            </View>
          </Animated.View>
        )}
      </Section>

      {settings.enabled && (
        <Animated.View exiting={exitFade}>
          <Section title={t('Account')} bandStyle={{ gap: Spacing.three }}>
            <ToggleRow
              label={t('Remind me before a plan ends')}
              value={settings.renewal.enabled}
              onChange={(v) => update({ renewal: { ...settings.renewal, enabled: v } })}
            />
            {settings.renewal.enabled && (
              <Animated.View exiting={exitFade}>
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
            <Animated.View>
              <ToggleRow
                label={t('Tell me when a login expires')}
                value={settings.authExpired}
                onChange={(v) => update({ authExpired: v })}
              />
            </Animated.View>
          </Section>
        </Animated.View>
      )}

      <Animated.View>
        <Section title={t('Background')} bandStyle={{ gap: Spacing.three }}>
          <ToggleRow
            label={t('Background refresh')}
            value={settings.backgroundRefresh}
            onChange={(v) => update({ backgroundRefresh: v })}
          />
          {background.data === 'restricted' && (
            <Animated.View>
              <ThemedText type="small" themeColor="textSecondary">
                {t('Background refresh is restricted on this device.')}
              </ThemedText>
            </Animated.View>
          )}
        </Section>
      </Animated.View>

      {permission.state === 'granted' ? (
        <Animated.View>
          <Section>
            <Button kind="secondary" title={t('Send a test notification')} onPress={sendTest} />
          </Section>
        </Animated.View>
      ) : null}
    </Screen>
  );
}
