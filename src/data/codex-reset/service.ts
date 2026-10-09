import { z } from 'zod';

import { backoffMs } from '@/core/backoff';
import { HttpError, RateLimitedError, TimeoutError } from '@/core/errors';
import { requestJson } from '@/core/http';
import type { SettingsRepo } from '@/db/repos';
import { schemas, type Endpoint, type Payloads } from './models';

export const SOURCE = 'https://codex-reset.com/';
export const USER_AGENT = 'AIUsage/1.0 (+https://github.com/nextroad-dev/AIUsage)';
export const CACHE_MS = 5 * 60_000;
export const STALE_MS = 15 * 60_000;
export const TIMEOUT_MS = 8_000;
const PREFIX = 'codex-reset:v1:';
export const CONSENT_KEY = 'codex-reset:consent:v1';
const consentSchema = z.object({
  version: z.literal(1),
  source: z.literal(SOURCE),
  enabled: z.boolean(),
  acceptedAt: z.number().finite().nonnegative().optional(),
});
const paths: Record<Endpoint, string> = {
  forecast: 'forecast',
};

export type DataError = 'rate-limited' | 'timeout' | 'invalid' | 'unavailable';
export interface CachedData<T> {
  data?: T;
  fetchedAt?: number;
  attemptedAt?: number;
  retryAt: number;
  failures: number;
  error?: DataError;
  publishedCheckedAt?: string;
  publishedExpiresAt?: string;
}

const envelopeSchema = z.object({
  data: z.unknown().optional(),
  fetchedAt: z.number().finite().nonnegative().optional(),
  attemptedAt: z.number().finite().nonnegative().optional(),
  retryAt: z.number().finite().nonnegative(),
  failures: z.number().int().nonnegative(),
  error: z.enum(['rate-limited', 'timeout', 'invalid', 'unavailable']).optional(),
  publishedCheckedAt: z.iso.datetime({ offset: true }).optional(),
  publishedExpiresAt: z.iso.datetime({ offset: true }).optional(),
});
type Store = Pick<SettingsRepo, 'getJson' | 'setJson'>;

export function isDataStale<T>(
  entry: CachedData<T>,
  updatedAt: string | null | undefined,
  now: number,
  upstreamStale = false,
): boolean {
  const updated = updatedAt ? Date.parse(updatedAt) : NaN;
  return (
    upstreamStale ||
    !!entry.error ||
    !entry.data ||
    entry.fetchedAt === undefined ||
    now - entry.fetchedAt >= STALE_MS ||
    !Number.isFinite(updated) ||
    updated > now + 60_000 ||
    now - updated >= STALE_MS ||
    (!!entry.publishedExpiresAt && Date.parse(entry.publishedExpiresAt) <= now)
  );
}

/**
 * Public data only: no account IDs, credential store, auth headers or UsageSnapshots.
 * One instance shared by views, manual refresh and the headless task. Persisted request gates
 * survive restarts; stale successes survive errors. Query retries cannot bypass these gates.
 */
export class CodexResetService {
  private cache = new Map<string, CachedData<unknown>>();
  private running = new Map<string, Promise<CachedData<unknown>>>();
  private originRetryAt = 0;
  private originReady?: Promise<void>;
  private consentReady?: Promise<void>;
  private consentWrites: Promise<void> = Promise.resolve();
  private enabled = false;
  private generation = 0;
  private controllers = new Set<AbortController>();

  constructor(private deps: { store: Store; fetch: typeof fetch; now: () => number }) {}

  /** Missing, invalid or unreadable consent is always off. No network is needed to read it. */
  async getEnabled(): Promise<boolean> {
    const generation = this.generation;
    this.consentReady ??= this.deps.store
      .getJson<unknown>(CONSENT_KEY, null)
      .then((raw) => {
        const saved = consentSchema.safeParse(raw);
        if (this.generation === generation) {
          this.enabled = saved.success && saved.data.enabled && saved.data.acceptedAt !== undefined;
        }
      })
      .catch(() => {});
    await this.consentReady;
    return this.enabled;
  }

  /** UI calls true only after explicit source consent. Disable aborts in-flight reads immediately. */
  async setEnabled(enabled: boolean): Promise<void> {
    // Start hydration before invalidating its generation, so an old stored opt-in cannot
    // re-enable a preference the user has just turned off.
    const ready = this.getEnabled();
    const generation = ++this.generation;
    if (!enabled) {
      this.enabled = false;
      for (const controller of this.controllers) controller.abort();
    }
    await ready;
    // Multiple open account screens still persist preference changes in invocation order.
    const saving = this.consentWrites
      .catch(() => {})
      .then(() =>
        this.deps.store.setJson(CONSENT_KEY, {
          version: 1,
          source: SOURCE,
          enabled,
          ...(enabled ? { acceptedAt: this.deps.now() } : {}),
        }),
      );
    this.consentWrites = saving;
    await saving;
    if (generation === this.generation) this.enabled = enabled;
  }

  private initOrigin(): Promise<void> {
    this.originReady ??= this.deps.store
      .getJson<unknown>(`${PREFIX}retry-at`, 0)
      .then((value) => {
        if (typeof value === 'number' && Number.isFinite(value))
          this.originRetryAt = Math.max(this.originRetryAt, value);
      })
      .catch(() => {});
    return this.originReady;
  }

