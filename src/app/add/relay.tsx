import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Band, Section } from '@/components/section';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatAmount } from '@/core/format';
import { keys, useServices } from '@/data/hooks';
import { newId } from '@/data/services';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/i18n';
import { relaySnapshot } from '@/providers/relay';
import {
  inspectProvider,
  normalizeBaseUrl,
  RELAY_TYPE_NAMES,
  type RelayInspection,
} from '@/providers/relay/inspect';
import { Button, Field } from '@/ui/controls';
import { unlimitedKeyHint } from '@/ui/relay-hints';
import { haptics } from '@/ui/haptics';
import { enterFade, enterItem, exitFade, layoutShift } from '@/ui/motion';

/**
 * Add an API relay from just its address and key: "Detect" recognises the software, the site name
 * and the balance; "Add" saves the account with the recognised adapter so refreshes skip detection.
 */
export default function AddRelayScreen() {
  const router = useRouter();
  const services = useServices().data;
  const qc = useQueryClient();
  const theme = useTheme();
  const t = useT();
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [name, setName] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<RelayInspection>();
  const [error, setError] = useState<string>();
  const run = useRef(0);

  const inputsChanged = () => {
    // a result belongs to the exact address and key it was made for
    run.current++;
    setResult(undefined);
    setError(undefined);
  };

  const detect = async () => {
    let url: string;
    try {
      url = normalizeBaseUrl(baseUrl);
    } catch {
      setError(t('Enter a valid address, e.g. https://api.example.com'));
      haptics.error();
      return;
    }
    const id = ++run.current;
    setInspecting(true);
    setError(undefined);
    setResult(undefined);
    try {
      const r = await inspectProvider({ baseUrl: url, apiKey, fetch: (...a) => fetch(...a) });
      if (id !== run.current) return;
      setResult(r);
      setName(r.provider.name);
      if (r.key.valid === false) haptics.error();
      else if (r.billing.supported) haptics.success();
    } catch {
      if (id !== run.current) return;
      setError(t('Could not reach this address.'));
      haptics.error();
    } finally {
      if (id === run.current) setInspecting(false);
    }
  };

  const canAdd = !!result && result.key.valid !== false && result.billing.supported && !!services;

  const add = async () => {
    if (!result || !services || saving) return;
    setSaving(true);
    setError(undefined);
    const id = newId();
    let added = false;
    try {
      await services.accounts.add(
        {
          id,
          providerId: 'relay',
          label: name.trim() || result.provider.name,
          authMethod: 'apiKey',
          createdAt: Date.now(),
        },
        {
          type: 'apiKey',
          key: apiKey.trim(),
          baseUrl: result.provider.baseUrl,
          adapter: result.adapter,
        },
      );
      added = true;
      await services.repos.snapshots.save(
        relaySnapshot(id, result.billing, result.adapter, new Date()),
      );
      await services.repos.health.recordSuccess(id, Date.now());
      await qc.invalidateQueries({ queryKey: keys.views });
      haptics.success();
      router.dismissAll();
    } catch {
      if (added) await services.accounts.remove(id).catch(() => undefined);
      setError(t('Could not save the account. Please try again.'));
      haptics.error();
    } finally {
      setSaving(false);
    }
  };

  const b = result?.billing;
  const unit = b?.currency ?? 'USD';
  const money = (n?: number) => (n === undefined ? '—' : formatAmount(n, unit));

  return (
    <Screen safeTop={false}>
      <Band>
        <ThemedText type="small" themeColor="textSecondary">
          {t(
            'Works with New API, Sub2API, One API and other OpenAI-compatible relays. Only the address and key are needed; the software, site name and balance are detected.',
          )}
        </ThemedText>
      </Band>

      <Field
        label={t('Site address')}
        value={baseUrl}
        onChangeText={(v) => {
          setBaseUrl(v);
          inputsChanged();
        }}
        placeholder="https://api.example.com"
        keyboardType="url"
        editable={!inspecting && !saving}
      />
      <Field
        label={t('API key')}
        value={apiKey}
        onChangeText={(v) => {
          setApiKey(v);
          inputsChanged();
        }}
        placeholder="sk-…"
        secureTextEntry
        textContentType="password"
        editable={!inspecting && !saving}
        hint={t('Stored in the device Keychain and sent only to this address.')}
      />
      <Button
        title={t('Detect')}
        kind={result ? 'secondary' : 'primary'}
        onPress={detect}
        loading={inspecting}
        disabled={!baseUrl.trim() || !apiKey.trim() || saving}
      />

      {result ? (
        <Animated.View entering={enterFade} exiting={exitFade} layout={layoutShift}>
          <Section title={t('Detected')}>
            <Animated.View entering={enterItem(0)} style={{ gap: Spacing.half }}>
              <ThemedText type="subtitle">{result.provider.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {[
                  result.provider.type === 'unknown'
                    ? t('Unrecognised software')
                    : RELAY_TYPE_NAMES[result.provider.type],
                  result.provider.version,
                  result.provider.baseUrl.replace(/^https?:\/\//, ''),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </ThemedText>
            </Animated.View>

            {b?.supported ? (
              <Animated.View
                entering={enterItem(1)}
                style={{ flexDirection: 'row', gap: Spacing.four }}
              >
                <View style={{ gap: Spacing.half }}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('Remaining')}
                  </ThemedText>
                  <ThemedText type="default">
                    {b.unlimited ? t('Unlimited') : money(b.remaining)}
                  </ThemedText>
                </View>
                <View style={{ gap: Spacing.half }}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('Used')}
                  </ThemedText>
                  <ThemedText type="default">{money(b.used)}</ThemedText>
                </View>
                {b.total !== undefined && !b.unlimited ? (
                  <View style={{ gap: Spacing.half }}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {t('Total')}
                    </ThemedText>
                    <ThemedText type="default">{money(b.total)}</ThemedText>
                  </View>
                ) : null}
              </Animated.View>
            ) : (
              <ThemedText type="small" style={{ color: theme.warn }}>
                {'▲ '}
                {t('This site does not expose a balance for this key, so it cannot be tracked.')}
              </ThemedText>
            )}

            {/* an unlimited key has no ceiling to measure against: say how to set one */}
            {b?.supported && b.unlimited ? (
              <Animated.View entering={enterItem(2)}>
                <ThemedText type="small" style={{ color: theme.warn }}>
                  {'▲ '}
                  {unlimitedKeyHint(result.provider.type, t)}
                </ThemedText>
              </Animated.View>
            ) : null}

            <Animated.View entering={enterItem(2)}>
              <ThemedText
                type="small"
                style={{
                  color:
                    result.key.valid === false
                      ? theme.bad
                      : result.key.valid
                        ? theme.good
                        : theme.textSecondary,
                }}
              >
                {result.key.valid === false
                  ? `⊘ ${t('The key was rejected.')}`
                  : result.key.valid
                    ? `● ${t('Key is valid')}`
                    : `○ ${t('Key could not be checked')}`}
                {result.capabilities.models ? ` · ${t('OpenAI compatible')}` : ''}
              </ThemedText>
            </Animated.View>
          </Section>

          {canAdd ? (
            <View style={{ gap: Spacing.three }}>
              <Field
                label={t('Name')}
                value={name}
                onChangeText={setName}
                autoCapitalize="sentences"
                editable={!saving}
              />
              <Button title={t('Add')} onPress={add} loading={saving} />
            </View>
          ) : null}
        </Animated.View>
      ) : null}

      {error ? (
        <Animated.View entering={enterFade} exiting={exitFade}>
          <ThemedText type="small" style={{ color: theme.bad }}>
            {error}
          </ThemedText>
        </Animated.View>
      ) : null}
    </Screen>
  );
}
