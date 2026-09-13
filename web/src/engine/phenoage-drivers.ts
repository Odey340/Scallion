/**
 * "What is driving it" for Home: the PhenoAge waterfall rebuilt from a stored clock, by running
 * the same computePhenoAge on the same phenoage.json export — no second formula.
 *
 * A stored clock keeps the nine inputs actually used (imputed ones set to the age-sex reference)
 * plus the list of imputed keys. Passing back only the measured values, with glucose treated as
 * fasting only if it was measured, makes computePhenoAge re-impute exactly the same keys to the
 * same reference values, so the rebuild is identical. It is still checked: if the rebuilt total
 * disagrees with the stored age (e.g. phenoage.json changed since), no drivers are shown.
 */
import { ANALYTES, computePhenoAge, waterfallSum, type AnalyteKey, type PhenoAgeData, type Sex } from './phenoage';

export interface StoredPhenoInputs {
  values: Partial<Record<AnalyteKey, number>>;
  imputed: AnalyteKey[];
}

export interface Driver {
  key: AnalyteKey;
  /** Years this marker adds (+) or subtracts (−) versus the age-sex reference person. */
  years: number;
  imputed: boolean;
}

export interface Drivers {
  /** Years from the reference person's own PhenoAge at this exact age (the waterfall's first step). */
  cohortOffset: number;
  /** All nine markers, largest absolute contribution first. */
  analytes: Driver[];
  /** calendar age + cohort offset + all markers; equals the stored PhenoAge within `tol`. */
  total: number;
}

const isAnalyte = (k: string): k is AnalyteKey => (ANALYTES as readonly string[]).includes(k);

/** Accepts both the /clock row's `inputs` and the local clock's; anything malformed yields null. */
export function parseStoredInputs(inputs: unknown, imputedFallback?: unknown): StoredPhenoInputs | null {
  if (typeof inputs !== 'object' || inputs === null) return null;
  const src = inputs as Record<string, unknown>;
  const values: Partial<Record<AnalyteKey, number>> = {};
  for (const a of ANALYTES) if (typeof src[a] === 'number' && Number.isFinite(src[a])) values[a] = src[a] as number;
  const rawImputed = Array.isArray(src.imputed) ? src.imputed : Array.isArray(imputedFallback) ? imputedFallback : [];
  const imputed = rawImputed.filter((k): k is AnalyteKey => typeof k === 'string' && isAnalyte(k));
  if (Object.keys(values).length === 0) return null;
  return { values, imputed };
}

export function rebuildDrivers(
  stored: StoredPhenoInputs,
  age: number,
  sex: Sex,
  expectedYears: number,
  data: PhenoAgeData,
  tol = 0.05,
): Drivers | null {
  const measured: Partial<Record<AnalyteKey, number>> = {};
  for (const a of ANALYTES) if (!stored.imputed.includes(a) && stored.values[a] !== undefined) measured[a] = stored.values[a];
  let result;
  try {
    result = computePhenoAge(measured, age, sex, data, { fasting: !stored.imputed.includes('glucose') });
  } catch {
    return null;
  }
  const total = waterfallSum(age, result.waterfall);
  if (!Number.isFinite(total) || Math.abs(total - expectedYears) > tol) return null;
  const analytes = ANALYTES.map((key) => ({ key, years: result.waterfall[key], imputed: result.imputed.includes(key) })).sort(
    (a, b) => Math.abs(b.years) - Math.abs(a.years),
  );
  return { cohortOffset: result.waterfall.cohort_offset, analytes, total };
}
