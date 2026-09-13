import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedPressable, FadeInUp } from '@/components/animated';
import { CurveBand } from '@/components/curve-band';
import { ScoreRing } from '@/components/score-ring';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Colors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { glucoseAtMinute, minutesAboveThreshold, walkEffect } from '@/engine/meal';
import { computeWellbeingScore, wellbeingTier, WELLBEING_TIER_TEXT } from '@/engine/wellbeing';
import { formatSigned } from '@/lib/format';
import { clearScanResult, useScanResult } from '@/state/scan-store';

const TWO_HOUR_MIN = 120;

/**
 * Scan results, top to bottom: the wellbeing score first (the one number to take away), the
 * key numbers of the modeled curve, the curve itself, the walk comparison, tonight's coffee
 * cutoff, then the honest-label footer. Every number comes from A's meal_grid.json through
 * engine/meal.ts, or from engine/wellbeing.ts on that curve; nothing is invented here.
 */
export default function ScanResultsScreen() {
  const router = useRouter();
  const result = useScanResult();

  if (!result) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <FadeInUp delay={0} style={styles.empty}>
            <ThemedText type="subtitle">No meal analyzed yet</ThemedText>
            <ThemedText type="default" themeColor="textSecondary" style={styles.emptyText}>
              Go back and describe a meal to see its results here.
            </ThemedText>
            <AnimatedPressable style={styles.backButton} onPress={() => router.replace('/(tabs)/scan')}>
              <ThemedText type="smallBold" themeColor="accentText">
                Back to your meal
              </ThemedText>
            </AnimatedPressable>
          </FadeInUp>
        </SafeAreaView>
      </ThemedView>
    );
  }

  const { meal, mealType, onMeds, medsUnknown, carbsSource, gemini, coffee } = result;
  const hideWalk = onMeds || Boolean(medsUnknown);
  const score = computeWellbeingScore(meal.eatNow.curve, meal.tMin);
  const tier = wellbeingTier(score);
  const twoHour = glucoseAtMinute(meal.eatNow.curve, meal.tMin, TWO_HOUR_MIN);
  const minutesOver140 = minutesAboveThreshold(meal.eatNow.curve, meal.tMin, 140);
  const minutesOver200 = minutesAboveThreshold(meal.eatNow.curve, meal.tMin, 200);
  const walk = hideWalk ? null : walkEffect(meal.eatNow.summary, meal.withWalk.summary);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scrollOuter} contentContainerStyle={styles.scrollContent}>
          <View style={styles.scroll}>
            <FadeInUp delay={0}>
              <View style={styles.header}>
                <ThemedText type="small" themeColor="accent" style={styles.eyebrow}>
                  MODELED RESPONSE
                </ThemedText>
                <ThemedText type="subtitle">{mealType}</ThemedText>
                <ThemedText type="small" themeColor="textMuted">
                  {carbsSource === 'photo' ? 'Carbs estimated from your photo' : 'Carbs entered by hand'}
                  {gemini ? ` · ${gemini.food_description}` : ''}
                </ThemedText>
              </View>
            </FadeInUp>

            {/* 1. The one number to take away */}
            <FadeInUp delay={60}>
              <ThemedView type="surface" style={[styles.card, CardShadow, styles.hero]}>
                <ScoreRing score={score} tier={tier} />
                <View style={styles.heroText}>
                  <ThemedText type="smallBold">Wellbeing score</ThemedText>
                  <ThemedText type="default" themeColor="textSecondary">
                    {WELLBEING_TIER_TEXT[tier]}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textMuted">
                    Modeled glucose at the 2-hour mark ({Math.round(twoHour)} mg/dL) against the ADA oral glucose tolerance
                    thresholds: normal below 140, impaired 140-199, diabetes range 200 and above.
                  </ThemedText>
                </View>
              </ThemedView>
            </FadeInUp>

            {/* 2. Key numbers of the curve */}
            <FadeInUp delay={110}>
              <ThemedView type="surface" style={[styles.card, CardShadow]}>
                <ThemedText type="smallBold">Key numbers</ThemedText>
                <View style={styles.metrics}>
                  <Metric label="Peak glucose" value={`${Math.round(meal.eatNow.summary.peak_mgdL)}`} unit="mg/dL" />
                  <Metric label="Time to peak" value={`${meal.eatNow.summary.t_peak_min}`} unit="min" />
                  <Metric label="At 2 hours" value={`${Math.round(twoHour)}`} unit="mg/dL" />
                  <Metric label="Back near baseline" value={`${meal.eatNow.summary.t_baseline_min}`} unit="min" />
                </View>
                {(minutesOver140 > 0 || minutesOver200 > 0) && (
                  <ThemedText type="small" themeColor="textMuted">
                    Time above thresholds: {minutesOver140 > 0 ? `${minutesOver140} min above 140 mg/dL` : null}
                    {minutesOver140 > 0 && minutesOver200 > 0 ? ', ' : ''}
                    {minutesOver200 > 0 ? `${minutesOver200} min above 200 mg/dL` : null}. A model estimate, not a measurement.
                  </ThemedText>
                )}
              </ThemedView>
            </FadeInUp>

            {/* 3. The curve */}
            <FadeInUp delay={160}>
              <ThemedView type="surface" style={[styles.card, CardShadow]}>
                <ThemedText type="smallBold">Modeled glucose curve</ThemedText>
                <ThemedText type="small" themeColor="textMuted">
                  The first four hours after eating, no walk. SimBiology glucose-insulin model, interpolated from the MATLAB sweep.
                </ThemedText>
                <CurveBand series={meal.eatNow.curve} tMin={meal.tMin} basalMgdl={meal.basalMgdl} />
              </ThemedView>
            </FadeInUp>

            {/* 4. The walk */}
            <FadeInUp delay={210}>
              {hideWalk ? (
                <ThemedView type="surface" style={[styles.card, CardShadow]}>
                  <ThemedText type="smallBold">Exercise timing</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {onMeds
                      ? 'Discuss timing with your clinician. Walk-timing advice is hidden because you take medicine that affects blood sugar.'
                      : 'Walk-timing advice is hidden because the blood-sugar medication question was not answered. Answer it in your profile to see it.'}
                  </ThemedText>
                </ThemedView>
              ) : (
                walk && (
                  <ThemedView type="surface" style={[styles.card, CardShadow]}>
                    <ThemedText type="smallBold">With a 30-minute walk</ThemedText>
                    <View style={styles.metrics}>
                      <Metric label="Peak without walk" value={`${Math.round(walk.peakWithoutMgdl)}`} unit="mg/dL" muted />
                      <Metric label="Peak with walk" value={`${Math.round(walk.peakWithMgdl)}`} unit="mg/dL" tone="connection" />
                    </View>
                    <ThemedText type="smallBold" themeColor="connection">
                      {formatSigned(-walk.absoluteMgdl, 0)} mg/dL at the peak ({formatSigned(-walk.fraction * 100, 0)}%)
                    </ThemedText>
                    <CurveBand series={meal.withWalk.curve} tMin={meal.tMin} basalMgdl={meal.basalMgdl} walkWindow={{ startMin: 15, endMin: 45 }} />
                    <ThemedText type="small" themeColor="textMuted">
                      Shaded window: a walk starting 15 minutes after eating, modeled with the sweep&apos;s own calibration. Source: Buffey 2022.
                    </ThemedText>
                  </ThemedView>
                )
              )}
            </FadeInUp>

            {/* 5. Tonight */}
            {coffee && (
              <FadeInUp delay={260}>
                <ThemedView type="surfaceRaised" style={styles.card}>
                  <ThemedText type="smallBold">Tonight</ThemedText>
                  <ThemedText type="default">
                    {coffee.byClockTime ? `Have your last coffee by ${coffee.byClockTime}.` : 'You are already under the bedtime caffeine threshold.'}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textMuted">
                    From your usual cup, your bedtime and the caffeine half-life curve.
                  </ThemedText>
                </ThemedView>
              </FadeInUp>
            )}

            <FadeInUp delay={310} style={styles.footer}>
              <ThemedText type="small" themeColor="textMuted" style={styles.disclaimer}>
                Estimate, not diagnosis. A typical curve for someone with your fasting glucose and weight (ADA Standards of
                Care fasting cut points), not a glucose monitor reading and not your actual blood sugar.
              </ThemedText>
              <AnimatedPressable
                style={styles.backButton}
                onPress={() => {
                  clearScanResult();
                  router.replace('/(tabs)/scan');
                }}>
                <ThemedText type="smallBold" themeColor="accentText">
                  Try another meal
                </ThemedText>
              </AnimatedPressable>
            </FadeInUp>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Metric({
  label,
  value,
  unit,
  muted,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  muted?: boolean;
  tone?: 'connection';
}) {
  return (
    <View style={styles.metric}>
      <ThemedText type="small" themeColor="textMuted">
        {label}
      </ThemedText>
      <ThemedText type="numeric" style={[styles.metricValue, muted && styles.metricMuted, tone === 'connection' && styles.metricGood]}>
        {value}
        <ThemedText type="small" themeColor="textMuted">
          {' '}
          {unit}
        </ThemedText>
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignItems: 'center' },
  scrollOuter: { flex: 1, width: '100%' },
  scrollContent: { alignItems: 'center' },
  empty: { justifyContent: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four },
  emptyText: { textAlign: 'center' },
  scroll: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    gap: Spacing.four,
  },
  header: { gap: Spacing.one },
  eyebrow: { letterSpacing: 1.2 },
  card: {
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  hero: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.four },
  heroText: { flex: 1, minWidth: 220, gap: Spacing.two },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  metric: {
    flexGrow: 1,
    flexBasis: '40%',
    minWidth: 130,
    gap: Spacing.half,
    padding: Spacing.three,
    borderRadius: Radius.small,
    backgroundColor: Colors.surfaceRaised,
  },
  metricValue: { fontSize: 28, lineHeight: 34 },
  metricMuted: { color: Colors.textMuted },
  metricGood: { color: Colors.connection },
  footer: { gap: Spacing.three },
  disclaimer: { textAlign: 'center' },
  backButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
});
