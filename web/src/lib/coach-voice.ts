/**
 * Voice coach: the ElevenLabs Agents session (web only), started from the API's signed URL
 * (`GET /coach/session`; the ElevenLabs key never reaches the client) with the six client
 * tools from api/coach_tools.json implemented here. Each tool returns JSON the API already
 * holds (`/coach/context`, `/coach/explain`, `/coach/meal`, `/coach/share`), so the agent can
 * only speak numbers that exist (CLAUDE.md rule 1); the screen still runs every reply through
 * `POST /coach/validate` before showing it.
 *
 * Push-to-talk: the SDK is always listening once connected, so "hold to talk" toggles the mic
 * mute (setMicMuted) — the agent hears nothing while the button is up.
 */
import { Platform } from 'react-native';

import { ANALYTE_LABELS } from '@/components/waterfall';
import { ANALYTES, computePhenoAge, type AnalyteKey, type PhenoAgeData, type PhenoAgeValues } from '@/engine/phenoage';
import { api, type CanonicalKey, type CoachContext } from '@/lib/api';

export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
export type VoiceMode = 'listening' | 'speaking';

export interface VoiceHandlers {
  onStatus: (status: VoiceStatus, detail?: string) => void;
  onMode: (mode: VoiceMode) => void;
  onMessage: (source: 'user' | 'ai', text: string) => void;
  onToolCall: (name: string, params: unknown) => void;
}

interface VoiceSession {
  setMicMuted: (muted: boolean) => void;
  /** Send a typed question as if spoken (the suggestion chips). */
  sendText: (text: string) => void;
  endSession: () => Promise<void>;
}

export const voiceSupported = Platform.OS === 'web';

/**
 * Which markers move the age, for the coach to name. Recomputed in the browser from the inputs
 * the clock was posted with (rule 1: the same phenoage.ts and phenoage.json as the Labs screen).
 * Deliberately carries no numbers: the API context does not hold the waterfall, so any years
 * spoken from it would be withheld by the validator. The agent says "adds years" / "takes years off".
 */
let phenoDataPromise: Promise<PhenoAgeData | null> | null = null;
function phenoData(): Promise<PhenoAgeData | null> {
  return (phenoDataPromise ??= fetch('/engine/phenoage.json')
    .then((r) => (r.ok ? (r.json() as Promise<PhenoAgeData>) : null))
    .catch(() => null));
}

interface Driver {
  marker: AnalyteKey;
  label: string;
  effect: 'adds years' | 'takes years off' | 'about neutral';
  rank: number;
  imputed: boolean;
}

async function ageDrivers(context: CoachContext): Promise<{ drivers: Driver[]; markers_used: string } | null> {
  const row = context.clock.phenoage as { inputs?: Record<string, unknown>; chronological_age?: number | null } | undefined;
  const inputs = row?.inputs;
  const age = row?.chronological_age;
  const data = await phenoData();
  if (!inputs || typeof age !== 'number' || !data) return null;
  const sex = inputs.sex === 'F' ? 'F' : inputs.sex === 'M' ? 'M' : null;
  if (!sex) return null;
  const values = {} as PhenoAgeValues;
  for (const a of ANALYTES) values[a] = typeof inputs[a] === 'number' ? (inputs[a] as number) : null;
  try {
    const r = computePhenoAge(values, age, sex, data, { fasting: inputs.fasting !== false });
    const drivers = ANALYTES.map((a) => ({ marker: a, years: r.waterfall[a], imputed: r.imputed.includes(a) }))
      .sort((x, y) => Math.abs(y.years) - Math.abs(x.years))
      .map((d, i) => ({
        marker: d.marker,
        label: ANALYTE_LABELS[d.marker],
        effect: Math.abs(d.years) < 0.25 ? ('about neutral' as const) : d.years > 0 ? ('adds years' as const) : ('takes years off' as const),
        rank: i + 1,
        imputed: d.imputed,
      }));
    return { drivers, markers_used: `${r.markersUsed} of ${ANALYTES.length} markers` };
  } catch {
    return null;
  }
}

