import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Band, Section } from '@/components/section';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatAgo, formatPlan } from '@/core/format';
import { usedFraction, visibleMeters } from '@/core/meter-utils';
import type { Meter } from '@/core/types';
import { choiceFor, type OverrideChoice } from '@/alerts/evaluate';
import {
  useAccountActions,
  useAccountView,
  useAlertOverrides,
  useNow,
  useRefreshAccount,
} from '@/data/hooks';
import { deriveStatus } from '@/data/summary';
import { useT } from '@/i18n';
import type { Price } from '@/data/prices';
import { useTheme } from '@/hooks/use-theme';
import { meterTitle, renewalInfo } from '@/ui/account-card';
import { Button, Field, Segmented } from '@/ui/controls';
import { haptics } from '@/ui/haptics';
import { MeterRow } from '@/ui/meter-row';
import { unlimitedKeyHint } from '@/ui/relay-hints';
import { RefreshButton } from '@/ui/refresh-button';
import { RefreshNotice } from '@/ui/refresh-notice';
import { summarizeOutcomes, type RefreshSummary } from '@/data/refresh-summary';
import { enterFade, enterItem, exitFade, layoutShift } from '@/ui/motion';
import { ProviderIcon } from '@/ui/provider-icon';
import { StatusBadge } from '@/ui/status-badge';
import { CodexResetSection } from '@/ui/codex-reset-section';
import { useRefreshCodexReset } from '@/data/codex-reset/hooks';

const keyOf = (m: Meter) => `${m.id}:${m.scope.type === 'model' ? m.scope.name : ''}`;

function AlertChoices({ accountId, meters }: { accountId: string; meters: Meter[] }) {
  const { rules, set } = useAlertOverrides(accountId);
  const t = useT();
  const withRatio = meters.filter((m) => usedFraction(m) !== undefined);
  if (withRatio.length === 0) return null;
  const options: { value: OverrideChoice; label: string }[] = [
    { value: 'default', label: t('Default') },
    { value: 'off', label: t('Off') },
    ...[0.7, 0.8, 0.9, 0.95].map((v) => ({
      value: v as OverrideChoice,
      label: `${Math.round(v * 100)}%`,
    })),
  ];
  return (
    <Section title={t('Alerts')}>
      {withRatio.map((m) => (
        <View key={keyOf(m)} style={{ gap: Spacing.two }}>
          <ThemedText type="smallBold">{meterTitle(m, t)}</ThemedText>
          <Segmented
            options={options}
            label={meterTitle(m, t)}
            value={choiceFor(rules, accountId, m)}
            onChange={(choice) => set({ meter: m, choice })}
          />
        </View>
      ))}
    </Section>
  );
}

/** Monthly price the user pays, which feeds the overview total; providers do not report it. */
function SubscriptionSection({
  price,
  renewal,
  onSave,
}: {
  price?: Price;
  renewal?: { text: string; soon: boolean };
  onSave: (price: Price | null) => void;
}) {
  const t = useT();
  const theme = useTheme();
  const [amount, setAmount] = useState(price ? String(price.amount) : '');
  const [currency, setCurrency] = useState<Price['currency']>(price?.currency ?? 'USD');
  const commit = (c: Price['currency'] = currency) => {
    const n = Number(amount.replace(',', '.'));
    onSave(Number.isFinite(n) && n > 0 ? { amount: n, currency: c } : null);
  };
  return (
    <Section title={t('Subscription')}>
      {renewal ? (
        <ThemedText type="small" style={{ color: renewal.soon ? theme.warn : theme.text }}>
          {renewal.soon ? '▲ ' : ''}
          {renewal.text}
        </ThemedText>
      ) : null}
      <Field
        label={t('Monthly price')}
        value={amount}
        onChangeText={setAmount}
        onBlur={() => commit()}
        onSubmitEditing={() => commit()}
        keyboardType="decimal-pad"
        returnKeyType="done"
        placeholder={t('Optional')}
        hint={t('Used for the monthly total on the overview.')}
      />
      {/* the currency belongs to the price: offered once there is a price to save it with */}
      {amount.trim() ? (
        <Animated.View entering={enterFade} exiting={exitFade} style={{ gap: Spacing.two }}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('Price currency')}
          </ThemedText>
          <Segmented<Price['currency']>
            label={t('Price currency')}
            options={[
              { value: 'USD', label: 'USD $' },
              { value: 'CNY', label: 'CNY ¥' },
            ]}
            value={currency}
            onChange={(c) => {
              setCurrency(c);
              commit(c);
            }}
          />
        </Animated.View>
      ) : null}
    </Section>
  );
}

