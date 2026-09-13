import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { computePhenoAge, waterfallSum, type PhenoAgeData, type Sex } from './phenoage';
import { parseStoredInputs, rebuildDrivers } from './phenoage-drivers';

/**
 * End-to-end check of the exact path data takes: Labs computes a PhenoAgeResult and calls
 * setLocalClock({ inputs: {...result.inputs}, sex: result.sex, imputed: result.imputed, ... })
 * (labs.tsx); Home reads that LocalClock and calls parseStoredInputs(clock.inputs, clock.imputed)
 * then rebuildDrivers(...) (index.tsx). This reproduces both steps with real vectors so a field-name
 * mismatch between the two screens would fail here instead of only in the browser.
 */
const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(resolve(here, '../../public/engine/phenoage.json'), 'utf8')) as PhenoAgeData;

interface Vector {
  name: string;
  age: number;
  sex: Sex;
  fasting: boolean;
  values: Record<string, number>;
}
const vectors = JSON.parse(readFileSync(resolve(here, '../../../matlab/tests/vectors.json'), 'utf8')) as Vector[];

describe('Labs -> clock-store -> Home, end to end', () => {
  for (const v of vectors) {
    it(`${v.name}: Home reproduces the exact waterfall Labs computed`, () => {
      // What labs.tsx computes and hands to setLocalClock.
      const result = computePhenoAge(v.values, v.age, v.sex, data, { fasting: v.fasting });
      expect(result.phenoage).not.toBeNull();
      const localClock = {
        clock: 'phenoage' as const,
        years: result.phenoage as number,
        chronologicalAge: v.age,
        band: result.band,
        computedAt: new Date().toISOString(),
        imputed: result.imputed,
        inputs: { ...result.inputs },
        sex: result.sex,
      };

      // What index.tsx does with that stored clock.
      const stored = parseStoredInputs(localClock.inputs, localClock.imputed);
      expect(stored).not.toBeNull();
      const drivers = rebuildDrivers(stored!, localClock.chronologicalAge, localClock.sex, localClock.years, data);
      expect(drivers).not.toBeNull();

      // Home's headline arithmetic: calendar age + cohort offset + sum(marker years) = displayed years.
      const total = localClock.chronologicalAge + drivers!.cohortOffset + drivers!.analytes.reduce((s, d) => s + d.years, 0);
      expect(total).toBeCloseTo(localClock.years, 6);
      expect(total).toBeCloseTo(waterfallSum(v.age, result.waterfall), 6);

      // Every analyte Labs marked imputed is flagged imputed in what Home renders, and no others.
      for (const d of drivers!.analytes) expect(d.imputed).toBe(result.imputed.includes(d.key));
    });
  }
});
