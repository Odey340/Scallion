import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Field, NumberInput, SegmentButton } from '@/components/form-controls';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Colors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import {
  computeFitnessAge,
  FALLBACK_PAI_OPTIONS,
  type FitnessAgeResult,
  type HuntData,
  type Sex,
} from '@/engine/fitness-age';
import { api, hasToken } from '@/lib/api';
import { setLocalClock } from '@/state/clock-store';

/**
 * QR landing: fitness age in ten seconds, no login. docs/lanes/C.md Block 1.
 * Reads A's export at web/public/engine/hunt.json (Nes 2011 VO2max model, Kurtze 2008 PAI).
 */
export default function StartScreen() {
  const [hunt, setHunt] = useState<HuntData | null>(null);
  const [huntError, setHuntError] = useState<string | null>(null);

  const [age, setAge] = useState('');
  const [sex, setSex] = useState<Sex>('M');
  const [waistCm, setWaistCm] = useState('');
  const [rhr, setRhr] = useState('');
  const [paiIndex, setPaiIndex] = useState<number | null>(null);

  const [result, setResult] = useState<FitnessAgeResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/engine/hunt.json')
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then(setHunt)
      .catch(() => setHuntError('Could not load the fitness-age model (hunt.json).'));
  }, []);

  const paiOptions = hunt?.pai_options ?? FALLBACK_PAI_OPTIONS;

  const handleSubmit = () => {
    setFormError(null);
    setResult(null);

    if (!hunt) {
      setFormError('Still loading the fitness-age model.');
      return;
    }
    if (!age || !waistCm || !rhr || paiIndex === null) {
      setFormError('Fill in every field.');
      return;
    }

    const ageNum = Number(age);
    const waistNum = Number(waistCm);
    const rhrNum = Number(rhr);
    if (!Number.isFinite(ageNum) || !Number.isFinite(waistNum) || !Number.isFinite(rhrNum)) {
      setFormError('Age, waist, and resting heart rate must be numbers.');
      return;
    }

    try {
      const computed = computeFitnessAge({ age: ageNum, sex, waistCm: waistNum, rhr: rhrNum, pai: paiOptions[paiIndex].pai }, hunt);
      setResult(computed);
      // Home shows this clock until labs replace it (clock-store); the API row lets the coach speak about it.
      setLocalClock({
        clock: 'fitness',
        years: computed.fitnessAge,
        chronologicalAge: ageNum,
        band: computed.band,
        computedAt: new Date().toISOString(),
      });
      if (hasToken()) {
        api
          .postClock({
            clock: 'fitness',
            years: computed.fitnessAge,
            chronological_age: ageNum,
            band: computed.band,
            inputs: { vo2max: computed.vo2max, waist_cm: waistNum, rhr: rhrNum, pai: paiOptions[paiIndex].pai, sex },
            engine_version: String(hunt.version ?? 1),
          })
          .catch(() => undefined); // best-effort: the number on screen does not depend on the API
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not compute a fitness age.');
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scrollOuter} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <ThemedText type="subtitle">Your fitness age</ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            Ten seconds, no login. Estimate, not diagnosis.
          </ThemedText>

          {huntError && (
            <ThemedText type="small" themeColor="silence">
              {huntError}
            </ThemedText>
          )}

          <Field label="Age (years)">
            <NumberInput value={age} onChangeText={setAge} placeholder="34" />
          </Field>

          <Field label="Sex">
            <View style={styles.row}>
              <SegmentButton label="Male" active={sex === 'M'} onPress={() => setSex('M')} />
              <SegmentButton label="Female" active={sex === 'F'} onPress={() => setSex('F')} />
            </View>
          </Field>

          <Field label="Waist (cm)">
            <NumberInput value={waistCm} onChangeText={setWaistCm} placeholder="85" />
          </Field>

          <Field label="Resting heart rate (bpm)">
            <NumberInput value={rhr} onChangeText={setRhr} placeholder="62" />
          </Field>

          <Field label="How often do you exercise hard enough to raise your heart rate?">
            <View style={styles.wrap}>
              {paiOptions.map((option, index) => (
                <SegmentButton
                  key={option.key}
                  label={option.label}
                  active={paiIndex === index}
                  onPress={() => setPaiIndex(index)}
                />
              ))}
            </View>
          </Field>

          {formError && (
            <ThemedText type="small" themeColor="silence">
              {formError}
            </ThemedText>
          )}

          <Pressable style={styles.submit} onPress={handleSubmit}>
            <ThemedText type="smallBold" themeColor="accentText">
              Get my fitness age
            </ThemedText>
          </Pressable>

          {result && (
            <ThemedView type="surface" style={styles.resultCard}>
              <ThemedText type="numeric">{Math.round(result.fitnessAge)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                fitness age, +/- {Math.round(result.band)} years
              </ThemedText>
              <ThemedText type="small" themeColor="textMuted" style={styles.disclaimer}>
                Estimate, not diagnosis. {hunt?.label ?? 'From age, waist, resting pulse and activity.'}
                {hunt?.vo2max_source ? ` VO2max: ${hunt.vo2max_source}.` : ''}
                {hunt?.pai_source ? ` Activity index: ${hunt.pai_source}.` : ''}
              </ThemedText>
            </ThemedView>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignItems: 'center' },
  scrollOuter: { flex: 1, width: '100%' },
  scroll: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    gap: Spacing.four,
  },
  row: { flexDirection: 'row', gap: Spacing.two },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  submit: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  resultCard: {
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.four,
    gap: Spacing.one,
    alignItems: 'center',
    ...CardShadow,
  },
  disclaimer: {
    textAlign: 'center',
    marginTop: Spacing.two,
  },
});
