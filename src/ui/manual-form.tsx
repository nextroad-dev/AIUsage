import { useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { ManualAccountConfig } from '@/core/manual';
import {
  applyEdits,
  buildManualConfig,
  parseNumber,
  type ManualSetup,
  type ManualTemplateLike,
  type ResetInput,
} from '@/core/manual-setup';
import { useT, type Translator } from '@/i18n';
import { Button, Field, Segmented } from '@/ui/controls';

const weekdayLabels = (t: Translator) => [
  t('Sun'),
  t('Mon'),
  t('Tue'),
  t('Wed'),
  t('Thu'),
  t('Fri'),
  t('Sat'),
];

/**
 * Create (templates + reset questions) or edit (plan, price, limits only; reset anchors are kept)
 * a manual account. Calls `onSubmit` with the finished config.
 */
export function ManualForm({
  templates,
  existing,
  submitLabel,
  onSubmit,
}: {
  templates: ManualTemplateLike[];
  existing?: ManualAccountConfig;
  submitLabel: string;
  onSubmit: (config: ManualAccountConfig) => void;
}) {
  const t = useT();
  const editing = !!existing;
  const [idx, setIdx] = useState(0);
  const tpl: ManualTemplateLike = existing
    ? {
        planName: existing.planName ?? '',
        priceMonthly: existing.priceMonthly,
        currency: existing.currency,
        meters: existing.meters,
      }
    : templates[idx];

  const [planName, setPlanName] = useState(tpl.planName);
  const [price, setPrice] = useState(
    tpl.priceMonthly === undefined ? '' : String(tpl.priceMonthly),
  );
  const [limits, setLimits] = useState<Record<string, string>>(() =>
    Object.fromEntries(tpl.meters.map((m) => [m.id, m.limit === undefined ? '' : String(m.limit)])),
  );
  const [resets, setResets] = useState<Record<string, ResetInput>>({});

  const pick = (i: number) => {
    const next = templates[i];
    setIdx(i);
    setPlanName(next.planName);
    setPrice(next.priceMonthly === undefined ? '' : String(next.priceMonthly));
    setLimits(
      Object.fromEntries(
        next.meters.map((m) => [m.id, m.limit === undefined ? '' : String(m.limit)]),
      ),
    );
    setResets({});
  };

  const setReset = (id: string, patch: ResetInput) =>
    setResets((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  const submit = () => {
    const setup: ManualSetup = {
      planName,
      priceMonthly: parseNumber(price),
      limits: Object.fromEntries(
        Object.entries(limits)
          .map(([k, v]) => [k, parseNumber(v)] as const)
          .filter((e): e is [string, number] => e[1] !== undefined),
      ),
      resets,
    };
    onSubmit(existing ? applyEdits(existing, setup) : buildManualConfig(tpl, setup, new Date()));
  };

  return (
    <View style={{ gap: Spacing.three }}>
      {!editing && templates.length > 1 && (
        <View style={{ gap: Spacing.two }}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('Plan')}
          </ThemedText>
          <Segmented
            options={templates.map((x, i) => ({
              value: i,
              label: x.planName === 'Custom' ? t('Custom') : x.planName,
            }))}
            value={idx}
            onChange={pick}
          />
        </View>
      )}

      <Field
        label={t('Plan name')}
        value={planName}
        onChangeText={setPlanName}
        autoCapitalize="sentences"
      />
      <Field
        label={t('Monthly price')}
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
        placeholder="0"
      />

      {tpl.meters.map((m) => (
        <View key={m.id} style={{ gap: Spacing.two }}>
          <ThemedText type="smallBold">{t(m.label)}</ThemedText>
          {!m.percent && (
            <Field
              label={t('Limit ({unit})', { unit: m.unit })}
              value={limits[m.id] ?? ''}
              onChangeText={(v) => setLimits((l) => ({ ...l, [m.id]: v }))}
              keyboardType="decimal-pad"
              placeholder={t('Optional')}
            />
          )}
          {!editing && m.window.type === 'rolling' && (
            <Field
              label={t('Current window started (minutes ago)')}
              value={String(resets[m.id]?.startedMinutesAgo ?? 0)}
              onChangeText={(v) => setReset(m.id, { startedMinutesAgo: parseNumber(v) ?? 0 })}
              keyboardType="number-pad"
            />
          )}
          {!editing && m.window.type === 'weekly' && (
            <View style={{ gap: Spacing.one }}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('Resets every week on')}
              </ThemedText>
              <Segmented
                options={weekdayLabels(t).map((label, d) => ({ value: d, label }))}
                label={t('Resets every week on')}
                value={resets[m.id]?.weekday ?? new Date().getDay()}
                onChange={(d) => setReset(m.id, { weekday: d })}
              />
            </View>
          )}
          {!editing && m.window.type === 'monthly' && (
            <Field
              label={t('Resets on day of month')}
              value={String(resets[m.id]?.dayOfMonth ?? new Date().getDate())}
              onChangeText={(v) => setReset(m.id, { dayOfMonth: parseNumber(v) })}
              keyboardType="number-pad"
            />
          )}
        </View>
      ))}

      <Button title={submitLabel} onPress={submit} />
    </View>
  );
}