  load<K extends Endpoint>(endpoint: K): Promise<CachedData<Payloads[K]>> {
    const key = endpoint;
    const inflight = this.running.get(key);
    if (inflight) return inflight as Promise<CachedData<Payloads[K]>>;
    const work = this.read(endpoint, key).finally(() => this.running.delete(key));
    this.running.set(key, work);
    return work;
  }

  private async read<K extends Endpoint>(
    endpoint: K,
    key: string,
  ): Promise<CachedData<Payloads[K]>> {
    if (!(await this.getEnabled())) return { retryAt: 0, failures: 0 };
    const generation = this.generation;
    await this.initOrigin();
    const schema = schemas[endpoint];
    let previous = this.cache.get(key) as CachedData<Payloads[K]> | undefined;
    if (!previous) {
      const raw = await this.deps.store.getJson<unknown>(PREFIX + key, null).catch(() => null);
      const saved = envelopeSchema.safeParse(raw);
      if (saved.success) {
        const payload = schema.safeParse(saved.data.data);
        previous = {
          ...saved.data,
          data: payload.success ? (payload.data as Payloads[K]) : undefined,
        };
      }
    }
    previous ??= { retryAt: 0, failures: 0 };
    if (!this.enabled || generation !== this.generation) return { retryAt: 0, failures: 0 };
    this.cache.set(key, previous);
    const now = this.deps.now();
    if (now < this.originRetryAt) {
      return {
        ...previous,
        error: 'rate-limited',
        retryAt: Math.max(previous.retryAt, this.originRetryAt),
      };
    }
    if (now < previous.retryAt) return previous;

    // Reserve the next attempt before network I/O, including a headless task interrupted by OS.
    const reserved = { ...previous, attemptedAt: now, retryAt: now + CACHE_MS };
    this.cache.set(key, reserved);
    await this.deps.store.setJson(PREFIX + key, reserved).catch(() => {});

    if (!this.enabled || generation !== this.generation) return { retryAt: 0, failures: 0 };
    const controller = new AbortController();
    this.controllers.add(controller);
    let unlinkTimeout: (() => void) | undefined;

    let next: CachedData<Payloads[K]>;
    let checked: string | undefined;
    let expires: string | undefined;
    try {
      const result = await requestJson(
        `${SOURCE}api/${paths[endpoint]}`,
        {
          timeoutMs: TIMEOUT_MS,
          headers: { 'User-Agent': USER_AGENT },
          fetch: async (...args) => {
            const [url, init] = args;
            const abort = () => controller.abort();
            init?.signal?.addEventListener('abort', abort);
            unlinkTimeout = () => init?.signal?.removeEventListener('abort', abort);
            if (init?.signal?.aborted) controller.abort();
            const res = await this.deps.fetch(url, { ...init, signal: controller.signal });
            const time = z.iso.datetime({ offset: true });
            const c = time.safeParse(res.headers.get('x-published-checked-at'));
            const e = time.safeParse(res.headers.get('x-published-expires-at'));
            checked = c.success ? c.data : undefined;
            expires = e.success ? e.data : undefined;
            // Public-site authorization failure must never enter the credential error path.
            if (res.status === 401) throw new HttpError(401);
            return res;
          },
        },
      );
      if (!this.enabled || generation !== this.generation) return { retryAt: 0, failures: 0 };
      const data = schema.safeParse(result.json);
      if (!data.success) throw new InvalidDataError();
      const finished = this.deps.now();
      next = {
        data: data.data as Payloads[K],
        fetchedAt: finished,
        attemptedAt: now,
        retryAt: finished + CACHE_MS,
        failures: 0,
        publishedCheckedAt: checked,
        publishedExpiresAt: expires,
      };
    } catch (error) {
      if (!this.enabled || generation !== this.generation) return { retryAt: 0, failures: 0 };
      const finished = this.deps.now();
      const failures = previous.failures + 1;
      // At least 5 minutes between attempts, including manual refresh, failures and remounts.
      const wait = Math.max(
        CACHE_MS,
        backoffMs(failures),
        error instanceof RateLimitedError ? (error.retryAfterMs ?? 0) : 0,
      );
      next = {
        ...previous,
        attemptedAt: now,
        failures,
        retryAt: finished + wait,
        error:
          error instanceof RateLimitedError
            ? 'rate-limited'
            : error instanceof TimeoutError
              ? 'timeout'
              : error instanceof InvalidDataError
                ? 'invalid'
                : 'unavailable',
      };
      // 401/403 from this public site is a data-source failure, never account auth expiry.
      if (error instanceof HttpError && error.status >= 400 && error.status < 500)
        next.retryAt = finished + 60 * 60_000;
      if (error instanceof RateLimitedError) {
        this.originRetryAt = Math.max(this.originRetryAt, next.retryAt);
        await this.deps.store.setJson(`${PREFIX}retry-at`, this.originRetryAt).catch(() => {});
      }
    } finally {
      unlinkTimeout?.();
      this.controllers.delete(controller);
    }
    this.cache.set(key, next);
    await this.deps.store.setJson(PREFIX + key, next).catch(() => {});
    return next;
  }

  async refresh(): Promise<void> {
    await this.load('forecast');
  }
}

class InvalidDataError extends Error {}
