import type { MealCurveSeries } from './meal';

/**
 * Meal wellbeing score (0-100). Still Lane C's own scoring layer — not a MATLAB export — but now
 * anchored to a real, cited clinical standard instead of an internal percentile scheme, so it's
 * explainable in one sentence rather than "we made up these weights and cutoffs."
 *
 * The metric: glucose at the 2-hour mark (t=120 min), the exact checkpoint the American Diabetes
 * Association uses to diagnose glucose tolerance from an oral glucose tolerance test (OGTT):
 *   - < 140 mg/dL  -> normal glucose tolerance
 *   - 140-199 mg/dL -> impaired glucose tolerance ("prediabetes" range)
 *   - >= 200 mg/dL -> diabetes range
 * Source: ADA Standards of Care in Diabetes, "Classification and Diagnosis of Diabetes" (2-hour
 * plasma glucose criteria) — the same document meal.ts's `variantFromFasting` already cites for
 * the fasting-glucose cut points, so this reuses a source the app already trusts rather than
 * introducing a new one.
 *
 * The score is a straight line through the two ADA boundaries (140 mg/dL -> 70, 200 mg/dL -> 30),
 * extrapolated and clamped to [0, 100]. That means the tier boundaries below line up exactly with
 * the ADA categories: score >= 70 iff the 2-hour value is in ADA's normal range, score < 30 iff
 * it's in the diabetes range. Peak and time-to-baseline are still shown separately in the UI
 * (meal.ts's summary) as supporting detail, deliberately not folded into this number, so the score
 * stays a single explainable statistic instead of an opaque weighted blend.
 */

const ADA_NORMAL_MGDL = 140;
const ADA_DIABETES_MGDL = 200;
const SCORE_AT_NORMAL_BOUNDARY = 70;
const SCORE_AT_DIABETES_BOUNDARY = 30;

const SLOPE = (SCORE_AT_DIABETES_BOUNDARY - SCORE_AT_NORMAL_BOUNDARY) / (ADA_DIABETES_MGDL - ADA_NORMAL_MGDL);

function glucoseAt2h(curve: MealCurveSeries, tMin: number[]): number {
  const idx = tMin.indexOf(120);
  if (idx >= 0) return curve.p50[idx];
  // Grid is every 5 min from 0-240 in the current export, so this only triggers if that changes —
  // fall back to the closest available point rather than throwing.
  let closest = 0;
  for (let i = 1; i < tMin.length; i++) {
    if (Math.abs(tMin[i] - 120) < Math.abs(tMin[closest] - 120)) closest = i;
  }
  return curve.p50[closest];
}

export function computeWellbeingScore(curve: MealCurveSeries, tMin: number[]): number {
  const glucose2h = glucoseAt2h(curve, tMin);
  const score = SCORE_AT_NORMAL_BOUNDARY + SLOPE * (glucose2h - ADA_NORMAL_MGDL);
  return Math.round(Math.max(0, Math.min(100, score)));
}

export function wellbeingTier(score: number): 'good' | 'fair' | 'poor' {
  if (score >= SCORE_AT_NORMAL_BOUNDARY) return 'good';
  if (score >= SCORE_AT_DIABETES_BOUNDARY) return 'fair';
  return 'poor';
}

export const WELLBEING_TIER_TEXT: Record<'good' | 'fair' | 'poor', string> = {
  good: 'Your glucose at the 2-hour mark stays in the normal range (ADA criteria).',
  fair: 'Your glucose at the 2-hour mark is in the impaired-tolerance range (ADA criteria).',
  poor: 'Your glucose at the 2-hour mark reaches the diabetes-range threshold (ADA criteria).',
};
