import { useState } from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';

import { Section } from '@/components/section';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { formatAgo, formatCountdown } from '@/core/format';
import { countdown } from '@/core/meter-utils';
import type { Meter } from '@/core/types';
import {
  averageIntervalDays,
  chanceBand,
  chanceBandText,
  confidenceLevel,
  confidenceText,
  errorText,
  eventText,
  localEventTime,
  resetDays,
} from '@/data/codex-reset/format';
import { useCodexReset } from '@/data/codex-reset/hooks';
import { useCodexResetPreference } from '@/data/codex-reset/preferences';
import {
  codexState,
  isConfirmedReset,
  newestFirst,
  type Incident,
  type ResetEvent,
} from '@/data/codex-reset/models';
import { isDataStale, SOURCE } from '@/data/codex-reset/service';
import { useTheme } from '@/hooks/use-theme';
import { useLocale, useT } from '@/i18n';
import { Button } from '@/ui/controls';

const open = (url: string) => void Linking.openURL(url).catch(() => {});

function SourceCredit() {
  return (
    <ThemedText type="linkPrimary" accessibilityRole="link" onPress={() => open(SOURCE)}>
      Data: codex-reset.com
    </ThemedText>
  );
}

function EventRow({ event, now }: { event: ResetEvent; now: Date }) {
  const t = useT();
  const locale = useLocale();
  return (
    <View style={styles.block}>
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
    <View style={styles.block}>
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

/**
 * Auxiliary public information below the personal meters; it never changes their status.
 * One card answers "is a global reset likely soon?" first, then shows the evidence.
 */
export function CodexResetSection({ now, weekly }: { now: Date; weekly?: Meter }) {
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
  if (!preference.loaded) return null;
  if (!preference.enabled) {
    return (
      <Section title={t('Global reset radar')}>
        <ThemedText type="small" themeColor="textSecondary">
          {t(
            "See how likely OpenAI is to reset everyone's Codex limits early. Data comes from codex-reset.com, an independent site; you confirm before anything is requested.",
          )}
        </ThemedText>
        <Button
          kind="secondary"
          title={t('Turn on')}
          disabled={preference.pending}
          onPress={() => change(true)}
        />
        <ThemedText
          type="linkPrimary"
          accessibilityRole="link"
          onPress={() => open(`${SOURCE}developers`)}
        >
          {t('About the data source')}
        </ThemedText>
      </Section>
    );
  }
  return (
    <ResetRadar
      now={now}
      weekly={weekly}
      turningOff={preference.pending}
      onTurnOff={() => change(false)}
    />
  );
}

function ResetRadar({
  now,
  weekly,
  turningOff,
  onTurnOff,
}: {
  now: Date;
  weekly?: Meter;
  turningOff: boolean;
  onTurnOff: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const theme = useTheme();
  const queries = useCodexReset();
  const [more, setMore] = useState(false);
  const forecast = queries.forecast.data?.data;
  const timeline = queries.timeline.data?.data;
  const status = queries.status.data?.data;
  const events = newestFirst(timeline?.events ?? [], (e) => e.announced_at);
  const confirmed = events.filter(isConfirmedReset);
  const announcements = events.filter((e) => !isConfirmedReset(e));
  const incidents = newestFirst(status?.incidents ?? [], (e) => e.started_at);
  const state = status ? codexState(status) : 'unknown';

  const ms = now.getTime();
  const stale = [
    queries.forecast.data && isDataStale(queries.forecast.data, forecast?.updated_at, ms),
    queries.timeline.data && isDataStale(queries.timeline.data, timeline?.updated_at, ms),
    queries.status.data &&
      isDataStale(queries.status.data, status?.checked_at, ms, status?.stale),
  ].some(Boolean);
  const error =
    queries.forecast.data?.error ?? queries.timeline.data?.error ?? queries.status.data?.error;

  const p24 = forecast?.probabilities.rounded_24h;
  const p48 = forecast?.probabilities.rounded_48h;
  const band = chanceBand(p24);
  const dots = confidenceLevel(forecast?.confidence);
  const days = resetDays(events, now);
  const confirmedDays = days.filter((d) => d === 'confirmed').length;
  const signalDays = days.filter((d) => d === 'signal').length;
  const interval = averageIntervalDays(confirmed);
  const lastReset = forecast?.last_reset_at ? Date.parse(forecast.last_reset_at) : NaN;
  const personal = weekly ? countdown(weekly.resetsAt, now) : undefined;
  const personalLeft = personal && !personal.elapsed ? personal : undefined;
  const personalUsed = weekly?.kind.type === 'percent' ? Math.round(weekly.kind.used) : undefined;
  const pct = (p: number | null | undefined) => (p == null ? t('Unknown') : `${p}%`);
  const stateColor =
    state === 'incident' ? theme.bad : state === 'operational' ? theme.good : theme.muted;

  return (
    <Section
      title={t('Global reset radar')}
      footer={t(
        'Independent prediction, not an OpenAI quota API. A global reset does not guarantee your personal quota will recover.',
      )}
    >
      <View style={styles.chips}>
        <Chip
          color={stateColor}
          dot
          text={
            state === 'operational'
              ? t('Codex operational')
              : state === 'incident'
                ? t('Codex service incident reported')
                : t('Codex status unknown')
          }
        />
        {stale ? <Chip color={theme.warn} text={t('Outdated data')} /> : null}
      </View>
      {state === 'incident' ? (
        <ThemedText type="small" themeColor="bad">
          {t('A platform incident is different from exhausted personal quota.')}
        </ThemedText>
      ) : null}

      {forecast ? (
        <View style={styles.block}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('Chance of a global reset in the next 24 hours')}
          </ThemedText>
          <View style={styles.answer}>
            <ThemedText type="subtitle" style={[styles.number, { color: theme.primary }]}>
              {pct(p24)}
            </ThemedText>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>
              {chanceBandText(band, t)}
            </ThemedText>
          </View>
          <View style={styles.inline}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.number}>
              {t('48 hours: {percent}', { percent: pct(p48) })}
            </ThemedText>
            <View
              style={styles.dots}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {[1, 2, 3].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    {
                      backgroundColor:
                        dots !== undefined && i <= dots
                          ? theme.textSecondary
                          : theme.backgroundSelected,
                    },
                  ]}
                />
              ))}
            </View>
            <ThemedText
              type="small"
              themeColor={forecast.confidence === 'low' ? 'warn' : 'textSecondary'}
            >
              {confidenceText(forecast.confidence, t)}
            </ThemedText>
          </View>
          {forecast.confidence === 'low' ? (
            <ThemedText type="small" themeColor="warn">
              {t('Low-confidence forecast: treat these odds with caution.')}
            </ThemedText>
          ) : null}

          <ForecastStrip
            p24={p24}
            p48={p48}
            personalHours={personalLeft ? personalLeft.ms / 3_600_000 : undefined}
          />
          {personalLeft ? (
            <ThemedText type="small">
              {personalUsed === undefined
                ? t('Your weekly quota resets on its own in {time}.', {
                    time: formatCountdown(personalLeft.label, t),
                  })
                : t('Your weekly quota is {used}% used and resets on its own in {time}.', {
                    used: personalUsed,
                    time: formatCountdown(personalLeft.label, t),
                  })}
            </ThemedText>
          ) : null}

          {forecast.official_signal ? (
            <View style={styles.block}>
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
        </View>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          {queries.forecast.isLoading ? t('Loading…') : t('No public data available.')}
        </ThemedText>
      )}

      {timeline ? (
        <View style={styles.block}>
          <View style={styles.between}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('Last 30 days')}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t('{confirmed} confirmed · {signals} signals', {
                confirmed: confirmedDays,
                signals: signalDays,
              })}
            </ThemedText>
          </View>
          <View
            style={styles.days}
            accessible
            accessibilityLabel={t(
              'Last 30 days: {confirmed} days with a confirmed reset, {signals} with an unconfirmed signal',
              { confirmed: confirmedDays, signals: signalDays },
            )}
          >
            {days.map((d, i) => (
              <View
                key={i}
                style={[
                  styles.day,
                  d === 'confirmed'
                    ? [styles.dayConfirmed, { backgroundColor: theme.primary }]
                    : d === 'signal'
                      ? [styles.daySignal, { borderColor: theme.primary }]
                      : { backgroundColor: theme.backgroundSelected },
                ]}
              />
            ))}
          </View>
        </View>
      ) : null}

      {Number.isFinite(lastReset) || interval !== undefined ? (
        <View style={styles.block}>
          {Number.isFinite(lastReset) ? (
            <View style={styles.between}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('Last confirmed global reset')}
              </ThemedText>
              <ThemedText type="small" style={styles.number}>
                {`${formatAgo(lastReset, ms, t)} · ${localEventTime(forecast?.last_reset_at, locale, now)}`}
              </ThemedText>
            </View>
          ) : null}
          {interval !== undefined ? (
            <View style={styles.between}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('Average interval')}
              </ThemedText>
              <ThemedText type="small" style={styles.number}>
                {t('about {n} days', { n: interval })}
              </ThemedText>
            </View>
          ) : null}
        </View>
      ) : null}

      {timeline || status ? (
        <Button
          kind="secondary"
          title={more ? t('Show less') : t('History and service status')}
          onPress={() => setMore(!more)}
        />
      ) : null}
      {more ? (
        <View style={styles.history}>
          {confirmed.length ? (
            confirmed
              .slice(0, 10)
              .map((event) => <EventRow key={event.id} event={event} now={now} />)
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              {t('No confirmed resets reported.')}
            </ThemedText>
          )}
          {announcements.slice(0, 5).map((event) => (
            <EventRow key={event.id} event={event} now={now} />
          ))}
          <ThemedText type="small" themeColor="textSecondary">
            {t('Unconfirmed signals and other announcements are not confirmed global resets.')}
          </ThemedText>
          {incidents.slice(0, 3).map((incident) => (
            <IncidentRow key={incident.id} incident={incident} now={now} />
          ))}
        </View>
      ) : null}

      {/* one source line for the whole card: credit, freshness and any fetch problem */}
      <View style={styles.block}>
        {error ? (
          <ThemedText type="small" themeColor="textSecondary">
            {errorText(error, t)}
          </ThemedText>
        ) : null}
        {stale && forecast ? (
          <ThemedText type="small" themeColor="warn">
            {t('Outdated data — showing the last available copy.')}
          </ThemedText>
        ) : null}
        <View style={styles.between}>
          {forecast ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.shrink}>
              {t('Source updated {time}', {
                time: localEventTime(forecast.updated_at, locale, now),
              })}
            </ThemedText>
          ) : null}
          <SourceCredit />
        </View>
        <ThemedText
          type="linkPrimary"
          accessibilityRole="button"
          accessibilityState={{ disabled: turningOff }}
          onPress={turningOff ? undefined : onTurnOff}
        >
          {t('Turn off global reset radar')}
        </ThemedText>
      </View>
    </Section>
  );
}

