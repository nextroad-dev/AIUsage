import { getPath } from './path';
import { toIso } from './time';

/**
 * Tiny value-expression language used by declarative provider specs.
 *  - string: path into the current item (or into the response root when prefixed "$root.")
 *  - number: literal
 *  - { sub|add|mul|div: [a, b] }, { coalesce: [a, b, ...] }
 */
export type Expr =
  | string
  | number
  | { sub: [Expr, Expr] }
  | { add: [Expr, Expr] }
  | { mul: [Expr, Expr] }
  | { div: [Expr, Expr] }
  | { coalesce: Expr[] };

export interface Scope {
  root: unknown;
  item: unknown;
}

function raw(expr: Expr, scope: Scope): unknown {
  if (typeof expr === 'number') return expr;
  if (typeof expr === 'string') {
    return expr.startsWith('$root.')
      ? getPath(scope.root, expr.slice(6))
      : getPath(scope.item, expr);
  }
  return evalNum(expr, scope);
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function evalNum(expr: Expr, scope: Scope): number | undefined {
  if (typeof expr === 'number' || typeof expr === 'string') return toNumber(raw(expr, scope));
  if ('coalesce' in expr) {
    for (const e of expr.coalesce) {
      const v = evalNum(e, scope);
      if (v !== undefined) return v;
    }
    return undefined;
  }
  const op = Object.keys(expr)[0] as 'sub' | 'add' | 'mul' | 'div';
  const [a, b] = (expr as Record<string, [Expr, Expr]>)[op].map((e) => evalNum(e, scope));
  if (a === undefined || b === undefined) return undefined;
  switch (op) {
    case 'sub':
      return a - b;
    case 'add':
      return a + b;
    case 'mul':
      return a * b;
    case 'div':
      return b === 0 ? undefined : a / b;
  }
}

export function evalString(expr: Expr, scope: Scope): string | undefined {
  const v = raw(expr, scope);
  return typeof v === 'string' ? v : undefined;
}

export function evalTime(expr: Expr, scope: Scope): string | undefined {
  return toIso(raw(expr, scope));
}
