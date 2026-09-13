import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedPressable, FadeInUp } from '@/components/animated';
import { ChoiceGroup, Field, NumberInput, TextField } from '@/components/form-controls';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  BEDTIME_PRESETS,
  CAFFEINE_SOURCE,
  CUP_PRESETS,
  cupLabel,
  formatClock,
  isValidClock,
  LSNS_RESPONSES,
  lsnsLabel,
  normalizeClock,
  SLEEP_BINS,
  sleepLabel,
  type LsnsCode,
} from '@/constants/profile-options';
import { Colors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import type { HuntData, PaiOption } from '@/engine/fitness-age';
import { api, type Me } from '@/lib/api';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useSession } from '@/state/auth-store';
import { decodeJwtSub } from '@/state/local-identity';
import { answersFromProfile, getProfile, missingFields, PROFILE_REQUIREMENTS, updateProfile, useProfile, type UserProfile } from '@/state/profile-store';

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
// Sandbox templates may need environment-id on the hosted-flow URL; unset until D configures it.
const PERSONA_ENVIRONMENT_ID = process.env.EXPO_PUBLIC_PERSONA_ENVIRONMENT_ID ?? null;
const DEMO_TOKEN = process.env.EXPO_PUBLIC_DEMO_TOKEN ?? null;
const DEMO_USER_ID = DEMO_TOKEN ? decodeJwtSub(DEMO_TOKEN) : null;

type SectionKey = 'basics' | 'activity' | 'bloodSugar' | 'coffeeSleep' | 'connections';
type Field_ = keyof UserProfile;

const FIELD_NAME: Partial<Record<Field_, string>> = {
  age: 'age',
  sex: 'sex',
  weightLb: 'weight',
  waistCm: 'waist',
  paiKey: 'activity',
  fastingGlucoseMgdl: 'fasting glucose',
  on_glucose_meds: 'medication',
  bedtime: 'bedtime',
  coffee_mg_per_cup: 'usual cup',
  help_family: 'family question',
  help_friends: 'friends question',
};

/** What each feature needs from the profile — shown so the user knows why a question is asked. */
const READINESS: { label: string; where: string; fields: Field_[] }[] = [
  { label: 'Fitness age', where: 'Start and Camera', fields: PROFILE_REQUIREMENTS.fitnessAge },
  { label: 'Meal model', where: 'Scan', fields: PROFILE_REQUIREMENTS.mealModel },
  { label: 'Coffee cutoff', where: 'Scan', fields: PROFILE_REQUIREMENTS.caffeine },
  { label: 'Blood age', where: 'Labs', fields: PROFILE_REQUIREMENTS.phenoAge },
  { label: 'Social support score', where: 'Circle', fields: ['help_family', 'help_friends'] },
];

function sectionFields(key: SectionKey, p: UserProfile): Field_[] {
  switch (key) {
    case 'basics':
      return ['age', 'sex', 'weightLb', 'waistCm'];
    case 'activity':
      return ['paiKey'];
    case 'bloodSugar':
      return ['fastingGlucoseMgdl', 'on_glucose_meds'];
    case 'coffeeSleep':
      return p.sex === 'M' ? ['coffee_mg_per_cup', 'bedtime', 'sleep_h', 'smoker'] : ['coffee_mg_per_cup', 'bedtime', 'sleep_h', 'smoker', 'oral_contraceptive'];
    case 'connections':
      return ['help_family', 'help_friends', 'lonely', 'lives_alone'];
  }
}

const SECTION_ORDER: SectionKey[] = ['basics', 'activity', 'bloodSugar', 'coffeeSleep', 'connections'];

function yesNo(v: boolean | undefined): string | null {
  return v === undefined ? null : v ? 'Yes' : 'No';
}

