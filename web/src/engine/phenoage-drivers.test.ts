import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ANALYTES, computePhenoAge, waterfallSum, type AnalyteKey, type PhenoAgeData, type Sex } from './phenoage';
import { parseStoredInputs, rebuildDrivers } from './phenoage-drivers';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(resolve(here, '../../public/engine/phenoage.json'), 'utf8')) as PhenoAgeData;

interface Vector {
  name: string;
  age: number;
  sex: Sex;
  fasting: boolean;
  values: Partial<Record<AnalyteKey, number>>;
}
const vectors = JSON.parse(readFileSync(resolve(here, '../../../matlab/tests/vectors.json'), 'utf8')) as Vector[];

describe('rebuildDrivers', () => {
  for (const v of vectors) {
    it(`reproduces the Labs waterfall from a stored clock: ${v.name}`, () => {
      const original = computePhenoAge(v.values, v.age, v.sex, data, { fasting: v.fasting });
      const stored = { values: original.inputs, imputed: original.imputed };
      const expected = waterfallSum(v.age, original.waterfall);
      const drivers = rebuildDrivers(stored, v.age, v.sex, expected, data);
      expect(drivers).not.toBeNull();
      expect(drivers!.cohortOffset).toBeCloseTo(original.waterfall.cohort_offset, 9);
      for (const d of drivers!.analytes) {
        expect(d.years).toBeCloseTo(original.waterfall[d.key], 9);
        expect(d.imputed).toBe(original.imputed.includes(d.key));
      }
      expect(drivers!.analytes).toHaveLength(ANALYTES.length);
      for (let i = 1; i < drivers!.analytes.length; i++) {
        expect(Math.abs(drivers!.analytes[i - 1].years)).toBeGreaterThanOrEqual(Math.abs(drivers!.analytes[i].years));
      }
    });
  }

  it('refuses to show drivers that do not add up to the stored age', () => {
    const v = vectors[0];
    const original = computePhenoAge(v.values, v.age, v.sex, data, { fasting: v.fasting });
    const expected = waterfallSum(v.age, original.waterfall);
    expect(rebuildDrivers({ values: original.inputs, imputed: original.imputed }, v.age, v.sex, expected + 1, data)).toBeNull();
  });
});

describe('parseStoredInputs', () => {
  it('reads the /clock row shape (si values + imputed + extra keys)', () => {
    const p = parseStoredInputs({ albumin: 44, rdw: 13.1, imputed: ['crp', 'nonsense'], fasting: true, sex: 'M' });
    expect(p).toEqual({ values: { albumin: 44, rdw: 13.1 }, imputed: ['crp'] });
  });

  it('takes the imputed list from the local clock when inputs lack one', () => {
    expect(parseStoredInputs({ albumin: 44 }, ['glucose'])?.imputed).toEqual(['glucose']);
  });

  it('returns null for missing or malformed inputs', () => {
    expect(parseStoredInputs(null)).toBeNull();
    expect(parseStoredInputs({ imputed: ['crp'] })).toBeNull();
    expect(parseStoredInputs('x')).toBeNull();
  });
});
