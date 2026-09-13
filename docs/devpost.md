# Devpost draft (Lane D owns; everyone edits before 8:30 am Sunday)

**Title:** Scallion
**Tagline:** Know your biological age. Know your circle. Then move both.
**Track (pick exactly one):** Healthcare
**Challenges (tick each one we can evidence, see the list at the end):** MathWorks · Persona · ElevenLabs (sponsor) · MLH Best Use of ElevenLabs · MLH Best Use of Gemini · MLH Presage · MLH Tiger Data · MLH Backboard · MLH Vultr · MLH GoDaddy Registry · Lilie Lab (Rice only) · Notability (only with evidence)

## Inspiration

The Healthcare track describes longevity as a stack: cellular aging and inflammation at the base, biomarkers and biological age above that, then sleep, nutrition, exercise and stress, and at the outer edge, environment and social connection. What struck us is that almost nobody can see their own stack. Three of its numbers are already within reach and nobody shows them.

The first sits in a blood panel on a patient portal. Nine ordinary analytes, including CRP for inflammation, feed a published clock, PhenoAge (Levine 2018), that says whether your body is running older or younger than your birthday. Nobody hands you that number, and nobody tells you which marker is costing you the years.

The second needs no lab at all. Thirty seconds of a face in front of a camera is enough to read pulse and breathing, and a resting pulse plus a waist measurement and one activity question gives a fitness age from the HUNT study's VO2max equation. Most people have never had their cardiorespiratory fitness estimated, even though low fitness carries one of the largest hazard ratios in the whole stack.

The third is the outermost layer, and it is invisible. How many real people do you actually exchange messages with, and is that circle quietly shrinking? Holt-Lunstad's meta-analyses put sustained isolation on the same mortality scale as the lab markers, yet no app measures it, partly because doing so honestly means never reading a message.

Scallion puts every layer on one clock, in years, labelled honestly, and then does one concrete thing about it before dinner tonight. That is what we understood "clear, actionable guidance" to mean: not a dashboard, but a number you can explain and a step you can take today.

## What it does

**Cells and biomarkers: the labs you already have.** Pick the PDF from any portal. The browser renders it with pdf.js, runs 17 redaction rules over the text layer (name, date of birth, record number, address, physician, contact details), and only the redacted text leaves the device. Gemini extracts the printed rows into a strict schema with the exact source line for each value. A unit normalizer converts to the paper's units, flags anything it cannot read instead of guessing, and derives lymphocyte percentage from an absolute count when a lab omits it. The PhenoAge clock runs in the browser from MATLAB-exported coefficients. A waterfall shows the cohort offset and each analyte's cost in years, so a raised CRP or RDW is a bar you can point at, with NHANES percentiles for context. An imputed analyte is labelled "8 of 9 markers" and widens the uncertainty band. Any critical-range value hides the age and says "see a clinician first". A "complete your clock" card lists what to order for missing markers and when to re-test.

**Diagnostics without a lab: thirty seconds at a camera.** Press Start on the phone; the demo laptop's webcam, driven by the Presage SmartSpectra SDK, reads pulse and breathing with no wearable. A fitness age comes from the HUNT VO2max equation, and the QR landing page gives that same fitness age from four questions in ten seconds. If a capture fails, the laptop tells the phone why (webcam in use, no face found) instead of a generic timeout.

**Lifestyle: one decision today.** Nutrition: photograph or type a meal, and a SimBiology glucose-insulin sweep shows the curve for someone with your fasting glucose and weight, with and without a 30-minute walk. Exercise: the walk comparison and the fitness age, with exercise-timing advice switched off for anyone on blood-sugar medication. Sleep: a last-coffee time from caffeine half-life, adjusted for smoking and oral contraceptives, and short or long sleep as a lever on the same clock. Stress: a stress index from the camera capture, labelled exploratory.

