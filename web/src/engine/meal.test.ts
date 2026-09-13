import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { computeMealCurves, glucoseAtMinute, minutesAboveThreshold, walkEffect, type MealCurveSeries, type MealGrid } from './meal';

const here = dirname(fileURLToPath(import.meta.url));
const grid = JSON.parse(readFileSync(resolve(here, '../../public/engine/meal_grid.json'), 'utf8')) as MealGrid;

function flat(v: number): MealCurveSeries {
  return { p10: [v], p90: [v], p50: [v] };
}

describe('glucoseAtMinute', () => {
  it('reads an exact grid point without interpolation error', () => {
    const meal = computeMealCurves({ carbsG: 60, fastingMgdl: 95, weightKg: 78, }, grid);
    const idx = meal.tMin.indexOf(120);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(glucoseAtMinute(meal.eatNow.curve, meal.tMin, 120)).toBeCloseTo(meal.eatNow.curve.p50[idx], 9);
  });

  it('interpolates linearly between two grid points', () => {
    const series: MealCurveSeries = { p10: [0, 0], p90: [0, 0], p50: [100, 200] };
    expect(glucoseAtMinute(series, [0, 10], 5)).toBeCloseTo(150, 9);
    expect(glucoseAtMinute(series, [0, 10], 2)).toBeCloseTo(120, 9);
  });

  it('clamps outside the grid range', () => {
    const series: MealCurveSeries = { p10: [0, 0], p90: [0, 0], p50: [100, 200] };
    expect(glucoseAtMinute(series, [0, 10], -5)).toBe(100);
    expect(glucoseAtMinute(series, [0, 10], 50)).toBe(200);
  });
});

describe('minutesAboveThreshold', () => {
  it('is zero when the curve never crosses the threshold', () => {
    const series = flat(90);
    expect(minutesAboveThreshold({ ...series, p50: [90, 90, 90] }, [0, 5, 10], 140)).toBe(0);
  });

  it('counts the full span when always above', () => {
    expect(minutesAboveThreshold({ p10: [], p90: [], p50: [150, 160, 150] }, [0, 5, 10], 140)).toBe(10);
  });

  it('interpolates a single crossing to a fraction of the interval', () => {
    // Straight line 100 -> 200 mg/dL over 10 min; crosses 150 at the midpoint (5 min above).
    const series: MealCurveSeries = { p10: [], p90: [], p50: [100, 200] };
    expect(minutesAboveThreshold(series, [0, 10], 150)).toBe(5);
  });

  it('handles a rise then fall across the threshold within a real computed curve', () => {
    const meal = computeMealCurves({ carbsG: 100, fastingMgdl: 130, weightKg: 90 }, grid);
    const minutes = minutesAboveThreshold(meal.eatNow.curve, meal.tMin, 140);
    expect(minutes).toBeGreaterThan(0);
    expect(minutes).toBeLessThanOrEqual(240);
  });
});

describe('walkEffect', () => {
  it('reports a positive reduction when the walk lowers the peak', () => {
    const meal = computeMealCurves({ carbsG: 80, fastingMgdl: 95, weightKg: 78 }, grid);
    const effect = walkEffect(meal.eatNow.summary, meal.withWalk.summary);
    expect(effect.peakWithoutMgdl).toBe(meal.eatNow.summary.peak_mgdL);
    expect(effect.peakWithMgdl).toBe(meal.withWalk.summary.peak_mgdL);
    expect(effect.absoluteMgdl).toBeCloseTo(effect.peakWithoutMgdl - effect.peakWithMgdl, 9);
    expect(effect.fraction).toBeCloseTo(effect.absoluteMgdl / effect.peakWithoutMgdl, 9);
    // meal_grid.json's own walk_calibration targets a 10-20% peak reduction.
    expect(effect.fraction).toBeGreaterThan(0);
    expect(effect.fraction).toBeLessThan(0.3);
  });

  it('computes the fraction from the two summaries alone, with no hidden state', () => {
    const effect = walkEffect({ peak_mgdL: 142, t_peak_min: 55, auc_mgdL_min: 100, t_baseline_min: 170, basal_mgdL: 90 }, {
      peak_mgdL: 119,
      t_peak_min: 50,
      auc_mgdL_min: 80,
      t_baseline_min: 140,
      basal_mgdL: 90,
    });
    expect(effect.absoluteMgdl).toBe(23);
    expect(effect.fraction).toBeCloseTo(23 / 142, 9);
  });
});
