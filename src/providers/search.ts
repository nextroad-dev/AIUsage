import type { ProviderMeta } from '@/providers/registry';

const fold = (s: string) => s.toLowerCase().replace(/[\s\-_/().]+/g, '');

/**
 * Providers whose name, displayed (translated) name or id contains the query, ignoring case,
 * spaces and punctuation.
 */
export function matchProviders(
  list: ProviderMeta[],
  query: string,
  displayName: (p: ProviderMeta) => string = (p) => p.name,
): ProviderMeta[] {
  const q = fold(query);
  if (!q) return list;
  return list.filter(
    (p) => fold(p.name).includes(q) || fold(displayName(p)).includes(q) || fold(p.id).includes(q),
  );
}
