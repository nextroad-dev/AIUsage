/** Decode a JWT payload without verifying it (we only read our own tokens' claims). */
export function jwtClaims(token: string): Record<string, unknown> | undefined {
  const part = token.split('.')[1];
  if (!part) return undefined;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(globalThis.atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** `exp` claim in epoch milliseconds. */
export function jwtExpiryMs(token: string): number | undefined {
  const exp = jwtClaims(token)?.exp;
  return typeof exp === 'number' ? exp * 1000 : undefined;
}
