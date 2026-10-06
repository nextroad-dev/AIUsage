import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Band, Section } from '@/components/section';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { isLoopbackAvailable } from '@/authkit/loopback';
import { meterText } from '@/core/format';
import type { AuthMethod, Credential } from '@/core/types';
import { keys, useServices } from '@/data/hooks';
import { newId } from '@/data/services';
import { useT } from '@/i18n';
import { useTheme } from '@/hooks/use-theme';
import { isConnectableProvider, providerById, supportsCredential } from '@/providers/registry';
import { validateCredential, type ValidationResult } from '@/providers/service';
import { Button, Field, Segmented } from '@/ui/controls';
import { BrowserSignInPanel, type BrowserSignInProvider } from '@/ui/browser-sign-in';
import { DeviceSignInPanel } from '@/ui/device-sign-in';
import { haptics } from '@/ui/haptics';
import { enterFade, enterItem, exitFade, layoutShift } from '@/ui/motion';

type Mode = 'browser' | 'device' | 'key';

export default function AddProviderScreen() {
  const { providerId } = useLocalSearchParams<{ providerId: string }>();
  const router = useRouter();
  const services = useServices().data;
  const qc = useQueryClient();
  const theme = useTheme();
  const t = useT();
  const meta = providerById(String(providerId));
  const automatic = isConnectableProvider(meta);
  const browserProvider: BrowserSignInProvider | undefined =
    meta?.connect === 'codexBrowser'
      ? 'codex'
      : meta?.connect === 'openrouterPkce'
        ? 'openrouter'
        : undefined;
  // Browser sign-in needs the native loopback listener, which Expo Go and builds made before it was
  // added do not have. Codex then signs in with a device code instead; OpenRouter keeps its key.
  const [loopback] = useState(isLoopbackAvailable);
  const browserMissing = automatic && browserProvider !== undefined && !loopback;
  const browser = automatic && browserProvider !== undefined && loopback;
  const deviceFlow: 'codexDevice' | 'githubDevice' | undefined =
    meta?.connect === 'codexDevice' || (meta?.connect === 'codexBrowser' && !loopback)
      ? 'codexDevice'
      : meta?.connect === 'githubDevice'
        ? 'githubDevice'
        : undefined;
  const device = automatic && deviceFlow !== undefined;
  const keyEntry = automatic && !!meta?.auth.includes('apiKey');
  const modes: Mode[] = [
    ...(browser ? (['browser'] as const) : []),
    ...(device ? (['device'] as const) : []),
    ...(keyEntry ? (['key'] as const) : []),
  ];
  const [mode, setMode] = useState<Mode | undefined>(modes[0]);
  const [label, setLabel] = useState(meta?.name ?? '');
  const [region, setRegion] = useState(meta?.regions?.[0]?.key);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [saveError, setSaveError] = useState<string>();

  if (!meta)
    return (
      <Screen safeTop={false}>
        <ThemedText>{t('Unknown provider.')}</ThemedText>
      </Screen>
    );
  if (!automatic || modes.length === 0)
    return (
      <Screen safeTop={false}>
        <Stack.Screen options={{ title: meta.name }} />
        <ThemedText>
          {t('This provider has no supported OAuth or API-key usage connection.')}
        </ThemedText>
        {meta.note && (
          <ThemedText type="small" themeColor="textSecondary">
            {t(meta.note)}
          </ThemedText>
        )}
      </Screen>
    );

  const isToken = meta.id === 'copilot';
  const connect = async (cred: Credential, authMethod: AuthMethod) => {
    if (!services || saving.current || !supportsCredential(meta.id, authMethod, cred)) return;
    saving.current = true;
    setBusy(true);
    setResult(null);
    setSaveError(undefined);
    let added: string | undefined;
    try {
      const res = await validateCredential(meta.id, cred, {
        fetch: (...a) => fetch(...a),
        now: () => new Date(),
        region,
      });
      setResult(res);
      if (!res.ok) {
        haptics.error();
        return;
      }
      const id = newId();
      await services.accounts.add(
        {
          id,
          providerId: meta.id,
          label: label.trim() || meta.name,
          region,
          authMethod,
          createdAt: Date.now(),
        },
        cred,
      );
      added = id;
      await services.repos.snapshots.save({ ...res.snapshot, accountId: id });
      await services.repos.health.recordSuccess(id, Date.now());
      added = undefined;
      await qc.invalidateQueries({ queryKey: keys.views });
      haptics.success();
      router.dismissAll();
    } catch {
      // A half-saved account would linger and be duplicated by the retry the message asks for.
      if (added) await services.accounts.remove(added).catch(() => undefined);
      haptics.error();
      setSaveError(t('Could not save the account. Please try again.'));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const modeLabel: Record<Mode, string> = {
    browser: t('Sign in'),
    device: t('Sign in'),
    key: isToken ? t('Token') : t('API key'),
  };
  return (
    <Screen safeTop={false}>
      <Stack.Screen options={{ title: meta.name }} />
      {meta.note && (
        <Band>
          <ThemedText type="small" themeColor="textSecondary">
            {t(meta.note)}
          </ThemedText>
        </Band>
      )}
      {browserMissing && (
        <Band entering={enterFade}>
          <ThemedText type="small" themeColor="textSecondary">
            {deviceFlow
              ? t(
                  'Browser sign-in is not in this build, so a sign-in code is used instead. Install the current development build to sign in through the browser.',
                )
              : t(
                  'Browser sign-in is not in this build. Use an API key, or install the current development build to sign in through the browser.',
                )}
          </ThemedText>
        </Band>
      )}
      {modes.length > 1 && (
        <Segmented
          options={modes.map((m) => ({ value: m, label: modeLabel[m] }))}
          value={mode ?? modes[0]}
          onChange={(m) => {
            if (saving.current) return;
            setMode(m);
            setResult(null);
            setSaveError(undefined);
          }}
        />
      )}
      <Field
        label={t('Name')}
        value={label}
        onChangeText={setLabel}
        autoCapitalize="sentences"
        editable={!busy}
      />
      {/* switching sign-in mode cross-fades the panel instead of snapping */}
      <Animated.View key={mode} entering={enterFade} layout={layoutShift}>
        {mode === 'browser' && browserProvider && (
          <BrowserSignInPanel
            provider={browserProvider}
            onCredential={(cred) => connect(cred, 'oauthPkce')}
            busy={busy}
          />
        )}
        {mode === 'device' && deviceFlow && (
          <DeviceSignInPanel
            flow={deviceFlow}
            onCredential={(cred) => connect(cred, 'deviceCode')}
            busy={busy}
          />
        )}
        {mode === 'key' && keyEntry && (
          <View style={{ gap: Spacing.three }}>
            {meta.regions && (
              <View style={{ gap: Spacing.two }}>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('Region')}
                </ThemedText>
                <Segmented
                  options={meta.regions.map((r) => ({ value: r.key, label: t(r.label) }))}
                  label={t('Region')}
                  value={region ?? meta.regions[0].key}
                  onChange={(r) => {
                    if (!busy) setRegion(r);
                  }}
                />
              </View>
            )}
            <Field
              label={isToken ? t('GitHub token') : t('API key')}
              value={apiKey}
              onChangeText={setApiKey}
              secureTextEntry
              textContentType="password"
              editable={!busy}
              placeholder={isToken ? 'github_pat_…' : 'sk-…'}
              hint={t('Stored in the device Keychain. Prefer a read-only key.')}
            />
            <Button
              title={t('Check and add')}
              onPress={() => connect({ type: 'apiKey', key: apiKey.trim() }, 'apiKey')}
              loading={busy}
              disabled={!apiKey.trim() || !services}
            />
          </View>
        )}
      </Animated.View>
      {result && !result.ok && (
        <Band entering={enterFade} exiting={exitFade} layout={layoutShift}>
          <ThemedText type="smallBold" style={{ color: theme.bad }}>
            {t('Could not add this account')}
          </ThemedText>
          <ThemedText type="small">{t(result.message)}</ThemedText>
        </Band>
      )}
      {result?.ok && (
        <Section title={t('Found')}>
          {result.snapshot.meters.map((m, i) => (
            <Animated.View
              key={`${m.id}${m.scope.type === 'model' ? m.scope.name : ''}`}
              entering={enterItem(i)}
            >
              <ThemedText type="small">
                {t(m.label)}: {meterText(m, t).primary} {meterText(m, t).secondary}
              </ThemedText>
            </Animated.View>
          ))}
        </Section>
      )}
      {saveError && (
        <Animated.View entering={enterFade} exiting={exitFade}>
          <ThemedText type="small" style={{ color: theme.bad }}>
            {saveError}
          </ThemedText>
        </Animated.View>
      )}
    </Screen>
  );
}
