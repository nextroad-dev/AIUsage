/** Ids are not secrets; they only need to be unique and keychain-safe. */
export function newId(): string {
  const rand = Math.floor(Math.random() * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
  return `acc-${Date.now().toString(36)}-${rand}`;
}
