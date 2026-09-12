import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Field, NumberInput, SegmentButton, TextField } from '@/components/form-controls';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { lastCoffeeHoursBeforeBed, subtractHours, type CaffeineData } from '@/engine/caffeine';
import { computeMealCurves, type MealComputation, type MealGrid } from '@/engine/meal';
import { setScanResult, type GeminiEstimate, type ScanResult } from '@/state/scan-store';

const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
const LB_PER_KG = 2.20462;

/**
 * Scan any meal — not just dinner. Photo -> Gemini carbs estimate (or type it in) ->
 * two glucose CurveBands from A's meal_grid.json, plus the caffeine last-coffee line.
 * The full breakdown lives on the results page; this screen only gathers inputs.
 */
export default function ScanScreen() {
  const router = useRouter();

  const [grid, setGrid] = useState<MealGrid | null>(null);
  const [caffeine, setCaffeine] = useState<CaffeineData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mealType, setMealType] = useState<string | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [gemini, setGemini] = useState<GeminiEstimate | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [carbsG, setCarbsG] = useState('');
  const [fastingMgdl, setFastingMgdl] = useState('');
  const [weightLb, setWeightLb] = useState('');
  const [onMeds, setOnMeds] = useState<boolean | null>(null);
  const [caffeineMg, setCaffeineMg] = useState('');
  const [bedtime, setBedtime] = useState('');

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

  const pickImage = async (source: 'camera' | 'library') => {
    setPhotoError(null);
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPhotoError('Permission was not granted.');
      return;
    }

    const result = await (source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync)({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.5,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;

    const asset = result.assets[0];
    setImageUri(asset.uri);
    setGemini(null);
    await analyzePhoto(asset.base64!, asset.mimeType ?? 'image/jpeg');
  };

  const analyzePhoto = async (base64: string, mimeType: string) => {
    setAnalyzing(true);
    setPhotoError(null);
    try {
      const res = await fetch('/api/estimate-carbs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data: GeminiEstimate = await res.json();
      setGemini(data);
      setCarbsG(String(Math.round(data.carbs_g)));
    } catch {
      setPhotoError('Could not analyze the photo — enter carbs manually below.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSubmit = () => {
    setFormError(null);

    if (!grid || !caffeine) {
      setFormError('Still loading the meal model.');
      return;
    }
    if (!carbsG || !fastingMgdl || !weightLb || onMeds === null) {
      setFormError('Fill in carbs, fasting glucose, weight, and the medication question.');
      return;
    }

    const carbsNum = Number(carbsG);
    const fastingNum = Number(fastingMgdl);
    const weightLbNum = Number(weightLb);
    if (!Number.isFinite(carbsNum) || !Number.isFinite(fastingNum) || !Number.isFinite(weightLbNum)) {
      setFormError('Carbs, fasting glucose, and weight must be numbers.');
      return;
    }

    const weightKgNum = weightLbNum / LB_PER_KG;

    let meal: MealComputation;
    try {
      meal = computeMealCurves({ carbsG: carbsNum, fastingMgdl: fastingNum, weightKg: weightKgNum }, grid);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not compute a curve for this meal.');
      return;
    }

    let coffee: ScanResult['coffee'] = null;
    if (caffeineMg && bedtime) {
      const doseNum = Number(caffeineMg);
      if (Number.isFinite(doseNum)) {
        const hoursBefore = lastCoffeeHoursBeforeBed(doseNum, { smoker: false, oralContraceptive: false }, caffeine);
        coffee = { hoursBefore, byClockTime: hoursBefore > 0 ? subtractHours(bedtime, hoursBefore) : null };
      }
    }

    setScanResult({
      meal,
      mealType: mealType ?? 'Meal',
      onMeds: onMeds === true,
      carbsSource: gemini ? 'photo' : 'manual',
      gemini,
      coffee,
    });
    router.push('/scan-results');
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scrollOuter} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <ThemedText type="subtitle">Your meal</ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            Breakfast, lunch, dinner, or a snack — estimate, not diagnosis.
          </ThemedText>

          {loadError && (
            <ThemedText type="small" themeColor="silence">
              {loadError}
            </ThemedText>
          )}

          <Field label="What meal is this?">
            <View style={styles.wrap}>
              {MEAL_TYPES.map((type) => (
                <SegmentButton key={type} label={type} active={mealType === type} onPress={() => setMealType(type)} />
              ))}
            </View>
          </Field>

          <Field label="Photo of the plate (optional)">
            <View style={styles.row}>
              <Pressable style={styles.photoButton} onPress={() => pickImage('camera')}>
                <ThemedText type="small" themeColor="accentText">
                  Take photo
                </ThemedText>
              </Pressable>
              <Pressable style={styles.photoButton} onPress={() => pickImage('library')}>
                <ThemedText type="small" themeColor="accentText">
                  Choose photo
                </ThemedText>
              </Pressable>
            </View>
          </Field>

          {imageUri && <Image source={{ uri: imageUri }} style={styles.thumbnail} />}
          {analyzing && (
            <View style={styles.row}>
              <ActivityIndicator color={Colors.accent} />
              <ThemedText type="small" themeColor="textSecondary">
                Analyzing photo…
              </ThemedText>
            </View>
          )}
          {gemini && (
            <ThemedText type="small" themeColor="textSecondary">
              {gemini.food_description} ({gemini.confidence} confidence)
            </ThemedText>
          )}
          {photoError && (
            <ThemedText type="small" themeColor="silence">
              {photoError}
            </ThemedText>
          )}

          <Field label="Carbs on the plate (g)">
            <NumberInput value={carbsG} onChangeText={setCarbsG} placeholder="60" />
          </Field>
          <ThemedText type="small" themeColor="textMuted">
            Pre-filled from your photo when available — always editable.
          </ThemedText>

          <Field label="Fasting glucose (mg/dL)">
            <NumberInput value={fastingMgdl} onChangeText={setFastingMgdl} placeholder="95" />
          </Field>

          <Field label="Weight (lb)">
            <NumberInput value={weightLb} onChangeText={setWeightLb} placeholder="172" />
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
              See results
            </ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignItems: 'center' },
  scrollOuter: { flex: 1, width: '100%', alignItems: 'center' },
  scroll: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    gap: Spacing.three,
  },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  photoButton: {
    flex: 1,
    backgroundColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  thumbnail: {
    width: 120,
    height: 120,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  submit: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
});
