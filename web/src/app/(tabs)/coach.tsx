import { Link } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SegmentButton, TextField } from '@/components/form-controls';
import { ReadAloud } from '@/components/read-aloud';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ANALYTE_LABELS } from '@/components/waterfall';
import { CardShadow, Colors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { ANALYTES, type AnalyteKey } from '@/engine/phenoage';
import { ApiError, api, hasToken, type Checkin, type CoachContext, type Explain } from '@/lib/api';
import { startVoice, voiceSupported, type VoiceMode, type VoiceStatus } from '@/lib/coach-voice';
import { useSession } from '@/state/auth-store';

/**
 * Coach (docs/lanes/C.md Block 4): push-to-talk to D's ElevenLabs agent with captions, every
 * agent reply checked by POST /coach/validate before it is shown, and a text fallback that
 * renders /coach/context as cards (clock, circle, today's plan, levers, memory) with a
 * read-aloud button on each (GET /tts). Explain-an-analyte uses the curated /coach/explain
 * texts. Check-ins go to POST /coach/checkin (the coach's memory, Backboard behind it).
 */

type Lang = 'en' | 'es';

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
  // Subscribing re-renders this screen when the session (and so hasToken()) changes.
  useSession();
  const [lang, setLang] = useState<Lang>('en');
  const t = (en: string, es: string) => (lang === 'es' ? es : en);
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
  const session = useRef<Awaited<ReturnType<typeof startVoice>> | null>(null);
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
      setLang(c.flags.lang);
      setContextError(null);
    } catch {
      setContextError('Could not reach the coach context.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    return () => {
      session.current?.endSession().catch(() => undefined);
    };
  }, [load]);

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
      session.current = await startVoice(lang, {
        onStatus: (s, d) => {
          setStatus(s);
          if (d) {
            setStatusDetail(
              /permission|notallowed|denied/i.test(d)
                ? t('Microphone permission was denied. Allow the mic to talk; the cards below work without it.', 'Se denegó el micrófono. Permítelo para hablar; las tarjetas de abajo funcionan sin él.')
                : d,
            );
          }
        },
        onMode: setMode,
        onMessage: addCaption,
        onToolCall: (name) => setToolCalls((t) => [...t, name]),
      });
    } catch (e) {
      setStatus('error');
      setStatusDetail(e instanceof ApiError && e.status === 503 ? 'No coach agent is configured on the API.' : e instanceof Error ? e.message : 'Could not start the voice coach.');
    }
  };

  const stop = async () => {
    await session.current?.endSession().catch(() => undefined);
    session.current = null;
    setStatus('idle');
    setHolding(false);
  };

  const pressIn = () => {
    setHolding(true);
    session.current?.setMicMuted(false);
  };
  const pressOut = () => {
    setHolding(false);
    session.current?.setMicMuted(true);
  };

  const pickExplain = async (key: AnalyteKey) => {
    setExplainKey(key);
    setExplainBusy(true);
    try {
      setExplain(await api.explain(key, lang));
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
        <ScrollView style={styles.scrollOuter} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.headerRow}>
            <ThemedText type="subtitle">{t('Coach', 'Coach')}</ThemedText>
            <View style={styles.row}>
              <SegmentButton label="EN" active={lang === 'en'} onPress={() => setLang('en')} />
              <SegmentButton label="ES" active={lang === 'es'} onPress={() => setLang('es')} />
            </View>
          </View>
          <ThemedText type="default" themeColor="textSecondary">
            {t(
              'Ask about your clock, your circle, or today’s one action. The coach may only say numbers that exist in your data; every reply is checked.',
              'Pregunta por tu reloj, tu círculo o la acción de hoy. El coach solo puede decir números que existen en tus datos; cada respuesta se verifica.',
            )}
          </ThemedText>

          {!hasToken() && (
            <ThemedView type="surfaceRaised" style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('The coach reads your stored clock, circle and plan, so it needs you signed in.', 'El coach lee tu reloj, círculo y plan guardados, así que necesita que inicies sesión.')}
              </ThemedText>
              {!hasToken() && (
                <Link href="/onboarding" asChild>
                  <Pressable style={styles.secondaryButton}>
                    <ThemedText type="smallBold" themeColor="accent">
                      {t('Sign in', 'Iniciar sesión')}
                    </ThemedText>
                  </Pressable>
                </Link>
              )}
            </ThemedView>
          )}

          {/* Voice */}
          <ThemedView type="surface" style={[styles.card, CardShadow]}>
            <View style={styles.headerRow}>
              <ThemedText type="smallBold">{t('Talk to the coach', 'Habla con el coach')}</ThemedText>
              <StatusPill status={status} mode={mode} holding={holding} />
            </View>
            {!voiceSupported && (
              <ThemedText type="small" themeColor="textMuted">
                {t('Voice runs in the web app; use the cards below here.', 'La voz funciona en la app web; usa las tarjetas de abajo.')}
              </ThemedText>
            )}
            {statusDetail && (
              <ThemedText type="small" themeColor="silence">
                {statusDetail}
              </ThemedText>
            )}
            {status !== 'connected' && status !== 'connecting' ? (
              <Pressable style={[styles.primaryButton, (!hasToken() || !voiceSupported) && styles.disabled]} onPress={start} disabled={!hasToken() || !voiceSupported}>
                <ThemedText type="smallBold" themeColor="accentText">
                  {t('Start a conversation', 'Iniciar conversación')}
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
                    {status === 'connecting' ? t('Connecting…', 'Conectando…') : holding ? t('Listening…', 'Escuchando…') : t('Hold to talk', 'Mantén para hablar')}
                  </ThemedText>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={stop}>
                  <ThemedText type="smallBold" themeColor="accent">
                    {t('End', 'Terminar')}
                  </ThemedText>
                </Pressable>
              </>
            )}

            {captions.length > 0 && (
              <View style={styles.captions}>
                {captions.map((c) => (
                  <View key={c.id} style={[styles.caption, c.source === 'user' ? styles.captionUser : styles.captionAi]}>
                    <ThemedText type="small" themeColor="textMuted">
                      {c.source === 'user' ? t('You', 'Tú') : 'Coach'}
                      {c.source === 'ai' && c.ok === null ? ` · ${t('checking numbers…', 'verificando números…')}` : ''}
                    </ThemedText>
                    {c.source === 'ai' && c.ok === false ? (
                      <ThemedText type="small" themeColor="silence">
                        {t('Reply withheld: it contained a number not in your data', 'Respuesta retenida: contenía un número que no está en tus datos')} ({c.unknown?.join(', ')}).
                      </ThemedText>
                    ) : (
                      <ThemedText type="default">{c.text}</ThemedText>
                    )}
                  </View>
                ))}
              </View>
            )}
            {toolCalls.length > 0 && (
              <ThemedText type="small" themeColor="textMuted">
                {t('Tools used', 'Herramientas usadas')}: {toolCalls.join(', ')}
              </ThemedText>
            )}
            <ThemedText type="small" themeColor="textMuted">
              {t(
                'ElevenLabs Agents; the key stays on the server. Captions on. Estimate, not diagnosis.',
                'ElevenLabs Agents; la clave se queda en el servidor. Subtítulos activados. Estimación, no diagnóstico.',
              )}
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
              <Card title={t('Your clock', 'Tu reloj')}>
                {context.flags.critical ? (
                  <ThemedText type="default" themeColor="critical">
                    {t('See a clinician first', 'Consulta primero a un clínico')}
                  </ThemedText>
                ) : clockRows.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('No clock yet.', 'Aún no hay reloj.')}
                  </ThemedText>
                ) : (
                  clockRows.map(([name, row]) => (
                    <ThemedText key={name} type="default">
                      {name === 'phenoage' ? t('Biological age', 'Edad biológica') : name === 'fitness' ? t('Fitness age', 'Edad física') : name}:{' '}
                      <ThemedText type="smallBold">{Math.round(row.years)}</ThemedText>
                      {row.band != null ? ` +/- ${Math.round(row.band)}` : ''}
                      {row.delta_years != null ? ` (${row.delta_years > 0 ? '+' : ''}${row.delta_years} ${t('vs calendar age', 'vs edad calendario')})` : ''}
                    </ThemedText>
                  ))
                )}
                <ReadAloud lang={lang} text={clockSentence(clockRows, context, lang)} />
              </Card>

              <Card title={t('Your circle', 'Tu círculo')}>
                {context.circle.available ? (
                  <>
                    <ThemedText type="default">
                      {context.circle.metrics.activeTies} {t('active ties', 'vínculos activos')}, {context.circle.metrics.closeTies} {t('close', 'cercanos')}.{' '}
                      {context.circle.nudges.length} {t('overdue', 'pendientes')}.
                    </ThemedText>
                    <ThemedText type="small" themeColor="textMuted">
                      {context.circle.lsns.label}: {context.circle.lsns.score}.
                    </ThemedText>
                    <ReadAloud lang={lang} text={circleSentence(context, lang)} />
                  </>
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('No inbox connected yet.', 'Aún no hay bandeja conectada.')}
                  </ThemedText>
                )}
              </Card>

              <Card title={t('Today’s plan', 'El plan de hoy')}>
                {context.today.nudge && <ThemedText type="default">{context.today.nudge.text}</ThemedText>}
                {context.today.caffeine?.last_coffee_by && (
                  <ThemedText type="default">
                    {t('Last coffee by', 'Último café antes de las')} {context.today.caffeine.last_coffee_by}.
                  </ThemedText>
                )}
                {context.today.meal && (
                  <ThemedText type="default">
                    {t('Meal logged', 'Comida registrada')}: {context.today.meal.carbs_g} g {t('carbs', 'de carbohidratos')}{context.today.meal.note ? ` (${context.today.meal.note})` : ''}.
                  </ThemedText>
                )}
                {context.today.vitals && (
                  <ThemedText type="default">
                    {t('Latest pulse', 'Último pulso')}: {Math.round(context.today.vitals.pulse_bpm)} bpm.
                  </ThemedText>
                )}
                {!context.flags.exercise_timing_allowed && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('Exercise timing advice is off because of your medication answer; discuss timing with your clinician.', 'El consejo sobre el momento del ejercicio está desactivado por tu respuesta sobre medicación; consulta con tu clínico.')}
                  </ThemedText>
                )}
                {context.last_plan && (
                  <ThemedText type="small" themeColor="textMuted">
                    {t('Last plan', 'Último plan')}: {context.last_plan.text}
                  </ThemedText>
                )}
                <ReadAloud lang={lang} text={planSentence(context, lang)} />
              </Card>

              {context.levers.length > 0 && (
                <Card title={t('Levers', 'Palancas')}>
                  {context.levers.map((l) => (
                    <ThemedText key={l.exposure} type="default">
                      {l.exposure.replace(/_/g, ' ')}: {l.years > 0 ? '+' : ''}
                      {l.years} {t('years', 'años')} ({l.label}).
                    </ThemedText>
                  ))}
                  <ReadAloud lang={lang} text={context.levers.map((l) => `${l.exposure.replace(/_/g, ' ')}: ${l.years} ${t('risk-equivalent years if sustained, a population estimate', 'años de riesgo equivalente si se mantiene, una estimación poblacional')}`).join('. ')} />
                </Card>
              )}
            </>
          ) : null}

          {/* Explain an analyte */}
          <Card title={t('Explain a blood marker', 'Explicar un marcador')}>
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
                    ? `${t('Your value', 'Tu valor')}: ${explain.value} ${explain.unit ?? ''}${explain.imputed ? ` (${t('imputed', 'imputado')})` : ''}.`
                    : t('No value of yours on file yet.', 'Aún no hay un valor tuyo.')}
                </ThemedText>
                <ThemedText type="small" themeColor="textMuted">
                  {explain.source}. {explain.disclaimer}
                </ThemedText>
                <ReadAloud lang={lang} text={explain.text} />
              </>
            ) : explainKey && !hasToken() ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t('This needs a demo account for this build.', 'Esto necesita una cuenta de demostración para esta versión.')}
              </ThemedText>
            ) : null}
          </Card>

          {/* Memory */}
          {hasToken() && (
            <Card title={t('Check in', 'Registro del día')}>
              <ThemedText type="small" themeColor="textSecondary">
                {t('One line about today. The coach remembers it tomorrow.', 'Una línea sobre hoy. El coach lo recordará mañana.')}
              </ThemedText>
              <TextField value={checkinText} onChangeText={setCheckinText} placeholder={t('Walked after dinner, coffee at two.', 'Caminé después de cenar, café a las dos.')} />
              <Pressable style={[styles.primaryButton, (checkinBusy || !checkinText.trim()) && styles.disabled]} onPress={sendCheckin} disabled={checkinBusy || !checkinText.trim()}>
                <ThemedText type="smallBold" themeColor="accentText">
                  {checkinBusy ? t('Saving…', 'Guardando…') : t('Save', 'Guardar')}
                </ThemedText>
              </Pressable>
              {history.slice(0, 5).map((h) => (
                <ThemedText key={h.id} type="small" themeColor="textSecondary">
                  {new Date(h.ts).toLocaleDateString()} · {h.kind}: {h.text ?? JSON.stringify(h.data)}
                </ThemedText>
              ))}
            </Card>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function clockSentence(rows: [string, ClockRow][], context: CoachContext, lang: Lang): string {
  if (context.flags.critical) return lang === 'es' ? 'Un valor de laboratorio está fuera de rango. Consulta primero a un clínico.' : 'One lab value is out of range. See a clinician first.';
  if (rows.length === 0) return lang === 'es' ? 'Aún no tienes un reloj.' : 'You have no clock yet.';
  return rows
    .map(([name, r]) => {
      const label = name === 'phenoage' ? (lang === 'es' ? 'edad biológica' : 'biological age') : lang === 'es' ? 'edad física' : 'fitness age';
      return lang === 'es'
        ? `Tu ${label} estimada es ${Math.round(r.years)}, más o menos ${Math.round(r.band ?? 0)}. Es una estimación, no un diagnóstico.`
        : `Your estimated ${label} is ${Math.round(r.years)}, plus or minus ${Math.round(r.band ?? 0)}. An estimate, not a diagnosis.`;
    })
    .join(' ');
}

function circleSentence(context: CoachContext, lang: Lang): string {
  if (!context.circle.available) return lang === 'es' ? 'Aún no hay bandeja conectada.' : 'No inbox connected yet.';
  const m = context.circle.metrics;
  return lang === 'es'
    ? `Tienes ${m.activeTies} vínculos activos y ${m.closeTies} cercanos. ${context.circle.nudges.length} están pendientes.`
    : `You have ${m.activeTies} active ties and ${m.closeTies} close ones. ${context.circle.nudges.length} are overdue.`;
}

function planSentence(context: CoachContext, lang: Lang): string {
  const parts: string[] = [];
  if (context.today.nudge) parts.push(context.today.nudge.text);
  if (context.today.caffeine?.last_coffee_by) parts.push(lang === 'es' ? `Último café antes de las ${context.today.caffeine.last_coffee_by}.` : `Last coffee by ${context.today.caffeine.last_coffee_by}.`);
  if (parts.length === 0) parts.push(lang === 'es' ? 'Nada pendiente hoy.' : 'Nothing overdue today.');
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
});
