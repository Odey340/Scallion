/**
 * Scan's plate: two glucose CurveBands (eat now / plus a walk) from A's SimBiology sweep,
 * per web/public/engine/meal_grid.json (matlab/sweep/run_meal_sweep.m, Cobelli/Dalla Man 2007 model).
 * Contract: "C interpolates linearly on carbs and weight, nearest on variant."
 */

export type Variant = 'normal' | 'low_si' | 't2d';

export interface MealCurveSeries {
  p10: number[];
  p50: number[];
  p90: number[];
}

export interface MealSummary {
  peak_mgdL: number;
  t_peak_min: number;
  auc_mgdL_min: number;
  t_baseline_min: number;
  basal_mgdL: number;
}

export interface WalkCalibration {
  walk_start_min: number;
  walk_end_min: number;
  vm0_factor: number;
  source: string;
  mechanism: string;
}

export interface MealGrid {
  version: number;
  axes: { carbs_g: number[]; variant: Variant[]; weight_kg: number[]; walk: number[] };
  t_min: number[];
  curves: Record<string, MealCurveSeries>;
  walk_calibration: WalkCalibration;
  labels: { curve: string; walk: string; medication: string };
  variant_rule: Record<string, string>;
}

export interface MealComputation {
  variant: Variant;
  tMin: number[];
  basalMgdl: number;
  eatNow: { curve: MealCurveSeries; summary: MealSummary };
  withWalk: { curve: MealCurveSeries; summary: MealSummary };
}

/** ADA Standards of Care fasting cut points — the same thresholds meal_grid.json's own `variant_rule` cites. */
export function variantFromFasting(fastingMgdl: number): Variant {
  if (fastingMgdl >= 126) return 't2d';
  if (fastingMgdl >= 100) return 'low_si';
  return 'normal';
}

export function computeMealCurves(
  input: { carbsG: number; fastingMgdl: number; weightKg: number },
  grid: MealGrid
): MealComputation {
  const variant = variantFromFasting(input.fastingMgdl);
  const eatNowCurve = interpolateMealCurve(grid, input.carbsG, variant, input.weightKg, 0);
  const withWalkCurve = interpolateMealCurve(grid, input.carbsG, variant, input.weightKg, 1);
  const basalMgdl = eatNowCurve.p50[0];

  return {
    variant,
    tMin: grid.t_min,
    basalMgdl,
    eatNow: { curve: eatNowCurve, summary: deriveSummary(eatNowCurve.p50, grid.t_min, basalMgdl) },
    withWalk: { curve: withWalkCurve, summary: deriveSummary(withWalkCurve.p50, grid.t_min, basalMgdl) },
  };
}

function interpolateMealCurve(
  grid: MealGrid,
  carbsG: number,
  variant: Variant,
  weightKg: number,
  walk: 0 | 1
): MealCurveSeries {
  const [c0, c1, ct] = bracket(grid.axes.carbs_g, carbsG);
  const [w0, w1, wt] = bracket(grid.axes.weight_kg, weightKg);

  const cell = (c: number, w: number): MealCurveSeries => {
    const key = `${c}|${variant}|${w}|${walk}`;
    const series = grid.curves[key];
    if (!series) throw new Error(`meal_grid.json has no curve for "${key}"`);
    return series;
  };

  const c0w0 = cell(c0, w0);
  const c0w1 = cell(c0, w1);
  const c1w0 = cell(c1, w0);
  const c1w1 = cell(c1, w1);

  const bilerp = (key: keyof MealCurveSeries): number[] => {
    const atW0 = lerpSeries(c0w0[key], c1w0[key], ct);
    const atW1 = lerpSeries(c0w1[key], c1w1[key], ct);
    return lerpSeries(atW0, atW1, wt);
  };

  return { p10: bilerp('p10'), p50: bilerp('p50'), p90: bilerp('p90') };
}

/** Returns [lo, hi, t] such that value ~= lo + t*(hi-lo), clamped to the axis range. `axis` must be ascending. */
function bracket(axis: number[], value: number): [number, number, number] {
  if (value <= axis[0]) return [axis[0], axis[0], 0];
  const last = axis[axis.length - 1];
  if (value >= last) return [last, last, 0];

  for (let i = 0; i < axis.length - 1; i++) {
    if (value >= axis[i] && value <= axis[i + 1]) {
      const t = (value - axis[i]) / (axis[i + 1] - axis[i]);
      return [axis[i], axis[i + 1], t];
    }
  }
  return [last, last, 0];
}

