import type { UserProfile } from '@/state/profile-store';

/**
 * Scan's inputs split into two kinds: this meal's scenario (carbs — never saved) and profile
 * facts (weight, fasting glucose, medication, usual cup, bedtime). This decides which profile
 * facts differ from what's saved, and whether saving them should be the default.
 */

export const SCAN_PROFILE_FIELDS = ['weightLb', 'fastingGlucoseMgdl', 'on_glucose_meds', 'coffee_mg_per_cup', 'bedtime'] as const;
export type ScanProfileField = (typeof SCAN_PROFILE_FIELDS)[number];

export type ScanProfileValues = Partial<Pick<UserProfile, ScanProfileField>>;

export interface ScanProfileDiff {
  /** Fields whose value for this meal differs from the saved profile (including not-yet-saved). */
  changed: ScanProfileField[];
  /** Subset of `changed` that would replace a value the profile already has. */
  overwrites: ScanProfileField[];
  /**
   * First-time entries save by default (otherwise the user retypes them every meal); edits to an
   * already-saved value default to "just this meal", so one unusual meal never silently rewrites
   * the profile.
   */
  defaultSave: boolean;
}

export function diffScanProfile(values: ScanProfileValues, profile: UserProfile): ScanProfileDiff {
  const changed: ScanProfileField[] = [];
  const overwrites: ScanProfileField[] = [];
  for (const field of SCAN_PROFILE_FIELDS) {
    const next = values[field];
    if (next === undefined) continue;
    // "Prefer not to say" is a saved answer too, so answering Yes/No here replaces it.
    const saved = field === 'on_glucose_meds' && profile.glucoseMedsDeclined ? 'declined' : profile[field];
    if (saved === next) continue;
    changed.push(field);
    if (saved !== undefined) overwrites.push(field);
  }
  return { changed, overwrites, defaultSave: overwrites.length === 0 };
}

export function pickChanged(values: ScanProfileValues, changed: ScanProfileField[]): ScanProfileValues {
  const out: ScanProfileValues = {};
  for (const field of changed) (out as Record<string, unknown>)[field] = values[field];
  return out;
}
