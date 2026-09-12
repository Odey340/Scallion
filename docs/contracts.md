# Contracts between lanes

Change only by agreement: edit here, commit `[contract] ...`, post in Discord. Bump the version line.

**v2 (Fri H2): `/extract` response gained `text`, `source_text`, `raw_name`, `missing`; `source_span` indexes into `text`.**
**v3 (Sat): section 7, client-side redaction rules at `api/redaction_rules.json` (D produces, C applies before upload).**
**v4 (Sat H9): `/extract` analytes gained `si_value`, `si_unit`, `derived`, `note` (unit normalizer); a derived `lymph_pct` row may appear.**
**v5 (Sat H10): `/events` response gained `received`, `duplicates`; `DELETE /events` and `DELETE /events/{contact}` added for B's forget/delete-all.**
**v6 (Sat H10): `GET /me` gained `age` (verified only) and `verify_url` (Persona hosted flow); `PUT /me/lang` added; `GET /tts?text=&lang=` added.**
**v7 (Sat H11): `POST /clock` + `GET /clock/latest` (C records the clock it computed); `PUT /me/answers` (onboarding); `/coach/context` shape below; `POST /coach/validate` (number validator).**
**v8 (Sat H14): coach memory `POST /coach/checkin`, `GET /coach/checkins`; tool handlers `POST /coach/meal`, `POST /coach/share`; `GET /coach/session` (agent id + signed URL); `GET /coach/explain/{name}`; context gained `history`, `last_plan`, `today.meal`.**
**v9 (Sat H14): `/extract` gained `complete` (what to order for missing analytes, re-test date, fasting action; reference prices labelled, never engine).**
**v10 (Sat H22): `GET /circle/summary` served by the API from `contact_events` as a stand-in for B's package (same thresholds, TODO(B)); `web/src/lib/api.ts` typed client for C.**
**v11 (Sat, C): route `/tonight` renamed to `/scan` (screen is meal-agnostic now, not dinner-only; human request). `/scan-results` added — submitting `/scan` navigates to a results page instead of showing results inline. No response/route-elsewhere shape changed.**
**v8 (Fri H5, A): `phenoage.json` `k` is 0.090165 (Levine 2018 Supplement 1; 0.09165 was a typo) and the horizon key is `t_months` (120), not `t_days`. Additive keys now exported: `a`, `offset`, `affine.A`, `imputation_sd_by_age_sex`, `cohort_offset_rule`, `waterfall_rule`, `band_rule`, `labels`; `meal_grid.json` gained `band_rule`, `summary_rule`, `labels`, `summary.*.basal_mgdL`. C must compute the cohort offset at the user's exact age (see below).**

## 1. Engine exports (A produces, C consumes): `web/public/engine/`

Plain JSON written by `matlab/export/export_artifacts.m`. C never re-derives coefficients; it reads these files.

### `phenoage.json`
```json
{
  "version": 1,
  "units": {"albumin":"g/L","creatinine":"umol/L","glucose":"mmol/L","crp":"mg/dL","lymph_pct":"%","mcv":"fL","rdw":"%","alp":"U/L","wbc":"10^9/L","age":"years"},
  "coefficients": {"albumin":-0.0336,"creatinine":0.0095,"glucose":0.1953,"ln_crp":0.0954,"lymph_pct":-0.0120,"mcv":0.0268,"rdw":0.3306,"alp":0.00188,"wbc":0.0554,"age":0.0804},
  "intercept": -19.907,
  "gamma": 0.0076927,
  "t_months": 120,
  "k": 0.090165,
  "crp_floor_mgdL": 0.1,
  "crp_acute_mgdL": 1.0,
  "reference_by_age_sex": {"M": {"30-39": {"albumin": 44.0}}, "F": {}},
  "cohort_offset_by_age_sex": {"M": {"30-39": -1.2}, "F": {}},
  "cv": {"glucose": {"within": 0.06, "analytical": 0.02}, "crp": {"within": 0.35, "analytical": 0.05}, "rdw": {"within": 0.035, "analytical": 0.01}},
  "critical_ranges": {"glucose_mgdL": [55, 250], "wbc": [2, 30], "creatinine_x_ref_high": 2}
}
```
A verifies the coefficient units against Levine 2018 Table 1 before exporting; the values above are placeholders to fix the shape. C implements `computePhenoAge(values, age, sex, opts)` in `web/src/engine/phenoage.ts` from this file and must reproduce A's test vectors in `matlab/tests/vectors.json` to within 0.05 years:
```json
[{"name":"ref_34M","age":34,"sex":"M",
  "values":{"albumin":44,"creatinine":80,"glucose":5.4,"crp":0.08,"lymph_pct":30,"mcv":90,"rdw":13.1,"alp":70,"wbc":6.2},
  "phenoage":41.3,"band":2.4,
  "waterfall":{"cohort_offset":-0.9,"albumin":0.2,"creatinine":-0.1,"glucose":1.1,"crp":-0.4,"lymph_pct":0.0,"mcv":0.3,"rdw":5.6,"alp":0.1,"wbc":0.4}}]
```
Waterfall rule: `age + cohort_offset + sum(analyte years) == phenoage` exactly (affine identity). Imputed analytes carry `"imputed": true` and widen `band`.

