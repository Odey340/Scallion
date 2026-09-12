/**
 * Meal wellbeing score (0-100): Lane C's own composite heuristic over the MATLAB-derived
 * glucose-response summary (meal.ts's `deriveSummary`, itself computed from A's meal_grid.json).
 * This score itself is NOT a MATLAB export or a validated clinical index — say so in the UI.
 *
 * Three factors, each scored 0-100 then weighted, thresholds calibrated against the actual
 * spread of the 144-cell grid (walk=0): peak excess above basal ranges ~13-286 mg/dL, incremental
 * AUC ~1850-39700 mg/dL*min across the grid's carbs/weight/variant combinations.
 */

import type { MealSummary } from './meal';

const PEAK_GOOD_MGDL = 30; // excess above basal
const PEAK_POOR_MGDL = 180;
const AUC_GOOD = 4000; // mg/dL*min, incremental
const AUC_POOR = 30000;
const BASELINE_GOOD_MIN = 90;
const BASELINE_POOR_MIN = 240;

function scoreDown(value: number, good: number, poor: number): number {
  if (value <= good) return 100;
  if (value >= poor) return 0;
  return 100 * (1 - (value - good) / (poor - good));
}

export function computeWellbeingScore(summary: MealSummary): number {
  const peakExcess = summary.peak_mgdL - summary.basal_mgdL;
  const peakScore = scoreDown(peakExcess, PEAK_GOOD_MGDL, PEAK_POOR_MGDL);
  const aucScore = scoreDown(summary.auc_mgdL_min, AUC_GOOD, AUC_POOR);
  const baselineScore = scoreDown(summary.t_baseline_min, BASELINE_GOOD_MIN, BASELINE_POOR_MIN);

  const composite = 0.4 * peakScore + 0.4 * aucScore + 0.2 * baselineScore;
  return Math.round(Math.max(0, Math.min(100, composite)));
}

export function wellbeingTier(score: number): 'good' | 'fair' | 'poor' {
  if (score >= 70) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

export const WELLBEING_TIER_TEXT: Record<'good' | 'fair' | 'poor', string> = {
  good: 'This meal keeps your glucose response fairly steady.',
  fair: 'This meal causes a moderate glucose rise.',
  poor: 'This meal may cause a larger, longer glucose rise than usual.',
};
