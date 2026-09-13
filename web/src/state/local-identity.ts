import type { Answers } from '@/lib/api';

/**
 * Device-local fallbacks around the real sign-in (src/state/auth-store.ts, Supabase email OTP).
 * Session 17 briefly replaced Supabase with a pretend name+email "sign-in" kept here; the team
 * restored the real one once the Supabase project was configured (docs/log/C.md session 15).
 * What survives: answers saved to this browser when the API can't be reached, and the JWT
 * `sub` decoder used to derive the shared demo account's user id from EXPO_PUBLIC_DEMO_TOKEN.
 */

const ANSWERS_KEY = 'scallion.local_answers';

function readStorage<T>(key: string): T | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private browsing / quota — the app still works, it just won't remember next visit
  }
}

export function saveLocalAnswers(answers: Answers) {
  writeStorage(ANSWERS_KEY, answers);
}

export function loadLocalAnswers(): Answers | null {
  return readStorage<Answers>(ANSWERS_KEY);
}

/** Decodes a JWT's payload without verifying its signature — fine here since it's our own token. */
export function decodeJwtSub(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(base64)) as { sub?: unknown };
    return typeof json.sub === 'string' ? json.sub : null;
  } catch {
    return null;
  }
}