v8 clarifications (A): PhenoAge is affine in the linear predictor, `phenoage = affine.A + xb / k`, so `cohort_offset = phenoage(reference_by_age_sex[sex][band], age, sex) - age` evaluated at the user's exact age (the `cohort_offset_by_age_sex` table is the band-midpoint value, for display only), and each analyte's years are `coef * (term(x) - term(reference)) / k` with `term_crp = ln(max(crp, crp_floor_mgdL))`. `band` is 1 SD: `sqrt(sum((coef/k * sd)^2))` with `sd = x * sqrt(cv_within^2 + cv_analytical^2)` for measured analytes (for CRP the CV itself, on the log term) and `sd = imputation_sd_by_age_sex[sex][band][analyte]` for imputed ones. `vectors.json` entries carry `fasting`, `imputed`, `markers_used`, `xb`, `mortality_10y` for finer checks.

### `nhanes_percentiles.json`
`{"phenoage_accel": {"M": {"30-39": {"p5":-8.1,"p25":-3.2,"p50":-0.4,"p75":2.9,"p95":8.0}}}, "analytes": {"rdw": {"M": {"30-39": {"p5":11.9,"p50":13.0,"p95":15.1}}}}}`

### `hunt.json`
`{"vo2max": {"M": {"intercept":100.27,"age":-0.296,"waist":-0.369,"rhr":-0.155,"pai":0.226}, "F": {}}, "fitness_age_lookup": {"M": [[20,45.0],[25,43.1]], "F": []}}`
(VO2max by age at the population median; fitness age = the age whose median VO2max equals the user's.)

### `risk_years.json`
`[{"layer":"social","exposure":"social_isolation","hr":1.29,"years":2.9,"source":"Holt-Lunstad 2015","condition":"lsns_proxy < 12"}, {"layer":"lifestyle","exposure":"short_sleep","hr":1.12,"years":1.3,"source":"Cappuccio 2010","condition":"sleep_h < 6"}, {"layer":"lifestyle","exposure":"smoking","hr":2.0,"years":8.0,"source":"Jha 2013","condition":"smoker"}]`

### `meal_grid.json`
```json
{"axes":{"carbs_g":[20,40,60,80,100,120],"variant":["normal","low_si","t2d"],"weight_kg":[50,70,90,110],"walk":[0,1]},
 "t_min":[0,5,10,240],
 "curves":{"60|normal|70|0":{"p10":[90],"p50":[90],"p90":[90]}},
 "summary":{"60|normal|70|0":{"peak_mgdL":142,"t_peak_min":55,"auc_mgdL_min":6100,"t_baseline_min":170}},
 "variant_rule":{"normal":"fasting < 100 mg/dL","low_si":"100-125","t2d":">= 126 or diagnosed"},
 "walk_calibration":{"peak_reduction_target":[0.10,0.20],"source":"Buffey 2022"}}
```
Key format `carbs|variant|weight|walk`. C interpolates linearly on carbs and weight, nearest on variant.

### `caffeine.json`
`{"half_life_h":5.0,"modifiers":{"smoker":0.5,"oral_contraceptive":2.0},"bedtime_threshold_mg":50,"curve":{"t_h":[0,0.5,16],"fraction":[1.0,0.93,0.11]}}`

## 2. Social package (B produces, C and D consume): `social/`

```ts
export type App = 'gmail'|'whatsapp'|'sms'|'imessage'|'notif';
export interface Event { contact: string /* sha256(normalized handle + user salt) */; ts: string /* ISO */; app: App; dir: 'in'|'out'; len: 0|1|2|3 /* <20, <100, <500, more chars */ }
export function parseWhatsApp(text: string, selfName: string, salt: string): Event[];
export function parseGmailHeaders(msgs: GmailMetadataMessage[], selfEmail: string, salt: string): Event[];
export function parseSmsBackupXml(xml: string, salt: string): Event[];
export function parseImessageRows(rows: ChatDbRow[], salt: string): Event[];
export interface Metrics { activeTies: number; closeTies: number; initiationShare: number; replyLatencyH: {mine: number; theirs: number}; churn: number; silenceDays: number; window: [string,string] }
export function computeMetrics(events: Event[], windowEnd: Date, windowDays?: number /* 30 */): Metrics;
export function lsnsProxy(m: Metrics, asked: {help_family: 0|1|2|3|4|5; help_friends: 0|1|2|3|4|5}): { score: number; atRisk: boolean; items: number[]; fromMessaging: 4; fromUser: 2 };
export interface Nudge { contact: string; kind: 'overdue'; medianGapDays: number; daysSince: number; score: number; text: string }
export function recurrence(events: Event[], now: Date): Nudge[];   // contacts stream; a second stream can plug into the same interface later
export interface Day { date: string; people: number; level: 0|1|2|3 /* 0 = red */ }
export function heatmap(events: Event[], weeks?: number /* 52 */): Day[];
export function alerts(prev: Metrics, curr: Metrics, lsns: {atRisk: boolean}): ('distancing'|'active')[];
```
Thresholds: two-way exchange = both directions within 7 days; close tie = 4+ exchange days in 30; thread gap = 6 h; overdue = `daysSince > max(7, median + 2*MAD)`; distancing = activeTies down 30%+ or `lsns.atRisk`.

Tiger Data table (D creates; B's `/events` payload matches):
```sql
create table contact_events (user_id uuid, ts timestamptz not null, contact_hash text, app text, dir text, len_bucket smallint);
select create_hypertable('contact_events','ts');
create materialized view daily_connection with (timescaledb.continuous) as
  select user_id, time_bucket('1 day', ts) as d, count(distinct contact_hash) as people
  from contact_events group by 1, 2;
```

## 3. API (D produces; C and B consume): base `https://api.<domain>`, JWT in `Authorization: Bearer`

| Route | Body -> Response |
|---|---|
| `POST /extract` | multipart `file` (redacted PDF or image, 15 MB max) -> `{"analytes":[{"name":"rdw","value":13.1,"unit":"%","ref_low":11.5,"ref_high":14.5,"source_span":[120,128],"source_text":"RDW 13.1 % 11.5-14.5","raw_name":"RDW"}],"fasting":null,"lang":"en","text":"<text layer>","missing":["crp"]}`. Names are the canonical keys from `phenoage.json`; unknown analytes come back as `"name":"other:<raw>"`. `text` is the server-side text layer of the upload (pypdf, pages joined by `\n\f`; empty for images); `source_span` is `[start, end)` into `text` or `null`; `source_text` is the printed line verbatim, so C can highlight by quote when its pdf.js text layer differs. `missing` lists canonical keys not found. `value`/`unit` are as printed; `si_value`/`si_unit` are the same result in `phenoage.json` units (albumin g/L, creatinine umol/L, glucose mmol/L, CRP mg/dL with hs-CRP mg/L converted, ALP U/L, WBC 10^9/L), or null with `note: "unknown_unit:<printed>"` when the printed unit is not recognised. When no lymphocyte % is printed but an absolute count and WBC are, a `lymph_pct` row is added with `derived: "lymph_pct_from_absolute"` and `raw_name` `"<abs row> / <wbc row>"` (C labels it "1 of 9 derived"). Spanish analyte names map to the same canonical keys. C computes the clock from `si_value` only. `complete` = `{"missing", "derived", "order": [{"panel", "name", "covers", "dtc_usd": [lo, hi], "fasting"}], "where", "collected_date", "retest_date" (collected + 90 days, an assumption), "retest_rule", "fasting_action", "fasting_hours", "label": "reference prices, not engine output"}` for the review screen's 'complete your clock' card. The upload is never stored. |
| `POST /events` | `{"events": Event[]}` (max 50k, `contact` must be 64 hex chars) -> `{"inserted": n, "received": m, "duplicates": m-n}`. Idempotent: a re-sent batch inserts 0 (unique on user, contact, ts, app, dir). |
| `DELETE /events` | -> `{"deleted": n}` (one-tap delete-all) |
| `DELETE /events/{contact}` | -> `{"deleted": n}` (per-contact forget) |
| `GET /circle/summary?window_days=30` | -> `{"available": true, "metrics": Metrics, "previous": Metrics, "lsns": {"score", "atRisk", "items", "fromMessaging": 4, "fromUser": 2, "asked", "label"}, "nudges": Nudge[], "heatmap": Day[] (364 days), "alerts": [...], "risk": risk_years social_isolation row|null, "events": n, "source"}` or `{"available": false, "events": 0}`. Until B's `social/` lands the API computes this from `contact_events` with the section 2 thresholds (`api/app/circle/metrics.py`, TODO(B)); `lsns.items[4:6]` come from `/me/answers` help_family/help_friends. |
| `POST /vitals` | `{"source":"presage","pulse_bpm":62,"breathing_bpm":14,"stress_index":98,"captured_at":"..."}` (from the worker) -> `{"ok":true}` |
| `GET /vitals/latest` | -> latest row |
| `POST /clock` | `{"clock": "phenoage"|"fitness"|"social_risk", "years": 41.3, "chronological_age": 34, "band": 2.4, "inputs": {"albumin": 44, ..., "imputed": ["crp"]}, "engine_version": "1"}` -> the row with `computed_at`. C posts what it computed from A's export (si values by canonical key in `inputs`); the API stores, never computes. `GET /clock/latest` -> `{"phenoage": row, "fitness": row}`. |
| `PUT /me/answers` | any subset of `{"on_glucose_meds": bool, "sleep_h": 0-24, "smoker": bool, "lonely": bool, "lives_alone": bool, "oral_contraceptive": bool, "help_family": 0-5, "help_friends": 0-5, "bedtime": "HH:MM", "coffee_mg_per_cup": mg}` (merge) -> the `/me` body, which now carries `answers`. |
| `GET /coach/context` | -> `{"clock": {"phenoage": {...row, "delta_years": 7.3, "show": true}, "labels": phenoage.json labels}, "circle": {"available": false, ...} (TODO(B)), "today": {"vitals": latest|null, "caffeine": {"hours_before_bed", "last_coffee_by": "18:24"|null, "dose_mg", "dose_assumption", "source", "rule"}, "nudge": null, "meal": {"carbs_g", "ts", "note"}|null}, "levers": [risk_years rows whose condition holds for this user], "levers_unknown": [{"exposure", "needs"}], "history": [last 8 check-in rows, newest first], "last_plan": row|null, "flags": {"on_glucose_meds", "critical", "critical_reasons": ["glucose"], "verified", "over_65", "exercise_timing_allowed", "show_age", "lang"}}`. `critical` uses phenoage.json `critical_ranges` on the latest posted `inputs`; when true the age is hidden (`show: false`). |
| `POST /coach/checkin` | `{"kind": "checkin"|"nudge"|"reply"|"meal"|"share"|"plan", "text"?: str, "data"?: {}}` -> the row with `id`, `ts`. The coach's memory (Backboard fallback table). `GET /coach/checkins?limit=10&kind=` -> newest first. |
| `POST /coach/meal` | `{"carbs_g": 0-300, "note"?: str}` -> `{"ok": true, "carbs_g", "ts"}` (log_meal tool; C recomputes the plate from meal_grid.json). |
| `POST /coach/share` | `{"target_contact": <64 hex>, "text"?: str}` -> `{"ok": true, ...}`; **403** unless Persona verified (share_with_circle tool). |
| `GET /coach/session` | -> `{"agent_id", "signed_url"|null, "issued_at"}`. C starts the ElevenLabs Conversation with `signed_url` (the API key stays server-side); 503 when no agent is configured. |
| `GET /coach/explain/{name}?lang=en|es` | -> `{"name", "text", "source", "value", "unit", "imputed", "disclaimer"}` (explain_analyte tool; curated text has no digits). |
| `POST /coach/validate` | `{"text": "..."}` -> `{"ok": bool, "unknown_numbers": ["12"]}`: numbers not present in this user's context (timestamps, citations and condition strings excluded; 0/1/2-decimal roundings allowed). C drops any coach reply with `ok: false`. |
| `POST /persona/webhook` | Persona inquiry events -> sets `verified`, `birthdate` |
| `GET /me` | -> `{"verified": bool, "over_65": bool, "lang": "en"|"es", "age": int|null, "verify_url": str|null}`. `age` only after Persona verified a government ID (selfie-only gives `verified` without `age`); `verify_url` is the hosted Persona link with `reference-id=<user id>`, null once verified. |
| `PUT /me/lang` | `{"lang": "en"|"es"}` -> the `/me` body |
| `GET /tts?text=<=300 chars&lang=en|es` | -> `audio/mpeg` (one sentence; 503 when no ElevenLabs key and no fake) |

## 4. Coach tools (D implements as ElevenLabs Agents client tools)

`get_clock()`, `get_circle()`, `explain_analyte(name)`, `get_today_plan()`, `log_meal(carbs_g)`, `share_with_circle(target_contact)` (refuses unless `verified`). Each returns JSON from `/coach/context`; the agent's system prompt forbids numbers not present in that JSON. Push-to-talk, captions on, text fallback.

## 5. Screens (C) and routes

`/start` (QR landing: fitness age in ten seconds), `/` Home (clock + levers ledger + today's nudge), `/circle`, `/labs` (upload -> review -> waterfall), `/camera`, `/scan` (was `/tonight`: photo or typed meal -> carbs -> `/scan-results`), `/scan-results`, `/coach`, `/onboarding` (what leaves your phone; medication question; the two LSNS questions; Persona verification). Large-type mode toggled by `over_65` or by hand; Spanish by device locale.

## 6. Fixtures (`fixtures/`)

`lab_report_redacted.pdf` (one real, consented, redacted), `lab_report_es.pdf` (Spanish-format sample), `whatsapp_sample.txt` (synthetic, 90 days, 12 contacts), `gmail_metadata_sample.json` (synthetic), `nhanes_2017_2020_labs.parquet` (A builds Friday). Never commit unredacted files.

## 7. Redaction rules (D produces, C applies in the browser): `api/redaction_rules.json`

C imports this file (copy or fetch at build time; it is versioned) and applies it to the pdf.js text layer before anything leaves the phone. D tests it here (`api/tests/test_redaction.py`) and keeps a Python reference applier in `api/app/redaction.py`.

```json
{"version": 1,
 "regex_dialect": "ECMAScript, case-insensitive; no inline flags, no lookbehind, no named groups",
 "mask_token": "[REDACTED]",
 "keep_if": {"pattern": "<a result row: name, number, unit>"},
 "rules": [
   {"id": "patient_name_label", "category": "name", "action": "drop_line", "pattern": "^\s*(patient|name|nombre|paciente)...[:#]", "note": "..."},
   {"id": "email", "category": "contact", "action": "mask", "pattern": "[A-Za-z0-9._%+-]+@...", "note": "..."}
 ]}
```

- `category` is one of `name | dob | mrn | address | physician | contact`. Every rule has a unique `id`.
- Apply per line (pdf.js items grouped by y, joined with a space). Rules run in order; the first `drop_line` match removes the whole line (black out every item's box); `mask` rules replace only the matched substring (same regex, global flag) with `mask_token`.
- A line matching `keep_if` (an analyte result row) is never dropped, only masked.
- Kept on purpose: Sex, Age, Collected/Reported dates, section titles. Upload only the redacted document, never the original.

## 8. Web client (D provides, C consumes): `web/src/lib/api.ts`

One typed function per route above (`api.extract`, `api.postClock`, `api.me`, `api.coachContext`, `api.session`, `api.circle`, `api.tts`, ...). Base URL `EXPO_PUBLIC_API_URL` (default `https://api.scallion.us`); `setToken(jwt)` after login or `EXPO_PUBLIC_DEMO_TOKEN` for the judged account; `api.extract(file, {preferCache: true})` sends `X-Scallion-Cache: prefer`. Errors throw `ApiError(status, detail)`.