**Environment and social connection: your circle, from metadata only.** Upload a WhatsApp export, run the iMessage exporter on a Mac, or connect an inbox through the Gmail metadata-only scope. Content is parsed on the device and discarded; what leaves is a hashed contact id, a timestamp, the app, the direction, and a length bucket. From that: active and close ties, initiation share, reply latency, churn, days of silence, a 52-week heatmap, an LSNS-6 proxy (four items from messaging, two you answer), and which specific ties are drifting past their own usual gap. A nudge lands before a tie goes cold. One tap forgets a contact; one tap deletes everything.

**One clock across the layers.** Isolation, loneliness, living alone, short sleep, smoking and low fitness are each converted to risk-equivalent years from published hazard ratios via the Gompertz mortality doubling time (years = 8 × log2 HR), labelled "if sustained, population estimate", never "life lost". Home shows one result, what is driving it, and one action. Every lever names its source paper.

**Understanding and coaching.** Tap any analyte for a plain-language explanation with one citation and no digits it did not get from the engine. Every result has a "How this is calculated" disclosure. A voice coach (ElevenLabs Agents) answers questions with six tools that read your data, logs meals and check-ins, and remembers across days through Backboard, so "did I walk after dinner yesterday" gets a real answer.

**Every number is checked.** The coach may only say numbers that exist in the engine's output. A validator rejects any sentence containing a number not present in the user's context, and the app drops it before it is spoken.

**Trust and safety.** Persona verifies a government ID once; the over-65 large-type mode switches on from the verified birthdate, never from a typed age, and the coach's share-with-circle action refuses until the person is verified. Every estimate says "estimate, not diagnosis".

## How we built it

Four lanes, one contract file. Each teammate owned a directory and a Claude Code agent paired with them; every interface between lanes lived in `docs/contracts.md`, changed only by a `[contract]` commit, and grew only additively. Twelve contract versions and more than a hundred small commits straight to main, no force pushes.

**MATLAB engine.** PhenoAge with the exact affine waterfall, NHANES 2017-2020 weighted norms from 8,521 adults, the HUNT fitness-age lookup, a sourced risk-years table, caffeine PK, and a SimBiology meal model (the Cobelli/Dalla Man `insulindemo`) configured with body weight, three insulin-sensitivity variants from ADA fasting cut points, and a walk calibrated to Buffey 2022. A 144-cell sweep (432 simulations in 24 seconds), a Gaussian-process surrogate, an engineer's console with a Validation tab that reruns the full model against the interpolated grid, a MATLAB project, and a live script that runs the whole pipeline and writes six JSON files. The app reads those files; nothing re-derives a coefficient, and the API never calls MATLAB.

**Social engine.** A dependency-free TypeScript package: WhatsApp parsers for iOS and Android export formats, Gmail metadata-scope mapping with outgoing fan-out per recipient, contact hashing with a per-user salt, length buckets, per-contact strength tiers, and an iMessage exporter that turns a Mac's chat.db into the same hashed events.

**Product.** Expo with expo-router, TypeScript strict, web export on Vercel at scallion.us. A TypeScript port of the PhenoAge clock that reproduces the MATLAB reference vectors, in-browser redaction ported from the API's rules, the review screen with source-line highlights, the waterfall, the circle map, the 30-second capture flow, meal curves interpolated from the sweep, the ElevenLabs session with client tools, and Supabase email sign-in.

**Platform.** FastAPI on a Vultr box behind Caddy at api.scallion.us. Tiger Data hypertables for contact events, vitals, and clock history, with a continuous aggregate for daily connection. Gemini 3.6 Flash extraction with a strict response schema and a cache fallback keyed by upload hash. Persona hosted verification with server-minted one-time links and a signed webhook. An ElevenLabs agent created from code with six client tools. Backboard as coach memory with one assistant per user. A Node worker for the Presage SDK that polls an arm endpoint so pressing Start on the phone triggers a capture on the laptop.

