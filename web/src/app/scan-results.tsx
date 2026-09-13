import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedPressable, FadeInUp } from '@/components/animated';
import { CurveBand } from '@/components/curve-band';
import { ScoreRing } from '@/components/score-ring';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Colors, MaxChartWidth, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { glucoseAtMinute, minutesAboveThreshold, walkEffect } from '@/engine/meal';
import { computeWellbeingScore, wellbeingTier, WELLBEING_TIER_TEXT } from '@/engine/wellbeing';
import { formatSigned } from '@/lib/format';
import { clearScanResult, useScanResult } from '@/state/scan-store';

const TWO_HOUR_MIN = 120;

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
                <ThemedText type="small" themeColor="textMuted">
                  {mealType} · {carbsSource === 'photo' ? 'carbs estimated from your photo' : 'carbs entered manually'}
                </ThemedText>
                {gemini && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {gemini.food_description}
                  </ThemedText>
                )}
                <ThemedText type="small" themeColor="accent" style={styles.eyebrow}>
                  MODELED RESPONSE
                </ThemedText>
              </View>
            </FadeInUp>

            <FadeInUp delay={60}>
              <View style={styles.metrics}>
                <Metric label="Peak" value={`${Math.round(meal.eatNow.summary.peak_mgdL)}`} unit="mg/dL" />
                <Metric label="Peak time" value={`${meal.eatNow.summary.t_peak_min}`} unit="min" />
                <Metric label="2-hour estimate" value={`${Math.round(twoHour)}`} unit="mg/dL" />
                <Metric label="Back near baseline" value={`${meal.eatNow.summary.t_baseline_min}`} unit="min" />
              </View>
              {(minutesOver140 > 0 || minutesOver200 > 0) && (
                <ThemedText type="small" themeColor="textMuted" style={styles.modelNote}>
                  Model estimate: {minutesOver140 > 0 ? `${minutesOver140} min above 140 mg/dL` : null}
                  {minutesOver140 > 0 && minutesOver200 > 0 ? ', ' : ''}
                  {minutesOver200 > 0 ? `${minutesOver200} min above 200 mg/dL` : null}. Not a measurement.
                </ThemedText>
              )}
            </FadeInUp>

            <FadeInUp delay={110}>
              <ThemedView type="surface" style={[styles.card, CardShadow]}>
                <ThemedText type="smallBold">Eat now</ThemedText>
                <CurveBand series={meal.eatNow.curve} tMin={meal.tMin} basalMgdl={meal.basalMgdl} />
              </ThemedView>
            </FadeInUp>

            <FadeInUp delay={160}>
              {hideWalk ? (
                <ThemedView type="surface" style={[styles.card, CardShadow]}>
                  <ThemedText type="smallBold">Exercise timing</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {onMeds
                      ? 'Discuss timing with your clinician — walk-timing advice is hidden because you take medicine that affects blood sugar.'
                      : 'Walk-timing advice is hidden because the blood-sugar medication question wasn’t answered. Answer it in your profile to see it.'}
                  </ThemedText>
                </ThemedView>
              ) : (
                walk && (
                  <ThemedView type="surface" style={[styles.card, CardShadow]}>
                    <ThemedText type="smallBold" style={styles.eyebrow}>
                      WITH A 30-MINUTE WALK
                    </ThemedText>
                    <View style={styles.walkRow}>
                      <View style={styles.walkPeaks}>
                        <ThemedText type="small" themeColor="textMuted">
                          Peak without walk
                        </ThemedText>
                        <ThemedText type="numeric" style={styles.walkStrike}>
                          {Math.round(walk.peakWithoutMgdl)} mg/dL
                        </ThemedText>
                      </View>
                      <ThemedText type="default" themeColor="textMuted">
                        →
                      </ThemedText>
                      <View style={styles.walkPeaks}>
                        <ThemedText type="small" themeColor="textMuted">
                          Peak with walk
                        </ThemedText>
                        <ThemedText type="numeric" style={styles.walkNew}>
                          {Math.round(walk.peakWithMgdl)} mg/dL
                        </ThemedText>
                      </View>
                    </View>
                    <ThemedText type="smallBold" themeColor="connection">
                      {formatSigned(-walk.absoluteMgdl, 0)} mg/dL · {formatSigned(-walk.fraction * 100, 0)}%
                    </ThemedText>
                    <CurveBand series={meal.withWalk.curve} tMin={meal.tMin} basalMgdl={meal.basalMgdl} walkWindow={{ startMin: 15, endMin: 45 }} />
                    <ThemedText type="small" themeColor="textMuted">
                      Walk starting 15 min after eating, modeled from meal_grid.json&apos;s own calibration. Source: Buffey 2022.
                    </ThemedText>
                  </ThemedView>
                )
              )}
            </FadeInUp>

            <FadeInUp delay={210}>
              <ThemedView type="surfaceRaised" style={styles.referenceCard}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.eyebrow}>
                  WHERE THIS LANDS ON THE ADA SCALE
                </ThemedText>
                <View style={styles.referenceRow}>
                  <ScoreRing score={score} tier={tier} />
                  <ThemedText type="small" themeColor="textSecondary" style={styles.referenceText}>
                    {WELLBEING_TIER_TEXT[tier]}
                  </ThemedText>
                </View>
                {coffee && (
                  <View style={styles.coffeeLine}>
                    {coffee.byClockTime ? (
                      <ThemedText type="small">Have your last coffee by {coffee.byClockTime} tonight.</ThemedText>
                    ) : (
                      <ThemedText type="small">You are already under the bedtime caffeine threshold.</ThemedText>
                    )}
                  </View>
                )}
              </ThemedView>
            </FadeInUp>

            <FadeInUp delay={260}>
              <ThemedText type="small" themeColor="textMuted" style={styles.disclaimer}>
                Estimate, not diagnosis. A typical curve for someone with your fasting glucose and weight (ADA
                Standards of Care fasting cut points) — not a continuous glucose monitor reading and not your actual
                blood sugar. The ADA-scale score compares your modeled glucose at the 2-hour mark against the same
                thresholds used to diagnose an oral glucose tolerance test (normal &lt;140 mg/dL, impaired 140-199,
                diabetes range &gt;=200).
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

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={styles.metric}>
      <ThemedText type="numeric" style={styles.metricValue}>
        {value}
        <ThemedText type="small" themeColor="textMuted">
          {' '}
          {unit}
        </ThemedText>
      </ThemedText>
      <ThemedText type="small" themeColor="textMuted">
        {label}
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
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: Spacing.five,
    rowGap: Spacing.three,
  },
  metric: { minWidth: 120, gap: Spacing.half },
  metricValue: { fontSize: 28, lineHeight: 32 },
  modelNote: { marginTop: -Spacing.two },
  card: {
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  walkRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  walkPeaks: { gap: Spacing.half },
  walkStrike: { fontSize: 20, lineHeight: 24, color: Colors.textMuted },
  walkNew: { fontSize: 20, lineHeight: 24, color: Colors.connection },
  referenceCard: {
    borderRadius: Radius.medium,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  referenceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  referenceText: { flex: 1, flexShrink: 1 },
  coffeeLine: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.three,
  },
  disclaimer: { textAlign: 'center', maxWidth: MaxChartWidth, alignSelf: 'center' },
  backButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
});
