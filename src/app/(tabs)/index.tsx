import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Band } from '@/components/section';
import { Screen } from '@/components/screen';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatAgo, formatAmount, formatDate } from '@/core/format';
import { lastUpdated, nextRenewal, orderViews, subscriptionTotals } from '@/data/summary';
import { useAccountViews, useNow, useRefreshAll, useServices } from '@/data/hooks';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/i18n';
import { AccountCard } from '@/ui/account-card';
import { AccountCardSkeleton } from '@/ui/account-card-skeleton';
import { Button } from '@/ui/controls';
import { HeaderButton } from '@/ui/header-button';
import { RefreshButton } from '@/ui/refresh-button';
import { summarizeCycle, type RefreshSummary } from '@/data/refresh-summary';
import { haptics } from '@/ui/haptics';
import { RefreshNotice } from '@/ui/refresh-notice';
import { ResetChanceLine } from '@/ui/reset-chance-line';
import { useCodexResetPreference } from '@/data/codex-reset/preferences';
import { enterFade, enterItem, exitFade, layoutShift } from '@/ui/motion';

export default function OverviewScreen() {
  const router = useRouter();
  const theme = useTheme();
  const t = useT();
  const now = useNow();
  const resetOdds = useCodexResetPreference();
  const services = useServices();
  const views = useAccountViews();
  const refresh = useRefreshAll();
  const [notice, setNotice] = useState<RefreshSummary>();
  // only a pull shows the pull spinner; the refresh on open and the header button have their own
  const [pulling, setPulling] = useState(false);
  const closeNotice = useCallback(() => setNotice(undefined), []);

  // A pull or the refresh button reports what it did: how many accounts updated, or which ones
  // failed and why. The automatic refresh on open stays silent.
  const refreshNow = (source: 'button' | 'pull') => {
    // a refresh already running (e.g. the one on open) is not doubled up
    if (refresh.isPending) return;
    setNotice(undefined);
    if (source === 'pull') setPulling(true);
    refresh.mutate(
      { force: true },
      {
        onSettled: () => setPulling(false),
        onSuccess: (result) => {
          const s = summarizeCycle(result, views.data ?? []);
          if (s.kind === 'ok' && s.updated === 0) return;
          if (s.kind === 'ok') haptics.success();
          else haptics.warning();
          setNotice(s);
        },
      },
    );
  };

  // Refresh once when the app opens; the rate limiter makes this cheap if data is recent.
  const ready = !!services.data;
  const { mutate } = refresh;
  useEffect(() => {
    if (ready) mutate({});
  }, [ready, mutate]);

  // a stable order: problems first, then the user's order (not by usage, so cards don't jump)
  const list = orderViews(views.data ?? []);
  const updatedAt = lastUpdated(list);
  const totals = Object.entries(subscriptionTotals(list));
  const renewal = nextRenewal(list, now);
  const loading = views.isLoading && list.length === 0;
  const empty = list.length === 0 && !views.isLoading;
  // Codex reset odds are global: under the only Codex card, or once below the summary when
  // several Codex accounts would otherwise repeat them
  const codexCount = list.filter((v) => v.account.providerId === 'codex').length;
  const sharedOdds = codexCount > 1 && resetOdds.enabled;

  return (
    <Screen onRefresh={() => refreshNow('pull')} refreshing={pulling}>
      <ScreenHeader
        title={t('Usage')}
        subtitle={
          updatedAt === undefined
            ? undefined
            : t('Updated {ago}', { ago: formatAgo(updatedAt, now.getTime(), t) })
        }
        action={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.one }}>
            <HeaderButton
              icon={{ ios: 'plus', android: 'add', web: 'add' }}
              label={t('Add account')}
              onPress={() => router.push('/add')}
            />
            <RefreshButton refreshing={refresh.isPending} onPress={() => refreshNow('button')} />
          </View>
        }
      />

      {notice ? <RefreshNotice summary={notice} onClose={closeNotice} /> : null}

      {services.error || views.error ? (
        <Band entering={enterFade} exiting={exitFade} layout={layoutShift}>
          <ThemedText type="small" style={{ color: theme.bad }}>
            {t('Local storage is unavailable. Restart the app.')}
          </ThemedText>
        </Band>
      ) : null}

      {/* the summary appears only with something to say: a priced plan or an upcoming plan end */}
      {totals.length > 0 || renewal || sharedOdds ? (
        <Band entering={enterFade} layout={layoutShift} style={{ gap: Spacing.one }}>
          {totals.length > 0 ? (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                {t('Subscriptions per month')}
              </ThemedText>
              <ThemedText type="subtitle">
                {totals.map(([currency, sum]) => formatAmount(sum, currency)).join(' + ')}
              </ThemedText>
            </>
          ) : null}
          {renewal ? (
            <ThemedText type="small" themeColor="textSecondary">
              {t('Next plan end: {name}, {date}', {
                name: renewal.view.meta?.name ?? renewal.view.account.label,
                date: formatDate(renewal.at),
              })}
            </ThemedText>
          ) : null}
          {/* one copy of the global odds for all Codex accounts, part of the summary */}
          {sharedOdds ? (
            <View style={totals.length > 0 || renewal ? { marginTop: Spacing.two } : undefined}>
              <ResetChanceLine now={now} heading={t('Codex reset chance')} />
            </View>
          ) : null}
        </Band>
      ) : null}

      {loading ? (
        <Band exiting={exitFade}>
          <AccountCardSkeleton />
          <AccountCardSkeleton />
        </Band>
      ) : null}

      {list.length > 0 ? (
        <Band style={{ gap: Spacing.four }} layout={layoutShift}>
          {/* cards rise in one after another, and slide when the risk order changes */}
          {list.map((v, i) => (
            <Animated.View
              key={v.account.id}
              entering={enterItem(i)}
              exiting={exitFade}
              layout={layoutShift}
            >
              <AccountCard
                view={v}
                now={now}
                onPress={() => router.push(`/account/${v.account.id}`)}
                footer={
                  codexCount === 1 && v.account.providerId === 'codex' ? (
                    <ResetChanceLine now={now} />
                  ) : undefined
                }
              />
            </Animated.View>
          ))}
        </Band>
      ) : null}

      {empty ? (
        <Band
          entering={enterItem(0)}
          style={{ alignItems: 'center', paddingVertical: Spacing.five }}
        >
          <ThemedText type="smallBold">{t('No accounts yet')}</ThemedText>
          <Button title={t('Add your first account')} onPress={() => router.push('/add')} />
        </Band>
      ) : null}
    </Screen>
  );
}
