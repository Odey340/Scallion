import { CameraView, useCameraPermissions } from 'expo-camera';
import { Link } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Field, NumberInput, SegmentButton } from '@/components/form-controls';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Colors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { computeFitnessAge, FALLBACK_PAI_OPTIONS, type FitnessAgeResult, type HuntData, type Sex } from '@/engine/fitness-age';
import { ApiError, api, hasToken, type VitalsOut } from '@/lib/api';
import { setFitnessInputs, setLocalClock, useFitnessInputs } from '@/state/clock-store';
import { useLocalUser } from '@/state/local-identity';

/**
 * Camera: thirty seconds of face for pulse and breathing (docs/lanes/C.md Blocks 1 and 3).
 *
 * The measurement is Presage SmartSpectra, run by Lane D's worker (presage-worker/) on the demo
 * laptop's webcam; it POSTs the contract's /vitals payload and this screen reads /vitals/latest.
 * The phone's camera preview is for framing and the countdown; frames never leave the device.
 * The quality bar is the worker's own confidence once a reading arrives, never a number invented
 * here. Fitness age from the measured pulse re-runs A's hunt.json model with the /start inputs.
 * Perceived age (@vladmandic/human) is first in the cut order and is not in this build.
 */

const CAPTURE_SECONDS = 30;
const SETTLE_SECONDS = 25; // the worker posts after its own settle; keep polling a little longer
const POLL_MS = 3000;

type Phase = 'idle' | 'capturing' | 'settling' | 'done' | 'timeout';

