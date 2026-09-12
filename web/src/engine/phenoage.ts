/**
 * PhenoAge (Levine 2018) — a TypeScript port of Lane A's `matlab/engine/phenoage.m`.
 *
 * Every constant comes from `web/public/engine/phenoage.json` (A's export). Nothing here
 * re-derives a coefficient; the file is read and evaluated. The port must reproduce
 * `matlab/tests/vectors.json` to within 0.05 years (see `phenoage.test.ts`).
 *
 * Model (phenoage_constants.m):
 *   xb       = intercept + sum(coef_i * term_i) + coef_age * age,  term_crp = ln(max(crp, floor))
 *   M        = 1 - exp(-exp(xb) * (exp(t_months * gamma) - 1) / gamma)     (10-year mortality)
 *   PhenoAge = offset + ln(-a * ln(1 - M)) / k  ==  A + xb / k               (affine in xb)
 *
 * The affine form gives an exact per-analyte waterfall:
 *   age + cohort_offset + sum(analyte years) == phenoage
 * where cohort_offset = PhenoAge(reference person, age) - age at the user's exact age and
 * each analyte's years are coef * (term(x) - term(reference)) / k.
 */

export type Sex = 'M' | 'F';

export const ANALYTES = [
  'albumin',
  'creatinine',
  'glucose',
  'crp',
  'lymph_pct',
  'mcv',
  'rdw',
  'alp',
  'wbc',
] as const;
export type AnalyteKey = (typeof ANALYTES)[number];

type AnalyteRecord = Record<AnalyteKey, number>;
type BandTable = Record<Sex, Record<string, AnalyteRecord>>;

/** The shape of `phenoage.json` (contracts.md section 1 plus A's v8 additive keys). */
export interface PhenoAgeData {
  version: number;
  source?: string;
  units: Record<AnalyteKey | 'age', string>;
  coefficients: Record<Exclude<AnalyteKey, 'crp'> | 'ln_crp' | 'age', number>;
  intercept: number;
  gamma: number;
  t_months: number;
  k: number;
  a?: number;
  offset?: number;
  affine?: { A: number; rule?: string };
  crp_floor_mgdL: number;
  crp_acute_mgdL: number;
  reference_by_age_sex: BandTable;
  imputation_sd_by_age_sex: BandTable;
  cohort_offset_by_age_sex?: Record<Sex, Record<string, number>>;
  cv: Record<AnalyteKey, { within: number; analytical: number }>;
  critical_ranges: { glucose_mgdL: [number, number]; wbc: [number, number]; creatinine_x_ref_high: number };
  creatinine_ref_high_default_umolL?: number;
  labels?: { estimate?: string; critical?: string; imputed?: string };
}

/** Lab values in `phenoage.json` units (the API's `si_value`). Missing, null, or NaN entries are imputed. */
export type PhenoAgeValues = Partial<Record<AnalyteKey, number | null | undefined>>;

export interface PhenoAgeOptions {
  /** true = fasting. false or null/undefined (unknown) treats glucose as non-fasting: imputed, "8 of 9 markers". */
  fasting?: boolean | null;
  /** The report's upper reference limit for creatinine (umol/L), for the "2 x ref high" critical rule. */
  creatinineRefHigh?: number | null;
}

export interface PhenoAgeFlags {
  critical: boolean;
  criticalAnalytes: AnalyteKey[];
  crpAcute: boolean;
  nonFasting: boolean;
}

export type Waterfall = { cohort_offset: number } & AnalyteRecord;

export interface PhenoAgeResult {
  /** Years; null when a critical flag suppresses the number ("see a clinician first"). */
  phenoage: number | null;
  /** The non-affine route (mortality score -> age), for self-checks. Equals `phenoage` to 1e-9. */
  phenoageDirect: number | null;
  /** +/- years, 1 SD. Imputed analytes contribute the population SD, so the band widens. */
  band: number;
  waterfall: Waterfall;
  /** The nine inputs actually used, after imputation. */
  inputs: AnalyteRecord;
  imputed: AnalyteKey[];
  markersUsed: number;
  flags: PhenoAgeFlags;
  xb: number;
  mortality10y: number;
  age: number;
  sex: Sex;
  ageBand: string;
  /** "Estimate, not diagnosis", or the critical label from phenoage.json. */
  label: string;
}