function lerpSeries(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => v + t * (b[i] - v));
}

/** Linear interpolation of the median curve at an arbitrary minute; clamped to the grid's range. */
export function glucoseAtMinute(series: MealCurveSeries, tMin: number[], minute: number): number {
  if (minute <= tMin[0]) return series.p50[0];
  const last = tMin.length - 1;
  if (minute >= tMin[last]) return series.p50[last];
  for (let i = 0; i < last; i++) {
    if (minute >= tMin[i] && minute <= tMin[i + 1]) {
      const t = (minute - tMin[i]) / (tMin[i + 1] - tMin[i]);
      return series.p50[i] + t * (series.p50[i + 1] - series.p50[i]);
    }
  }
  return series.p50[last];
}

/**
 * Minutes the median curve spends above a threshold, linearly interpolating the crossing point
 * within whichever grid interval it falls in (the grid is every 5 min, so this is accurate to a
 * fraction of that). A model-derived quantity, not a measurement — label it as such in the UI.
 */
export function minutesAboveThreshold(series: MealCurveSeries, tMin: number[], thresholdMgdl: number): number {
  let minutes = 0;
  for (let i = 1; i < tMin.length; i++) {
    const dt = tMin[i] - tMin[i - 1];
    const a = series.p50[i - 1] - thresholdMgdl;
    const b = series.p50[i] - thresholdMgdl;
    if (a >= 0 && b >= 0) {
      minutes += dt;
    } else if (a > 0 !== b > 0) {
      // Crosses the threshold once within this interval; only the above-threshold fraction counts.
      const cross = a / (a - b);
      minutes += a > 0 ? dt * cross : dt * (1 - cross);
    }
  }
  return Math.round(minutes);
}

export interface WalkEffect {
  peakWithoutMgdl: number;
  peakWithMgdl: number;
  /** peakWithout - peakWith; positive means the walk lowered the peak. */
  absoluteMgdl: number;
  /** absoluteMgdl / peakWithout, as a fraction (0.16 = 16%). */
  fraction: number;
}

/** Peak-reduction comparison between the two computed curves — both already carry the walk's effect built in via meal_grid.json's own sweep; this just reads the two peaks back out. */
export function walkEffect(eatNow: MealSummary, withWalk: MealSummary): WalkEffect {
  const absoluteMgdl = eatNow.peak_mgdL - withWalk.peak_mgdL;
  return {
    peakWithoutMgdl: eatNow.peak_mgdL,
    peakWithMgdl: withWalk.peak_mgdL,
    absoluteMgdl,
    fraction: eatNow.peak_mgdL > 0 ? absoluteMgdl / eatNow.peak_mgdL : 0,
  };
}

/** Mirrors meal_grid.json's own `summary_rule`: incremental AUC above basal 0-240 min; baseline = first time after the peak within 5 mg/dL of basal. */
function deriveSummary(p50: number[], tMin: number[], basalMgdl: number): MealSummary {
  let peakIdx = 0;
  for (let i = 1; i < p50.length; i++) {
    if (p50[i] > p50[peakIdx]) peakIdx = i;
  }

  let auc = 0;
  for (let i = 1; i < p50.length; i++) {
    const dt = tMin[i] - tMin[i - 1];
    const above0 = Math.max(0, p50[i - 1] - basalMgdl);
    const above1 = Math.max(0, p50[i] - basalMgdl);
    auc += ((above0 + above1) / 2) * dt;
  }

  let baselineMin = tMin[tMin.length - 1];
  for (let i = peakIdx; i < p50.length; i++) {
    if (Math.abs(p50[i] - basalMgdl) <= 5) {
      baselineMin = tMin[i];
      break;
    }
  }

  return {
    peak_mgdL: p50[peakIdx],
    t_peak_min: tMin[peakIdx],
    auc_mgdL_min: Math.round(auc),
    t_baseline_min: baselineMin,
    basal_mgdL: basalMgdl,
  };
}
