import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedPressable, FadeInUp } from '@/components/animated';
import { CurveBand } from '@/components/curve-band';
import { ScoreRing } from '@/components/score-ring';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Colors, MaxChartWidth, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import type { MealComputation } from '@/engine/meal';
import { computeWellbeingScore, wellbeingTier, WELLBEING_TIER_TEXT } from '@/engine/wellbeing';
import { clearScanResult, useScanResult } from '@/state/scan-store';

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
  const walkScore = computeWellbeingScore(meal.withWalk.curve, meal.tMin);
  const walkImprovement = walkScore - score;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scrollOuter} contentContainerStyle={styles.scrollContent}>
          <View style={styles.scroll}>
          <FadeInUp delay={0}>
          <View style={styles.hero}>
            <ThemedText type="small" themeColor="textMuted">
              {mealType} • {carbsSource === 'photo' ? 'estimated from your photo' : 'entered manually'}
            </ThemedText>
            <ScoreRing score={score} tier={tier} />
            <ThemedText type="default" style={styles.tierText}>
              {WELLBEING_TIER_TEXT[tier]}
            </ThemedText>
            {gemini && (
              <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                {gemini.food_description}
              </ThemedText>
            )}
            {!hideWalk && walkImprovement > 2 && (
              <ThemedView type="surfaceRaised" style={styles.insightCard}>
                <ThemedText type="small">
                  A 30 min walk after eating could raise this to {walkScore}%.
                </ThemedText>
              </ThemedView>
            )}
            {coffee && (
              <ThemedView type="surfaceRaised" style={styles.insightCard}>
                {coffee.byClockTime ? (
                  <ThemedText type="small">Have your last coffee by {coffee.byClockTime} tonight.</ThemedText>
                ) : (
                  <ThemedText type="small">You&apos;re already under the bedtime caffeine threshold.</ThemedText>
                )}
              </ThemedView>
            )}
            <ThemedText type="small" themeColor="textMuted" style={styles.scrollHint}>
              Scroll down for the full breakdown
            </ThemedText>
          </View>
          </FadeInUp>

          <View style={styles.divider} />

          <FadeInUp delay={70}>
          <ThemedView type="surface" style={[styles.card, CardShadow]}>
            <ThemedText type="smallBold">Eat now</ThemedText>
            <CurveBand series={meal.eatNow.curve} tMin={meal.tMin} basalMgdl={meal.basalMgdl} />
            <SummaryRow summary={meal.eatNow.summary} />
          </ThemedView>
          </FadeInUp>

          <FadeInUp delay={140}>
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
            <ThemedView type="surface" style={[styles.card, CardShadow]}>
              <ThemedText type="smallBold">Plus a 30 min walk</ThemedText>
              <CurveBand series={meal.withWalk.curve} tMin={meal.tMin} basalMgdl={meal.basalMgdl} />
              <SummaryRow summary={meal.withWalk.summary} />
              <ThemedText type="small" themeColor="textMuted">
                Walk starting 15 min after eating. Source: Buffey 2022.
              </ThemedText>
            </ThemedView>
          )}
          </FadeInUp>

          <FadeInUp delay={210}>
          <ThemedText type="small" themeColor="textMuted" style={styles.disclaimer}>
            Estimate, not diagnosis. A typical curve for someone with your fasting glucose and weight (ADA Standards
            of Care fasting cut points). The wellbeing score is your glucose at the 2-hour mark measured against the
            same ADA diagnostic thresholds used for an oral glucose tolerance test (normal &lt;140 mg/dL, impaired
            140-199, diabetes range &gt;=200) — not a validated clinical index on its own, but grounded in one.
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

function SummaryRow({ summary }: { summary: MealComputation['eatNow']['summary'] }) {
  return (
    <View style={styles.summaryRow}>
      <Stat label="Peak" value={`${Math.round(summary.peak_mgdL)} mg/dL`} />
      <Stat label="At" value={`${summary.t_peak_min}m`} />
      <Stat label="Back to baseline" value={`${summary.t_baseline_min}m`} />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="numeric" style={styles.statValue}>
        {value}
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
  },
  hero: { alignItems: 'center', gap: Spacing.two },
  tierText: { textAlign: 'center', maxWidth: 280 },
  center: { textAlign: 'center' },
  insightCard: {
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginTop: Spacing.one,
  },
  scrollHint: { marginTop: Spacing.three },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    width: '100%',
    marginVertical: Spacing.five,
  },
  card: {
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.four,
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: MaxChartWidth,
    alignSelf: 'center',
  },
  stat: { alignItems: 'center', gap: Spacing.half },
  statValue: { fontSize: 18, lineHeight: 22 },
  disclaimer: { textAlign: 'center', marginBottom: Spacing.four },
  backButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
});
