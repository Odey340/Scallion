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
import { formatBand } from '@/lib/format';
import { setFitnessInputs, setLocalClock, useFitnessInputs } from '@/state/clock-store';
import { useSession } from '@/state/auth-store';
import { updateProfile, useProfile } from '@/state/profile-store';

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

const CAPTURE_SECONDS = 30; // un-armed fallback (hand-started worker): its 30 s recording is already under way
const SETTLE_SECONDS = 75; // un-armed fallback: keep polling past the countdown for the hand-started worker's POST
// Armed flow (Start told the laptop worker to capture): the laptop needs ~10-20 s to lock the camera
// and find the face, then records 30 s, so the hold-still countdown runs a full minute.
const HOLD_SECONDS = 60;
// One laptop attempt can take up to ~3 min (camera lock, up to 2 min waiting for a face, the 30 s
// recording, stop, POST; the watcher kills a child at 180 s and then reports). The armed screen waits
// that long for a verdict, and once more from the moment the laptop says it is trying again.
const ATTEMPT_SECONDS = 190;
// The watcher polls /vitals/arm every 2 s (also while a capture runs), so worker_seen_at older than
// this means no worker is running for this account. After the grace, two stale reads end the wait
// with a message that names the fix instead of a generic timeout minutes later.
const WORKER_STALE_S = 15;
const WORKER_GRACE_S = 20;
const POLL_MS = 3000;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

type Phase = 'idle' | 'capturing' | 'settling' | 'done' | 'timeout';

