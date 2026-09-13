import { useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedPressable, FadeInUp } from '@/components/animated';
import { Field, SegmentButton, TextField } from '@/components/form-controls';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, Colors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { api, setToken, type Me } from '@/lib/api';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useSession } from '@/state/auth-store';

const HELP_SCALE = [0, 1, 2, 3, 4, 5] as const;

/**
 * What leaves your phone; the medication question; the two LSNS questions; sign-in (Supabase,
 * verified by api/app/auth.py); Persona identity verification via GET /me's verify_url.
 * Personal answers only save once signed in. docs/lanes/C.md Block 4, contracts.md §3.
 */
export default function OnboardingScreen() {
  const { session, loading } = useSession();

  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  const [onMeds, setOnMeds] = useState<boolean | null>(null);
  const [helpFamily, setHelpFamily] = useState<(typeof HELP_SCALE)[number] | null>(null);
  const [helpFriends, setHelpFriends] = useState<(typeof HELP_SCALE)[number] | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState<string | null>(null);

  const refreshMe = async () => {
    if (!session) return;
    setMeError(null);
    try {
      setMe(await api.me());
    } catch {
      setMeError('Could not reach the API.');
    }
  };

  useEffect(() => {
    setToken(session?.access_token ?? null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const sendCode = async () => {
    if (!supabase || !email) return;
    setAuthBusy(true);
    setAuthError(null);
    // Supabase's default email template is a clickable link, not a typed code — emailRedirectTo
    // controls where that link sends the user back to. Without it (or without this URL in the
    // Supabase project's Redirect URLs allowlist), Supabase falls back to its default Site URL,
    // which is why the email link was landing on an inaccessible localhost address.
    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/onboarding` : undefined;
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    setAuthBusy(false);
    if (error) {
      setAuthError(error.message);
      return;
    }
    setOtpSent(true);
  };

  const verifyCode = async () => {
    if (!supabase || !otp) return;
    setAuthBusy(true);
    setAuthError(null);
    const { error } = await supabase.auth.verifyOtp({ email, token: otp, type: 'email' });
    setAuthBusy(false);
    if (error) {
      setAuthError(error.message);
    }
  };

  const signOut = async () => {
    await supabase?.auth.signOut();
    setOtpSent(false);
    setOtp('');
    setMe(null);
  };

  const saveAnswers = async () => {
    if (!session) return;
    setSaveStatus(null);
    try {
      await api.setAnswers({
        on_glucose_meds: onMeds ?? undefined,
        help_family: helpFamily ?? undefined,
        help_friends: helpFriends ?? undefined,
      });
      setSaveStatus('Saved.');
      refreshMe();
    } catch {
      setSaveStatus('Could not save — try again.');
    }
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
                Answers below only save to your account once you sign in, and identity verification
                (below) confirms it&apos;s really you before anything sensitive is attached to your
                profile.
              </ThemedText>
            </ThemedView>
          </FadeInUp>

          <FadeInUp delay={210}>
          <ThemedView type="surface" style={[styles.card, CardShadow]}>
            <ThemedText type="smallBold">Sign in</ThemedText>
            {!isSupabaseConfigured ? (
              <ThemedText type="small" themeColor="silence">
                Sign-in isn&apos;t configured yet (missing the Supabase project URL/anon key as Vercel
                env vars). Answers and verification can&apos;t be saved until that&apos;s set.
              </ThemedText>
            ) : loading ? (
              <ThemedText type="small" themeColor="textSecondary">
                Checking your session…
              </ThemedText>
            ) : session ? (
              <>
                <ThemedText type="small" themeColor="textSecondary">
                  Signed in as {session.user.email ?? 'your account'}.
                </ThemedText>
                <AnimatedPressable style={styles.secondaryButton} onPress={signOut}>
                  <ThemedText type="small">Sign out</ThemedText>
                </AnimatedPressable>
              </>
            ) : (
              <>
                <Field label="Email">
                  <TextField value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
                </Field>
                {!otpSent ? (
                  <AnimatedPressable style={styles.submit} onPress={sendCode} disabled={authBusy}>
                    <ThemedText type="smallBold" themeColor="accentText">
                      {authBusy ? 'Sending…' : 'Send sign-in code'}
                    </ThemedText>
                  </AnimatedPressable>
                ) : (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">
                      Check your email — click the sign-in link and you&apos;ll be brought right back here signed
                      in. If your email shows a 6-digit code instead of a link, enter it below.
                    </ThemedText>
                    <Field label="6-digit code (optional, only if your email shows one)">
                      <TextField value={otp} onChangeText={setOtp} placeholder="123456" keyboardType="number-pad" />
                    </Field>
                    <AnimatedPressable style={styles.submit} onPress={verifyCode} disabled={authBusy || !otp}>
                      <ThemedText type="smallBold" themeColor="accentText">
                        {authBusy ? 'Verifying…' : 'Verify code'}
                      </ThemedText>
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
            <ThemedText type="smallBold">Do you take medicine that affects your blood sugar?</ThemedText>
            <View style={styles.row}>
              <SegmentButton label="No" active={onMeds === false} onPress={() => setOnMeds(false)} />
              <SegmentButton label="Yes" active={onMeds === true} onPress={() => setOnMeds(true)} />
            </View>

            <ThemedText type="smallBold" style={styles.questionSpacing}>
              How many family members could you ask for help?
            </ThemedText>
            <View style={styles.wrap}>
              {HELP_SCALE.map((n) => (
                <SegmentButton key={n} label={String(n)} active={helpFamily === n} onPress={() => setHelpFamily(n)} />
              ))}
            </View>

            <ThemedText type="smallBold" style={styles.questionSpacing}>
              How many friends could you ask for help?
            </ThemedText>
            <View style={styles.wrap}>
              {HELP_SCALE.map((n) => (
                <SegmentButton key={n} label={String(n)} active={helpFriends === n} onPress={() => setHelpFriends(n)} />
              ))}
            </View>

            <AnimatedPressable style={[styles.submit, styles.questionSpacing]} onPress={saveAnswers} disabled={!session}>
              <ThemedText type="smallBold" themeColor="accentText">
                {session ? 'Save answers' : 'Sign in to save'}
              </ThemedText>
            </AnimatedPressable>
            {saveStatus && (
              <ThemedText type="small" themeColor="textSecondary">
                {saveStatus}
              </ThemedText>
            )}
          </ThemedView>
          </FadeInUp>

          <FadeInUp delay={350}>
          <ThemedView type="surface" style={[styles.card, CardShadow]}>
            <ThemedText type="smallBold">Identity verification</ThemedText>
            {!session ? (
              <ThemedText type="small" themeColor="textSecondary">
                Sign in above first.
              </ThemedText>
            ) : (
              <>
                {meError && (
                  <ThemedText type="small" themeColor="silence">
                    {meError}
                  </ThemedText>
                )}
                {me && (
                  <ThemedText type="small" themeColor={me.verified ? 'connection' : 'textSecondary'}>
                    {me.verified ? `Verified${me.age ? ` • age ${me.age}` : ''}` : 'Not verified yet'}
                  </ThemedText>
                )}
                {me?.verify_url && (
                  <AnimatedPressable style={styles.submit} onPress={() => Linking.openURL(me.verify_url!)}>
                    <ThemedText type="smallBold" themeColor="accentText">
                      Verify with Persona
                    </ThemedText>
                  </AnimatedPressable>
                )}
                <AnimatedPressable style={styles.secondaryButton} onPress={refreshMe}>
                  <ThemedText type="small">Refresh status</ThemedText>
                </AnimatedPressable>
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
