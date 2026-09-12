/**
 * A random per-browser salt used to hash contact handles before anything leaves the device
 * (docs/contracts.md §2: `contact = sha256(normalized handle + salt)`). Generated once, kept
 * only in this browser's localStorage, and never sent anywhere. Web-only: on native, message
 * ingest isn't wired up yet (the web export is the demo surface — see CLAUDE.md Stack).
 */
const SALT_KEY = 'scallion.device_salt.v1';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function getOrCreateDeviceSalt(): string {
  const existing = localStorage.getItem(SALT_KEY);
  if (existing) return existing;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const salt = toHex(bytes);
  localStorage.setItem(SALT_KEY, salt);
  return salt;
}

export function clearDeviceSalt(): void {
  localStorage.removeItem(SALT_KEY);
}
