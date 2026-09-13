import { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedPressable, FadeInUp } from '@/components/animated';
import { Field, NumberInput, SegmentButton, TextField } from '@/components/form-controls';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Colors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { api, type Answers, type Me } from '@/lib/api';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useSession } from '@/state/auth-store';
import { decodeJwtSub, loadLocalAnswers, saveLocalAnswers } from '@/state/local-identity';
import { updateProfile, useProfile } from '@/state/profile-store';

const HELP_SCALE = [0, 1, 2, 3, 4, 5] as const;
const RESEND_COOLDOWN_S = 60;

/**
 * Supabase's raw auth errors are terse. The ones we hit in practice:
 *  - "email rate limit exceeded": the PROJECT-wide cap on auth emails (now 60/hour via custom
 *    SMTP; was 2/hour on Supabase's built-in sender) — nothing the app can do but wait.
 *  - "For security purposes, you can only request this after N seconds": per-address 60 s cooldown.
 */
/**
 * The sign-in email links to `{{ .SiteURL }}/onboarding?token_hash=...&type=email` (set in the
 * Supabase email templates) instead of Supabase's own verify URL. Mail scanners (Outlook SafeLinks
 * especially) pre-fetch links, and Supabase's verify link is single-use — so it was already spent
 * by the time a human clicked it. Landing here does nothing until the user presses "Finish signing
 * in", which is when the hash is exchanged. Supabase's own "Email link is invalid or has expired"
 * bounce (from any old-style link) arrives in the URL hash and is surfaced too.
 */
function readSignInLink(): { tokenHash: string | null; error: string | null } {
  if (typeof window === 'undefined') return { tokenHash: null, error: null };
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return {
    tokenHash: query.get('token_hash'),
    error: hash.get('error_description') ?? query.get('error_description'),
  };
}

function clearSignInLinkFromUrl() {
  if (typeof window === 'undefined') return;
  window.history.replaceState(null, '', window.location.pathname);
}

function describeAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('rate limit')) {
    return 'Too many sign-in emails were sent from this project in the last hour (Supabase caps them). Please try again in a while.';
  }
  const wait = /after (\d+) seconds/.exec(m);
  if (wait) return `Please wait ${wait[1]} seconds before requesting another code.`;
  if (m.includes('expired')) return 'That code has expired. Request a new one.';
  if (m.includes('invalid')) return 'That code did not match. Check the email and try again.';
  return message;
}

// docs/log/D.md session H13: template created for this project. Not a secret by Persona's own
// design (it's meant to sit in a client-facing verify_url) — overridable if D rotates it.
const PERSONA_TEMPLATE_ID = process.env.EXPO_PUBLIC_PERSONA_TEMPLATE_ID ?? 'itmpl_AH43ZFeBwqDRXTQLsUW8vEpdokrjAU';
// docs/log/C.md session 19: the template is a Persona sandbox template, so the hosted flow 404s
// with "could not load template" unless environment-id is also present — same fix D's own
// api/app/routes/persona.py::_verify_url applies server-side. Unset until D configures the real
// PERSONA_ENVIRONMENT_ID; this only changes behavior once that value exists.
const PERSONA_ENVIRONMENT_ID = process.env.EXPO_PUBLIC_PERSONA_ENVIRONMENT_ID ?? null;
const DEMO_TOKEN = process.env.EXPO_PUBLIC_DEMO_TOKEN ?? null;
const DEMO_USER_ID = DEMO_TOKEN ? decodeJwtSub(DEMO_TOKEN) : null;

/**
 * What leaves your phone; real sign-in (Supabase email one-time code, verified by api/app/auth.py);
 * the full onboarding questionnaire (contracts.md §3 AnswersIn — medication, sleep, smoking, oral
 * contraceptive use, bedtime, usual caffeine, and the two LSNS items plus loneliness/living alone);
 * Persona identity verification via a client-built verify_url. docs/lanes/C.md Block 4.
 */
