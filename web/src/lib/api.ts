/**
 * Scallion API client (Lane D provides; Lane C consumes). One function per route in
 * docs/contracts.md section 3, typed from the API's pydantic models.
 *
 * Base URL: EXPO_PUBLIC_API_URL (default https://api.scallion.us). Local dev with the API in
 * DEV_AUTH_BYPASS mode: EXPO_PUBLIC_API_URL=http://localhost:8000 and no token.
 * Auth: call setToken(jwt) after login (Supabase access token), or set EXPO_PUBLIC_DEMO_TOKEN for
 * the judged demo account. Every request sends Authorization: Bearer <token> when one is set.
 *
 * Numbers rule: nothing here computes; it only moves engine JSON, stored rows and the coach
 * context. The web app computes PhenoAge/fitness age from web/public/engine/*.json and POSTs the
 * result with postClock so the coach can speak about it.
 */

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'https://api.scallion.us').replace(/\/$/, '');

let token: string | null = process.env.EXPO_PUBLIC_DEMO_TOKEN ?? null;
export function setToken(jwt: string | null) {
  token = jwt;
}
export function hasToken() {
  return !!token;
}

export class ApiError extends Error {
  constructor(public status: number, public detail: unknown, message?: string) {
    super(message ?? `API ${status}`);
  }
}

