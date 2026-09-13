import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedPressable, FadeInUp } from '@/components/animated';
import { ChoiceGroup, Field, NumberInput, SegmentButton, TextField } from '@/components/form-controls';
import { ProfileValue } from '@/components/profile-value';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BEDTIME_PRESETS, CAFFEINE_SOURCE, CUP_PRESETS, cupLabel, formatClock, isValidClock, normalizeClock } from '@/constants/profile-options';
import { Colors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { lastCoffeeHoursBeforeBed, subtractHours, type CaffeineData } from '@/engine/caffeine';
import { computeMealCurves, type MealComputation, type MealGrid } from '@/engine/meal';
import { updateProfile, useProfile, type UserProfile } from '@/state/profile-store';
import { diffScanProfile, pickChanged, type ScanProfileField, type ScanProfileValues } from '@/state/scan-profile';
import { setScanResult, type GeminiEstimate, type ScanResult } from '@/state/scan-store';

const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
const LB_PER_KG = 2.20462;

const FIELD_LABEL: Record<ScanProfileField, string> = {
  weightLb: 'weight',
  fastingGlucoseMgdl: 'fasting glucose',
  on_glucose_meds: 'medication',
  coffee_mg_per_cup: 'usual cup',
  bedtime: 'bedtime',
};

function formatField(field: ScanProfileField, p: Partial<UserProfile>): string | null {
  switch (field) {
    case 'weightLb':
      return p.weightLb !== undefined ? `${p.weightLb} lb` : null;
    case 'fastingGlucoseMgdl':
      return p.fastingGlucoseMgdl !== undefined ? `${p.fastingGlucoseMgdl} mg/dL` : null;
    case 'on_glucose_meds':
      if (p.on_glucose_meds !== undefined) return p.on_glucose_meds ? 'Yes' : 'No';
      return p.glucoseMedsDeclined ? 'Not given' : null;
    case 'coffee_mg_per_cup':
      return p.coffee_mg_per_cup !== undefined ? cupLabel(p.coffee_mg_per_cup) : null;
    case 'bedtime':
      return p.bedtime ? formatClock(p.bedtime) : null;
  }
}

function joinFields(fields: ScanProfileField[]): string {
  const names = fields.map((f) => FIELD_LABEL[f]);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Scan any meal — not just dinner. Photo -> Gemini carbs estimate (or type it in) ->
 * two glucose CurveBands from A's meal_grid.json, plus the caffeine last-coffee line.
 * Carbs are this meal only; weight, fasting glucose, medication, usual cup and bedtime come from
 * the profile and are only written back when the user chooses "Save to profile".
 */
export default function ScanScreen() {
  const router = useRouter();
  const profile = useProfile();

  const [grid, setGrid] = useState<MealGrid | null>(null);
  const [caffeine, setCaffeine] = useState<CaffeineData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mealType, setMealType] = useState<string | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [gemini, setGemini] = useState<GeminiEstimate | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [carbsG, setCarbsG] = useState('');
  // Local text only matters while a field is being edited or has nothing saved yet; otherwise the
  // live profile value is used, so a change made on another screen can never go stale here.
  const [fastingMgdl, setFastingMgdl] = useState('');
  const [weightLb, setWeightLb] = useState('');
  const [onMeds, setOnMeds] = useState<boolean | null>(null);
  const [cupMg, setCupMg] = useState('');
  const [bedtime, setBedtime] = useState('');
  const [editing, setEditing] = useState<Partial<Record<ScanProfileField, boolean>>>({});
  const [saveChoice, setSaveChoice] = useState<'save' | 'once' | null>(null);

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
      .catch(() => setLoadError('The meal model could not be loaded. Check your connection and reload.'));
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
      setPhotoError('We couldn’t read the photo. Enter the carbs below instead.');
    } finally {
      setAnalyzing(false);
    }
  };

  const numOrUndefined = (s: string) => (s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : undefined);

  const usingSaved = (field: ScanProfileField) => !editing[field] && formatField(field, profile) !== null;

  // What this meal uses for each profile fact: the saved value, or what the user typed.
  const values: ScanProfileValues = {
    weightLb: usingSaved('weightLb') ? profile.weightLb : numOrUndefined(weightLb),
    fastingGlucoseMgdl: usingSaved('fastingGlucoseMgdl') ? profile.fastingGlucoseMgdl : numOrUndefined(fastingMgdl),
    on_glucose_meds: usingSaved('on_glucose_meds') ? profile.on_glucose_meds : (onMeds ?? undefined),
    coffee_mg_per_cup: usingSaved('coffee_mg_per_cup') ? profile.coffee_mg_per_cup : numOrUndefined(cupMg),
    bedtime: usingSaved('bedtime') ? profile.bedtime : bedtime && isValidClock(bedtime) ? normalizeClock(bedtime) : undefined,
  };
  const diff = diffScanProfile(values, profile);
  const willSave = diff.changed.length > 0 && (saveChoice ?? (diff.defaultSave ? 'save' : 'once')) === 'save';
  const medsUnknown = usingSaved('on_glucose_meds') && profile.on_glucose_meds === undefined && Boolean(profile.glucoseMedsDeclined);

  const setEditingField = (field: ScanProfileField, on: boolean) => setEditing((e) => ({ ...e, [field]: on }));

  /** Tapping Edit starts from the saved value, not an empty box. */
  const startEdit = (field: ScanProfileField) => {
    if (field === 'weightLb') setWeightLb(profile.weightLb !== undefined ? String(profile.weightLb) : '');
    if (field === 'fastingGlucoseMgdl') setFastingMgdl(profile.fastingGlucoseMgdl !== undefined ? String(profile.fastingGlucoseMgdl) : '');
    if (field === 'on_glucose_meds') setOnMeds(profile.on_glucose_meds ?? null);
    if (field === 'coffee_mg_per_cup') setCupMg(profile.coffee_mg_per_cup !== undefined ? String(profile.coffee_mg_per_cup) : '');
    if (field === 'bedtime') setBedtime(profile.bedtime ?? '');
    setEditingField(field, true);
  };
  const stopEdit = (field: ScanProfileField) => setEditingField(field, false);

  const handleSubmit = () => {
    setFormError(null);

    if (!grid || !caffeine) {
      setFormError('Still loading the meal model.');
      return;
    }
    const carbsNum = numOrUndefined(carbsG);
    if (carbsNum === undefined || values.fastingGlucoseMgdl === undefined || values.weightLb === undefined) {
      setFormError('Carbs, fasting glucose and weight are all needed for the estimate.');
      return;
    }
    if (values.on_glucose_meds === undefined && !medsUnknown) {
      setFormError('Answer the medication question — it decides whether walk advice is shown.');
      return;
    }
    if (!usingSaved('bedtime') && bedtime && !isValidClock(bedtime)) {
      setFormError('Bedtime should look like 22:30.');
      return;
    }

    let meal: MealComputation;
    try {
      meal = computeMealCurves({ carbsG: carbsNum, fastingMgdl: values.fastingGlucoseMgdl, weightKg: values.weightLb / LB_PER_KG }, grid);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not compute a curve for this meal.');
      return;
    }

    let coffee: ScanResult['coffee'] = null;
    if (values.coffee_mg_per_cup !== undefined && values.bedtime) {
      const hoursBefore = lastCoffeeHoursBeforeBed(
        values.coffee_mg_per_cup,
        { smoker: profile.smoker ?? false, oralContraceptive: profile.oral_contraceptive ?? false },
        caffeine,
      );
      coffee = { hoursBefore, byClockTime: hoursBefore > 0 ? subtractHours(values.bedtime, hoursBefore) : null };
    }

    if (willSave) {
      const patch: Partial<UserProfile> = pickChanged(values, diff.changed);
      if (diff.changed.includes('on_glucose_meds')) patch.glucoseMedsDeclined = false;
      updateProfile(patch);
      setEditing({});
      setSaveChoice(null);
    }

    setScanResult({
      meal,
      mealType: mealType ?? 'Meal',
      onMeds: values.on_glucose_meds === true,
      medsUnknown,
      carbsSource: gemini ? 'photo' : 'manual',
      gemini,
      coffee,
    });
    router.push('/scan-results');
  };

  const savedNote = 'From your profile';
  const cupIsPreset = CUP_PRESETS.some((p) => String(p.mg) === cupMg);
  const bedtimeIsPreset = (BEDTIME_PRESETS as readonly string[]).includes(bedtime);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scrollOuter} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.scroll}>
            <FadeInUp delay={0}>
              <ThemedText type="subtitle">Your meal</ThemedText>
              <ThemedText type="default" themeColor="textSecondary">
                A modeled glucose response for any meal. Estimate, not diagnosis.
              </ThemedText>
              {loadError && (
                <ThemedText type="small" themeColor="silence">
                  {loadError}
                </ThemedText>
              )}
            </FadeInUp>

            <FadeInUp delay={70} style={{ gap: Spacing.three }}>
              <Field label="What are you having?">
                <View style={styles.wrap}>
                  {MEAL_TYPES.map((type) => (
                    <SegmentButton key={type} label={type} active={mealType === type} onPress={() => setMealType(type)} />
                  ))}
                </View>
              </Field>
            </FadeInUp>

            <FadeInUp delay={140} style={{ gap: Spacing.three }}>
              <Field label="Photo of the plate (optional)">
                <View style={styles.row}>
                  <AnimatedPressable style={styles.photoButton} onPress={() => pickImage('camera')}>
                    <ThemedText type="small" themeColor="accentText">
                      Take photo
                    </ThemedText>
                  </AnimatedPressable>
                  <AnimatedPressable style={styles.photoButton} onPress={() => pickImage('library')}>
                    <ThemedText type="small" themeColor="accentText">
                      Choose photo
                    </ThemedText>
                  </AnimatedPressable>
                </View>
              </Field>

              {imageUri && <Image source={{ uri: imageUri }} style={styles.thumbnail} />}
              {analyzing && (
                <View style={styles.row}>
                  <ActivityIndicator color={Colors.accent} />
                  <ThemedText type="small" themeColor="textSecondary">
                    Estimating the carbohydrates on your plate…
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
                {gemini ? 'Estimated from your photo — check it and adjust if it looks off.' : 'For this meal only. A photo fills this in.'}
              </ThemedText>
            </FadeInUp>

            <FadeInUp delay={210}>
              <View style={styles.section}>
                <ThemedText type="smallBold">About you</ThemedText>
                <ThemedText type="small" themeColor="textMuted">
                  The model needs these for a curve typical of someone like you.
                </ThemedText>

                <ProfileValue
                  label="Fasting glucose"
                  value={formatField('fastingGlucoseMgdl', profile)}
                  note={savedNote}
                  editing={Boolean(editing.fastingGlucoseMgdl)}
                  onEdit={() => startEdit('fastingGlucoseMgdl')}
                  onRevert={profile.fastingGlucoseMgdl !== undefined ? () => stopEdit('fastingGlucoseMgdl') : undefined}
                  revertLabel={`Use saved (${formatField('fastingGlucoseMgdl', profile)})`}>
                  <NumberInput value={fastingMgdl} onChangeText={setFastingMgdl} placeholder="mg/dL, e.g. 92" />
                </ProfileValue>

                <ProfileValue
                  label="Weight"
                  value={formatField('weightLb', profile)}
                  note={savedNote}
                  editing={Boolean(editing.weightLb)}
                  onEdit={() => startEdit('weightLb')}
                  onRevert={profile.weightLb !== undefined ? () => stopEdit('weightLb') : undefined}
                  revertLabel={`Use saved (${formatField('weightLb', profile)})`}>
                  <NumberInput value={weightLb} onChangeText={setWeightLb} placeholder="lb, e.g. 172" />
                </ProfileValue>

                <ProfileValue
                  label="Medicine that affects blood sugar"
                  value={formatField('on_glucose_meds', profile)}
                  note={medsUnknown ? 'Not given, so walk-timing advice stays hidden' : savedNote}
                  editing={Boolean(editing.on_glucose_meds)}
                  onEdit={() => startEdit('on_glucose_meds')}
                  onRevert={formatField('on_glucose_meds', profile) !== null ? () => stopEdit('on_glucose_meds') : undefined}
                  revertLabel={`Use saved (${formatField('on_glucose_meds', profile)})`}>
                  <ChoiceGroup
                    options={[
                      { value: false, label: 'No' },
                      { value: true, label: 'Yes' },
                    ]}
                    value={onMeds}
                    onChange={setOnMeds}
                  />
                </ProfileValue>
              </View>
            </FadeInUp>

            <FadeInUp delay={280}>
              <View style={styles.section}>
                <ThemedText type="smallBold">Tonight&apos;s coffee (optional)</ThemedText>
                <ThemedText type="small" themeColor="textMuted">
                  With your usual cup and bedtime, we&apos;ll add the latest time for a last coffee.
                </ThemedText>

                <ProfileValue
                  label="Your usual cup"
                  value={formatField('coffee_mg_per_cup', profile)}
                  note={savedNote}
                  editing={Boolean(editing.coffee_mg_per_cup)}
                  onEdit={() => startEdit('coffee_mg_per_cup')}
                  onRevert={profile.coffee_mg_per_cup !== undefined ? () => stopEdit('coffee_mg_per_cup') : undefined}
                  revertLabel={`Use saved (${formatField('coffee_mg_per_cup', profile)})`}>
                  <ChoiceGroup
                    options={CUP_PRESETS.map((p) => ({ value: String(p.mg), label: p.label, description: p.detail }))}
                    value={cupIsPreset ? cupMg : null}
                    onChange={setCupMg}
                  />
                  <NumberInput value={cupMg} onChangeText={setCupMg} placeholder="Or exact mg" />
                  <ThemedText type="small" themeColor="textMuted">
                    {CAFFEINE_SOURCE}
                  </ThemedText>
                </ProfileValue>

                <ProfileValue
                  label="Bedtime"
                  value={formatField('bedtime', profile)}
                  note={savedNote}
                  editing={Boolean(editing.bedtime)}
                  onEdit={() => startEdit('bedtime')}
                  onRevert={profile.bedtime ? () => stopEdit('bedtime') : undefined}
                  revertLabel={`Use saved (${formatField('bedtime', profile)})`}>
                  <ChoiceGroup
                    options={BEDTIME_PRESETS.map((t) => ({ value: t, label: formatClock(t) }))}
                    value={bedtimeIsPreset ? bedtime : null}
                    onChange={setBedtime}
                  />
                  <TextField value={bedtime} onChangeText={setBedtime} placeholder="Or exact time, e.g. 22:45" />
                </ProfileValue>
              </View>
            </FadeInUp>

            <FadeInUp delay={350} style={{ gap: Spacing.three }}>
              {diff.changed.length > 0 && (
                <ThemedView type="surfaceRaised" style={styles.saveBox}>
                  <ThemedText type="small">
                    {diff.overwrites.length > 0
                      ? `You changed your ${joinFields(diff.overwrites)} for this meal.`
                      : `Save your ${joinFields(diff.changed)} so you don't have to enter ${diff.changed.length > 1 ? 'them' : 'it'} again?`}
                  </ThemedText>
                  <ChoiceGroup
                    options={[
                      { value: 'once', label: 'Just this meal' },
                      { value: 'save', label: 'Save to profile' },
                    ]}
                    value={willSave ? 'save' : 'once'}
                    onChange={(v) => setSaveChoice(v as 'save' | 'once')}
                  />
                </ThemedView>
              )}

              {formError && (
                <ThemedText type="small" themeColor="silence">
                  {formError}
                </ThemedText>
              )}

              <AnimatedPressable style={styles.submit} onPress={handleSubmit}>
                <ThemedText type="smallBold" themeColor="accentText">
                  See results
                </ThemedText>
              </AnimatedPressable>
            </FadeInUp>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, alignItems: 'center' },
  scrollOuter: { flex: 1, width: '100%' },
  scrollContent: { alignItems: 'center' },
  scroll: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    gap: Spacing.four,
  },
  section: { gap: Spacing.one },
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
  saveBox: {
    borderRadius: Radius.small,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  submit: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
});