function summary(key: SectionKey, p: UserProfile, pai: PaiOption[]): string | null {
  const parts: (string | null)[] = (() => {
    switch (key) {
      case 'basics':
        return [
          p.age !== undefined ? `${p.age} years` : null,
          p.sex ? (p.sex === 'M' ? 'Male' : 'Female') : null,
          p.weightLb !== undefined ? `${p.weightLb} lb` : null,
          p.waistCm !== undefined ? `${p.waistCm} cm waist` : null,
        ];
      case 'activity':
        return [
          p.paiKey ? (pai.find((o) => o.key === p.paiKey)?.label ?? null) : null,
          p.restingHr !== undefined ? `${p.restingHr} bpm resting` : null,
        ];
      case 'bloodSugar':
        return [
          p.fastingGlucoseMgdl !== undefined ? `${p.fastingGlucoseMgdl} mg/dL fasting` : null,
          p.glucoseMedsDeclined ? 'medication not given' : p.on_glucose_meds !== undefined ? `medication: ${yesNo(p.on_glucose_meds)}` : null,
        ];
      case 'coffeeSleep':
        return [
          p.coffee_mg_per_cup !== undefined ? cupLabel(p.coffee_mg_per_cup) : null,
          p.bedtime ? `bed ${formatClock(p.bedtime)}` : null,
          p.sleep_h !== undefined ? `sleep ${sleepLabel(p.sleep_h)}` : null,
        ];
      case 'connections':
        return [
          p.help_family !== undefined ? `family: ${lsnsLabel(p.help_family).toLowerCase()}` : null,
          p.help_friends !== undefined ? `friends: ${lsnsLabel(p.help_friends).toLowerCase()}` : null,
        ];
    }
  })();
  const shown = parts.filter((x): x is string => x !== null);
  return shown.length ? shown.join(' · ') : null;
}

/**
 * Your Scallion profile: answer once, every screen reuses it (state/profile-store.ts). Tap where
 * a choice is enough, type only where precision matters. Each answer saves on this device the
 * moment it's given; when signed in, the habit and connection answers (contracts.md §3 Answers,
 * nothing else) also sync to the account. Real sign-in (Supabase email code) and Persona
 * identity verification are separate, optional sections below. docs/lanes/C.md Block 4.
 */