## Challenges we ran into

**Two language models in the pipeline, zero invented numbers.** Gemini extracts, MATLAB computes, and a validator gates the coach. When the coach felt "dumb and repetitive", the fix was not a bigger model; its system prompt was 767 characters of prohibitions and nothing about what it could do.

**MATLAB was not installed at hour zero.** We wrote a line-for-line Python mirror to produce provisional exports, installed MATLAB with `mpm`, and then turned the mirror into a crosscheck. It caught a real bug: MATLAB's `max` silently turned missing CRP into the 0.1 floor. The crosscheck now agrees on 970 norm numbers to 1e-13.

**The waterfall had to close exactly.** PhenoAge is affine in its linear predictor, so the cohort offset must be evaluated at the user's exact age, not a band midpoint. A one-character typo in the published constant (0.09165 versus 0.090165) would have put the TypeScript port off by up to a year; the reference vectors caught it.

**A walk that looked like physiology.** The first walk calibration reset glucose uptake instantly and produced a dip-and-rebound curve. A multiplier on insulin-independent uptake with a 60-minute decay, bisected to a 15% peak drop, landed inside Buffey 2022's 10-20% window.

**Reading a pulse headlessly on Windows.** The SDK waits for a face, streams continuously, ignores its duration cap, and its blocking stop call hung after live captures. Then captures failed with a Media Foundation error because the phone screen's own camera preview, open in the laptop browser, was holding the webcam. The fix was a protocol: the phone arms, the laptop watches, and the laptop reports the reason for any failure back to the phone.

**Auth in the wild.** The Supabase project signed tokens with ES256 while the API verified HS256. Sign-in codes "expired" because Microsoft 365 link detonation opened every emailed link and consumed the shared token. The default sender allowed two emails an hour. Each was diagnosed from logs, not guessed.

**Vendor drift within months.** Gemini 2.5 Flash returned 404 for new keys. The ElevenLabs premade voice we planned on no longer existed. Persona's sandbox template link was misconfigured for hosted flows, so we mint one-time links server-side; sandbox inquiries end "completed", not "approved". Tiger Cloud defaults continuous aggregates to materialized-only. Backboard rejects memory metadata. Metro could not resolve a symlinked sibling package. Every one has a fallback in the demo runbook.

## Accomplishments that we're proud of

- **The math reconciles.** Age plus cohort offset plus analyte years equals PhenoAge, exactly, on every screen. The TypeScript port reproduces the MATLAB vectors, and Home refuses to show drivers that do not add up.
- **A validated in-silico model, not a picture of one.** 432 SimBiology simulations, a surrogate with peak RMSE of 1.2 mg/dL (R² 0.9997) under 5-fold cross-validation, and a console that overlays the full model on the grid within about 1 mg/dL.
- **A real pulse with no wearable.** Captures of 68.5, 72.6, and 74 bpm from the demo laptop's webcam, stored in Tiger Data, retrievable by the phone.
- **A lab PDF to nine analytes in about 35 seconds,** each with its source line, its SI value, and a derived lymphocyte percentage when needed, redacted before it left the browser and never stored.
- **A coach that cannot make up a number.** Ask it anything; every reply passes through the validator first.
- **Privacy we can defend line by line.** Five fields per event, 17 redaction rules, per-contact forget, delete-all, uploads held in memory only.
- **Tested and deployed.** 233 API tests, 77 web tests, 42 social tests, 15 worker tests, 11 MATLAB tests, a TLS API and a web app on a real domain, and a fallback for every live step that produces the same numbers.

## What we learned

