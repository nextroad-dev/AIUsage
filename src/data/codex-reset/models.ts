import { z } from 'zod';

/** Only the public contract is used; classifier internals are intentionally ignored. */
const timestamp = z.iso.datetime({ offset: true });
const optionalTime = timestamp.nullish().catch(null);
const optionalText = z.string().nullish().catch(null);
const probability = z.number().finite().min(0).max(100).nullish().catch(null);
const httpsUrl = z
  .url()
  .refine((v) => v.startsWith('https://'))
  .nullish()
  .catch(null);

export const forecastSchema = z.object({
  probabilities: z.object({
    rounded_24h: probability,
    rounded_48h: probability,
  }),
  confidence: optionalText,
  last_reset_at: optionalTime,
  updated_at: optionalTime,
  // No stable inner signal fields are documented. Offer the source rather than invent copy.
  official_signal: z
    .union([z.string(), z.record(z.string(), z.unknown())])
    .nullish()
    .catch(null),
});

export const eventSchema = z.object({
  id: z.string().min(1),
  announced_at: timestamp,
  group: z.string(),
  type: optionalText,
  announcement_state: optionalText,
  summary: z.string(),
  localized_summary: optionalText,
  url: httpsUrl,
});

// A malformed event should not discard the remaining history.
const validEvents = z.array(z.unknown()).transform((items) =>
  items.flatMap((item) => {
    const parsed = eventSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  }),
);
export const timelineSchema = z.object({
  updated_at: optionalTime,
  events: validEvents,
});

export const incidentSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  status: z.string(),
  started_at: timestamp,
  resolved_at: optionalTime,
  source_url: httpsUrl,
});
export const statusSchema = z.object({
  current: z.object({
    codex: optionalText,
    degraded: z.boolean().nullish().catch(null),
  }),
  checked_at: optionalTime,
  stale: z.boolean().optional().catch(true),
  incidents: z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const parsed = incidentSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  ),
});

export const schemas = {
  forecast: forecastSchema,
  timeline: timelineSchema,
  status: statusSchema,
};
export type Endpoint = keyof typeof schemas;
export type Forecast = z.infer<typeof forecastSchema>;
export type Timeline = z.infer<typeof timelineSchema>;
export type ServiceStatus = z.infer<typeof statusSchema>;
export type ResetEvent = z.infer<typeof eventSchema>;
export type Incident = z.infer<typeof incidentSchema>;
export type Payloads = {
  forecast: Forecast;
  timeline: Timeline;
  status: ServiceStatus;
};

/** This is the documented confirmation rule, not the event's type or confidence. */
export const isConfirmedReset = (event: ResetEvent): boolean =>
  event.group === 'reset' && event.announcement_state === 'announced';

export function newestFirst<T>(items: T[], time: (item: T) => string): T[] {
  return [...items].sort((a, b) => Date.parse(time(b)) - Date.parse(time(a)));
}

export function codexState(status: ServiceStatus): 'operational' | 'incident' | 'unknown' {
  const state = status.current.codex;
  if (
    status.current.degraded === true ||
    ['degraded_performance', 'partial_outage', 'major_outage', 'under_maintenance'].includes(
      state ?? '',
    )
  )
    return 'incident';
  return state === 'operational' ? 'operational' : 'unknown';
}
