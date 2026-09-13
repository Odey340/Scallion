import { Link } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Disclosure } from '@/components/disclosure';
import { SegmentButton, TextField } from '@/components/form-controls';
import { ReadAloud } from '@/components/read-aloud';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ANALYTE_LABELS } from '@/components/waterfall';
import { CardShadow, Colors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { ANALYTES, type AnalyteKey } from '@/engine/phenoage';
import { ApiError, api, hasToken, type Checkin, type CoachContext, type Explain } from '@/lib/api';
import { startVoice, voiceSupported, type VoiceMode, type VoiceStatus } from '@/lib/coach-voice';
import { formatBand } from '@/lib/format';
import { useSession } from '@/state/auth-store';

/**
 * Coach (docs/lanes/C.md Block 4): push-to-talk to D's ElevenLabs agent with captions, every
 * agent reply checked by POST /coach/validate before it is shown, and a text fallback that
 * renders /coach/context as cards (clock, circle, today's plan, levers, memory) with a
 * read-aloud button on each (GET /tts). Explain-an-analyte uses the curated /coach/explain
 * texts. Check-ins go to POST /coach/checkin (the coach's memory, Backboard behind it).
 */

/** What the coach can do, as questions. Tapping one sends it as a typed turn (or starts the conversation with it). */
const SUGGESTIONS = [
  'What moves my biological age?',
  'What should I do next to lower it?',
  'Who in my circle is drifting?',
  'What is my one action today?',
  'Explain my glucose.',
  'When is my last coffee?',
];

interface Caption {
  id: number;
  source: 'user' | 'ai';
  text: string;
  /** ai only: null while validating, true/false after */
  ok: boolean | null;
  unknown?: string[];
}

type ClockRow = { years: number; chronological_age?: number | null; band?: number | null; delta_years?: number | null; show?: boolean };

function isClockRow(v: unknown): v is ClockRow {
  return typeof v === 'object' && v !== null && 'years' in v;
}

export default function CoachScreen() {
  // The session resolves asynchronously (getSession + a token refresh); until then hasToken() is
  // false even for a signed-in user, so gate the sign-in card on authLoading and reload the
  // context once the session lands.
  const { session, loading: authLoading } = useSession();
  const [context, setContext] = useState<CoachContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // voice
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [mode, setMode] = useState<VoiceMode>('listening');
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [toolCalls, setToolCalls] = useState<string[]>([]);
  const [holding, setHolding] = useState(false);
  const voiceSession = useRef<Awaited<ReturnType<typeof startVoice>> | null>(null);
  const pendingQuestion = useRef<string | null>(null);
  const nextId = useRef(1);

  // text mode
  const [explainKey, setExplainKey] = useState<AnalyteKey | null>(null);
  const [explain, setExplain] = useState<Explain | null>(null);
  const [explainBusy, setExplainBusy] = useState(false);
  const [checkinText, setCheckinText] = useState('');
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [history, setHistory] = useState<Checkin[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    if (!hasToken()) {
      setLoading(false);
      return;
    }
    try {
      const c = await api.coachContext();
      setContext(c);
      setHistory(c.history);
      setContextError(null);
    } catch {
      setContextError('Could not reach the coach context.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, authLoading, session]);

  useEffect(() => {
    const voice = voiceSession;
    return () => {
      voice.current?.endSession().catch(() => undefined);
    };
  }, []);

  const addCaption = (source: 'user' | 'ai', text: string) => {
    const id = nextId.current++;
    setCaptions((c) => [...c, { id, source, text, ok: source === 'ai' ? null : true }]);
    if (source === 'ai') {
      api
        .validate(text)
        .then((v) => setCaptions((c) => c.map((x) => (x.id === id ? { ...x, ok: v.ok, unknown: v.unknown_numbers } : x))))
        .catch(() => setCaptions((c) => c.map((x) => (x.id === id ? { ...x, ok: false, unknown: ['validator unavailable'] } : x))));
    }
  };

  const start = async () => {
    setStatusDetail(null);
    setCaptions([]);
    setToolCalls([]);
    try {
      voiceSession.current = await startVoice({
        onStatus: (s, d) => {
          setStatus(s);
          if (d) {
            setStatusDetail(
              /permission|notallowed|denied/i.test(d)
                ? 'Microphone permission was denied. Allow the mic to talk; the cards below work without it.'
                : d,
            );
          }
        },
        onMode: setMode,
        onMessage: addCaption,
        onToolCall: (name) => setToolCalls((t) => [...t, name]),
      });
      if (pendingQuestion.current) {
        voiceSession.current.sendText(pendingQuestion.current);
        pendingQuestion.current = null;
      }
    } catch (e) {
      setStatus('error');
      setStatusDetail(e instanceof ApiError && e.status === 503 ? 'No coach agent is configured on the API.' : e instanceof Error ? e.message : 'Could not start the voice coach.');
    }
  };

  const stop = async () => {
    await voiceSession.current?.endSession().catch(() => undefined);
    voiceSession.current = null;
    setStatus('idle');
    setHolding(false);
  };

  const ask = (text: string) => {
    if (voiceSession.current && status === 'connected') {
      voiceSession.current.sendText(text);
    } else if (status !== 'connecting') {
      pendingQuestion.current = text;
      start();
    }
  };

  const pressIn = () => {
    setHolding(true);
    voiceSession.current?.setMicMuted(false);
  };
  const pressOut = () => {
    setHolding(false);
    voiceSession.current?.setMicMuted(true);
  };

  const pickExplain = async (key: AnalyteKey) => {
    setExplainKey(key);
    setExplainBusy(true);
    try {
      setExplain(await api.explain(key));
    } catch {
      setExplain(null);
    }
    setExplainBusy(false);
  };

  const sendCheckin = async () => {
    const text = checkinText.trim();
    if (!text) return;
    setCheckinBusy(true);
    try {
      const row = await api.checkin('checkin', text);
      setHistory((h) => [row, ...h]);
      setCheckinText('');
    } catch {
      // leave the text in place so nothing is lost
    }
    setCheckinBusy(false);
  };

  const connected = status === 'connected';
  const clockRows = context ? (Object.entries(context.clock).filter(([k, v]) => k !== 'labels' && isClockRow(v)) as [string, ClockRow][]) : [];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView style={styles.scrollOuter} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.scroll}>
          <ThemedText type="subtitle">Coach</ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            The coach reads your blood-panel clock, your circle and today’s plan, explains what moves your age and what to do
            next. It may only say numbers that exist in your data; every reply is checked.
          </ThemedText>

          {authLoading && !hasToken() && (
            <ThemedText type="small" themeColor="textMuted">
              Checking your sign-in…
            </ThemedText>
          )}
          {!authLoading && !hasToken() && (
            <ThemedView type="surfaceRaised" style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">
                The coach reads your stored clock, circle and plan, so it needs you signed in.
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

          {/* Voice */}
          <ThemedView type="surface" style={[styles.card, CardShadow]}>
            <View style={styles.headerRow}>
              <ThemedText type="smallBold">Talk to the coach</ThemedText>
              <StatusPill status={status} mode={mode} holding={holding} />
            </View>
            {!voiceSupported && (
              <ThemedText type="small" themeColor="textMuted">
                Voice runs in the web app; use the cards below here.
              </ThemedText>
            )}
            {statusDetail && (
              <ThemedText type="small" themeColor="silence">
                {statusDetail}
              </ThemedText>
            )}
            {hasToken() && voiceSupported && (
              <>
                <ThemedText type="small" themeColor="textSecondary">
                  {connected ? 'Tap to ask, or hold the button and speak.' : 'Things you can ask (tap one to start):'}
                </ThemedText>
                <View style={styles.row}>
                  {SUGGESTIONS.map((q) => (
                    <Pressable key={q} style={[styles.chip, status === 'connecting' && styles.disabled]} onPress={() => ask(q)} disabled={status === 'connecting'}>
                      <ThemedText type="small" themeColor="accent">
                        {q}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
            {status !== 'connected' && status !== 'connecting' ? (
              <Pressable style={[styles.primaryButton, (!hasToken() || !voiceSupported) && styles.disabled]} onPress={start} disabled={!hasToken() || !voiceSupported}>
                <ThemedText type="smallBold" themeColor="accentText">
                  Start a conversation
                </ThemedText>
              </Pressable>
            ) : (
              <>
                <Pressable
                  style={[styles.talkButton, holding && styles.talkButtonActive, !connected && styles.disabled]}
                  onPressIn={pressIn}
                  onPressOut={pressOut}
                  disabled={!connected}>
                  <ThemedText type="subtitle" themeColor="accentText">
                    {status === 'connecting' ? 'Connecting…' : holding ? 'Listening…' : 'Hold to talk'}
                  </ThemedText>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={stop}>
                  <ThemedText type="smallBold" themeColor="accent">
                    End
                  </ThemedText>
                </Pressable>
              </>
            )}

            {captions.length > 0 && (
              <View style={styles.captions}>
                {captions.map((c) => (
                  <View key={c.id} style={[styles.caption, c.source === 'user' ? styles.captionUser : styles.captionAi]}>
                    <ThemedText type="small" themeColor="textMuted">
                      {c.source === 'user' ? 'You' : 'Coach'}
                      {c.source === 'ai' && c.ok === null ? ' · checking numbers…' : ''}
                    </ThemedText>
                    {c.source === 'ai' && c.ok === false ? (
                      <ThemedText type="small" themeColor="silence">
                        Reply withheld: it contained a number not in your data ({c.unknown?.join(', ')}).
                      </ThemedText>
                    ) : (
                      <ThemedText type="default">{c.text}</ThemedText>
                    )}
                  </View>
                ))}
              </View>
            )}
            {toolCalls.length > 0 && (
              <Disclosure title="Technical details">
                <ThemedText type="small" themeColor="textMuted">
                  Tools used: {toolCalls.join(', ')}
                </ThemedText>
              </Disclosure>
            )}
            <ThemedText type="small" themeColor="textMuted">
              ElevenLabs Agents; the key stays on the server. Captions on. Estimate, not diagnosis.
            </ThemedText>
          </ThemedView>

          {/* Text fallback: the same context as cards */}
          {loading && hasToken() ? (
            <ActivityIndicator color={Colors.accent} />
          ) : contextError ? (
            <ThemedText type="small" themeColor="silence">
              {contextError}
            </ThemedText>
          ) : context ? (
            <>
              <Card title="Your clock">
                {context.flags.critical ? (
                  <ThemedText type="default" themeColor="critical">
                    See a clinician first
                  </ThemedText>
                ) : clockRows.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    No clock yet.
                  </ThemedText>
                ) : (
                  clockRows.map(([name, row]) => (
                    <ThemedText key={name} type="default">
                      {name === 'phenoage' ? 'Biological age' : name === 'fitness' ? 'Fitness age' : name}:{' '}
                      <ThemedText type="smallBold">{Math.round(row.years)}</ThemedText>
                      {row.band != null ? ` ${formatBand(row.band)}` : ''}
                      {row.delta_years != null ? ` (${row.delta_years > 0 ? '+' : ''}${row.delta_years} vs calendar age)` : ''}
                    </ThemedText>
                  ))
                )}
                <ReadAloud text={clockSentence(clockRows, context)} />
              </Card>

              <Card title="Your circle">
                {context.circle.available ? (
                  <>
                    <ThemedText type="default">
                      {context.circle.metrics.activeTies} active ties, {context.circle.metrics.closeTies} close.{' '}
                      {context.circle.nudges.length} overdue.
                    </ThemedText>
                    <ThemedText type="small" themeColor="textMuted">
                      {context.circle.lsns.label}: {context.circle.lsns.score}.
                    </ThemedText>
                    <ReadAloud text={circleSentence(context)} />
                  </>
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    No inbox connected yet.
                  </ThemedText>
                )}
              </Card>

              <Card title="Today’s plan">
                {context.today.nudge && <ThemedText type="default">{context.today.nudge.text}</ThemedText>}
                {context.today.caffeine?.last_coffee_by && (
                  <ThemedText type="default">Last coffee by {context.today.caffeine.last_coffee_by}.</ThemedText>
                )}
                {context.today.meal && (
                  <ThemedText type="default">
                    Meal logged: {context.today.meal.carbs_g} g carbs{context.today.meal.note ? ` (${context.today.meal.note})` : ''}.
                  </ThemedText>
                )}
                {context.today.vitals && (
                  <ThemedText type="default">Latest pulse: {Math.round(context.today.vitals.pulse_bpm)} bpm.</ThemedText>
                )}
                {!context.flags.exercise_timing_allowed && (
                  <ThemedText type="small" themeColor="textSecondary">
                    Exercise timing advice is off because of your medication answer; discuss timing with your clinician.
                  </ThemedText>
                )}
                {context.last_plan && (
                  <ThemedText type="small" themeColor="textMuted">
                    Last plan: {context.last_plan.text}
                  </ThemedText>
                )}
                <ReadAloud text={planSentence(context)} />
              </Card>

              {context.levers.length > 0 && (
                <Card title="Levers">
                  {context.levers.map((l) => (
                    <ThemedText key={l.exposure} type="default">
                      {l.exposure.replace(/_/g, ' ')}: {l.years > 0 ? '+' : ''}
                      {l.years} years ({l.label}).
                    </ThemedText>
                  ))}
                  <ReadAloud
                    text={context.levers
                      .map((l) => `${l.exposure.replace(/_/g, ' ')}: ${l.years} risk-equivalent years if sustained, a population estimate`)
                      .join('. ')}
                  />
                </Card>
              )}
            </>
          ) : null}

          {/* Explain an analyte */}
          <Card title="Explain a blood marker">
            <View style={styles.row}>
              {ANALYTES.map((k) => (
                <SegmentButton key={k} label={ANALYTE_LABELS[k]} active={explainKey === k} onPress={() => pickExplain(k)} />
              ))}
            </View>
            {explainBusy ? (
              <ActivityIndicator color={Colors.accent} />
            ) : explain ? (
              <>
                <ThemedText type="default">{explain.text}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {explain.value !== null
                    ? `Your value: ${explain.value} ${explain.unit ?? ''}${explain.imputed ? ' (imputed)' : ''}.`
                    : 'No value of yours on file yet.'}
                </ThemedText>
                <ThemedText type="small" themeColor="textMuted">
                  {explain.source}. {explain.disclaimer}
                </ThemedText>
                <ReadAloud text={explain.text} />
              </>
            ) : explainKey && !hasToken() ? (
              <ThemedText type="small" themeColor="textSecondary">
                Sign in to read the explanations.
              </ThemedText>
            ) : null}
          </Card>

          {/* Memory */}
          {hasToken() && (
            <Card title="Check in">
              <ThemedText type="small" themeColor="textSecondary">
                One line about today. The coach remembers it tomorrow.
              </ThemedText>
              <TextField value={checkinText} onChangeText={setCheckinText} placeholder="Walked after dinner, coffee at two." />
              <Pressable style={[styles.primaryButton, (checkinBusy || !checkinText.trim()) && styles.disabled]} onPress={sendCheckin} disabled={checkinBusy || !checkinText.trim()}>
                <ThemedText type="smallBold" themeColor="accentText">
                  {checkinBusy ? 'Saving…' : 'Save'}
                </ThemedText>
              </Pressable>
              {history.slice(0, 5).map((h) => (
                <ThemedText key={h.id} type="small" themeColor="textSecondary">
                  {new Date(h.ts).toLocaleDateString()} · {h.kind}: {h.text ?? JSON.stringify(h.data)}
                </ThemedText>
              ))}
            </Card>
          )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function clockSentence(rows: [string, ClockRow][], context: CoachContext): string {
  if (context.flags.critical) return 'One lab value is out of range. See a clinician first.';
  if (rows.length === 0) return 'You have no clock yet.';
  return rows
    .map(([name, r]) => {
      const label = name === 'phenoage' ? 'biological age' : 'fitness age';
      return `Your estimated ${label} is ${Math.round(r.years)}, plus or minus ${Math.round(r.band ?? 0)}. An estimate, not a diagnosis.`;
    })
    .join(' ');
}

function circleSentence(context: CoachContext): string {
  if (!context.circle.available) return 'No inbox connected yet.';
  const m = context.circle.metrics;
  return `You have ${m.activeTies} active ties and ${m.closeTies} close ones. ${context.circle.nudges.length} are overdue.`;
}

function planSentence(context: CoachContext): string {
  const parts: string[] = [];
  if (context.today.nudge) parts.push(context.today.nudge.text);
  if (context.today.caffeine?.last_coffee_by) parts.push(`Last coffee by ${context.today.caffeine.last_coffee_by}.`);
  if (parts.length === 0) parts.push('Nothing overdue today.');
  return parts.join(' ');
}

function StatusPill({ status, mode, holding }: { status: VoiceStatus; mode: VoiceMode; holding: boolean }) {
  const text =
    status === 'connected' ? (holding ? 'listening' : mode === 'speaking' ? 'speaking' : 'muted') : status;
  const color = status === 'connected' ? (holding ? Colors.connection : Colors.accent) : status === 'error' ? Colors.silence : Colors.textMuted;
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <View style={[styles.pillDot, { backgroundColor: color }]} />
      <ThemedText type="small" style={{ color }}>
        {text}
      </ThemedText>
    </View>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <ThemedView type="surface" style={[styles.card, CardShadow]}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {children}
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
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
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
  talkButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.large,
    paddingVertical: Spacing.five,
    alignItems: 'center',
  },
  talkButtonActive: { backgroundColor: Colors.connection },
  disabled: { opacity: 0.5 },
  captions: { gap: Spacing.two, marginTop: Spacing.two },
  caption: { borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.half },
  captionUser: { backgroundColor: Colors.surfaceRaised },
  captionAi: { borderWidth: 1, borderColor: Colors.border },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  chip: {
    borderWidth: 1,
    borderColor: Colors.accent,
    borderRadius: Radius.pill,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
  },
});
