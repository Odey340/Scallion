/**
 * Quick-choice options for profile questions, shared by Onboarding and Scan so the two can never
 * disagree. These are input conveniences, not model outputs: each maps to the exact value the
 * engines/API already accept, and every assumption is shown to the user next to the choice.
 */

/** Typical caffeine per serving, USDA FoodData Central values. Real cups vary; "Custom" takes an exact number. */
export const CAFFEINE_SOURCE = 'Typical values, USDA FoodData Central. Real cups vary.';

export const CUP_PRESETS = [
  { key: 'tea', label: 'Tea', detail: '8 oz · ~47 mg', mg: 47 },
  { key: 'espresso', label: 'Espresso', detail: '1 shot · ~63 mg', mg: 63 },
  { key: 'coffee', label: 'Coffee, regular', detail: '8 oz · ~95 mg', mg: 95 },
  { key: 'coffee_large', label: 'Coffee, large', detail: '16 oz · ~190 mg', mg: 190 },
] as const;

export function cupLabel(mg: number): string {
  const preset = CUP_PRESETS.find((p) => p.mg === mg);
  return preset ? `${preset.label} · ${mg} mg` : `${mg} mg`;
}

/** Stored as "HH:MM" (contracts.md §3 `bedtime`); the caffeine engine needs an exact clock time. */
export const BEDTIME_PRESETS = ['21:30', '22:00', '22:30', '23:00', '23:30', '00:00'] as const;

export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function isValidClock(text: string): boolean {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return false;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

export function normalizeClock(text: string): string {
  const [h, m] = text.trim().split(':');
  return `${h.padStart(2, '0')}:${m}`;
}

/**
 * Sleep bins line up with the only thresholds the risk table uses (sleep_h < 6, sleep_h > 9 —
 * Cappuccio 2010, contracts.md §1), so a bin's representative value always lands on the same side
 * of each threshold as any exact answer inside that bin would.
 */
export const SLEEP_BINS = [
  { key: 'under6', label: 'Under 6 h', hours: 5.5 },
  { key: '6to7', label: '6–7 h', hours: 6.5 },
  { key: '7to8', label: '7–8 h', hours: 7.5 },
  { key: '8to9', label: '8–9 h', hours: 8.5 },
  { key: 'over9', label: 'Over 9 h', hours: 9.5 },
] as const;

export function sleepLabel(hours: number): string {
  const bin = SLEEP_BINS.find((b) => b.hours === hours);
  return bin ? bin.label : `${hours} h`;
}

/**
 * LSNS-6 (Lubben 2006) response scale. The stored value is the response CODE, not a head count:
 * api/app/circle/metrics.py sums these codes directly, so "5" must mean "nine or more", never "five".
 */
export const LSNS_RESPONSES = [
  { code: 0, label: 'None' },
  { code: 1, label: 'One' },
  { code: 2, label: 'Two' },
  { code: 3, label: 'Three or four' },
  { code: 4, label: 'Five to eight' },
  { code: 5, label: 'Nine or more' },
] as const;

export type LsnsCode = (typeof LSNS_RESPONSES)[number]['code'];

export function lsnsLabel(code: number): string {
  return LSNS_RESPONSES.find((r) => r.code === code)?.label ?? String(code);
}