export default function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  // Subscribing re-renders this screen when the session (and so hasToken()) changes. The account
  // matters: the worker must POST under the same user, or /vitals/latest never shows the row.
  const { session } = useSession();
  const account = session?.user?.email ?? (hasToken() ? 'the shared demo account' : null);
  const inputs = useFitnessInputs();
  const profile = useProfile();

  const [hunt, setHunt] = useState<HuntData | null>(null);
  const [latest, setLatest] = useState<VitalsOut | null>(null);
  const [latestError, setLatestError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [secondsLeft, setSecondsLeft] = useState(CAPTURE_SECONDS);
  const [elapsed, setElapsed] = useState(0);
  const [reading, setReading] = useState<VitalsOut | null>(null);
  const captureStart = useRef<number>(0);
  // armed_at from POST /vitals/arm (server clock). When set, only a row the API received after it
  // counts, so a re-Start never finishes on the previous reading; without it (no token, arm failed,
  // hand-started worker) a row captured up to 60 s before Start is accepted.
  const armedAt = useRef<number | null>(null);
  const accepts = (row: VitalsOut) =>
    armedAt.current != null
      ? new Date(row.received_at).getTime() >= armedAt.current
      : new Date(row.captured_at).getTime() >= captureStart.current - 60_000;
  const timers = useRef<{ tick?: ReturnType<typeof setInterval>; poll?: ReturnType<typeof setInterval>; stop?: ReturnType<typeof setTimeout> }>({});

  const clearTimers = () => {
    if (timers.current.tick) clearInterval(timers.current.tick);
    if (timers.current.poll) clearInterval(timers.current.poll);
    if (timers.current.stop) clearTimeout(timers.current.stop);
    timers.current = {};
  };
  // (Re)arm the give-up timer: the wait runs from now for `seconds`, whatever it was before.
  const stopAfter = (seconds: number) => {
    if (timers.current.stop) clearTimeout(timers.current.stop);
    timers.current.stop = setTimeout(() => {
      clearTimers();
      setPhase((p) => (p === 'done' ? p : 'timeout'));
    }, seconds * 1000);
  };

  const [ageText, setAgeText] = useState(profile.age ? String(profile.age) : inputs ? String(inputs.age) : '');
  const [sex, setSex] = useState<Sex>(profile.sex ?? inputs?.sex ?? 'M');
  const [waistText, setWaistText] = useState(profile.waistCm ? String(profile.waistCm) : inputs ? String(inputs.waistCm) : '');
  const [paiKey, setPaiKey] = useState<string | null>(profile.paiKey ?? inputs?.paiKey ?? null);
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
  // 'armed': the API accepted the arm, so a worker left running with --watch will capture now.
  const [armState, setArmState] = useState<'idle' | 'arming' | 'armed' | 'failed'>('idle');
  // The worker's reason when a capture fails (webcam busy, no face), via GET /vitals/arm `note`.
  const [note, setNote] = useState<string | null>(null);
  // Whether a presage-worker is polling for this account (GET /vitals/arm `worker_seen_at`):
  // 'unknown' until the first status read, 'alive' while its polls are fresh, 'missing' ends the wait.
  const [workerState, setWorkerState] = useState<'unknown' | 'alive' | 'missing'>('unknown');
  const staleReads = useRef(0);
  const lastNote = useRef<string | null>(null);

  const start = async () => {
    setReading(null);
    setFitness(null);
    setNote(null);
    setWorkerState('unknown');
    setElapsed(0);
    staleReads.current = 0;
    lastNote.current = null;
    // Tell the laptop worker (presage-worker --watch) to capture; a hand-started worker still works.
    armedAt.current = null;
    if (hasToken()) {
      setArmState('arming');
      try {
        const arm = await api.armVitals();
        armedAt.current = arm.armed_at ? new Date(arm.armed_at).getTime() : null;
        setArmState(armedAt.current != null ? 'armed' : 'failed');
      } catch {
        setArmState('failed');
      }
    } else {
      setArmState('idle');
    }
    const armed = armedAt.current != null;
    if (armed) {
      // The laptop webcam does the measuring, so this device's camera stays closed: with this page open
      // in the laptop's own browser the preview held the webcam and the SDK could not start (Media
      // Foundation 0xC00D3704, Sun H33); on a phone the preview showed the wrong camera anyway.
      setPreviewAvailable(false);
    } else {
      let granted = permission?.granted ?? false;
      if (!granted) {
        const res = await requestPermission().catch(() => null);
        granted = res?.granted ?? false;
      }
      // No preview is not a blocker: the measurement runs on the laptop webcam; the countdown still helps.
      setPreviewAvailable(granted);
    }
    const holdSeconds = armed ? HOLD_SECONDS : CAPTURE_SECONDS;
    const startedAt = Date.now();
    captureStart.current = startedAt;
    setSecondsLeft(holdSeconds);
    setPhase('capturing');
    timers.current.tick = setInterval(() => {
      const elapsedS = Math.floor((Date.now() - captureStart.current) / 1000);
      setElapsed(elapsedS);
      const left = Math.max(0, holdSeconds - elapsedS);
      setSecondsLeft(left);
      if (left === 0) setPhase((p) => (p === 'capturing' ? 'settling' : p));
    }, 500);
    timers.current.poll = setInterval(async () => {
      const row = await fetchLatest();
      if (row && accepts(row)) {
        finish(row);
        return;
      }
      if (!armed) return;
      const status = await api.armStatus().catch(() => null);
      if (!status) return; // an API hiccup says nothing about the laptop
      // The worker says why a capture failed (webcam busy, no face). A final note ends the arm on the
      // API (armed_at null), so stop waiting and show it instead of the generic timeout.
      if (status.note) setNote(status.note);
      if (status.note && status.armed_at === null) {
        clearTimers();
        setPhase('timeout');
        return;
      }
      if (status.note && status.note !== lastNote.current) {
        // "Trying once more": the laptop is starting another attempt now, so wait for it in full.
        lastNote.current = status.note;
        stopAfter(ATTEMPT_SECONDS);
      }
      // Liveness. armed_at and worker_seen_at are both server clock, so compare them to each other:
      // the server's "now" is armed_at plus the time since Start, whatever this device's clock says.
      const seen = status.worker_seen_at ? new Date(status.worker_seen_at).getTime() : null;
      const serverNow = (armedAt.current ?? 0) + (Date.now() - captureStart.current);
      const alive = seen != null && serverNow - seen < WORKER_STALE_S * 1000;
      if (alive) {
        staleReads.current = 0;
        setWorkerState('alive');
        return;
      }
      if (Date.now() - captureStart.current < WORKER_GRACE_S * 1000) return;
      staleReads.current += 1;
      if (staleReads.current >= 2) {
        // Nothing on the laptop is polling for this account: say so now, not after minutes of waiting.
        setWorkerState('missing');
        clearTimers();
        setPhase('timeout');
      }
    }, POLL_MS);
    stopAfter(armed ? ATTEMPT_SECONDS : holdSeconds + SETTLE_SECONDS);
  };

  const stop = () => {
    clearTimers();
    setPhase('idle');
    setArmState('idle');
    setWorkerState('unknown');
    if (hasToken()) api.disarmVitals().catch(() => undefined);
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
      updateProfile({ age, sex, waistCm: waist, restingHr: shown.pulse_bpm, paiKey: pai.key });
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
        <ScrollView style={styles.scrollOuter} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.scroll}>
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
                  Sit in front of the demo laptop&apos;s webcam, face the light, hold still. Start tells the laptop worker
                  to capture (it must be running with --watch); the numbers appear here. This device&apos;s camera stays
                  closed so it never competes with the laptop&apos;s.
                </ThemedText>
                {permission && !permission.granted && !permission.canAskAgain && (
                  <ThemedText type="small" themeColor="silence">
                    Camera permission was denied. Allow it in your browser or system settings to see the preview.
                  </ThemedText>
                )}
                {account && (
                  <ThemedText type="small" themeColor="textMuted">
                    Readings arrive for {account}; the laptop worker must post under the same account (SCALLION_API_TOKEN).
                  </ThemedText>
                )}
                {phase === 'timeout' && (
                  <ThemedText type="small" themeColor="silence">
                    {workerState === 'missing'
                      ? `No laptop worker is polling for ${account ?? 'this account'}. On the demo laptop run node index.mjs --watch in presage-worker (its terminal must list this account; add --replay test/fixtures/capture_real.json when there is no camera), then press Start again.${note ? ` Its last report: ${note}` : ''}`
                      : note
                        ? `The laptop reported: ${note}`
                        : workerState === 'alive'
                          ? `No reading arrived${account ? ` for ${account}` : ''} in ${mmss(elapsed)}, although the laptop worker was running. Check its terminal, then press Start again.`
                          : `No reading arrived${account ? ` for ${account}` : ''}. On the demo laptop the worker must be running (node index.mjs --watch; add --replay test/fixtures/capture_real.json when there is no camera) and its terminal must list this account. Then press Start again.`}
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
                        {armState === 'armed'
                          ? 'Face the laptop webcam and hold still. No preview here: the laptop camera does the measuring, and a preview on this device would compete for it.'
                          : "Camera preview unavailable here (permission not granted). The countdown still runs; face the demo laptop's webcam."}
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
                <QualityBar phase={phase} confidence={reading?.confidence ?? null} />
                <ThemedText type="small" themeColor="textSecondary">
                  {armState === 'armed'
                    ? phase === 'capturing'
                      ? 'Face the laptop webcam and hold still. It records for 30 seconds once it finds your face.'
                      : `Keep still a little longer. Waiting for the laptop's reading (${mmss(elapsed)} since Start; a slow face lock can take a while).`
                    : phase === 'capturing'
                      ? 'Hold still. Breathe normally.'
                      : 'Capture finished. Waiting for the reading to arrive…'}
                </ThemedText>
                {armState !== 'idle' && (
                  <ThemedText
                    type="small"
                    themeColor={armState === 'failed' ? 'silence' : armState === 'armed' && workerState === 'alive' ? 'connection' : 'textMuted'}>
                    {armState === 'arming'
                      ? 'Telling the laptop worker to capture…'
                      : armState === 'armed'
                        ? workerState === 'alive'
                          ? 'Laptop worker: connected and capturing for this account.'
                          : 'Laptop worker: not seen yet. It needs node index.mjs --watch running on the demo laptop with this account in its list.'
                        : 'Could not reach the API to start the laptop worker; run node index.mjs there by hand.'}
                  </ThemedText>
                )}
                {note && (
                  <ThemedText type="small" themeColor="silence">
                    Laptop: {note}
                  </ThemedText>
                )}
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
                  : 'Readings are stored against your account. Sign in to keep them; the capture preview and fitness age below work either way.'}
              </ThemedText>
              {!hasToken() && (
                <Link href="/onboarding" asChild>
                  <Pressable style={styles.secondaryButton}>
                    <ThemedText type="smallBold" themeColor="accent">
                      Sign in
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
                        {formatBand(fitness.band)}
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
          </View>
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
  scrollContent: { alignItems: 'center' },
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
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    minHeight: 44,
    justifyContent: 'center',
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
