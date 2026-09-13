import { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedPressable, FadeInUp } from '@/components/animated';
import { Field, NumberInput, SegmentButton, TextField } from '@/components/form-controls';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Colors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { api, type Answers, type Me } from '@/lib/api';
import { decodeJwtSub, loadLocalAnswers, saveLocalAnswers, signIn, signOut, useLocalUser } from '@/state/local-identity';

const HELP_SCALE = [0, 1, 2, 3, 4, 5] as const;

// docs/log/D.md session H13: template created for this project. Not a secret by Persona's own
// design (it's meant to sit in a client-facing verify_url) — overridable if D rotates it.
const PERSONA_TEMPLATE_ID = process.env.EXPO_PUBLIC_PERSONA_TEMPLATE_ID ?? 'itmpl_AH43ZFeBwqDRXTQLsUW8vEpdokrjAU';
const DEMO_TOKEN = process.env.EXPO_PUBLIC_DEMO_TOKEN ?? null;
const DEMO_USER_ID = DEMO_TOKEN ? decodeJwtSub(DEMO_TOKEN) : null;

/**
 * What leaves your phone; a fake local sign-in (see state/local-identity.ts for why); the full
 * onboarding questionnaire (contracts.md §3 AnswersIn — medication, sleep, smoking, oral
 * contraceptive use, bedtime, usual caffeine, and the two LSNS items plus loneliness/living alone);
 * Persona identity verification via a client-built verify_url. docs/lanes/C.md Block 4.
 */
