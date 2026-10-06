/** Minimal path access: "a.b[0].c". Empty path returns the value itself. */
export function getPath(value: unknown, path: string): unknown {
  if (path === '' || path === '$') return value;
  const segs = path.match(/[^.[\]]+/g) ?? [];
  let cur: unknown = value;
  for (const s of segs) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[s];
  }
  return cur;
}
