import type { FetchContext } from '@/core/types';

export interface FakeRoute {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

/** fetch stub keyed by URL (exact match). Unknown URLs return 404. Records requests. */
export function fakeFetch(routes: Record<string, FakeRoute>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: { ...(init?.headers as Record<string, string>) } });
    const r = routes[url];
    if (!r) return new Response('not found', { status: 404 });
    const body = r.text ?? (r.json === undefined ? '' : JSON.stringify(r.json));
    return new Response(body, { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch;
  return { fetch: impl, calls };
}

export const NOW = new Date('2026-10-06T12:00:00.000Z');

export function ctxWith(f: typeof fetch, region?: string): FetchContext {
  return { fetch: f, now: () => NOW, region };
}