export default function OnboardingScreen() {
  const user = useLocalUser();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const [onMeds, setOnMeds] = useState<boolean | null>(null);
  const [smoker, setSmoker] = useState<boolean | null>(null);
  const [oralContraceptive, setOralContraceptive] = useState<boolean | null>(null);
  const [sleepH, setSleepH] = useState('');
  const [bedtime, setBedtime] = useState('');
  const [coffeeMgPerCup, setCoffeeMgPerCup] = useState('');

  const [helpFamily, setHelpFamily] = useState<(typeof HELP_SCALE)[number] | null>(null);
  const [helpFriends, setHelpFriends] = useState<(typeof HELP_SCALE)[number] | null>(null);
  const [lonely, setLonely] = useState<boolean | null>(null);
  const [livesAlone, setLivesAlone] = useState<boolean | null>(null);

  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState<string | null>(null);

  const canUseRealApi = Boolean(DEMO_TOKEN && DEMO_USER_ID);
  const personaReferenceId = DEMO_USER_ID ?? user?.id ?? null;
  const verifyUrl = personaReferenceId
    ? `https://inquiry.withpersona.com/verify?inquiry-template-id=${PERSONA_TEMPLATE_ID}&reference-id=${personaReferenceId}`
    : null;

  const refreshMe = async () => {
    if (!canUseRealApi) return;
    setMeError(null);
    try {
      setMe(await api.me());
    } catch {
      setMeError('Could not reach the API.');
    }
  };

  function applyStoredAnswers(a: Answers) {
    if (a.on_glucose_meds !== undefined) setOnMeds(a.on_glucose_meds);
    if (a.smoker !== undefined) setSmoker(a.smoker);
    if (a.oral_contraceptive !== undefined) setOralContraceptive(a.oral_contraceptive);
    if (a.sleep_h !== undefined) setSleepH(String(a.sleep_h));
    if (a.bedtime) setBedtime(a.bedtime);
    if (a.coffee_mg_per_cup !== undefined) setCoffeeMgPerCup(String(a.coffee_mg_per_cup));
    if (a.help_family !== undefined) setHelpFamily(a.help_family);
    if (a.help_friends !== undefined) setHelpFriends(a.help_friends);
    if (a.lonely !== undefined) setLonely(a.lonely);
    if (a.lives_alone !== undefined) setLivesAlone(a.lives_alone);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshMe();
    const stored = loadLocalAnswers();
    if (stored) applyStoredAnswers(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleSignIn = () => {
    if (!name.trim() || !email.trim()) return;
    signIn(name, email);
  };

  const handleSignOut = () => {
    signOut();
    setMe(null);
  };

  const saveAnswers = async () => {
    if (!user) return;
    setSaveStatus(null);

    const answers: Answers = {
      on_glucose_meds: onMeds ?? undefined,
      smoker: smoker ?? undefined,
      oral_contraceptive: oralContraceptive ?? undefined,
      sleep_h: sleepH ? Number(sleepH) : undefined,
      bedtime: bedtime || undefined,
      coffee_mg_per_cup: coffeeMgPerCup ? Number(coffeeMgPerCup) : undefined,
      help_family: helpFamily ?? undefined,
      help_friends: helpFriends ?? undefined,
      lonely: lonely ?? undefined,
      lives_alone: livesAlone ?? undefined,
    };

    if (canUseRealApi) {
      try {
        await api.setAnswers(answers);
        setSaveStatus('Saved to the demo account.');
        refreshMe();
        return;
      } catch {
        // fall through to local save so the answers are not lost
      }
    }
    saveLocalAnswers(answers);
    setSaveStatus('Saved on this device (no demo account configured, so this stays local).');
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scrollOuter} contentContainerStyle={styles.scrollContent}>
          <View style={styles.scroll}>
            <FadeInUp delay={0}>
              <ThemedText type="subtitle">Onboarding</ThemedText>
            </FadeInUp>

            <FadeInUp delay={70}>
              <ThemedView type="surfaceRaised" style={styles.card}>
                <ThemedText type="smallBold">What leaves your phone</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Message content is parsed on your device and discarded; only a hashed contact id,
                  timestamp, app, direction, and a length bucket ever leave the phone. Lab PDFs are
                  redacted client-side before upload. Uploads are never stored.
                </ThemedText>
              </ThemedView>
            </FadeInUp>

            <FadeInUp delay={140}>
              <ThemedView type="surfaceRaised" style={[styles.card, styles.sensitiveCard]}>
                <ThemedText type="smallBold" themeColor="silence">
                  Your health data is sensitive
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Answers below only save once you sign in, and identity verification (below)
                  confirms it&apos;s really you before anything sensitive is attached to your
                  profile.
                </ThemedText>
              </ThemedView>
            </FadeInUp>

            <FadeInUp delay={210}>
              <ThemedView type="surface" style={[styles.card, CardShadow]}>
                <ThemedText type="smallBold">Sign in</ThemedText>
                <ThemedText type="small" themeColor="textMuted">
                  This isn&apos;t a real account — just a name so the app can remember you on this
                  device. Nothing is verified here; that&apos;s what Persona (below) is for.
                </ThemedText>
                {user ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">
                      Signed in as {user.name} ({user.email}).
                    </ThemedText>
                    <AnimatedPressable style={styles.secondaryButton} onPress={handleSignOut}>
                      <ThemedText type="small">Sign out</ThemedText>
                    </AnimatedPressable>
                  </>
                ) : (
                  <>
                    <Field label="Name">
                      <TextField value={name} onChangeText={setName} placeholder="Your name" />
                    </Field>
                    <Field label="Email">
                      <TextField value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
                    </Field>
                    <AnimatedPressable style={styles.submit} onPress={handleSignIn} disabled={!name.trim() || !email.trim()}>
                      <ThemedText type="smallBold" themeColor="accentText">
                        Continue
                      </ThemedText>
                    </AnimatedPressable>
                  </>
                )}
              </ThemedView>
            </FadeInUp>

            <FadeInUp delay={280}>
              <ThemedView type="surface" style={[styles.card, CardShadow]}>
                <ThemedText type="smallBold">Your health</ThemedText>

                <ThemedText type="smallBold" themeColor="textSecondary">
                  Do you take medicine that affects your blood sugar?
                </ThemedText>
                <View style={styles.row}>
                  <SegmentButton label="No" active={onMeds === false} onPress={() => setOnMeds(false)} />
                  <SegmentButton label="Yes" active={onMeds === true} onPress={() => setOnMeds(true)} />
                </View>

                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.questionSpacing}>
                  Do you smoke?
                </ThemedText>
                <View style={styles.row}>
                  <SegmentButton label="No" active={smoker === false} onPress={() => setSmoker(false)} />
                  <SegmentButton label="Yes" active={smoker === true} onPress={() => setSmoker(true)} />
                </View>

                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.questionSpacing}>
                  Do you take an oral contraceptive?
                </ThemedText>
                <ThemedText type="small" themeColor="textMuted">
                  Slows caffeine clearance — changes your last-coffee time on Scan.
                </ThemedText>
                <View style={styles.row}>
                  <SegmentButton label="No" active={oralContraceptive === false} onPress={() => setOralContraceptive(false)} />
                  <SegmentButton label="Yes" active={oralContraceptive === true} onPress={() => setOralContraceptive(true)} />
                </View>

                <Field label="Usual hours of sleep">
                  <NumberInput value={sleepH} onChangeText={setSleepH} placeholder="7" />
                </Field>

                <Field label="Usual bedtime (HH:MM)">
                  <TextField value={bedtime} onChangeText={setBedtime} placeholder="23:00" />
                </Field>

                <Field label="Caffeine in your usual cup (mg)">
                  <NumberInput value={coffeeMgPerCup} onChangeText={setCoffeeMgPerCup} placeholder="95" />
                </Field>
              </ThemedView>
            </FadeInUp>

            <FadeInUp delay={350}>
              <ThemedView type="surface" style={[styles.card, CardShadow]}>
                <ThemedText type="smallBold">Your connections</ThemedText>

                <ThemedText type="smallBold" themeColor="textSecondary">
                  How many family members could you ask for help?
                </ThemedText>
                <View style={styles.wrap}>
                  {HELP_SCALE.map((n) => (
                    <SegmentButton key={n} label={String(n)} active={helpFamily === n} onPress={() => setHelpFamily(n)} />
                  ))}
                </View>

                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.questionSpacing}>
                  How many friends could you ask for help?
                </ThemedText>
                <View style={styles.wrap}>
                  {HELP_SCALE.map((n) => (
                    <SegmentButton key={n} label={String(n)} active={helpFriends === n} onPress={() => setHelpFriends(n)} />
                  ))}
                </View>

                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.questionSpacing}>
                  Do you often feel lonely?
                </ThemedText>
                <View style={styles.row}>
                  <SegmentButton label="No" active={lonely === false} onPress={() => setLonely(false)} />
                  <SegmentButton label="Yes" active={lonely === true} onPress={() => setLonely(true)} />
                </View>

                <ThemedText type="smallBold" themeColor="textSecondary" style={styles.questionSpacing}>
                  Do you live alone?
                </ThemedText>
                <View style={styles.row}>
                  <SegmentButton label="No" active={livesAlone === false} onPress={() => setLivesAlone(false)} />
                  <SegmentButton label="Yes" active={livesAlone === true} onPress={() => setLivesAlone(true)} />
                </View>

                <AnimatedPressable style={[styles.submit, styles.questionSpacing]} onPress={saveAnswers} disabled={!user}>
                  <ThemedText type="smallBold" themeColor="accentText">
                    {user ? 'Save answers' : 'Sign in to save'}
                  </ThemedText>
                </AnimatedPressable>
                {saveStatus && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {saveStatus}
                  </ThemedText>
                )}
              </ThemedView>
            </FadeInUp>

            <FadeInUp delay={420}>
              <ThemedView type="surface" style={[styles.card, CardShadow]}>
                <ThemedText type="smallBold">Identity verification</ThemedText>
                {!user ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Sign in above first.
                  </ThemedText>
                ) : (
                  <>
                    {!canUseRealApi && (
                      <ThemedText type="small" themeColor="textMuted">
                        No demo account is configured, so the app can&apos;t ask the real API to
                        confirm your result — but Persona&apos;s own verification flow below is
                        real and fully testable end to end.
                      </ThemedText>
                    )}
                    {meError && (
                      <ThemedText type="small" themeColor="silence">
                        {meError}
                      </ThemedText>
                    )}
                    {canUseRealApi && me && (
                      <ThemedText type="small" themeColor={me.verified ? 'connection' : 'textSecondary'}>
                        {me.verified ? `Verified${me.age ? ` • age ${me.age}` : ''}` : 'Not verified yet'}
                      </ThemedText>
                    )}
                    {verifyUrl && (
                      <AnimatedPressable style={styles.submit} onPress={() => Linking.openURL(verifyUrl)}>
                        <ThemedText type="smallBold" themeColor="accentText">
                          Verify with Persona
                        </ThemedText>
                      </AnimatedPressable>
                    )}
                    {canUseRealApi && (
                      <AnimatedPressable style={styles.secondaryButton} onPress={refreshMe}>
                        <ThemedText type="small">Refresh status</ThemedText>
                      </AnimatedPressable>
                    )}
                  </>
                )}
              </ThemedView>
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
    gap: Spacing.three,
  },
  card: {
    borderRadius: Radius.medium,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  sensitiveCard: {
    borderWidth: 1,
    borderColor: Colors.silence,
  },
  row: { flexDirection: 'row', gap: Spacing.two },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  questionSpacing: { marginTop: Spacing.two },
  submit: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
});
