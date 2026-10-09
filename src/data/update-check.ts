import { useQuery, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';

import { useServices } from '@/data/hooks';

/**
 * New-version notice: the latest GitHub release of this app against the installed version.
 * Checked at most every few hours; the user can dismiss a version, and that version is never
 * offered again (a newer one is).
 */
export const RELEASES_API = 'https://api.github.com/repos/nextroad-dev/AIUsage/releases/latest';
const DISMISSED_KEY = 'update-dismissed-version';
const CHECK_EVERY_MS = 6 * 3_600_000;

export interface LatestRelease {
  /** without the leading "v", e.g. "1.0.3" */
  version: string;
  url: string;
}

/** Numeric dotted compare: 1 when a > b, -1 when a < b, 0 when equal or not comparable. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.trim().replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map(Number);
  const x = parse(a);
  const y = parse(b);
  if ([...x, ...y].some((n) => !Number.isFinite(n))) return 0;
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Latest published (non-draft, non-prerelease) release, or undefined when it cannot be read. */
export async function fetchLatestRelease(
  doFetch: typeof fetch,
): Promise<LatestRelease | undefined> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await doFetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      tag_name?: unknown;
      html_url?: unknown;
      draft?: unknown;
      prerelease?: unknown;
    };
    if (json.draft === true || json.prerelease === true) return undefined;
    if (typeof json.tag_name !== 'string' || typeof json.html_url !== 'string') return undefined;
    return { version: json.tag_name.replace(/^v/i, ''), url: json.html_url };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** The release to offer, if it is newer than this build and has not been dismissed. */
export function pickNotice(
  latest: LatestRelease | undefined,
  installed: string | undefined,
  dismissed: string | null,
): LatestRelease | undefined {
  if (!latest || !installed) return undefined;
  if (compareVersions(latest.version, installed) <= 0) return undefined;
  if (dismissed && compareVersions(latest.version, dismissed) <= 0) return undefined;
  return latest;
}

export function useUpdateNotice(): { notice?: LatestRelease; dismiss: () => void } {
  const services = useServices().data;
  const qc = useQueryClient();
  const latest = useQuery({
    queryKey: ['latestRelease'],
    queryFn: () => fetchLatestRelease((...a) => fetch(...a)),
    staleTime: CHECK_EVERY_MS,
    retry: false,
  });
  const dismissed = useQuery({
    queryKey: ['updateDismissed'],
    queryFn: () => services!.repos.settings.get(DISMISSED_KEY),
    enabled: !!services,
  });
  // decide only once the dismissed version is known, so a dismissed notice never flashes
  const notice = dismissed.isSuccess
    ? pickNotice(latest.data, Constants.expoConfig?.version, dismissed.data ?? null)
    : undefined;
  return {
    notice,
    dismiss: () => {
      if (!notice || !services) return;
      qc.setQueryData(['updateDismissed'], notice.version);
      void services.repos.settings.set(DISMISSED_KEY, notice.version);
    },
  };
}
