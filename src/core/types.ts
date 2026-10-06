// Domain model. See docs/technical-design.md §4–§5.

export type MeterKind =
  | { type: 'percent'; used: number } // 0..100, only the ratio is known
  | { type: 'amount'; used: number; limit?: number; unit: string }
  | { type: 'balance'; value: number; unit: string };

export type MeterScope = { type: 'overall' } | { type: 'model'; name: string };

export interface Meter {
  /** "session" | "weekly" | "monthly" | "credits" | ... (stable within a provider) */
  id: string;
  label: string;
  kind: MeterKind;
  scope: MeterScope;
  /** ISO timestamp of the next reset; drives the countdown */
  resetsAt?: string;
}

export type SnapshotStatus =
  | { type: 'ok' }
  | { type: 'manual' }
  | { type: 'stale' }
  | { type: 'authExpired' }
  | { type: 'unsupported' }
  | { type: 'error'; message: string };

export interface UsageSnapshot {
  providerId: string;
  accountId: string;
  plan?: string;
  /** ISO time the paid plan renews or runs out, when the provider reports it */
  renewsAt?: string;
  fetchedAt: string;
  meters: Meter[];
  status: SnapshotStatus;
}

export type AuthMethod =
  | 'apiKey'
  | 'oauthPkce'
  | 'deviceCode'
  | 'webviewSession' // in-app WebView login, cookies/localStorage captured
  | 'manual';

export type Credential =
  | { type: 'apiKey'; key: string }
  | {
      type: 'oauth';
      accessToken: string;
      refreshToken?: string;
      /** epoch ms */
      expiresAt?: number;
      accountId?: string;
      /** epoch ms the paid subscription is active until (from the sign-in identity claims) */
      subscriptionUntil?: number;
    }
  | { type: 'session'; cookies?: Record<string, string>; storage?: Record<string, string> };

export interface FetchContext {
  fetch: typeof fetch;
  now: () => Date;
  /** variant key, e.g. "intl" | "cn" */
  region?: string;
}

export interface ProviderPlugin {
  id: string;
  fetchUsage(accountId: string, cred: Credential, ctx: FetchContext): Promise<UsageSnapshot>;
  /** Optional: refresh an expiring credential. Must return the new credential, never mutate. */
  refresh?(cred: Credential, ctx: FetchContext): Promise<Credential>;
}