function Chip({ text, color, dot = false }: { text: string; color: string; dot?: boolean }) {
  return (
    <View style={[styles.chip, { borderColor: color }]}>
      {dot ? <View style={[styles.dot, { backgroundColor: color }]} /> : null}
      <ThemedText type="small" style={{ color }}>
        {text}
      </ThemedText>
    </View>
  );
}

/**
 * Now → 24 h → 48 h, shaded by the source's two odds, with the user's own weekly reset marked
 * when it falls inside the two days (pinned to the end with an arrow when it is later).
 */
function ForecastStrip({
  p24,
  p48,
  personalHours,
}: {
  p24?: number | null;
  p48?: number | null;
  personalHours?: number;
}) {
  const t = useT();
  const theme = useTheme();
  const shade = (p: number | null | undefined) =>
    p == null ? 0.15 : 0.15 + Math.min(1, Math.max(0, p) / 100) * 0.85;
  const marker = personalHours === undefined ? undefined : Math.min(1, personalHours / 48);
  return (
    <View
      style={styles.strip}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.between}>
        <ThemedText type="small" themeColor="textSecondary">
          {t('Now')}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          24h
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          48h
        </ThemedText>
      </View>
      <View style={styles.track}>
        <View
          style={[styles.segment, styles.first, { backgroundColor: theme.primary, opacity: shade(p24) }]}
        />
        <View
          style={[
            styles.segment,
            styles.second,
            { backgroundColor: theme.primary, opacity: shade(p48) },
          ]}
        />
        {marker === undefined ? null : (
          <View style={[styles.marker, { left: `${marker * 100}%`, backgroundColor: theme.warn }]} />
        )}
      </View>
      {marker === undefined ? null : (
        <ThemedText
          type="small"
          style={[{ color: theme.warn }, marker > 0.5 ? styles.alignEnd : null]}
        >
          {marker >= 1 ? t('Your weekly reset is later →') : t('▲ Your weekly reset')}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  number: { fontVariant: ['tabular-nums'] },
  shrink: { flexShrink: 1 },
  block: { gap: Spacing.one },
  history: { gap: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: 1,
  },
  answer: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: Spacing.two },
  inline: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  dots: { flexDirection: 'row', gap: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  strip: { gap: Spacing.one, paddingTop: Spacing.one },
  track: { height: 12, flexDirection: 'row' },
  segment: { flex: 1, height: '100%' },
  first: { borderTopLeftRadius: Radius.pill, borderBottomLeftRadius: Radius.pill },
  second: {
    marginLeft: 2,
    borderTopRightRadius: Radius.pill,
    borderBottomRightRadius: Radius.pill,
  },
  marker: { position: 'absolute', top: -4, bottom: -4, width: 2, marginLeft: -1 },
  alignEnd: { alignSelf: 'flex-end' },
  days: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 14 },
  day: { flex: 1, height: 6, borderRadius: 2 },
  dayConfirmed: { height: 12 },
  daySignal: { height: 10, borderWidth: 1.5 },
});
