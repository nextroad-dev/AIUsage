import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { Colors } from '@/constants/theme';
import { useEffectiveScheme } from '@/hooks/use-theme';
import { useT } from '@/i18n';

export default function AppTabs() {
  const scheme = useEffectiveScheme();
  const t = useT();
  const colors = Colors[scheme];

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t('Usage')}</NativeTabs.Trigger.Label>
        {/* system symbols: SF Symbols on iOS, Material icons on Android */}
        <NativeTabs.Trigger.Icon
          sf={{ default: 'chart.bar', selected: 'chart.bar.fill' }}
          md="bar_chart"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>{t('Settings')}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={{ default: 'gearshape', selected: 'gearshape.fill' }}
          md="settings"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
