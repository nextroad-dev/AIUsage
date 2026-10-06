import { View } from 'react-native';

import { Screen } from '@/components/screen';
import { Section } from '@/components/section';
import { ThemedText } from '@/components/themed-text';
import { Accents, Spacing, type AccentName } from '@/constants/theme';
import { useT, type LocaleSetting, type ThemeSetting } from '@/i18n';
import { usePreferences } from '@/providers/preferences';
import { ColorSwatches, Segmented } from '@/ui/controls';
import { ACCENT_LABELS } from '@/ui/settings-labels';

export default function AppearanceSettingsScreen() {
  const t = useT();
  const {
    localeSetting,
    themeSetting,
    accentSetting,
    setLocaleSetting,
    setThemeSetting,
    setAccentSetting,
  } = usePreferences();

  return (
    <Screen safeTop={false}>
      <Section title={t('Language')}>
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
      </Section>

      <Section title={t('Appearance')} bandStyle={{ gap: Spacing.three }}>
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
        <View style={{ gap: Spacing.two }}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('Theme color')}
          </ThemedText>
          <ColorSwatches<AccentName>
            label={t('Theme color')}
            options={(Object.keys(Accents) as AccentName[]).map((name) => ({
              value: name,
              color: Accents[name],
              label: t(ACCENT_LABELS[name]),
            }))}
            value={accentSetting}
            onChange={setAccentSetting}
          />
        </View>
      </Section>
    </Screen>
  );
}