function buildClientTools(handlers: VoiceHandlers, getContext: () => Promise<CoachContext>) {
  const call = async <T>(name: string, params: unknown, fn: () => Promise<T>): Promise<string> => {
    handlers.onToolCall(name, params);
    try {
      return JSON.stringify(await fn());
    } catch (e) {
      return JSON.stringify({ error: e instanceof Error ? e.message : 'failed' });
    }
  };
  return {
    get_clock: (p: unknown) => call('get_clock', p, async () => {
      const c = await getContext();
      // Only the clock rows: the `labels` strings ("See a clinician first") are UI copy, not state,
      // and the agent read them as the user's situation.
      const { labels: _labels, ...rows } = c.clock as Record<string, unknown>;
      const hasPheno = 'phenoage' in rows;
      const hasFitness = 'fitness' in rows;
      if (!hasPheno && !hasFitness) {
        return {
          status: 'no_clock_yet',
          what_is_missing: 'No biological age or fitness age has been computed for this account.',
          how_to_get_one: {
            biological_age: 'Upload a blood panel on the Labs tab, or tap "Try the sample report" there.',
            fitness_age: 'Use the Camera tab: thirty seconds facing the camera.',
          },
          critical: false,
        };
      }
      const drivers = hasPheno && c.flags.show_age ? await ageDrivers(c) : null;
      return {
        clock: rows,
        show_age: c.flags.show_age,
        critical: c.flags.critical,
        critical_reasons: c.flags.critical_reasons,
        ...(hasPheno ? {} : { biological_age: 'not computed yet: upload a blood panel on the Labs tab' }),
        ...(hasFitness ? {} : { fitness_age: 'not computed yet: use the Camera tab' }),
        ...(drivers ?? {}),
      };
    }),
    get_circle: (p: unknown) => call('get_circle', p, async () => {
      const c = await getContext();
      if (!c.circle.available) {
        return {
          status: 'no_inbox_connected',
          what_is_missing: 'No messaging metadata yet, so there are no ties, no drifting contacts and no isolation proxy.',
          how_to_connect: 'On the Circle tab: connect Gmail or upload a WhatsApp export. Only metadata is used, never message content.',
        };
      }
      return c.circle;
    }),
    explain_analyte: (p: { name: CanonicalKey }) => call('explain_analyte', p, () => api.explain(p.name)),
    get_today_plan: (p: unknown) => call('get_today_plan', p, async () => {
      const c = await getContext();
      const missing: string[] = [];
      if (!c.today.nudge) missing.push(c.circle.available ? 'nobody is overdue in the circle today' : 'no nudge: no inbox connected yet (Circle tab)');
      if (c.today.caffeine && !c.today.caffeine.last_coffee_by) missing.push('no clock time for the last coffee: bedtime is not set yet (Profile in onboarding); only the hours-before-bed rule is known');
      if (!c.today.meal) missing.push('no meal logged today: the Scan tab or log_meal gives the plate decision');
      if (!c.today.vitals) missing.push('no pulse yet: Camera tab');
      return { today: c.today, levers: c.levers, flags: c.flags, last_plan: c.last_plan, missing };
    }),
    log_meal: (p: { carbs_g: number }) => call('log_meal', p, () => api.logMeal(Number(p.carbs_g))),
    share_with_circle: (p: { target_contact: string }) => call('share_with_circle', p, async () => {
      const c = await getContext();
      if (!c.flags.verified) return { refused: 'not verified' };
      return api.share(String(p.target_contact));
    }),
  };
}

const STALE_CHUNK_KEY = 'scallion.reloaded-for-stale-chunk';

/**
 * Loads the ElevenLabs SDK, which Metro splits into its own hashed chunk.
 * After a redeploy an already-open tab still holds the previous entry bundle, whose chunk URL no
 * longer exists on Vercel ("Loading module .../index-<hash>.js failed"). Reload once to pick up
 * the fresh bundle; if it fails again, tell the user instead of looping.
 */
async function loadElevenLabs(): Promise<typeof import('@elevenlabs/client')> {
  try {
    const mod = await import('@elevenlabs/client');
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(STALE_CHUNK_KEY);
    return mod;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const staleChunk = /Loading module|dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(msg);
    if (staleChunk && typeof window !== 'undefined' && typeof sessionStorage !== 'undefined') {
      if (!sessionStorage.getItem(STALE_CHUNK_KEY)) {
        sessionStorage.setItem(STALE_CHUNK_KEY, '1');
        window.location.reload();
        return new Promise(() => undefined); // the page is going away
      }
      throw new Error('The app was updated since this page loaded. Refresh the page and try the coach again.');
    }
    throw e;
  }
}

export async function startVoice(handlers: VoiceHandlers): Promise<VoiceSession> {
  if (!voiceSupported) throw new Error('Voice coach runs in the web app.');
  handlers.onStatus('connecting');
  const session = await api.session(); // 503 -> ApiError when no agent is configured
  if (!session.signed_url) throw new Error('The coach agent is not configured (no signed URL).');

  // Cached per conversation so repeated tool calls do not hammer the API.
  let contextPromise: Promise<CoachContext> | null = null;
  const getContext = () => (contextPromise ??= api.coachContext());

  // Loaded lazily: the SDK touches window/AudioContext at import time.
  const { Conversation } = await loadElevenLabs();
  const conversation = await Conversation.startSession({
    signedUrl: session.signed_url,
    connectionType: 'websocket',
    clientTools: buildClientTools(handlers, getContext),
    onConnect: () => handlers.onStatus('connected'),
    onDisconnect: () => handlers.onStatus('disconnected'),
    onError: (message: string) => handlers.onStatus('error', message),
    onModeChange: ({ mode }: { mode: string }) => handlers.onMode(mode === 'speaking' ? 'speaking' : 'listening'),
    onMessage: ({ message, source }: { message: string; source: 'user' | 'ai' }) => handlers.onMessage(source, message),
  });
  // Push-to-talk: start muted; the button unmutes while held.
  conversation.setMicMuted(true);
  return {
    setMicMuted: (m) => conversation.setMicMuted(m),
    sendText: (text) => {
      handlers.onMessage('user', text);
      conversation.sendUserMessage(text);
    },
    endSession: () => conversation.endSession(),
  };
}
