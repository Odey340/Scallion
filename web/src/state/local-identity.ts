import { useEffect, useState } from 'react';

import type { Answers } from '@/lib/api';

/**
 * Replaces Supabase auth entirely (human decision: Supabase's email-link flow kept landing on an
 * inaccessible localhost redirect, needed dashboard access nobody could give it, and was overkill
 * for a hackathon demo). This is a deliberately fake "sign-in": a name + email, no verification,
 * a random id generated once and kept in localStorage. It is NOT a real account and never claims
 * to be one — it exists so the app can personalize itself and gate "save my answers" without
 * fighting a real auth provider's configuration.
 *
 * Persona verification stays genuinely functional (see onboarding.tsx): it's Persona's own hosted
 * flow, independent of how the local user id was produced. If EXPO_PUBLIC_DEMO_TOKEN (a real,
 * pre-obtained Supabase JWT for one shared demo account) is configured, the app additionally uses
 * that account's real user id for Persona's reference-id and for saving answers to the real API —
 * see personaReferenceId()/canUseRealApi() in onboarding.tsx. Without it, everything here still
 * works, just locally: answers save to this browser, and Persona's flow can be exercised end to
 * end but the app can't ask the real API to confirm the result.
 */

export interface LocalUser {
  id: string;
  name: string;
  email: string;
}

const USER_KEY = 'scallion.local_user';
const ANSWERS_KEY = 'scallion.local_answers';

const listeners = new Set<() => void>();

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

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function signIn(name: string, email: string): LocalUser {
  const user: LocalUser = { id: randomId(), name: name.trim(), email: email.trim() };
  writeStorage(USER_KEY, user);
  listeners.forEach((l) => l());
  return user;
}

export function signOut() {
  writeStorage(USER_KEY, null);
  listeners.forEach((l) => l());
}

export function useLocalUser(): LocalUser | null {
  const [user, setUser] = useState<LocalUser | null>(() => readStorage<LocalUser>(USER_KEY));

  useEffect(() => {
    const listener = () => setUser(readStorage<LocalUser>(USER_KEY));
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return user;
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
