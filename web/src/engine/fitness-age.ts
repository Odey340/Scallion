/**
 * Fitness age from HUNT's VO2max model, per web/public/engine/hunt.json (Lane A's export).
 * Units assumed metric (waist cm, resting HR bpm) — not stated explicitly in hunt.json;
 * HUNT is a Norwegian cohort and the rest of the contract defaults to SI. Confirm with A.
 */

export type Sex = 'M' | 'F';

interface Vo2maxCoefficients {
  intercept: number;
  age: number;
  waist: number;
  rhr: number;
  pai: number;
  /** Standard error of the estimate, in the same VO2max units. Used to derive the fitness-age band. */
  see?: number;
}

export interface PaiOption {
  key: string;
  label: string;
  pai: number;
}

export interface HuntData {
  vo2max: Record<Sex, Partial<Vo2maxCoefficients>>;
  fitness_age_lookup: Record<Sex, [age: number, vo2max: number][]>;
  pai_options?: PaiOption[];
  vo2max_source?: string;
  pai_source?: string;
  label?: string;
}

export interface FitnessAgeInput {
  age: number;
  sex: Sex;
  waistCm: number;
  rhr: number;
  /** HUNT Physical Activity Index — pick a value from hunt.json's `pai_options`. */
  pai: number;
}

export interface FitnessAgeResult {
  vo2max: number;
  fitnessAge: number;
  /** +/- years, derived from the model's standard error where hunt.json provides one. */
  band: number;
}

/** Placeholder only for hunt.json shapes that predate `pai_options` (contracts.md §1's minimal example). */
export const FALLBACK_PAI_OPTIONS: PaiOption[] = [
  { key: 'none', label: 'Rarely or never', pai: 0 },
  { key: 'light', label: '1-2 days a week', pai: 25 },
  { key: 'moderate', label: '3-4 days a week', pai: 55 },
  { key: 'hard', label: '5+ days a week', pai: 85 },
];

export function computeFitnessAge(input: FitnessAgeInput, hunt: HuntData): FitnessAgeResult {
  const coef = hunt.vo2max[input.sex];
  if (
    coef.intercept === undefined ||
    coef.age === undefined ||
    coef.waist === undefined ||
    coef.rhr === undefined ||
    coef.pai === undefined
  ) {
    throw new Error(`hunt.json has no vo2max coefficients for sex "${input.sex}"`);
  }

  const vo2max =
    coef.intercept + coef.age * input.age + coef.waist * input.waistCm + coef.rhr * input.rhr + coef.pai * input.pai;

  const lookup = hunt.fitness_age_lookup[input.sex];
  const fitnessAge = fitnessAgeFromVo2max(vo2max, lookup);
  const band = coef.see !== undefined ? bandFromSee(vo2max, coef.see, lookup) : 3;

  return { vo2max, fitnessAge, band };
}

/** VO2max falls with age in the lookup table; find the age whose median VO2max equals `vo2max`, interpolating linearly. */
function fitnessAgeFromVo2max(vo2max: number, lookup: [number, number][]): number {
  if (lookup.length === 0) {
    throw new Error('hunt.json fitness_age_lookup is empty for this sex');
  }

  const sorted = [...lookup].sort((a, b) => a[0] - b[0]); // ascending age, descending vo2max
  const youngest = sorted[0];
  const oldest = sorted[sorted.length - 1];

  if (vo2max >= youngest[1]) return youngest[0];
  if (vo2max <= oldest[1]) return oldest[0];

  for (let i = 0; i < sorted.length - 1; i++) {
    const [ageA, vo2A] = sorted[i];
    const [ageB, vo2B] = sorted[i + 1];
    if (vo2max <= vo2A && vo2max >= vo2B) {
      const t = (vo2A - vo2max) / (vo2A - vo2B);
      return ageA + t * (ageB - ageA);
    }
  }

  return oldest[0];
}

/** Converts the regression's VO2max standard error into an age-equivalent +/- band via the lookup curve's local slope. */
function bandFromSee(vo2max: number, see: number, lookup: [number, number][]): number {
  const ageAtPlus = fitnessAgeFromVo2max(vo2max + see, lookup);
  const ageAtMinus = fitnessAgeFromVo2max(vo2max - see, lookup);
  return Math.abs(ageAtMinus - ageAtPlus) / 2;
}