export default function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const localUser = useLocalUser();
  const inputs = useFitnessInputs();

  const [hunt, setHunt] = useState<HuntData | null>(null);
  const [latest, setLatest] = useState<VitalsOut | null>(null);
  const [latestError, setLatestError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [secondsLeft, setSecondsLeft] = useState(CAPTURE_SECONDS);
  const [reading, setReading] = useState<VitalsOut | null>(null);
  const captureStart = useRef<number>(0);
  const [captureStartMs, setCaptureStartMs] = useState(0);
  const timers = useRef<{ tick?: ReturnType<typeof setInterval>; poll?: ReturnType<typeof setInterval>; stop?: ReturnType<typeof setTimeout> }>({});

  const clearTimers = () => {
    if (timers.current.tick) clearInterval(timers.current.tick);
    if (timers.current.poll) clearInterval(timers.current.poll);
    if (timers.current.stop) clearTimeout(timers.current.stop);
    timers.current = {};
  };

  const [ageText, setAgeText] = useState(inputs ? String(inputs.age) : '');
  const [sex, setSex] = useState<Sex>(inputs?.sex ?? 'M');
  const [waistText, setWaistText] = useState(inputs ? String(inputs.waistCm) : '');
  const [paiKey, setPaiKey] = useState<string | null>(inputs?.paiKey ?? null);
  const [fitness, setFitness] = useState<FitnessAgeResult | null>(null);
  const [fitnessError, setFitnessError] = useState<string | null>(null);

  const fetchLatest = useCallback(async (): Promise<VitalsOut | null> => {
    if (!hasToken()) return null;
    try {
      const row = await api.latestVitals();
      setLatest(row);
      setLatestError(null);
      return row;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setLatestError(null);
      else setLatestError('Could not reach the API.');
      return null;
    }
  }, []);

  useEffect(() => {
    fetch('/engine/hunt.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setHunt)
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLatest();
    return () => clearTimers();
  }, [fetchLatest]);

  const finish = (row: VitalsOut) => {
    clearTimers();
    setReading(row);
    setPhase('done');
  };

  const [previewAvailable, setPreviewAvailable] = useState(true);

  const start = async () => {
    let granted = permission?.granted ?? false;
    if (!granted) {
      const res = await requestPermission().catch(() => null);
      granted = res?.granted ?? false;
    }
    // No preview is not a blocker: the measurement runs on the laptop webcam; the countdown still helps.
    setPreviewAvailable(granted);
    setReading(null);
    setFitness(null);
    captureStart.current = Date.now();
    setCaptureStartMs(captureStart.current);
    setSecondsLeft(CAPTURE_SECONDS);
    setPhase('capturing');
    timers.current.tick = setInterval(() => {
      const elapsed = Math.floor((Date.now() - captureStart.current) / 1000);
      const left = Math.max(0, CAPTURE_SECONDS - elapsed);
      setSecondsLeft(left);
      if (left === 0) setPhase((p) => (p === 'capturing' ? 'settling' : p));
    }, 500);
    timers.current.poll = setInterval(async () => {
      const row = await fetchLatest();
      if (row && new Date(row.captured_at).getTime() >= captureStart.current - 60_000) finish(row);
    }, POLL_MS);
    timers.current.stop = setTimeout(() => {
      clearTimers();
      setPhase((p) => (p === 'done' ? p : 'timeout'));
    }, (CAPTURE_SECONDS + SETTLE_SECONDS) * 1000);
  };

  const stop = () => {
    clearTimers();
    setPhase('idle');
  };

  const shown = reading ?? latest;
  const paiOptions = hunt?.pai_options ?? FALLBACK_PAI_OPTIONS;

  const computeFitness = () => {
    setFitnessError(null);
    if (!hunt || !shown) return;
    const age = Number(ageText);
    const waist = Number(waistText);
    const pai = paiOptions.find((o) => o.key === paiKey);
    if (!Number.isFinite(age) || !Number.isFinite(waist) || !pai || age <= 0 || waist <= 0) {
      setFitnessError('Age, waist and an activity level are needed (the HUNT model uses all four).');
      return;
    }
    try {
      const r = computeFitnessAge({ age, sex, waistCm: waist, rhr: shown.pulse_bpm, pai: pai.pai }, hunt);
      setFitness(r);
      setFitnessInputs({ age, sex, waistCm: waist, pai: pai.pai, paiKey: pai.key });
      setLocalClock({ clock: 'fitness', years: r.fitnessAge, chronologicalAge: age, band: r.band, computedAt: new Date().toISOString() });
      if (hasToken()) {
        api
          .postClock({
            clock: 'fitness',
            years: r.fitnessAge,
            chronological_age: age,
            band: r.band,
            inputs: { vo2max: r.vo2max, waist_cm: waist, rhr: shown.pulse_bpm, rhr_source: shown.source, pai: pai.pai, sex },
            engine_version: String(hunt.version ?? 1),
          })
          .catch(() => undefined);
      }
    } catch (e) {
      setFitnessError(e instanceof Error ? e.message : 'Could not compute a fitness age.');
    }
  };

  const confidence = phase === 'done' && reading?.confidence != null ? reading.confidence : null;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scrollOuter} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <ThemedText type="subtitle">Pulse and breathing from your face</ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            Thirty seconds, no wearable. Presage SmartSpectra reads pulse and breathing from skin colour changes. Estimate,
            not diagnosis.
          </ThemedText>

          {/* Capture */}
          <ThemedView type="surface" style={[styles.card, CardShadow]}>
            {phase === 'idle' || phase === 'done' || phase === 'timeout' ? (
              <>
                <ThemedText type="smallBold">Measure now</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Face the light, hold still, keep your face inside the oval. The camera preview stays on this device; the
                  measurement runs on the demo laptop&apos;s webcam and the numbers appear here.
                </ThemedText>
                {permission && !permission.granted && !permission.canAskAgain && (
                  <ThemedText type="small" themeColor="silence">
                    Camera permission was denied. Allow it in your browser or system settings to see the preview.
                  </ThemedText>
                )}
                {phase === 'timeout' && (
                  <ThemedText type="small" themeColor="silence">
                    No reading arrived. On the demo laptop run the worker (`node index.mjs`, or `--replay` for the recorded
                    capture) and start again.
                  </ThemedText>
                )}
                <Pressable style={styles.primaryButton} onPress={start}>
                  <ThemedText type="smallBold" themeColor="accentText">
                    {phase === 'idle' ? 'Start 30-second capture' : 'Measure again'}
                  </ThemedText>
                </Pressable>
              </>
            ) : (
              <>
                <View style={styles.previewWrap}>
                  {previewAvailable ? (
                    <CameraView style={styles.preview} facing="front" mirror />
                  ) : (
                    <View style={[styles.preview, styles.previewFallback]}>
                      <ThemedText type="small" style={styles.previewFallbackText}>
                        Camera preview unavailable here (permission not granted). The countdown still runs; face the demo
                        laptop&apos;s webcam.
                      </ThemedText>
                    </View>
                  )}
                  <View pointerEvents="none" style={styles.oval} />
                  <View pointerEvents="none" style={styles.countdown}>
                    <ThemedText type="numeric" style={styles.countdownText}>
                      {phase === 'capturing' ? secondsLeft : '…'}
                    </ThemedText>
                  </View>
                </View>
                <QualityBar phase={phase} confidence={latest && new Date(latest.captured_at).getTime() >= captureStartMs - 60_000 ? latest.confidence : null} />
                <ThemedText type="small" themeColor="textSecondary">
                  {phase === 'capturing' ? 'Hold still. Breathe normally.' : 'Capture finished. Waiting for the reading to arrive…'}
                </ThemedText>
                <Pressable style={styles.secondaryButton} onPress={stop}>
                  <ThemedText type="smallBold" themeColor="accent">
                    Cancel
                  </ThemedText>
                </Pressable>
              </>
            )}
          </ThemedView>

          {/* Result */}
          {shown ? (
            <ThemedView type="surface" style={[styles.card, CardShadow]}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                {reading ? 'Your reading' : 'Latest reading'}
              </ThemedText>
              <View style={styles.vitalsRow}>
                <Vital label="Pulse" value={Math.round(shown.pulse_bpm)} unit="bpm" />
                <Vital label="Breathing" value={shown.breathing_bpm != null ? Math.round(shown.breathing_bpm) : null} unit="/min" />
                <Vital label="Stress index" value={shown.stress_index != null ? Math.round(shown.stress_index) : null} unit="Baevsky" />
              </View>
              <ThemedText type="small" themeColor="textMuted">
                HRV (RMSSD): {shown.hrv_rmssd_ms != null ? `${Math.round(shown.hrv_rmssd_ms)} ms` : 'not produced in this capture'}. Exploratory.
              </ThemedText>
              <ThemedText type="small" themeColor="textMuted">
                {shown.source === 'presage' ? 'Presage SmartSpectra' : 'Manual entry'}
                {shown.confidence != null ? `, confidence ${Math.round(shown.confidence * 100)}%` : ''}
                {shown.samples != null ? `, ${shown.samples} confident samples` : ''}. Captured{' '}
                {new Date(shown.captured_at).toLocaleString()}.
              </ThemedText>
              {confidence !== null && confidence < 0.5 && (
                <ThemedText type="small" themeColor="silence">
                  Low confidence. Better light and a still face give a cleaner signal; measure again.
                </ThemedText>
              )}
            </ThemedView>
          ) : (
            <ThemedView type="surfaceRaised" style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">
                {hasToken()
                  ? latestError ?? 'No reading yet. Start a capture, or run the worker on the demo laptop.'
                  : localUser
                    ? "Readings from the demo laptop's worker are stored on a real account, which this device doesn't have. Your capture above and the fitness age below still work fully on this device."
                    : 'Readings are stored against an account. Set up your Scallion profile to personalize the rest of the app; the capture preview and fitness age below work either way.'}
              </ThemedText>
              {!hasToken() && !localUser && (
                <Link href="/onboarding" asChild>
                  <Pressable style={styles.secondaryButton}>
                    <ThemedText type="smallBold" themeColor="accent">
                      Set up your profile
                    </ThemedText>
                  </Pressable>
                </Link>
              )}
            </ThemedView>
          )}

          {/* Fitness age from the measured pulse */}
          {shown && hunt && (
            <ThemedView type="surface" style={[styles.card, CardShadow]}>
              <ThemedText type="smallBold">Fitness age from this pulse</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Uses {Math.round(shown.pulse_bpm)} bpm as your resting heart rate in the HUNT VO2max model, with your age, waist and
                activity{inputs ? ' from /start' : ''}.
              </ThemedText>
              {fitness ? (
                <>
                  <View style={styles.clockRow}>
                    <ThemedText type="numeric" style={styles.bigNumber}>
                      {Math.round(fitness.fitnessAge)}
                    </ThemedText>
                    <View style={styles.clockMeta}>
                      <ThemedText type="small" themeColor="textSecondary">
                        +/- {Math.round(fitness.band)} years
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        fitness age, estimate not diagnosis
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText type="small" themeColor="textMuted">
                    {hunt.vo2max_source ? `VO2max: ${hunt.vo2max_source}. ` : ''}
                    {hunt.pai_source ? `Activity index: ${hunt.pai_source}.` : ''}
                  </ThemedText>
                  <Link href="/" asChild>
                    <Pressable style={styles.secondaryButton}>
                      <ThemedText type="smallBold" themeColor="accent">
                        See it on Home
                      </ThemedText>
                    </Pressable>
                  </Link>
                </>
              ) : (
                <>
                  {!inputs && (
                    <View style={styles.formRow}>
                      <View style={styles.formCol}>
                        <Field label="Age (years)">
                          <NumberInput value={ageText} onChangeText={setAgeText} placeholder="34" />
                        </Field>
                      </View>
                      <View style={styles.formCol}>
                        <Field label="Waist (cm)">
                          <NumberInput value={waistText} onChangeText={setWaistText} placeholder="85" />
                        </Field>
                      </View>
                    </View>
                  )}
                  {!inputs && (
                    <Field label="Sex">
                      <View style={styles.row}>
                        <SegmentButton label="Male" active={sex === 'M'} onPress={() => setSex('M')} />
                        <SegmentButton label="Female" active={sex === 'F'} onPress={() => setSex('F')} />
                      </View>
                    </Field>
                  )}
                  {!inputs && (
                    <Field label="How often do you exercise hard enough to raise your heart rate?">
                      <View style={styles.row}>
                        {paiOptions.map((o) => (
                          <SegmentButton key={o.key} label={o.label} active={paiKey === o.key} onPress={() => setPaiKey(o.key)} />
                        ))}
                      </View>
                    </Field>
                  )}
                  {fitnessError && (
                    <ThemedText type="small" themeColor="silence">
                      {fitnessError}
                    </ThemedText>
                  )}
                  <Pressable style={styles.primaryButton} onPress={computeFitness}>
                    <ThemedText type="smallBold" themeColor="accentText">
                      Fitness age from this pulse
                    </ThemedText>
                  </Pressable>
                </>
              )}
            </ThemedView>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function QualityBar({ phase, confidence }: { phase: Phase; confidence: number | null | undefined }) {
  const value = confidence ?? null;
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value)) * 100;
  const color = value === null ? Colors.border : value >= 0.7 ? Colors.connection : value >= 0.4 ? Colors.accent : Colors.silence;
  return (
    <View style={styles.quality}>
      <View style={styles.qualityHead}>
        <ThemedText type="small" themeColor="textSecondary">
          Signal quality
        </ThemedText>
        <ThemedText type="small" themeColor="textMuted">
          {value === null ? (phase === 'capturing' ? 'waiting for the worker' : 'settling') : `${Math.round(pct)}% confidence`}
        </ThemedText>
      </View>
      <View style={styles.qualityTrack}>
        <View style={[styles.qualityFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function Vital({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <View style={styles.vital}>
      <ThemedText type="numeric" style={styles.vitalValue}>
        {value === null ? '—' : value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="small" themeColor="textMuted">
        {unit}
      </ThemedText>
    </View>
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
  card: {
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  primaryButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  previewWrap: {
    width: '100%',
    aspectRatio: 3 / 4,
    maxHeight: 480,
    alignSelf: 'center',
    borderRadius: Radius.medium,
    overflow: 'hidden',
    backgroundColor: '#111827',
  },
  preview: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  previewFallback: { alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  previewFallbackText: { color: '#fff', textAlign: 'center' },
  oval: {
    position: 'absolute',
    left: '20%',
    right: '20%',
    top: '12%',
    bottom: '18%',
    borderRadius: 999,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  countdown: {
    position: 'absolute',
    right: Spacing.three,
    top: Spacing.three,
    backgroundColor: 'rgba(17,24,39,0.7)',
    borderRadius: Radius.medium,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  countdownText: { color: '#fff', fontSize: 28, lineHeight: 34 },
  quality: { gap: Spacing.one },
  qualityHead: { flexDirection: 'row', justifyContent: 'space-between' },
  qualityTrack: { height: 8, borderRadius: 4, backgroundColor: Colors.surfaceRaised, overflow: 'hidden' },
  qualityFill: { height: 8, borderRadius: 4 },
  vitalsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  vital: { flex: 1, alignItems: 'center' },
  vitalValue: { fontSize: 36, lineHeight: 42 },
  clockRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.three },
  bigNumber: { fontSize: 56, lineHeight: 60 },
  clockMeta: { paddingBottom: Spacing.two, gap: Spacing.half },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  formRow: { flexDirection: 'row', gap: Spacing.three },
  formCol: { flex: 1 },
});