/** Glucose unit conversion for the critical-range check only (mg/dL per mmol/L). Not a model coefficient. */
const MGDL_PER_MMOL_GLUCOSE = 18.016;

const DEFAULT_LABELS = { estimate: 'Estimate, not diagnosis', critical: 'See a clinician first', imputed: '8 of 9 markers' };

/**
 * Map an age to the NHANES norm band label used as a key in `reference_by_age_sex`
 * ('20-29' ... '70-79', '80+'). Ages under 20 use the lowest band (PhenoAge is an adult clock).
 */
export function ageBand(age: number, data: PhenoAgeData): string {
  const labels = Object.keys(data.reference_by_age_sex.M ?? data.reference_by_age_sex.F ?? {});
  const bands = labels
    .map((label) => {
      const open = label.endsWith('+');
      const [lo, hi] = open ? [Number(label.slice(0, -1)), Infinity] : label.split('-').map(Number);
      return { label, lo, hi: open ? hi : hi + 1 }; // '30-39' covers [30, 40)
    })
    .filter((b) => Number.isFinite(b.lo))
    .sort((a, b) => a.lo - b.lo);
  if (bands.length === 0) throw new Error('phenoage.json has no age bands');
  const a = Math.max(age, bands[0].lo);
  const hit = bands.find((b) => a >= b.lo && a < b.hi) ?? bands[bands.length - 1];
  return hit.label;
}

/** PhenoAge = A + xb / k. Prefer A's exported `affine.A`; otherwise derive it from the same constants. */
function affineA(data: PhenoAgeData): number {
  if (data.affine?.A !== undefined) return data.affine.A;
  if (data.a === undefined || data.offset === undefined) {
    throw new Error('phenoage.json needs affine.A or (a, offset)');
  }
  const logTerm = Math.log(data.a) + Math.log((Math.exp(data.t_months * data.gamma) - 1) / data.gamma);
  return data.offset + logTerm / data.k;
}

function coefficient(a: AnalyteKey, data: PhenoAgeData): number {
  return a === 'crp' ? data.coefficients.ln_crp : data.coefficients[a];
}

/** One term coef_i * f(x_i); CRP is floored, then logged. */
function modelTerm(a: AnalyteKey, value: number, data: PhenoAgeData): number {
  if (a === 'crp') return data.coefficients.ln_crp * Math.log(Math.max(value, data.crp_floor_mgdL));
  return data.coefficients[a] * value;
}

function linearPredictor(x: AnalyteRecord, age: number, data: PhenoAgeData): number {
  let xb = data.intercept + data.coefficients.age * age;
  for (const a of ANALYTES) xb += modelTerm(a, x[a], data);
  return xb;
}

