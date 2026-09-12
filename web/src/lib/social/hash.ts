import { sha256 } from 'js-sha256';

function normalize(handle: string): string {
  return handle.trim().toLowerCase();
}

/** contact = sha256(normalized handle + user salt) — per docs/contracts.md §2. */
export function hashContact(handle: string, salt: string): string {
  return sha256(normalize(handle) + salt);
}