export default function OnboardingScreen() {
  const { session, loading } = useSession();
  const user = session ? { id: session.user.id, email: session.user.email ?? '' } : null;
  const profile = useProfile();

  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [link] = useState(readSignInLink);
  const [linkDismissed, setLinkDismissed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(() =>
    link.error ? 'That sign-in link no longer works (mail scanners can use links up). Request a code below instead.' : null,
  );
  const [authBusy, setAuthBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const pendingLink = Boolean(link.tokenHash) && !linkDismissed;

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const [onMeds, setOnMeds] = useState<boolean | null>(profile.on_glucose_meds ?? null);
  const [smoker, setSmoker] = useState<boolean | null>(profile.smoker ?? null);
  const [oralContraceptive, setOralContraceptive] = useState<boolean | null>(profile.oral_contraceptive ?? null);
  const [sleepH, setSleepH] = useState(profile.sleep_h ? String(profile.sleep_h) : '');
  const [bedtime, setBedtime] = useState(profile.bedtime ?? '');
  const [coffeeMgPerCup, setCoffeeMgPerCup] = useState(profile.coffee_mg_per_cup ? String(profile.coffee_mg_per_cup) : '');

  const [helpFamily, setHelpFamily] = useState<(typeof HELP_SCALE)[number] | null>(profile.help_family ?? null);
  const [helpFriends, setHelpFriends] = useState<(typeof HELP_SCALE)[number] | null>(profile.help_friends ?? null);
  const [lonely, setLonely] = useState<boolean | null>(profile.lonely ?? null);
  const [livesAlone, setLivesAlone] = useState<boolean | null>(profile.lives_alone ?? null);

  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState<string | null>(null);

  // A real session always wins; the shared demo account is the fallback when nobody is signed in.
  const canUseRealApi = Boolean(session) || Boolean(DEMO_TOKEN && DEMO_USER_ID);
  const personaReferenceId = session?.user.id ?? DEMO_USER_ID ?? null;
  const verifyUrl = personaReferenceId
    ? `https://inquiry.withpersona.com/verify?inquiry-template-id=${PERSONA_TEMPLATE_ID}&reference-id=${personaReferenceId}` +
      (PERSONA_ENVIRONMENT_ID ? `&environment-id=${PERSONA_ENVIRONMENT_ID}` : '')
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

  /** One-time migration from the pre-profile-store local answers, and only for fields the profile doesn't already have. */
  function applyStoredAnswers(a: Answers) {
    if (a.on_glucose_meds !== undefined && profile.on_glucose_meds === undefined) setOnMeds(a.on_glucose_meds);
    if (a.smoker !== undefined && profile.smoker === undefined) setSmoker(a.smoker);
    if (a.oral_contraceptive !== undefined && profile.oral_contraceptive === undefined) setOralContraceptive(a.oral_contraceptive);
    if (a.sleep_h !== undefined && profile.sleep_h === undefined) setSleepH(String(a.sleep_h));
    if (a.bedtime && !profile.bedtime) setBedtime(a.bedtime);
    if (a.coffee_mg_per_cup !== undefined && profile.coffee_mg_per_cup === undefined) setCoffeeMgPerCup(String(a.coffee_mg_per_cup));
    if (a.help_family !== undefined && profile.help_family === undefined) setHelpFamily(a.help_family);
    if (a.help_friends !== undefined && profile.help_friends === undefined) setHelpFriends(a.help_friends);
    if (a.lonely !== undefined && profile.lonely === undefined) setLonely(a.lonely);
    if (a.lives_alone !== undefined && profile.lives_alone === undefined) setLivesAlone(a.lives_alone);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshMe();
    const stored = loadLocalAnswers();
    if (stored) applyStoredAnswers(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const sendCode = async () => {
    if (!supabase || !email.trim() || cooldown > 0) return;
    setAuthBusy(true);
    setAuthError(null);
    // The emailed link returns here; the origin must be in the Supabase project's redirect
    // allowlist (it is: scallion.us, *.vercel.app, localhost), else Supabase falls back to Site URL.
    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/onboarding` : undefined;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    });
    setAuthBusy(false);
    if (error) {
      setAuthError(describeAuthError(error.message));
      setCooldown(RESEND_COOLDOWN_S);
      return;
    }
    setOtpSent(true);
    setCooldown(RESEND_COOLDOWN_S);
  };

  const verifyCode = async () => {
    if (!supabase || !otp.trim()) return;
    setAuthBusy(true);
    setAuthError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: otp.trim(), type: 'email' });
    setAuthBusy(false);
    if (error) setAuthError(describeAuthError(error.message));
  };

  const finishLinkSignIn = async () => {
    if (!supabase || !link.tokenHash) return;
    setAuthBusy(true);
    setAuthError(null);
    const { error } = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: 'email' });
    setAuthBusy(false);
    setLinkDismissed(true);
    clearSignInLinkFromUrl();
    if (error) setAuthError(describeAuthError(error.message));
  };

  const handleSignOut = async () => {
    await supabase?.auth.signOut();
    setOtpSent(false);
    setOtp('');
    setAuthError(null);
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

    // The profile store is the single source Start/Scan/Camera/Labs all read — save here regardless
    // of whether the demo API save below also succeeds, so those screens see it immediately either way.
    updateProfile(answers);

    if (canUseRealApi) {
      try {
        await api.setAnswers(answers);
        setSaveStatus(session ? 'Saved to your account.' : 'Saved to the demo account.');
        refreshMe();
        return;
      } catch {
        // fall through to local save so the answers are not lost
      }
    }
    saveLocalAnswers(answers);
    setSaveStatus(
      canUseRealApi
        ? 'Could not reach the API, so this is saved on this device instead.'
        : 'Saved on this device (not signed in, so this stays local).',
    );
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
                {!isSupabaseConfigured ? (
                  <ThemedText type="small" themeColor="silence">
                    Sign-in isn&apos;t configured (missing the Supabase URL/anon key env vars).
                  </ThemedText>
                ) : loading ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Checking your session…
                  </ThemedText>
                ) : user ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">
                      Signed in as {user.email || 'your account'}.
                    </ThemedText>
                    <AnimatedPressable style={styles.secondaryButton} onPress={handleSignOut}>
                      <ThemedText type="small">Sign out</ThemedText>
                    </AnimatedPressable>
                  </>
                ) : pendingLink ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">
                      You opened a sign-in link from your email. Press the button to finish.
                    </ThemedText>
                    <AnimatedPressable style={styles.submit} onPress={finishLinkSignIn} disabled={authBusy}>
                      <ThemedText type="smallBold" themeColor="accentText">
                        {authBusy ? 'Signing in…' : 'Finish signing in'}
                      </ThemedText>
                    </AnimatedPressable>
                    <AnimatedPressable
                      style={styles.secondaryButton}
                      onPress={() => {
                        setLinkDismissed(true);
                        clearSignInLinkFromUrl();
                      }}
                    >
                      <ThemedText type="small">Use a code instead</ThemedText>
                    </AnimatedPressable>
                    {authError && (
                      <ThemedText type="small" themeColor="silence">
                        {authError}
                      </ThemedText>
                    )}
                  </>
                ) : (
                  <>
                    <ThemedText type="small" themeColor="textMuted">
                      We email you a 6-digit code. No password, and nothing else leaves the app.
                    </ThemedText>
                    <Field label="Email">
                      <TextField value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
                    </Field>
                    {!otpSent ? (
                      <AnimatedPressable
                        style={[styles.submit, (authBusy || cooldown > 0) && styles.submitDisabled]}
                        onPress={sendCode}
                        disabled={authBusy || cooldown > 0 || !email.trim()}
                      >
                        <ThemedText type="smallBold" themeColor="accentText">
                          {authBusy ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Send sign-in code'}
                        </ThemedText>
                      </AnimatedPressable>
                    ) : (
                      <>
                        <ThemedText type="small" themeColor="textSecondary">
                          Check your email for a 6-digit code and enter it below, or click the link in the
                          email to come straight back here signed in.
                        </ThemedText>
                        <Field label="6-digit code">
                          <TextField value={otp} onChangeText={setOtp} placeholder="123456" keyboardType="number-pad" />
                        </Field>
                        <AnimatedPressable style={styles.submit} onPress={verifyCode} disabled={authBusy || !otp.trim()}>
                          <ThemedText type="smallBold" themeColor="accentText">
                            {authBusy ? 'Verifying…' : 'Verify code'}
                          </ThemedText>
                        </AnimatedPressable>
                        <AnimatedPressable
                          style={[styles.secondaryButton, cooldown > 0 && styles.submitDisabled]}
                          onPress={sendCode}
                          disabled={authBusy || cooldown > 0}
                        >
                          <ThemedText type="small">{cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}</ThemedText>
                        </AnimatedPressable>
                        <AnimatedPressable
                          style={styles.secondaryButton}
                          onPress={() => {
                            setOtpSent(false);
                            setOtp('');
                            setAuthError(null);
                          }}
                        >
                          <ThemedText type="small">Use a different email</ThemedText>
                        </AnimatedPressable>
                      </>
                    )}
                    {authError && (
                      <ThemedText type="small" themeColor="silence">
                        {authError}
                      </ThemedText>
                    )}
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
                        The app can&apos;t reach the real API for your account right now, but
                        Persona&apos;s own verification flow below is real and fully testable.
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
  submitDisabled: {
    opacity: 0.6,
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
});