function isMeasured(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function computePhenoAge(
  values: PhenoAgeValues,
  age: number,
  sex: Sex,
  data: PhenoAgeData,
  opts: PhenoAgeOptions = {},
): PhenoAgeResult {
  if (sex !== 'M' && sex !== 'F') throw new Error("sex must be 'M' or 'F'");
  if (!Number.isFinite(age)) throw new Error('age must be a number');
  const fasting = opts.fasting === true;
  const band = ageBand(age, data);
  const ref = data.reference_by_age_sex[sex]?.[band];
  const sdp = data.imputation_sd_by_age_sex[sex]?.[band];
  if (!ref || !sdp) throw new Error(`phenoage.json has no norms for ${sex} ${band}`);
  const labels = { ...DEFAULT_LABELS, ...(data.labels ?? {}) };

  // 1. Assemble the nine inputs, imputing where needed.
  const x = {} as AnalyteRecord;
  const imputed: AnalyteKey[] = [];
  const flags: PhenoAgeFlags = { critical: false, criticalAnalytes: [], crpAcute: false, nonFasting: false };
  for (const a of ANALYTES) {
    const v = values[a];
    let have = isMeasured(v);
    if (a === 'glucose' && have && !fasting) {
      have = false; // non-fasting (or unknown) glucose is imputed, greyed, "8 of 9 markers"
      flags.nonFasting = true;
    }
    if (have) {
      x[a] = v as number;
    } else {
      x[a] = ref[a];
      imputed.push(a);
    }
  }
  const measured = (a: AnalyteKey) => !imputed.includes(a);
  flags.crpAcute = measured('crp') && x.crp > data.crp_acute_mgdL;

  // 2. Critical ranges: suppress the number, "see a clinician first".
  const crit: AnalyteKey[] = [];
  const glucoseMgdl = x.glucose * MGDL_PER_MMOL_GLUCOSE;
  const [gLo, gHi] = data.critical_ranges.glucose_mgdL;
  if (measured('glucose') && (glucoseMgdl < gLo || glucoseMgdl > gHi)) crit.push('glucose');
  const [wLo, wHi] = data.critical_ranges.wbc;
  if (measured('wbc') && (x.wbc < wLo || x.wbc > wHi)) crit.push('wbc');
  const creatinineRefHigh =
    isMeasured(opts.creatinineRefHigh) && opts.creatinineRefHigh > 0
      ? opts.creatinineRefHigh
      : (data.creatinine_ref_high_default_umolL ?? 110);
  if (measured('creatinine') && x.creatinine > data.critical_ranges.creatinine_x_ref_high * creatinineRefHigh) {
    crit.push('creatinine');
  }
  flags.critical = crit.length > 0;
  flags.criticalAnalytes = crit;

  // 3. Linear predictor, both routes.
  const A = affineA(data);
  const xb = linearPredictor(x, age, data);
  const paAffine = A + xb / data.k;
  const mortality = 1 - Math.exp((-Math.exp(xb) * (Math.exp(data.t_months * data.gamma) - 1)) / data.gamma);
  const paDirect =
    data.a !== undefined && data.offset !== undefined
      ? data.offset + Math.log(-data.a * Math.log(1 - mortality)) / data.k
      : paAffine;

  // 4. Waterfall: years relative to the age-sex reference person, at the user's exact age.
  const xbRef = linearPredictor(ref, age, data);
  const waterfall = { cohort_offset: A + xbRef / data.k - age } as Waterfall;
  for (const a of ANALYTES) waterfall[a] = (modelTerm(a, x[a], data) - modelTerm(a, ref[a], data)) / data.k;

  // 5. Band: 1 SD from CV (measured) or the population SD of the term (imputed).
  let variance = 0;
  for (const a of ANALYTES) {
    const dydx = coefficient(a, data) / data.k; // years per unit of the model term
    let sdTerm: number;
    if (measured(a)) {
      const cv = data.cv[a];
      const cvTotal = Math.hypot(cv.within, cv.analytical);
      sdTerm = a === 'crp' ? cvTotal : cvTotal * x[a]; // d(ln x) = dx / x
    } else {
      sdTerm = sdp[a];
    }
    variance += (dydx * sdTerm) ** 2;
  }

  // 6. Output.
  return {
    phenoage: flags.critical ? null : paAffine,
    phenoageDirect: flags.critical ? null : paDirect,
    band: Math.sqrt(variance),
    waterfall,
    inputs: x,
    imputed,
    markersUsed: ANALYTES.length - imputed.length,
    flags,
    xb,
    mortality10y: mortality,
    age,
    sex,
    ageBand: band,
    label: flags.critical ? labels.critical : labels.estimate,
  };
}

/** age + cohort_offset + sum(analyte years); equals `phenoage` to floating point when not suppressed. */
export function waterfallSum(age: number, waterfall: Waterfall): number {
  let s = age + waterfall.cohort_offset;
  for (const a of ANALYTES) s += waterfall[a];
  return s;
}
