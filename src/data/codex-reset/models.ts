import { z } from 'zod';

/** Only the reset odds and their source time are read; every other field is ignored. */
const timestamp = z.iso.datetime({ offset: true });
const optionalTime = timestamp.nullish().catch(null);
const probability = z.number().finite().min(0).max(100).nullish().catch(null);

export const forecastSchema = z.object({
  probabilities: z.object({
    rounded_24h: probability,
    rounded_48h: probability,
  }),
  updated_at: optionalTime,
});

export const schemas = {
  forecast: forecastSchema,
};
export type Endpoint = keyof typeof schemas;
export type Forecast = z.infer<typeof forecastSchema>;
export type Payloads = {
  forecast: Forecast;
};
