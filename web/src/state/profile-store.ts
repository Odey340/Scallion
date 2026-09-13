import { useEffect, useState } from 'react';

import type { Answers } from '@/lib/api';
import { loadLocalAnswers } from '@/state/local-identity';

/**
 * The single source of truth for "things Scallion already knows about you" — reused across
 * Start, Scan, Camera, Labs and Onboarding so no screen re-asks a question another screen
 * already answered. Scenario-only values (a specific meal's carbs, a specific glucose photo)
 * stay local to their screen and are never written here.
 *
 * Versioned (`scallion.profile.v1`) so a future field change can migrate forward instead of
 * silently dropping a returning user's data — see `migrate()`.
 */
export interface UserProfile extends Answers {
  age?: number;
  sex?: 'M' | 'F';
  weightLb?: number;
  waistCm?: number;
  restingHr?: number;
  /** HUNT PAI option key (hunt.json's pai_options[].key) — the model input is derived from this. */
  paiKey?: string;
  fastingGlucoseMgdl?: number;
  /**
   * "Prefer not to say" to the blood-sugar medication question. Kept separate from
   * on_glucose_meds so it is never sent to the API as `false`; Scan treats it conservatively
   * (walk-timing advice hidden, same as the CLAUDE.md rule 4 safety gate).
   */
  glucoseMedsDeclined?: boolean;
}

type ProfileField = keyof UserProfile;

const KEY = 'scallion.profile.v1';

let current: UserProfile = load();
const listeners = new Set<() => void>();

function load(): UserProfile {
  let profile: UserProfile = {};
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(KEY);
    if (raw) profile = migrate(JSON.parse(raw) as unknown);
  } catch {
    profile = {};
  }
  // Answers saved before the profile store existed (local sign-in era): fill only the gaps.
  const legacy = loadLocalAnswers();
  if (legacy) {
    const old = migrate(legacy) as Record<string, unknown>;
    const out = profile as Record<string, unknown>;
    for (const k of Object.keys(old)) if (out[k] === undefined) out[k] = old[k];
  }
  return profile;
}

/** Keeps only known fields with plausible types — an old or corrupted blob degrades to {} per field, not a throw. */
function migrate(parsed: unknown): UserProfile {
  if (typeof parsed !== 'object' || parsed === null) return {};
  const src = parsed as Record<string, unknown>;
  const out: UserProfile = {};
  const numberFields: ProfileField[] = ['age', 'weightLb', 'waistCm', 'restingHr', 'fastingGlucoseMgdl', 'sleep_h', 'coffee_mg_per_cup'];
  const boolFields: ProfileField[] = ['on_glucose_meds', 'smoker', 'lonely', 'lives_alone', 'oral_contraceptive', 'glucoseMedsDeclined'];
  for (const f of numberFields) if (typeof src[f] === 'number') (out as Record<string, unknown>)[f] = src[f];
  for (const f of boolFields) if (typeof src[f] === 'boolean') (out as Record<string, unknown>)[f] = src[f];
  if (src.sex === 'M' || src.sex === 'F') out.sex = src.sex;
  if (typeof src.paiKey === 'string') out.paiKey = src.paiKey;
  if (typeof src.bedtime === 'string') out.bedtime = src.bedtime;
  if (typeof src.help_family === 'number') out.help_family = src.help_family as UserProfile['help_family'];
  if (typeof src.help_friends === 'number') out.help_friends = src.help_friends as UserProfile['help_friends'];
  return out;
}

function persist() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // private mode or blocked storage: the module singleton still works for this page load
  }
}

/** Merges the given fields into the profile — never clears a field the caller didn't mention. */
export function updateProfile(patch: Partial<UserProfile>) {
  current = { ...current, ...patch };
  persist();
  listeners.forEach((l) => l());
}

export function updateProfileField<K extends ProfileField>(field: K, value: UserProfile[K]) {
  updateProfile({ [field]: value } as Partial<UserProfile>);
}

export function resetProfile() {
  current = {};
  persist();
  listeners.forEach((l) => l());
}

export function getProfile(): UserProfile {
  return current;
}

export function useProfile(): UserProfile {
  const [, forceRender] = useState(0);
  useEffect(() => {
    const listener = () => forceRender((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return current;
}

/** What each feature needs, so a screen can say *why* it's asking rather than just demanding a field. */
export const PROFILE_REQUIREMENTS = {
  fitnessAge: ['age', 'sex', 'waistCm', 'paiKey'] as ProfileField[],
  mealModel: ['weightLb', 'fastingGlucoseMgdl', 'on_glucose_meds'] as ProfileField[],
  caffeine: ['bedtime', 'coffee_mg_per_cup'] as ProfileField[],
  phenoAge: ['age', 'sex'] as ProfileField[],
};

export function missingFields(requirement: ProfileField[], profile: UserProfile = current): ProfileField[] {
  return requirement.filter((f) => {
    if (f === 'on_glucose_meds' && profile.glucoseMedsDeclined) return false;
    return profile[f] === undefined || profile[f] === null || profile[f] === '';
  });
}

/** The subset of the profile that is the API's `Answers` (contracts.md §3) — nothing else is uploaded. */
export function answersFromProfile(p: UserProfile): Answers {
  const out: Answers = {};
  if (p.on_glucose_meds !== undefined && !p.glucoseMedsDeclined) out.on_glucose_meds = p.on_glucose_meds;
  if (p.sleep_h !== undefined) out.sleep_h = p.sleep_h;
  if (p.smoker !== undefined) out.smoker = p.smoker;
  if (p.lonely !== undefined) out.lonely = p.lonely;
  if (p.lives_alone !== undefined) out.lives_alone = p.lives_alone;
  if (p.oral_contraceptive !== undefined) out.oral_contraceptive = p.oral_contraceptive;
  if (p.help_family !== undefined) out.help_family = p.help_family;
  if (p.help_friends !== undefined) out.help_friends = p.help_friends;
  if (p.bedtime !== undefined) out.bedtime = p.bedtime;
  if (p.coffee_mg_per_cup !== undefined) out.coffee_mg_per_cup = p.coffee_mg_per_cup;
  return out;
}