async function call<T>(path: string, init: RequestInit = {}, headers: Record<string, string> = {}): Promise<T> {
  const h: Record<string, string> = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (init.body && !(init.body instanceof FormData)) h['content-type'] = 'application/json';
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: h });
  if (!res.ok) {
    let detail: unknown = null;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text().catch(() => null);
    }
    throw new ApiError(res.status, detail, (detail as { detail?: string } | null)?.detail ?? `API ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

// ---------- types (mirror api/app/**/schema.py) ----------

export type CanonicalKey = 'albumin' | 'creatinine' | 'glucose' | 'crp' | 'lymph_pct' | 'mcv' | 'rdw' | 'alp' | 'wbc';

export interface Analyte {
  name: CanonicalKey | `other:${string}`;
  value: number;
  unit: string;
  ref_low: number | null;
  ref_high: number | null;
  source_span: [number, number] | null;
  source_text: string;
  raw_name: string;
  si_value: number | null;
  si_unit: string | null;
  derived: 'lymph_pct_from_absolute' | null;
  note: string | null;
}

export interface ExtractResponse {
  analytes: Analyte[];
  fasting: boolean | null;
  lang: 'en' | 'es' | 'other';
  text: string;
  missing: CanonicalKey[];
  complete: {
    missing: string[];
    derived: string[];
    order: { panel: string; name: string; covers: string[]; dtc_usd: [number, number]; fasting: boolean }[];
    where: string[];
    collected_date: string | null;
    retest_date: string | null;
    retest_rule: string;
    fasting_action: string | null;
    fasting_hours: string;
    label: string;
  } | null;
}

export interface VitalsIn {
  source?: 'presage' | 'manual';
  pulse_bpm: number;
  breathing_bpm?: number | null;
  stress_index?: number | null;
  captured_at: string;
  hrv_rmssd_ms?: number | null;
  confidence?: number | null;
  samples?: number | null;
}
export interface VitalsOut extends Required<VitalsIn> {
  received_at: string;
}

export type ClockName = 'phenoage' | 'fitness' | 'social_risk';
export interface ClockIn {
  clock: ClockName;
  years: number;
  chronological_age?: number | null;
  band?: number | null;
  inputs?: Record<string, unknown> | null; // phenoage: si values by canonical key + imputed: string[]
  engine_version?: string | null;
}
export interface ClockOut extends ClockIn {
  computed_at: string;
}

export interface Answers {
  on_glucose_meds?: boolean;
  sleep_h?: number;
  smoker?: boolean;
  lonely?: boolean;
  lives_alone?: boolean;
  oral_contraceptive?: boolean;
  help_family?: 0 | 1 | 2 | 3 | 4 | 5;
  help_friends?: 0 | 1 | 2 | 3 | 4 | 5;
  bedtime?: string; // "HH:MM"
  coffee_mg_per_cup?: number;
}

export interface Me {
  verified: boolean;
  over_65: boolean;
  lang: 'en' | 'es';
  age: number | null;
  verify_url: string | null;
  answers: Answers;
}

export interface Lever {
  layer: string;
  exposure: string;
  hr: number;
  years: number;
  source: string;
  condition: string;
  label: string;
}

export interface Checkin {
  id: number;
  ts: string;
  kind: 'checkin' | 'nudge' | 'reply' | 'meal' | 'share' | 'plan';
  text: string | null;
  data: Record<string, unknown> | null;
}

export interface CoachContext {
  clock: Record<string, (ClockOut & { delta_years: number | null; show: boolean }) | unknown>;
  circle: CircleSummary | { available: false; todo?: string };
  today: {
    vitals: VitalsOut | null;
    caffeine: {
      hours_before_bed: number;
      last_coffee_by: string | null;
      bedtime: string | null;
      dose_mg: number;
      dose_assumption: string | null;
      source: string;
      rule: string;
    } | null;
    nudge: Nudge | null;
    meal: { carbs_g: number | null; ts: string; note: string | null } | null;
  };
  levers: Lever[];
  levers_unknown: { exposure: string; needs: string }[];
  history: Checkin[];
  last_plan: Checkin | null;
  flags: {
    on_glucose_meds: boolean;
    critical: boolean;
    critical_reasons: string[];
    verified: boolean;
    over_65: boolean;
    exercise_timing_allowed: boolean;
    show_age: boolean;
    lang: 'en' | 'es';
  };
}

export interface Explain {
  name: CanonicalKey;
  lang: 'en' | 'es';
  text: string;
  source: string;
  value: number | null;
  unit: string | null;
  imputed: boolean;
  disclaimer: string;
}

export type App = 'gmail' | 'whatsapp' | 'sms' | 'imessage' | 'notif';
export interface Event {
  contact: string; // sha256 hex
  ts: string;
  app: App;
  dir: 'in' | 'out';
  len: 0 | 1 | 2 | 3;
}

export interface Metrics {
  activeTies: number;
  closeTies: number;
  initiationShare: number;
  replyLatencyH: { mine: number | null; theirs: number | null };
  churn: number;
  silenceDays: number;
  window: [string, string];
}
export interface Nudge {
  contact: string;
  kind: 'overdue';
  medianGapDays: number;
  daysSince: number;
  score: number;
  text: string;
}
export interface Day {
  date: string;
  people: number;
  level: 0 | 1 | 2 | 3;
}
export interface CircleSummary {
  available: true;
  metrics: Metrics;
  previous: Metrics;
  lsns: { score: number; atRisk: boolean; items: number[]; fromMessaging: 4; fromUser: 2; label: string };
  nudges: Nudge[];
  heatmap: Day[];
  alerts: ('distancing' | 'active')[];
  risk: Lever | null; // the social_isolation row from risk_years.json when lsns.atRisk
  events: number;
  source: string;
}

// ---------- routes ----------

export const api = {
  health: () => call<Record<string, unknown>>('/health'),

  /** Redacted PDF/image -> analytes. preferCache returns the cached demo response instantly. */
  extract: (file: Blob, opts: { preferCache?: boolean; filename?: string } = {}) => {
    const fd = new FormData();
    fd.append('file', file, opts.filename ?? 'report.pdf');
    return call<ExtractResponse>('/extract', { method: 'POST', body: fd }, opts.preferCache ? { 'x-scallion-cache': 'prefer' } : {});
  },

  postClock: (c: ClockIn) => call<ClockOut>('/clock', json(c)),
  latestClock: () => call<Partial<Record<ClockName, ClockOut>>>('/clock/latest'),

  postVitals: (v: VitalsIn) => call<{ ok: true }>('/vitals', json(v)),
  latestVitals: () => call<VitalsOut>('/vitals/latest'), // 404 -> ApiError when none

  me: () => call<Me>('/me'),
  setLang: (lang: 'en' | 'es') => call<Me>('/me/lang', { method: 'PUT', body: JSON.stringify({ lang }) }),
  setAnswers: (a: Answers) => call<Me>('/me/answers', { method: 'PUT', body: JSON.stringify(a) }),

  postEvents: (events: Event[]) => call<{ inserted: number; received: number; duplicates: number }>('/events', json({ events })),
  deleteAllEvents: () => call<{ deleted: number }>('/events', { method: 'DELETE' }),
  forgetContact: (contact: string) => call<{ deleted: number }>(`/events/${contact}`, { method: 'DELETE' }),
  circle: (windowDays = 30) => call<CircleSummary | { available: false }>(`/circle/summary?window_days=${windowDays}`),

  coachContext: () => call<CoachContext>('/coach/context'),
  validate: (text: string) => call<{ ok: boolean; unknown_numbers: string[] }>('/coach/validate', json({ text })),
  explain: (name: CanonicalKey, lang: 'en' | 'es' = 'en') => call<Explain>(`/coach/explain/${name}?lang=${lang}`),
  session: () => call<{ agent_id: string; signed_url: string | null }>('/coach/session'),
  checkin: (kind: Checkin['kind'], text?: string, data?: Record<string, unknown>) => call<Checkin>('/coach/checkin', json({ kind, text, data })),
  checkins: (limit = 10, kind?: Checkin['kind']) => call<Checkin[]>(`/coach/checkins?limit=${limit}${kind ? `&kind=${kind}` : ''}`),
  logMeal: (carbs_g: number, note?: string) => call<{ ok: true; carbs_g: number; ts: string }>('/coach/meal', json({ carbs_g, note })),
  share: (target_contact: string, text?: string) => call<{ ok: true }>('/coach/share', json({ target_contact, text })), // 403 unless verified
  recall: (q: string, limit = 5) => call<{ memory: string; hits: { content: string; score: number }[] }>(`/coach/recall?q=${encodeURIComponent(q)}&limit=${limit}`),

  /** One spoken sentence as an object URL for <audio>/expo-av. Revoke it when done. */
  tts: async (text: string, lang: 'en' | 'es' = 'en') => {
    const h: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
    const res = await fetch(`${API_URL}/tts?text=${encodeURIComponent(text)}&lang=${lang}`, { headers: h });
    if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => null));
    return URL.createObjectURL(await res.blob());
  },
};

export default api;
