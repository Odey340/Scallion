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
  endSession: () => Promise<void>;
}

export const voiceSupported = Platform.OS === 'web';

function buildClientTools(lang: 'en' | 'es', handlers: VoiceHandlers, getContext: () => Promise<CoachContext>) {
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
      return { clock: c.clock, show_age: c.flags.show_age, critical: c.flags.critical };
    }),
    get_circle: (p: unknown) => call('get_circle', p, async () => (await getContext()).circle),
    explain_analyte: (p: { name: CanonicalKey }) => call('explain_analyte', p, () => api.explain(p.name, lang)),
    get_today_plan: (p: unknown) => call('get_today_plan', p, async () => {
      const c = await getContext();
      return { today: c.today, levers: c.levers, flags: c.flags, last_plan: c.last_plan };
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

export async function startVoice(lang: 'en' | 'es', handlers: VoiceHandlers): Promise<VoiceSession> {
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
    clientTools: buildClientTools(lang, handlers, getContext),
    onConnect: () => handlers.onStatus('connected'),
    onDisconnect: () => handlers.onStatus('disconnected'),
    onError: (message: string) => handlers.onStatus('error', message),
    onModeChange: ({ mode }: { mode: string }) => handlers.onMode(mode === 'speaking' ? 'speaking' : 'listening'),
    onMessage: ({ message, source }: { message: string; source: string }) => handlers.onMessage(source === 'agent' ? 'ai' : 'user', message),
  });
  // Push-to-talk: start muted; the button unmutes while held.
  conversation.setMicMuted(true);
  return {
    setMicMuted: (m) => conversation.setMicMuted(m),
    endSession: () => conversation.endSession(),
  };
}
