import { Linking, Platform, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useAlertSettings, useBackgroundState, useNotificationPermission } from '@/data/hooks';
import { useT } from '@/i18n';
import { Button, Segmented } from '@/ui/controls';
import { enterFade, exitFade, layoutShift } from '@/ui/motion';
import { RowSkeleton } from '@/ui/skeleton';
import { MultiChips, ToggleRow } from '@/ui/toggles';

export default function AlertSettingsScreen() {
  const t = useT();
  const { settings, loaded, update } = useAlertSettings();
  const permission = useNotificationPermission();
  const background = useBackgroundState(settings.backgroundRefresh, loaded);

  // Until both the stored settings and the permission are known, show placeholders in the page's
  // shape: rendering the defaults first would flash the permission banner and toggle sections that
  // then jump away.
  if (!loaded || permission.state === undefined) {
    return (
      <Screen safeTop={false}>
        <Section title={t('Usage')}>
          <RowSkeleton rows={3} value />
        </Section>
        <Section title={t('Background')}>
          <RowSkeleton rows={1} value />
        </Section>
      </Screen>
    );
  }

  return (
    <Screen safeTop={false}>
      {permission.state !== 'granted' && (
        <Animated.View entering={enterFade} exiting={exitFade} layout={layoutShift}>
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

      <Section title={t('Usage')} bandStyle={{ gap: Spacing.three }}>
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
          </Animated.View>
        )}
      </Section>

      {settings.enabled && (
        <Animated.View entering={enterFade} exiting={exitFade} layout={layoutShift}>
          <Section title={t('Account')} bandStyle={{ gap: Spacing.three }}>
            <ToggleRow
              label={t('Remind me before a plan ends')}
              value={settings.renewal.enabled}
              onChange={(v) => update({ renewal: { ...settings.renewal, enabled: v } })}
            />
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
          </Section>
        </Animated.View>
      )}

      <Animated.View layout={layoutShift}>
        <Section title={t('Background')} bandStyle={{ gap: Spacing.three }}>
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
        </Section>
      </Animated.View>
    </Screen>
  );
}