- A hazard ratio becomes years people understand with one line of arithmetic, but only if the label says "if sustained, population estimate". Honest labels are a feature.
- Metadata is enough to see a circle. Content adds nothing to the metrics and everything to the risk.
- An exact identity is what makes an explanation trustworthy. If the bars do not add up to the total, do not show the bars.
- Additive-only contracts let four people and four agents ship in parallel with almost no merge conflicts. The contract file did more than any meeting.
- Hardware demos fail on boring things, like which process holds the webcam. The system should say why, in words, on the screen the presenter is looking at.
- Model ids, voice ids, and template links rot within months. Pin them, health-check them, and keep a cached fallback.
- Every live demo step needs a fallback that produces the same numbers, so switching never means apologizing.

## What's next for Scallion

- **Longitudinal clocks.** The review screen already computes a re-test date and what to order to complete the nine markers; the next step is tracking PhenoAge across draws and showing the trend, so healthspan becomes a line rather than a number.
- **More fitness inputs.** Apple Health, Fitbit, and Garmin resting heart rate and VO2max alongside the camera reading.
- **Live inbox connect.** The Gmail metadata-scope flow is built and tested against fixtures; it needs a verified Google OAuth client. Then SMS backups and iMessage inside the app, and a second inbox.
- **Family and friend tagging** to complete the LSNS-6 rather than proxying it.
- **Clinician handoff.** A one-page export a patient can bring to an appointment, and more languages once the coach's validator covers them.
- **Native builds** with on-device redaction on Android and iOS, beyond the web export.

## Built with

MATLAB R2026a (SimBiology, Statistics and Machine Learning Toolbox, Simulink), Expo / React Native, TypeScript, pdf.js, FastAPI, Python 3.12, Docker, Caddy, Vultr, Tiger Data (TimescaleDB), Supabase Auth, Gemini 3.6 Flash, Presage SmartSpectra Node SDK, ElevenLabs Agents, Persona, Backboard, Vercel, a .us domain (GoDaddy Registry).

## Challenges pursued: technology and how we used it

Choose one track (Healthcare) and tick every challenge below that we can show a judge.

- **Healthcare track.** All of the above. The four layers the track names map to four screens: Labs (cells and biomarkers), Camera (diagnostics), Scan and Home levers (lifestyle), Circle (social connection), with the coach as the "goal-setting and coaching" and "educational insights" directions.
- **MathWorks: Best Use of MathWorks.** MATLAB R2026a, SimBiology, Statistics and Machine Learning Toolbox, Simulink. The in-silico model is SimBiology's `insulindemo` (Cobelli/Dalla Man glucose-insulin meal model) configured for body weight, three insulin-sensitivity variants and a calibrated walk; a 144-cell sweep, a Gaussian-process surrogate with 5-fold cross-validation, a coded uifigure console with a Validation tab, a MATLAB project and a live script that runs tests and writes every number the app displays as JSON. PhenoAge, NHANES norms, HUNT fitness age, risk years and caffeine PK are all MATLAB. The coding agent drove MATLAB through batch runs.
- **Persona: Prove you're human.** Persona hosted flow, one-time inquiry links minted server-side, HMAC-signed webhook. Verification sets `verified` and a birthdate; the over-65 large-type mode adapts from the verified birthdate instead of demanding a typed age (the handbook's "age-aware" direction), and the coach's share-with-circle tool refuses to act until the person is verified (the "agent that can only act for you once you've proven you're you" direction). Sandbox, no real IDs.
- **ElevenLabs: Best Project Built with ElevenLabs (sponsor) and MLH Best Use of ElevenLabs.** ElevenLabs Agents plus the multilingual TTS API. A "Scallion coach" agent created from code with six client tools (get_clock, get_circle, explain_analyte, get_today_plan, log_meal, share_with_circle), started from a server-minted signed URL so the key never reaches the browser, hold-to-talk with captions. Every caption passes the number validator before it is shown. `GET /tts` reads one sentence aloud for the text fallback.
- **MLH: Best Use of Gemini.** Gemini 3.6 Flash via the Gemini API. Lab-report extraction with a strict response schema (printed value, unit, reference range, source line, fasting flag), and photo-to-carbs estimation on the Scan screen. Gemini extracts and narrates; it never produces a displayed number.
- **MLH: Best Use of Presage.** Presage SmartSpectra Node SDK. A headless worker on the demo laptop's webcam reads pulse, breathing and a Baevsky stress index over a 30-second capture, takes the confident median, and posts to the API; an arm/watch handshake lets a phone press Start and receive the reading or the reason it failed. Real captures of 68.5, 72.6 and 74 bpm.
- **MLH: Best Use of Tiger Data.** Tiger Cloud (TimescaleDB). Hypertables for `contact_events`, `vitals` and `clock_history`, a `daily_connection` continuous aggregate with real-time aggregation for the 52-week heatmap, a dedup index that makes event upload idempotent, plus `profiles` and `checkins` tables. Only metadata is stored, never message content.
- **MLH: Best Use of Backboard.** Backboard API. One assistant per user, created lazily; every check-in, meal and share is mirrored as a memory; `GET /coach/recall?q=` does semantic recall so the coach can answer "did I walk after dinner yesterday" across days.
- **MLH: Best Use of Vultr.** Vultr cloud compute (Dallas, Ubuntu 24.04). Provisioned through the Vultr API with cloud-init, Docker Compose running the FastAPI service behind Caddy with automatic TLS at api.scallion.us, one-command redeploy script.
- **MLH: Best Domain Name from GoDaddy Registry.** scallion.us. The web app is at scallion.us and the API at api.scallion.us; .us is operated by GoDaddy Registry. Confirm the registration path meets MLH's rule before ticking (DNS is currently hosted at Porkbun).
- **Lilie Lab AI Challenge (Rice students only).** Gemini extraction, the ElevenLabs agent and the Claude Code agent workflow, applied to a pressing problem: making biological age and social isolation legible and actionable. Tick only if a Rice student is on the team.
- **Notability: Trust the Process.** Tick only if the team has Notability notes or wireframes from the weekend to show; there is no evidence in the repo.