export default function AccountDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const accountId = String(id);
  const router = useRouter();
  const t = useT();
  const now = useNow();
  const view = useAccountView(accountId);
  const refresh = useRefreshAccount(accountId);
  const refreshPublic = useRefreshCodexReset();
  const [notice, setNotice] = useState<RefreshSummary>();
  const closeNotice = useCallback(() => setNotice(undefined), []);
  const actions = useAccountActions();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');

  const v = view.data;
  if (!v) {
    return (
      <Screen safeTop={false}>
        <ThemedText type="small" themeColor="textSecondary">
          {view.isLoading ? t('Loading…') : t('This account no longer exists.')}
        </ThemedText>
      </Screen>
    );
  }

  const status = deriveStatus(v);
  const meters = visibleMeters(v.snapshot?.meters ?? []);
  const providerName =
    v.meta?.id === 'relay' ? v.account.label : (v.meta?.name ?? v.account.providerId);

  const confirmRemove = () =>
    Alert.alert(t('Remove this account?'), t('Its credentials and usage history are deleted.'), [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Remove'),
        style: 'destructive',
        onPress: async () => {
          haptics.warning();
          await actions.remove(accountId);
          router.back();
        },
      },
    ]);

  const save = async () => {
    if (name.trim()) {
      await actions.rename(accountId, name.trim());
      haptics.success();
    }
    setRenaming(false);
  };

  // a manual refresh reports its outcome; the pull-to-refresh spinner already shows progress
  const refreshNow = () => {
    setNotice(undefined);
    if (v.account.providerId === 'codex') refreshPublic();
    refresh.mutate(undefined, {
      onSuccess: (outcome) => {
        const s = summarizeOutcomes({ [accountId]: outcome }, [v]);
        if (s.kind === 'ok' && s.updated === 0) return;
        if (s.kind === 'ok') haptics.success();
        else haptics.warning();
        setNotice(s);
      },
    });
  };

  return (
    <Screen
      safeTop={false}
      onRefresh={v.source === 'auto' ? refreshNow : undefined}
      refreshing={refresh.isPending}
    >
      <Stack.Screen
        options={{
          title: t('Details'),
          headerRight:
            v.source === 'auto'
              ? () => <RefreshButton refreshing={refresh.isPending} onPress={refreshNow} />
              : undefined,
        }}
      />

      {notice ? <RefreshNotice summary={notice} onClose={closeNotice} /> : null}

      <Band entering={enterFade} layout={layoutShift}>
        <View style={{ alignItems: 'flex-start', gap: Spacing.two }}>
          <ProviderIcon providerId={v.account.providerId} label={providerName} size={32} />
          <View style={{ flexShrink: 1 }}>
            <ThemedText type="subtitle">{providerName}</ThemedText>
            {[
              v.account.label !== providerName ? v.account.label : undefined,
              v.snapshot?.plan ? formatPlan(v.snapshot.plan) : v.account.manual?.planName,
            ].filter(Boolean).length > 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {[
                  v.account.label !== providerName ? v.account.label : undefined,
                  v.snapshot?.plan ? formatPlan(v.snapshot.plan) : v.account.manual?.planName,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </ThemedText>
            ) : null}
          </View>
        </View>
        <StatusBadge status={status} now={now} />
        {v.source === 'auto' ? (
          status.lastSuccessAt ? (
            <ThemedText type="small" themeColor="textSecondary">
              {t('Updated {ago}', { ago: formatAgo(status.lastSuccessAt, now.getTime(), t) })}
            </ThemedText>
          ) : null
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {t('Historical account (read-only)')}
          </ThemedText>
        )}
        {status.kind === 'authExpired' ? (
          <ThemedText type="small">
            {t('The credential was rejected. Remove and add the account again.')}
          </ThemedText>
        ) : status.message && status.kind !== 'stale' ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t(status.message)}
          </ThemedText>
        ) : null}
      </Band>

      {meters.length > 0 && (
        <Section
          title={t('Meters')}
          footer={
            // a relay key without a ceiling only reports spending: explain how to get the rest
            v.account.providerId === 'relay' &&
            meters.some((m) => m.kind.type === 'amount' && m.kind.limit === undefined)
              ? unlimitedKeyHint(v.snapshot?.plan === 'New API' ? 'new-api' : 'unknown', t)
              : undefined
          }
        >
          {meters.map((m, i) => (
            <Animated.View key={keyOf(m)} entering={enterItem(i)}>
              <MeterRow meter={m} now={now} view={v} />
            </Animated.View>
          ))}
        </Section>
      )}

      {v.account.providerId === 'codex' ? <CodexResetSection now={now} /> : null}

      <SubscriptionSection
        key={`${accountId}:${v.price?.amount ?? ''}:${v.price?.currency ?? ''}`}
        price={v.price}
        renewal={renewalInfo(v, now, t)}
        onSave={(p) => {
          if (p?.amount === v.price?.amount && p?.currency === v.price?.currency) return;
          void actions.setPrice(accountId, p);
        }}
      />

      {v.source === 'auto' && <AlertChoices accountId={accountId} meters={meters} />}

      {renaming ? (
        <Band key="rename" entering={enterFade} exiting={exitFade} layout={layoutShift}>
          <Field
            label={t('Name')}
            value={name}
            onChangeText={setName}
            autoCapitalize="sentences"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={save}
          />
          <Button title={t('Save')} onPress={save} />
          <Button title={t('Cancel')} kind="secondary" onPress={() => setRenaming(false)} />
        </Band>
      ) : (
        <Animated.View key="manage" entering={enterFade} exiting={exitFade} layout={layoutShift}>
          <Section title={t('Manage')}>
            <Button
              title={t('Rename')}
              kind="secondary"
              onPress={() => {
                setName(v.account.label);
                setRenaming(true);
              }}
            />
            <Button title={t('Remove account')} kind="destructive" onPress={confirmRemove} />
          </Section>
        </Animated.View>
      )}
    </Screen>
  );
}
