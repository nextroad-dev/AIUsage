import { useState } from 'react';
import { Alert, Linking, View } from 'react-native';

import { Section } from '@/components/section';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { confidenceText, errorText, eventText, localEventTime } from '@/data/codex-reset/format';
import { useCodexReset } from '@/data/codex-reset/hooks';
import { useCodexResetPreference } from '@/data/codex-reset/preferences';
import {
  codexState,
  isConfirmedReset,
  newestFirst,
  type Incident,
  type ResetEvent,
} from '@/data/codex-reset/models';
import { isDataStale, SOURCE, type CachedData } from '@/data/codex-reset/service';
import { useTheme } from '@/hooks/use-theme';
import { useLocale, useT } from '@/i18n';
import { Button } from '@/ui/controls';
import { ToggleRow } from '@/ui/toggles';

const open = (url: string) => void Linking.openURL(url).catch(() => {});

function SourceCredit() {
  return (
    <ThemedText type="linkPrimary" accessibilityRole="link" onPress={() => open(SOURCE)}>
      Data: codex-reset.com
    </ThemedText>
  );
}

function DataNote<T>({
  entry,
  updatedAt,
  now,
  upstreamStale = false,
}: {
  entry?: CachedData<T>;
  updatedAt?: string | null;
  now: Date;
  upstreamStale?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <View style={{ gap: Spacing.one }}>
      {entry?.data ? (
        <>
          {isDataStale(entry, updatedAt, now.getTime(), upstreamStale) ? (
            <ThemedText type="small" themeColor="warn">
              {t('Outdated data — showing the last available copy.')}
            </ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            {t('Source updated {time}', {
              time: localEventTime(updatedAt, locale, now),
            })}
          </ThemedText>
        </>
      ) : null}
      {entry?.error ? (
        <ThemedText type="small" themeColor="textSecondary">
          {errorText(entry.error, t)}
        </ThemedText>
      ) : null}
      <SourceCredit />
    </View>
  );
}

function EventRow({ event, now }: { event: ResetEvent; now: Date }) {
  const t = useT();
  const locale = useLocale();
  return (
    <View style={{ gap: Spacing.one }}>
      <ThemedText type="smallBold">{eventText(event, t)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {localEventTime(event.announced_at, locale, now)}
      </ThemedText>
      <ThemedText type="small" numberOfLines={2}>
        {locale === 'zh' ? event.localized_summary || event.summary : event.summary}
      </ThemedText>
      {event.url ? (
        <ThemedText type="linkPrimary" accessibilityRole="link" onPress={() => open(event.url!)}>
          {t('View announcement')}
        </ThemedText>
      ) : null}
    </View>
  );
}

function IncidentRow({ incident, now }: { incident: Incident; now: Date }) {
  const t = useT();
  const locale = useLocale();
  const resolved = incident.status === 'resolved';
  const active = ['investigating', 'identified', 'monitoring'].includes(incident.status);
  return (
    <View style={{ gap: Spacing.one }}>
      <ThemedText type="smallBold">{incident.name}</ThemedText>
      <ThemedText type="small" themeColor={active ? 'bad' : 'textSecondary'}>
        {resolved ? t('Resolved') : active ? t('Ongoing incident') : t('Status unknown')}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {localEventTime(incident.started_at, locale, now)}
      </ThemedText>
      {incident.source_url ? (
        <ThemedText
          type="linkPrimary"
          accessibilityRole="link"
          onPress={() => open(incident.source_url!)}
        >
          {t('View status report')}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** Auxiliary public information sits below personal meters and never changes their status. */
export function CodexResetSection({ now }: { now: Date }) {
  const t = useT();
  const preference = useCodexResetPreference();
  const save = (enabled: boolean) => {
    void preference
      .setEnabled(enabled)
      .catch(() =>
        Alert.alert(
          t('Could not save the public data setting'),
          t('Try changing the switch again.'),
        ),
      );
  };
  const change = (enabled: boolean) => {
    if (!enabled) {
      save(false);
      return;
    }
    Alert.alert(
      t('Enable Codex Reset?'),
      t(
        'Forecasts, global events and service status are fetched directly from codex-reset.com, an independent service, not OpenAI. Your API keys, ChatGPT access tokens, account IDs and personal usage are never sent to this site. Predictions do not guarantee your personal quota will recover. Allow public requests while this switch is on, including background refresh when available?',
      ),
      [
        { text: t('Cancel'), style: 'cancel' },
        { text: t('Agree and enable'), onPress: () => save(true) },
      ],
    );
  };
  return (
    <>
      <Section title="Codex Reset">
        <ToggleRow
          vertical
          label={t('Show global reset forecast')}
          hint={t(
            'Also shows public reset history and service status. Applies to all Codex accounts.',
          )}
          value={preference.enabled}
          disabled={!preference.loaded || preference.pending}
          onChange={change}
        />
        {!preference.enabled ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('Off. No requests are sent to codex-reset.com.')}
          </ThemedText>
        ) : null}
        <ThemedText
          type="linkPrimary"
          accessibilityRole="link"
          onPress={() => open(`${SOURCE}developers`)}
        >
          {t('About the data source')}
        </ThemedText>
      </Section>
      {preference.enabled ? <CodexResetContent now={now} /> : null}
    </>
  );
}

function CodexResetContent({ now }: { now: Date }) {
  const t = useT();
  const locale = useLocale();
  const theme = useTheme();
  const queries = useCodexReset();
  const [moreEvents, setMoreEvents] = useState(false);
  const [moreIncidents, setMoreIncidents] = useState(false);
  const forecast = queries.forecast.data?.data;
  const timeline = queries.timeline.data?.data;
  const status = queries.status.data?.data;
  const events = newestFirst(timeline?.events ?? [], (e) => e.announced_at);
  const confirmed = events.filter(isConfirmedReset);
  const announcements = events.filter((e) => !isConfirmedReset(e));
  const incidents = newestFirst(status?.incidents ?? [], (e) => e.started_at);
  const state = status ? codexState(status) : 'unknown';
  const unavailable = (loading: boolean) => (
    <ThemedText type="small" themeColor="textSecondary">
      {loading ? t('Loading…') : t('No public data available.')}
    </ThemedText>
  );

  return (
    <>
      <Section
        title={t('Global reset forecast')}
        footer={t(
          'Independent prediction, not an OpenAI quota API. A global reset does not guarantee your personal quota will recover.',
        )}
      >
        {forecast ? (
          <>
            {(
              [
                ['24', forecast.probabilities.rounded_24h],
                ['48', forecast.probabilities.rounded_48h],
              ] as const
            ).map(([hours, percent]) => (
              <View key={hours} style={{ gap: Spacing.one }}>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('Extra reset chance in {hours} hours', { hours })}
                </ThemedText>
                <ThemedText
                  type="smallBold"
                  style={{ color: theme.primary, fontVariant: ['tabular-nums'] }}
                >
                  {percent == null ? t('Unknown') : `${percent}%`}
                </ThemedText>
              </View>
            ))}
            <ThemedText
              type="small"
              themeColor={forecast.confidence === 'low' ? 'warn' : 'textSecondary'}
            >
              {confidenceText(forecast.confidence, t)}
            </ThemedText>
            {forecast.confidence === 'low' ? (
              <ThemedText type="small" themeColor="warn">
                {t('Low-confidence forecast: treat these odds with caution.')}
              </ThemedText>
            ) : null}
            <View style={{ gap: Spacing.one }}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('Last confirmed global reset')}
              </ThemedText>
              <ThemedText type="small">
                {localEventTime(forecast.last_reset_at, locale, now)}
              </ThemedText>
            </View>
            {forecast.official_signal ? (
              <View style={{ gap: Spacing.one }}>
                <ThemedText type="smallBold">{t('Official signal reported')}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t('A signal is not a confirmed reset.')}
                </ThemedText>
                <ThemedText
                  type="linkPrimary"
                  accessibilityRole="link"
                  onPress={() => open(SOURCE)}
                >
                  {t('View announcement')}
                </ThemedText>
              </View>
            ) : null}
          </>
        ) : (
          unavailable(queries.forecast.isLoading)
        )}
        <DataNote entry={queries.forecast.data} updatedAt={forecast?.updated_at} now={now} />
      </Section>

      <Section
        title={t('Recent global events')}
        footer={t('Unconfirmed signals and other announcements are not confirmed global resets.')}
      >
        {timeline ? (
          <>
            {confirmed.length ? (
              confirmed
                .slice(0, moreEvents ? 10 : 2)
                .map((event) => <EventRow key={event.id} event={event} now={now} />)
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                {t('No confirmed resets reported.')}
              </ThemedText>
            )}
            {moreEvents
              ? announcements
                  .slice(0, 5)
                  .map((event) => <EventRow key={event.id} event={event} now={now} />)
              : null}
            {confirmed.length > 2 || announcements.length > 0 ? (
              <Button
                kind="secondary"
                title={moreEvents ? t('Show less') : t('More history')}
                onPress={() => setMoreEvents(!moreEvents)}
              />
            ) : null}
          </>
        ) : (
          unavailable(queries.timeline.isLoading)
        )}
        <DataNote entry={queries.timeline.data} updatedAt={timeline?.updated_at} now={now} />
      </Section>

      <Section title={t('Codex service status')}>
        {status ? (
          <>
            <ThemedText
              type="smallBold"
              themeColor={state === 'incident' ? 'bad' : 'textSecondary'}
            >
              {state === 'operational'
                ? t('Codex operational')
                : state === 'incident'
                  ? t('Codex service incident reported')
                  : t('Codex status unknown')}
            </ThemedText>
            {state === 'incident' ? (
              <ThemedText type="small" themeColor="bad">
                {t('A platform incident is different from exhausted personal quota.')}
              </ThemedText>
            ) : null}
            {(moreIncidents
              ? incidents.slice(0, 3)
              : incidents.filter((e) => e.status !== 'resolved').slice(0, 1)
            ).map((incident) => (
              <IncidentRow key={incident.id} incident={incident} now={now} />
            ))}
            {incidents.length ? (
              <Button
                kind="secondary"
                title={moreIncidents ? t('Show less') : t('Recent incidents')}
                onPress={() => setMoreIncidents(!moreIncidents)}
              />
            ) : null}
          </>
        ) : (
          unavailable(queries.status.isLoading)
        )}
        <DataNote
          entry={queries.status.data}
          updatedAt={status?.checked_at}
          upstreamStale={status?.stale}
          now={now}
        />
      </Section>
    </>
  );
}
