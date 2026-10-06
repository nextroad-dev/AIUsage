import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useState } from 'react';

import { AppLifecycle } from '@/components/app-lifecycle';
import { KeyboardProvider } from '@/components/keyboard';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useT } from '@/i18n';
import { PreferencesProvider } from '@/providers/preferences';
// Registers the background task at module scope (required for headless launches).
import '@/refresh/background';

function ThemedRoot() {
  const scheme = useColorScheme();
  // Bound translator: stack titles and tab labels re-render when the language changes.
  const t = useT();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AppLifecycle />
      {/*
       * `headerBackButtonDisplayMode: minimal` keeps the pushed screens' back button to just the
       * chevron: the previous route is the tab group, whose name would otherwise leak as "(tabs)".
       */}
      <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: t('Usage') }} />
        <Stack.Screen name="account/[id]" options={{ title: t('Details') }} />
        <Stack.Screen name="add/index" options={{ title: t('Add account') }} />
        <Stack.Screen name="add/[providerId]" options={{ title: t('Add account') }} />
        <Stack.Screen name="add/relay" options={{ title: t('API relay') }} />
        <Stack.Screen name="settings/appearance" options={{ title: t('Language & appearance') }} />
        <Stack.Screen name="settings/accounts" options={{ title: t('Accounts') }} />
        <Stack.Screen name="settings/alerts" options={{ title: t('Alerts') }} />
        <Stack.Screen name="settings/data" options={{ title: t('Data') }} />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <PreferencesProvider>
        <KeyboardProvider>
          <ThemedRoot />
        </KeyboardProvider>
      </PreferencesProvider>
    </QueryClientProvider>
  );
}