export default function OnboardingScreen() {
  const { session, loading } = useSession();
  const user = session ? { id: session.user.id, email: session.user.email ?? '' } : null;
  const profile = useProfile();

  const [pai, setPai] = useState<PaiOption[] | null>(null);
  const [paiError, setPaiError] = useState(false);
  useEffect(() => {
    fetch('/engine/hunt.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((h: HuntData) => setPai(h.pai_options ?? null))
      .catch(() => setPaiError(true));
  }, []);

  const [open, setOpen] = useState<SectionKey | null>(() => {
    const p = getProfile();
    return SECTION_ORDER.find((k) => missingFields(sectionFields(k, p), p).length > 0) ?? null;
  });
  const openNext = (after: SectionKey) => {
    const rest = SECTION_ORDER.slice(SECTION_ORDER.indexOf(after) + 1);
    setOpen(rest.find((k) => missingFields(sectionFields(k, profile), profile).length > 0) ?? null);
  };

  // Typed numbers keep their own text so half-typed input isn't clobbered; valid values save immediately.
  const str = (n: number | undefined) => (n === undefined ? '' : String(n));
  const [text, setText] = useState(() => {
    const p = getProfile();
    return {
      age: str(p.age),
      weightLb: str(p.weightLb),
      waistCm: str(p.waistCm),
      restingHr: str(p.restingHr),
      fastingGlucoseMgdl: str(p.fastingGlucoseMgdl),
      coffee_mg_per_cup: str(p.coffee_mg_per_cup),
      sleep_h: p.sleep_h !== undefined && !SLEEP_BINS.some((b) => b.hours === p.sleep_h) ? String(p.sleep_h) : '',
      bedtime: p.bedtime ?? '',
    };
  });
  type TextKey = keyof typeof text;
  const onNumber = (key: Exclude<TextKey, 'bedtime'>, v: string) => {
    setText((t) => ({ ...t, [key]: v }));
    const trimmed = v.trim();
    if (trimmed === '') updateProfile({ [key]: undefined });
    else if (Number.isFinite(Number(trimmed)) && Number(trimmed) > 0) updateProfile({ [key]: Number(trimmed) });
  };
  const invalidNumber = (key: Exclude<TextKey, 'bedtime'>) => {
    const t = text[key].trim();
    return t !== '' && !(Number.isFinite(Number(t)) && Number(t) > 0);
  };
  const onBedtime = (v: string) => {
    setText((t) => ({ ...t, bedtime: v }));
    if (v.trim() === '') updateProfile({ bedtime: undefined });
    else if (isValidClock(v)) updateProfile({ bedtime: normalizeClock(v) });
  };

  // --- account sync (only the Answers subset leaves the device) ---
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const canUseRealApi = Boolean(session) || Boolean(DEMO_TOKEN && DEMO_USER_ID);
  const who = session?.user.id ?? DEMO_USER_ID ?? null;
  const answersJson = JSON.stringify(answersFromProfile(profile));
  const synced = useRef<{ json: string; who: string | null }>({ json: answersJson, who: null });

  const refreshMe = async () => {
    if (!canUseRealApi) return;
    setMeError(null);
    try {
      const m = await api.me();
      setMe(m);
      // A returning user on a new device: take the account's answers for anything not set here.
      const current = getProfile() as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(m.answers ?? {})) if (v !== null && v !== undefined && current[k] === undefined) patch[k] = v;
      if (Object.keys(patch).length) updateProfile(patch as Partial<UserProfile>);
    } catch {
      setMeError('Scallion’s server couldn’t be reached. Your answers are still saved on this device.');
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (!canUseRealApi || answersJson === '{}') return;
    if (synced.current.json === answersJson && synced.current.who === who) return;
    const id = setTimeout(async () => {
      try {
        await api.setAnswers(JSON.parse(answersJson));
        synced.current = { json: answersJson, who };
        setSyncStatus(session ? 'Saved to your account.' : 'Saved to the demo account.');
      } catch {
        setSyncStatus('Saved on this device. The server couldn’t be reached, so your account will update after your next change.');
      }
    }, 800);
    return () => clearTimeout(id);
  }, [answersJson, canUseRealApi, who, session]);

  // --- sign-in (Supabase email one-time code) ---
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
    setSyncStatus(null);
  };

  const personaReferenceId = session?.user.id ?? DEMO_USER_ID ?? null;
  // Prefer the API's server-minted one-time Persona link (D mints it with PERSONA_API_KEY, which is
  // what Persona's hosted flow actually accepts); the client-built template link is only the
  // fallback while GET /me is unavailable, and Persona currently rejects it ("check template-id").
  const verifyUrl =
    me?.verify_url ??
    (personaReferenceId
      ? `https://inquiry.withpersona.com/verify?inquiry-template-id=${PERSONA_TEMPLATE_ID}&reference-id=${personaReferenceId}` +
        (PERSONA_ENVIRONMENT_ID ? `&environment-id=${PERSONA_ENVIRONMENT_ID}` : '')
      : null);

  const paiOptions = pai ?? [];
  const allReady = READINESS.every((r) => missingFields(r.fields, profile).length === 0);
  const cupIsPreset = CUP_PRESETS.some((p) => p.mg === profile.coffee_mg_per_cup);
  const bedtimeIsPreset = (BEDTIME_PRESETS as readonly string[]).includes(profile.bedtime ?? '');
  const sleepBin = SLEEP_BINS.find((b) => b.hours === profile.sleep_h)?.key ?? null;
  const medsChoice = profile.glucoseMedsDeclined ? 'declined' : profile.on_glucose_meds === undefined ? null : profile.on_glucose_meds ? 'yes' : 'no';

  const sectionProps = (key: SectionKey, title: string) => {
    const fields = sectionFields(key, profile);
    const missing = missingFields(fields, profile);
    return {
      title,
      summary: summary(key, profile, paiOptions),
      answered: fields.length - missing.length,
      total: fields.length,
      open: open === key,
      onToggle: () => setOpen(open === key ? null : key),
      onDone: () => openNext(key),
    };
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scrollOuter} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.scroll}>
            <FadeInUp delay={0} style={styles.headerBlock}>
              <ThemedText type="small" themeColor="accent" style={styles.eyebrow}>
                YOUR PROFILE
              </ThemedText>
              <ThemedText type="subtitle">{allReady ? 'Your profile' : 'Set up Scallion once'}</ThemedText>
              <ThemedText type="default" themeColor="textSecondary">
                {allReady
                  ? 'Everything Scallion needs is here. Change any answer and every screen picks it up.'
                  : 'Every screen reuses these answers, so you won’t be asked twice. Answer only what you need — each feature below says what it’s waiting for.'}
              </ThemedText>
            </FadeInUp>

            <FadeInUp delay={60}>
              <Readiness profile={profile} />
            </FadeInUp>

            <FadeInUp delay={120} style={styles.sections}>
              <Section {...sectionProps('basics', 'Basics')}>
                <Question label="Age" hint="Used by the fitness and blood-age models.">
                  <NumberInput value={text.age} onChangeText={(v) => onNumber('age', v)} placeholder="Years" />
                  {invalidNumber('age') && <Invalid />}
                </Question>
                <Question label="Sex" hint="The published models have separate equations for each.">
                  <ChoiceGroup
                    options={[
                      { value: 'F' as const, label: 'Female' },
                      { value: 'M' as const, label: 'Male' },
                    ]}
                    value={profile.sex}
                    onChange={(sex) => updateProfile(sex === 'M' ? { sex, oral_contraceptive: undefined } : { sex })}
                  />
                </Question>
                <Question label="Weight (lb)" hint="Used by the meal model.">
                  <NumberInput value={text.weightLb} onChangeText={(v) => onNumber('weightLb', v)} placeholder="e.g. 172" />
                  {invalidNumber('weightLb') && <Invalid />}
                </Question>
                <Question label="Waist (cm)" hint="Measured at the navel. Used by the fitness model.">
                  <NumberInput value={text.waistCm} onChangeText={(v) => onNumber('waistCm', v)} placeholder="e.g. 86" />
                  {invalidNumber('waistCm') && <Invalid />}
                </Question>
              </Section>

              <Section {...sectionProps('activity', 'Activity')}>
                <Question label="How active are you?" hint="The HUNT fitness model's own activity levels.">
                  {pai ? (
                    <ChoiceGroup
                      layout="stack"
                      options={paiOptions.map((o) => ({ value: o.key, label: o.label }))}
                      value={profile.paiKey}
                      onChange={(paiKey) => updateProfile({ paiKey })}
                    />
                  ) : paiError ? (
                    <ThemedText type="small" themeColor="silence">
                      The activity levels couldn&apos;t be loaded. Reload to try again.
                    </ThemedText>
                  ) : (
                    <ActivityIndicator color={Colors.accent} />
                  )}
                </Question>
                <Question label="Resting heart rate (optional)" hint="Or measure it in 30 seconds on Camera.">
                  <NumberInput value={text.restingHr} onChangeText={(v) => onNumber('restingHr', v)} placeholder="bpm, e.g. 62" />
                  {invalidNumber('restingHr') && <Invalid />}
                </Question>
              </Section>

              <Section {...sectionProps('bloodSugar', 'Blood sugar')}>
                <Question label="Fasting glucose (mg/dL)" hint="From a recent blood test or a home meter before breakfast. Used by the meal model.">
                  <NumberInput value={text.fastingGlucoseMgdl} onChangeText={(v) => onNumber('fastingGlucoseMgdl', v)} placeholder="e.g. 92" />
                  {invalidNumber('fastingGlucoseMgdl') && <Invalid />}
                </Question>
                <Question label="Do you take medicine that affects your blood sugar?" hint="If yes, or if you'd rather not say, Scan hides walk-timing advice.">
                  <ChoiceGroup
                    options={[
                      { value: 'no' as const, label: 'No' },
                      { value: 'yes' as const, label: 'Yes' },
                      { value: 'declined' as const, label: 'Prefer not to say' },
                    ]}
                    value={medsChoice}
                    onChange={(c) =>
                      updateProfile(
                        c === 'declined'
                          ? { glucoseMedsDeclined: true, on_glucose_meds: undefined }
                          : { glucoseMedsDeclined: false, on_glucose_meds: c === 'yes' },
                      )
                    }
                  />
                </Question>
              </Section>

              <Section {...sectionProps('coffeeSleep', 'Coffee and sleep')}>
                <Question label="Your usual cup" hint={CAFFEINE_SOURCE}>
                  <ChoiceGroup
                    options={CUP_PRESETS.map((p) => ({ value: p.mg as number, label: p.label, description: p.detail }))}
                    value={cupIsPreset ? profile.coffee_mg_per_cup : null}
                    onChange={(mg) => {
                      setText((t) => ({ ...t, coffee_mg_per_cup: String(mg) }));
                      updateProfile({ coffee_mg_per_cup: mg });
                    }}
                  />
                  <NumberInput value={text.coffee_mg_per_cup} onChangeText={(v) => onNumber('coffee_mg_per_cup', v)} placeholder="Or exact mg" />
                  {invalidNumber('coffee_mg_per_cup') && <Invalid />}
                </Question>
                <Question label="Usual bedtime">
                  <ChoiceGroup
                    options={BEDTIME_PRESETS.map((t) => ({ value: t as string, label: formatClock(t) }))}
                    value={bedtimeIsPreset ? profile.bedtime : null}
                    onChange={onBedtime}
                  />
                  <TextField value={text.bedtime} onChangeText={onBedtime} placeholder="Or exact time, e.g. 22:45" />
                  {text.bedtime.trim() !== '' && !isValidClock(text.bedtime) && (
                    <ThemedText type="small" themeColor="silence">
                      Use 24-hour time, like 22:45.
                    </ThemedText>
                  )}
                </Question>
                <Question label="Usual sleep per night">
                  <ChoiceGroup
                    options={SLEEP_BINS.map((b) => ({ value: b.key as string, label: b.label }))}
                    value={sleepBin}
                    onChange={(key) => {
                      const bin = SLEEP_BINS.find((b) => b.key === key)!;
                      setText((t) => ({ ...t, sleep_h: '' }));
                      updateProfile({ sleep_h: bin.hours });
                    }}
                  />
                  <NumberInput value={text.sleep_h} onChangeText={(v) => onNumber('sleep_h', v)} placeholder="Or exact hours" />
                  {invalidNumber('sleep_h') && <Invalid />}
                </Question>
                <Question label="Do you smoke?" hint="Smoking speeds up caffeine clearance, so it changes your coffee cutoff.">
                  <ChoiceGroup
                    options={[
                      { value: false, label: 'No' },
                      { value: true, label: 'Yes' },
                    ]}
                    value={profile.smoker}
                    onChange={(smoker) => updateProfile({ smoker })}
                  />
                </Question>
                {profile.sex !== 'M' && (
                  <Question label="Do you take an oral contraceptive?" hint="It slows caffeine clearance, so it changes your coffee cutoff.">
                    <ChoiceGroup
                      options={[
                        { value: false, label: 'No' },
                        { value: true, label: 'Yes' },
                      ]}
                      value={profile.oral_contraceptive}
                      onChange={(oral_contraceptive) => updateProfile({ oral_contraceptive })}
                    />
                  </Question>
                )}
              </Section>

              <Section {...sectionProps('connections', 'Your connections')}>
                <ThemedText type="small" themeColor="textMuted">
                  Two of the six social-network questions (LSNS-6). Circle answers the other four from your message
                  metadata.
                </ThemedText>
                <Question label="How many relatives could you call on for help?">
                  <ChoiceGroup
                    options={LSNS_RESPONSES.map((r) => ({ value: r.code as LsnsCode, label: r.label }))}
                    value={profile.help_family}
                    onChange={(help_family) => updateProfile({ help_family })}
                  />
                </Question>
                <Question label="How many friends could you call on for help?">
                  <ChoiceGroup
                    options={LSNS_RESPONSES.map((r) => ({ value: r.code as LsnsCode, label: r.label }))}
                    value={profile.help_friends}
                    onChange={(help_friends) => updateProfile({ help_friends })}
                  />
                </Question>
                <Question label="Do you often feel lonely?">
                  <ChoiceGroup
                    options={[
                      { value: false, label: 'No' },
                      { value: true, label: 'Yes' },
                    ]}
                    value={profile.lonely}
                    onChange={(lonely) => updateProfile({ lonely })}
                  />
                </Question>
                <Question label="Do you live alone?">
                  <ChoiceGroup
                    options={[
                      { value: false, label: 'No' },
                      { value: true, label: 'Yes' },
                    ]}
                    value={profile.lives_alone}
                    onChange={(lives_alone) => updateProfile({ lives_alone })}
                  />
                </Question>
              </Section>
            </FadeInUp>

            <FadeInUp delay={180}>
              <View style={styles.privacy}>
                <ThemedText type="smallBold">Where this is kept</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Your profile is saved on this device as you answer. If you sign in, the answers under Coffee and sleep,
                  Blood sugar medication and Your connections are also stored with your account so the coach can use
                  them. Message content never leaves your phone; lab reports are redacted on this device before upload.
                </ThemedText>
                {syncStatus && (
                  <ThemedText type="small" themeColor="textMuted">
                    {syncStatus}
                  </ThemedText>
                )}
              </View>
            </FadeInUp>

            <FadeInUp delay={240}>
              <View style={styles.block}>
                <ThemedText type="smallBold">Account (optional)</ThemedText>
                {!isSupabaseConfigured ? (
                  <ThemedText type="small" themeColor="silence">
                    Sign-in isn&apos;t available in this build.
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
                      Sign in to keep your results with an account and to use the coach, lab upload and your circle. We
                      email you a 6-digit code — no password.
                    </ThemedText>
                    <Field label="Email">
                      <TextField value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
                    </Field>
                    {!otpSent ? (
                      <AnimatedPressable
                        style={[styles.submit, (authBusy || cooldown > 0) && styles.submitDisabled]}
                        onPress={sendCode}
                        disabled={authBusy || cooldown > 0 || !email.trim()}>
                        <ThemedText type="smallBold" themeColor="accentText">
                          {authBusy ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Send sign-in code'}
                        </ThemedText>
                      </AnimatedPressable>
                    ) : (
                      <>
                        <ThemedText type="small" themeColor="textSecondary">
                          Check your email for a 6-digit code and enter it below, or click the link in the email to come
                          straight back here signed in.
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
                          disabled={authBusy || cooldown > 0}>
                          <ThemedText type="small">{cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}</ThemedText>
                        </AnimatedPressable>
                        <AnimatedPressable
                          style={styles.secondaryButton}
                          onPress={() => {
                            setOtpSent(false);
                            setOtp('');
                            setAuthError(null);
                          }}>
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
              </View>
            </FadeInUp>

            <FadeInUp delay={300}>
              <View style={styles.block}>
                <ThemedText type="smallBold">Identity verification (optional)</ThemedText>
                <ThemedText type="small" themeColor="textMuted">
                  Separate from signing in: Persona checks a government ID and a selfie so a verified age can be attached to
                  your account.
                </ThemedText>
                {!user && !DEMO_USER_ID ? (
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
                        {me.verified ? `Verified${me.age ? ` · age ${me.age}` : ''}` : 'Not verified yet'}
                      </ThemedText>
                    )}
                    {verifyUrl && !me?.verified && (
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
              </View>
            </FadeInUp>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Readiness({ profile }: { profile: UserProfile }) {
  const rows = READINESS.map((r) => ({ ...r, missing: missingFields(r.fields, profile) }));
  const ready = rows.filter((r) => r.missing.length === 0);
  const waiting = rows.filter((r) => r.missing.length > 0);
  return (
    <View style={styles.readiness}>
      {ready.length > 0 && (
        <View style={styles.readinessGroup}>
          <ThemedText type="small" themeColor="textSecondary">
            Ready
          </ThemedText>
          {ready.map((r) => (
            <View key={r.label} style={styles.readinessRow}>
              <View style={[styles.dot, styles.dotReady]} />
              <ThemedText type="small">
                {r.label} <ThemedText type="small" themeColor="textMuted">· {r.where}</ThemedText>
              </ThemedText>
            </View>
          ))}
        </View>
      )}
      {waiting.length > 0 && (
        <View style={styles.readinessGroup}>
          <ThemedText type="small" themeColor="textSecondary">
            Still needed
          </ThemedText>
          {waiting.map((r) => (
            <View key={r.label} style={styles.readinessRow}>
              <View style={[styles.dot, styles.dotWaiting]} />
              <ThemedText type="small">
                {r.label}{' '}
                <ThemedText type="small" themeColor="textMuted">
                  · needs {r.missing.map((f) => FIELD_NAME[f] ?? String(f)).join(', ')}
                </ThemedText>
              </ThemedText>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function Section({
  title,
  summary: sum,
  answered,
  total,
  open,
  onToggle,
  onDone,
  children,
}: {
  title: string;
  summary: string | null;
  answered: number;
  total: number;
  open: boolean;
  onToggle: () => void;
  onDone: () => void;
  children: ReactNode;
}) {
  const complete = answered === total;
  return (
    <View style={[styles.section, open && styles.sectionOpen]}>
      <Pressable
        accessibilityRole="button"
        aria-expanded={open}
        accessibilityLabel={`${title}, ${answered} of ${total} answered`}
        onPress={onToggle}
        style={styles.sectionHeader}>
        <View style={styles.sectionTitleWrap}>
          <ThemedText type="smallBold">{title}</ThemedText>
          <ThemedText type="small" themeColor="textMuted" numberOfLines={open ? undefined : 1}>
            {sum ?? 'Not answered yet'}
          </ThemedText>
        </View>
        <ThemedText type="small" themeColor={complete ? 'textMuted' : 'accent'}>
          {open ? 'Close' : complete ? 'Edit' : `${answered}/${total}`}
        </ThemedText>
      </Pressable>
      {open && (
        <View style={styles.sectionBody}>
          {children}
          <AnimatedPressable style={styles.secondaryButton} onPress={onDone}>
            <ThemedText type="small">Done</ThemedText>
          </AnimatedPressable>
        </View>
      )}
    </View>
  );
}

function Question({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.question}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {label}
      </ThemedText>
      {hint && (
        <ThemedText type="small" themeColor="textMuted">
          {hint}
        </ThemedText>
      )}
      {children}
    </View>
  );
}

function Invalid() {
  return (
    <ThemedText type="small" themeColor="silence">
      Enter a number.
    </ThemedText>
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
  headerBlock: { gap: Spacing.two },
  eyebrow: { letterSpacing: 1.2 },
  readiness: {
    borderLeftWidth: 2,
    borderLeftColor: Colors.accent,
    paddingLeft: Spacing.three,
    gap: Spacing.three,
  },
  readinessGroup: { gap: Spacing.one },
  readinessRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotReady: { backgroundColor: Colors.connection },
  dotWaiting: { borderWidth: 1.5, borderColor: Colors.textMuted },
  sections: { gap: Spacing.two },
  section: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.small,
  },
  sectionOpen: { borderColor: Colors.accent },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    minHeight: 56,
  },
  sectionTitleWrap: { flex: 1, gap: Spacing.half },
  sectionBody: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.four,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.three,
  },
  question: { gap: Spacing.two },
  privacy: {
    gap: Spacing.one,
    paddingTop: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  block: {
    gap: Spacing.two,
    paddingTop: Spacing.three,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  submit: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.6 },
  secondaryButton: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.medium,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
});
