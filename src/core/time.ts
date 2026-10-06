/** unix seconds | unix ms | ISO string -> ISO string (undefined if not a valid time) */
export function toIso(x: unknown): string | undefined {
  if (x == null || x === '') return undefined;
  if (typeof x === 'string') {
    if (/^\d+(\.\d+)?$/.test(x.trim())) return toIso(Number(x));
    const d = new Date(x);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof x === 'number' && Number.isFinite(x)) {
    const ms = x > 1e12 ? x : x * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return undefined;
}