Skipped on purpose: Capital One Nessie, Solana, Lovable, Goldman Sachs (challenge details never published).

## Figures for the gallery (all rendered by MATLAB, in `media/`)

Upload in this order; the caption is the alt text.

1. `phenoage_waterfall.png`. PhenoAge waterfall for the reference vector: age, cohort offset and nine analyte bars add up exactly to the clock, with the one-SD band.
2. `insulindemo_78g_variants.png`. SimBiology `insulindemo` (Cobelli/Dalla Man) at a 78 g meal, base model against its five variants: the in-silico model the plate decision runs on.
3. `walk_calibration.png`. Walk calibration: a 30-minute walk starting 15 minutes after eating cuts the reference peak by 15 percent, inside Buffey 2022's 10-20 percent window.
4. `meal_sweep.png`. The 144-cell sweep at 70 kg: peak glucose against carbohydrate by insulin-sensitivity variant, with and without the walk.
5. `surrogate_validation.png`. Gaussian-process surrogate against the full simulation under 5-fold cross-validation: peak RMSE 1.2 mg/dL, R² 0.9997.
6. `app_console_tonight.png`. The MATLAB engineer's console, Tonight tab: the interpolated curve band, the walk, and the caffeine decay line.
7. `app_console_validation.png`. Console Validation tab: the grid curve the app uses overlaid on a full SimBiology run at the exact inputs, max error 1.0 mg/dL.
8. `app_console_clock.png`. Console Clock tab: the same waterfall the Labs screen shows, drawn by the MATLAB function that exported the coefficients.

## Links to fill in Sunday

- Live app: https://scallion.us · API: https://api.scallion.us/health · Repo: https://github.com/Odey340/Scallion
- Video (3-4 min, handbook outline: 30 s intro, 2 min demo, 30 s technical design, 30 s impact): media/
- MATLAB: `matlab/Scallion.prj`, `matlab/main_live_script.m`
