/**
 * The TypeScript PhenoAge port must reproduce Lane A's MATLAB engine.
 * Reference: matlab/tests/vectors.json (written by matlab/tests/make_vectors.m from phenoage.m);
 * the checks mirror matlab/tests/test_phenoage.m. Run: npm test (vitest).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ANALYTES, ageBand, computePhenoAge, waterfallSum, type AnalyteKey, type PhenoAgeData, type Sex } from './phenoage';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(resolve(here, '../../public/engine/phenoage.json'), 'utf8')) as PhenoAgeData;

interface Vector {
  name: string;
  age: number;
  sex: Sex;
  fasting: boolean;
  values: Partial<Record<AnalyteKey, number>>;
  phenoage: number;
  band: number;
  waterfall: Record<'cohort_offset' | AnalyteKey, number>;
  imputed: AnalyteKey[];
  markers_used: number;
  xb: number;
  mortality_10y: number;
}
const vectors = JSON.parse(readFileSync(resolve(here, '../../../matlab/tests/vectors.json'), 'utf8')) as Vector[];

const TOL_YEARS = 0.05; // the contract's tolerance (docs/contracts.md section 1)
const ref34M = vectors[0];

describe('phenoage.json', () => {
  it('is the real export, not the contract placeholder', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(4);
    expect(data.k).toBeCloseTo(0.090165, 6);
    expect(data.t_months).toBe(120);
    for (const sex of ['M', 'F'] as const) {
      expect(Object.keys(data.reference_by_age_sex[sex]).length).toBeGreaterThanOrEqual(7);
      for (const band of Object.keys(data.reference_by_age_sex[sex])) {
        for (const a of ANALYTES) {
          expect(data.reference_by_age_sex[sex][band][a]).toBeTypeOf('number');
          expect(data.imputation_sd_by_age_sex[sex][band][a]).toBeTypeOf('number');
        }
      }
    }
  });
});

describe('reference vectors (matlab/tests/vectors.json)', () => {
  for (const v of vectors) {
    it(`${v.name}: phenoage, band and every waterfall bar within ${TOL_YEARS} years`, () => {
      const o = computePhenoAge(v.values, v.age, v.sex, data, { fasting: v.fasting });
      expect(o.phenoage).not.toBeNull();
      expect(Math.abs((o.phenoage as number) - v.phenoage)).toBeLessThanOrEqual(TOL_YEARS);
      expect(Math.abs(o.band - v.band)).toBeLessThanOrEqual(TOL_YEARS);
      for (const key of Object.keys(v.waterfall) as (keyof Vector['waterfall'])[]) {
        expect(Math.abs(o.waterfall[key] - v.waterfall[key]), `waterfall.${key}`).toBeLessThanOrEqual(TOL_YEARS);
      }
      expect(o.imputed).toEqual(v.imputed);
      expect(o.markersUsed).toBe(v.markers_used);
      expect(o.xb).toBeCloseTo(v.xb, 5);
      expect(o.mortality10y).toBeCloseTo(v.mortality_10y, 5);
      expect(o.flags.critical).toBe(false);
      expect(o.label).toBe('Estimate, not diagnosis');
    });

    it(`${v.name}: the waterfall sums exactly to phenoage`, () => {
      const o = computePhenoAge(v.values, v.age, v.sex, data, { fasting: v.fasting });
      expect(Math.abs(waterfallSum(v.age, o.waterfall) - (o.phenoage as number))).toBeLessThan(1e-9);
    });

    it(`${v.name}: the affine shortcut equals the mortality-score route`, () => {
      const o = computePhenoAge(v.values, v.age, v.sex, data, { fasting: v.fasting });
      expect(Math.abs((o.phenoage as number) - (o.phenoageDirect as number))).toBeLessThan(1e-9);
    });
  }
});

describe('age bands', () => {
  it('maps ages to the norm bands like age_band.m', () => {
    expect(ageBand(34, data)).toBe('30-39');
    expect(ageBand(39.9, data)).toBe('30-39');
    expect(ageBand(40, data)).toBe('40-49');
    expect(ageBand(80, data)).toBe('80+');
    expect(ageBand(97, data)).toBe('80+');
    expect(ageBand(18, data)).toBe('20-29'); // adult clock: under-20s use the lowest band
  });
});

describe('reference person', () => {
  it('feeding the age-sex medians back in gives zero analyte bars and phenoage == age + cohort_offset', () => {
    const ref = data.reference_by_age_sex.M['40-49'];
    const o = computePhenoAge(ref, 45, 'M', data, { fasting: true });
    for (const a of ANALYTES) expect(Math.abs(o.waterfall[a])).toBeLessThan(1e-12);
    expect(Math.abs((o.phenoage as number) - (45 + o.waterfall.cohort_offset))).toBeLessThan(1e-9);
  });

  it('the exact-age cohort offset lands near the band-midpoint table value', () => {
    const o = computePhenoAge(data.reference_by_age_sex.M['30-39'], 35, 'M', data, { fasting: true });
    expect(o.waterfall.cohort_offset).toBeCloseTo(data.cohort_offset_by_age_sex!.M['30-39'], 1);
  });
});

describe('imputation', () => {
  it('a missing analyte is imputed from the norm, counted as 8 of 9, and widens the band', () => {
    const full = computePhenoAge(ref34M.values, ref34M.age, ref34M.sex, data, { fasting: true });
    const { crp: _crp, ...withoutCrp } = ref34M.values;
    const part = computePhenoAge(withoutCrp, ref34M.age, ref34M.sex, data, { fasting: true });
    expect(part.markersUsed).toBe(8);
    expect(part.imputed).toEqual(['crp']);
    expect(part.inputs.crp).toBe(data.reference_by_age_sex.M['30-39'].crp);
    expect(part.waterfall.crp).toBe(0);
    expect(part.band).toBeGreaterThan(full.band);
  });

  it('null and NaN count as missing', () => {
    const o = computePhenoAge({ ...ref34M.values, crp: null, alp: NaN }, ref34M.age, ref34M.sex, data, { fasting: true });
    expect(o.imputed).toEqual(['crp', 'alp']);
  });

  it('non-fasting or unknown fasting status imputes glucose', () => {
    const nonFasting = computePhenoAge(ref34M.values, ref34M.age, ref34M.sex, data, { fasting: false });
    expect(nonFasting.flags.nonFasting).toBe(true);
    expect(nonFasting.imputed).toEqual(['glucose']);
    const unknown = computePhenoAge(ref34M.values, ref34M.age, ref34M.sex, data, { fasting: null });
    expect(unknown.imputed).toEqual(['glucose']);
    const omitted = computePhenoAge(ref34M.values, ref34M.age, ref34M.sex, data);
    expect(omitted.imputed).toEqual(['glucose']);
  });
});

describe('CRP rules', () => {
  it('CRP below the floor is floored before the log', () => {
    const lo = computePhenoAge({ ...ref34M.values, crp: 0.02 }, ref34M.age, ref34M.sex, data, { fasting: true });
    const fl = computePhenoAge({ ...ref34M.values, crp: data.crp_floor_mgdL }, ref34M.age, ref34M.sex, data, { fasting: true });
    expect(Math.abs((lo.phenoage as number) - (fl.phenoage as number))).toBeLessThan(1e-12);
  });

  it('CRP above the acute threshold sets the flag without suppressing the number', () => {
    const o = computePhenoAge({ ...ref34M.values, crp: 1.5 }, ref34M.age, ref34M.sex, data, { fasting: true });
    expect(o.flags.crpAcute).toBe(true);
    expect(o.flags.critical).toBe(false);
    expect(o.phenoage).not.toBeNull();
  });
});

describe('safety gate: critical ranges suppress the number', () => {
  it('glucose out of range', () => {
    const o = computePhenoAge({ ...ref34M.values, glucose: 300 / 18.016 }, ref34M.age, ref34M.sex, data, { fasting: true });
    expect(o.flags.critical).toBe(true);
    expect(o.flags.criticalAnalytes).toEqual(['glucose']);
    expect(o.phenoage).toBeNull();
    expect(o.phenoageDirect).toBeNull();
    expect(o.label).toBe('See a clinician first');
    expect(Number.isFinite(o.band)).toBe(true); // the waterfall and band are still computed for the review screen
  });

  it('creatinine above 2 x the reference high (report value or the default)', () => {
    const withRef = computePhenoAge({ ...ref34M.values, creatinine: 250 }, ref34M.age, ref34M.sex, data, {
      fasting: true,
      creatinineRefHigh: 110,
    });
    expect(withRef.flags.criticalAnalytes).toEqual(['creatinine']);
    const defaultRef = computePhenoAge({ ...ref34M.values, creatinine: 250 }, ref34M.age, ref34M.sex, data, { fasting: true });
    expect(defaultRef.flags.criticalAnalytes).toEqual(['creatinine']);
    const highRef = computePhenoAge({ ...ref34M.values, creatinine: 250 }, ref34M.age, ref34M.sex, data, {
      fasting: true,
      creatinineRefHigh: 130,
    });
    expect(highRef.flags.critical).toBe(false);
  });

  it('WBC out of range', () => {
    const o = computePhenoAge({ ...ref34M.values, wbc: 35 }, ref34M.age, ref34M.sex, data, { fasting: true });
    expect(o.flags.criticalAnalytes).toEqual(['wbc']);
  });

  it('an imputed analyte can never trigger a critical flag', () => {
    const o = computePhenoAge({ ...ref34M.values, glucose: 300 / 18.016 }, ref34M.age, ref34M.sex, data, { fasting: false });
    expect(o.flags.critical).toBe(false);
  });
});

describe('input validation', () => {
  it('rejects a bad sex or age', () => {
    expect(() => computePhenoAge(ref34M.values, 34, 'X' as Sex, data)).toThrow();
    expect(() => computePhenoAge(ref34M.values, NaN, 'M', data)).toThrow();
  });
});
