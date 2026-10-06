// Shared helpers: HTTP with timeout, response shape redaction, Meter constructors.

export async function http(url, { method = "GET", headers = {}, body, timeoutMs = 10000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return {
      status: res.status,
      ok: res.ok,
      ms: Date.now() - started,
      retryAfter: res.headers.get("retry-after"),
      json,
      text: json === undefined ? text.slice(0, 300) : undefined,
    };
  } finally {
    clearTimeout(timer);
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}T/;

/** Describe a JSON value without leaking content: keys + types; numbers/booleans/ISO dates kept, other strings masked. */
export function shape(v, depth = 0) {
  if (v === null) return null;
  if (Array.isArray(v)) {
    if (v.length === 0) return [];
    const head = v.slice(0, 2).map((x) => shape(x, depth + 1));
    return v.length > 2 ? [...head, `…(+${v.length - 2} more)`] : head;
  }
  switch (typeof v) {
    case "number":
    case "boolean":
      return v;
    case "string":
      return ISO.test(v) ? v : `<string:${v.length}>`;
    case "object": {
      if (depth > 6) return "<deep>";
      const out = {};
      for (const [k, x] of Object.entries(v)) out[k] = shape(x, depth + 1);
      return out;
    }
    default:
      return `<${typeof v}>`;
  }
}

// ---- Meter model (mirrors docs/technical-design.md §4) ----

export const percent = (id, label, used, resetsAt, scope = { type: "overall" }) => ({
  id, label, scope, resetsAt, kind: { type: "percent", used },
});
export const amount = (id, label, used, limit, unit, resetsAt, scope = { type: "overall" }) => ({
  id, label, scope, resetsAt, kind: { type: "amount", used, limit, unit },
});
export const balance = (id, label, value, unit) => ({
  id, label, scope: { type: "overall" }, kind: { type: "balance", value, unit },
});

export const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);

/** unix seconds / ms / ISO -> ISO string */
export function toIso(x) {
  if (x == null) return undefined;
  if (typeof x === "string") {
    const d = new Date(x);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  if (typeof x === "number") {
    const ms = x > 1e12 ? x : x * 1000;
    return new Date(ms).toISOString();
  }
  return undefined;
}

export class MissingEnvError extends Error {}
export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new MissingEnvError(`missing env ${name}`);
  return v;
}
