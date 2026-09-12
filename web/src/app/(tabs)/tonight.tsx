import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CurveBand } from '@/components/curve-band';
import { Field, NumberInput, SegmentButton, TextField } from '@/components/form-controls';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Colors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { lastCoffeeHoursBeforeBed, subtractHours, type CaffeineData } from '@/engine/caffeine';
import { computeMealCurves, type MealComputation, type MealGrid } from '@/engine/meal';

const VARIANT_LABEL: Record<string, string> = {
  normal: 'fasting glucose in the normal range',
  low_si: 'fasting glucose in the impaired range',
  t2d: 'fasting glucose in the type 2 diabetic range',
};

/**
 * Tonight's plate: two glucose CurveBands (eat now / plus a walk) from A's meal_grid.json,
 * plus the caffeine last-coffee line from caffeine.json. docs/lanes/C.md Block 3.
 * TODO(D): "photograph the plate -> carbs" needs D's Gemini extraction endpoint, not yet in
 * docs/contracts.md. Carbs are typed manually until that lands.
 */
export default function TonightScreen() {
  const [grid, setGrid] = useState<MealGrid | null>(null);
  const [caffeine, setCaffeine] = useState<CaffeineData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [carbsG, setCarbsG] = useState('');
  const [fastingMgdl, setFastingMgdl] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [onMeds, setOnMeds] = useState<boolean | null>(null);
  const [caffeineMg, setCaffeineMg] = useState('');
  const [bedtime, setBedtime] = useState('');

  const [meal, setMeal] = useState<MealComputation | null>(null);
  const [coffeeResult, setCoffeeResult] = useState<{ hoursBefore: number; byClockTime: string | null } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/engine/meal_grid.json').then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      }),
      fetch('/engine/caffeine.json').then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      }),
    ])
      .then(([g, c]) => {
        setGrid(g);
        setCaffeine(c);
      })
      .catch(() => setLoadError('Could not load the meal or caffeine model.'));
  }, []);

  const handleSubmit = () => {
    setFormError(null);
    setMeal(null);
    setCoffeeResult(null);

    if (!grid || !caffeine) {
      setFormError('Still loading the meal model.');
      return;
    }
    if (!carbsG || !fastingMgdl || !weightKg || onMeds === null) {
      setFormError('Fill in carbs, fasting glucose, weight, and the medication question.');
      return;
    }

    const carbsNum = Number(carbsG);
    const fastingNum = Number(fastingMgdl);
    const weightNum = Number(weightKg);
    if (!Number.isFinite(carbsNum) || !Number.isFinite(fastingNum) || !Number.isFinite(weightNum)) {
      setFormError('Carbs, fasting glucose, and weight must be numbers.');
      return;
    }

    try {
      setMeal(computeMealCurves({ carbsG: carbsNum, fastingMgdl: fastingNum, weightKg: weightNum }, grid));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not compute tonight’s curve.');
      return;
    }

    if (caffeineMg && bedtime) {
      const doseNum = Number(caffeineMg);
      if (Number.isFinite(doseNum)) {
        const hoursBefore = lastCoffeeHoursBeforeBed(doseNum, { smoker: false, oralContraceptive: false }, caffeine);
        setCoffeeResult({
          hoursBefore,
          byClockTime: hoursBefore > 0 ? subtractHours(bedtime, hoursBefore) : null,
        });
      }
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <ThemedText type="subtitle">Tonight</ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            Estimate, not diagnosis. A typical curve for your fasting glucose and weight.
          </ThemedText>

          {loadError && (
            <ThemedText type="small" themeColor="silence">
              {loadError}
            </ThemedText>
          )}

          <Field label="Carbs on the plate (g)">
            <NumberInput value={carbsG} onChangeText={setCarbsG} placeholder="60" />
          </Field>
          <ThemedText type="small" themeColor="textMuted">
            TODO(D): photo-based carb estimation needs Gemini extraction, not yet in the API contract. Type it in for
            now.
          </ThemedText>

          <Field label="Fasting glucose (mg/dL)">
            <NumberInput value={fastingMgdl} onChangeText={setFastingMgdl} placeholder="95" />
          </Field>

          <Field label="Weight (kg)">
            <NumberInput value={weightKg} onChangeText={setWeightKg} placeholder="78" />
          </Field>

          <Field label="Do you take medicine that affects your blood sugar?">
            <View style={styles.row}>
              <SegmentButton label="No" active={onMeds === false} onPress={() => setOnMeds(false)} />
              <SegmentButton label="Yes" active={onMeds === true} onPress={() => setOnMeds(true)} />
            </View>
          </Field>

          <Field label="Caffeine so far today (mg, optional — ~95 mg per cup of coffee)">
            <NumberInput value={caffeineMg} onChangeText={setCaffeineMg} placeholder="95" />
          </Field>

          <Field label="Bedtime (HH:MM, optional)">
            <TextField value={bedtime} onChangeText={setBedtime} placeholder="22:30" />
          </Field>

          {formError && (
            <ThemedText type="small" themeColor="silence">
              {formError}
            </ThemedText>
          )}

          <Pressable style={styles.submit} onPress={handleSubmit}>
            <ThemedText type="smallBold" themeColor="accentText">
              See tonight’s plate
            </ThemedText>
          </Pressable>

          {meal && grid && (
            <>
              <ThemedView type="surface" style={styles.card}>
                <ThemedText type="smallBold">Eat now</ThemedText>
                <CurveBand series={meal.eatNow.curve} tMin={meal.tMin} basalMgdl={meal.basalMgdl} />
                <SummaryRow summary={meal.eatNow.summary} />
              </ThemedView>

              {onMeds ? (
                <ThemedView type="surface" style={styles.card}>
                  <ThemedText type="smallBold">{grid.labels.medication}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Walk-timing advice is hidden because you take medicine that affects blood sugar.
                  </ThemedText>
                </ThemedView>
              ) : (
                <ThemedView type="surface" style={styles.card}>
                  <ThemedText type="smallBold">{grid.labels.walk}</ThemedText>
                  <CurveBand
                    series={meal.withWalk.curve}
                    tMin={meal.tMin}
                    basalMgdl={meal.basalMgdl}
                    walkWindow={{
                      startMin: grid.walk_calibration.walk_start_min,
                      endMin: grid.walk_calibration.walk_end_min,
                    }}
                  />
                  <SummaryRow summary={meal.withWalk.summary} />
                  <ThemedText type="small" themeColor="textMuted">
                    Source: {grid.walk_calibration.source}
                  </ThemedText>
                </ThemedView>
              )}

              <ThemedText type="small" themeColor="textMuted">
                {grid.labels.curve} ({VARIANT_LABEL[meal.variant]}, source: {grid.variant_rule.source}).
              </ThemedText>
            </>
          )}

          {coffeeResult && (
            <ThemedView type="surface" style={[styles.card, CardShadow]}>
              <ThemedText type="smallBold">Last coffee</ThemedText>
              {coffeeResult.byClockTime ? (
                <ThemedText type="default">Have your last coffee by {coffeeResult.byClockTime} tonight.</ThemedText>
              ) : (
                <ThemedText type="default">You&apos;re already under the bedtime caffeine threshold.</ThemedText>
              )}
            </ThemedView>
          )}
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
  scroll: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    gap: Spacing.three,
  },
  row: { flexDirection: 'row', gap: Spacing.two },
  submit: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  card: {
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.four,
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stat: { alignItems: 'center', gap: Spacing.half },
  statValue: { fontSize: 18, lineHeight: 22 },
});
