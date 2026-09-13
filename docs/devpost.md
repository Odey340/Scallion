# Devpost draft (Lane D owns; everyone edits before 8:30 am Sunday)

**Title:** Scallion
**Tagline:** Know your biological age. Know your circle. Then move both.
**Track:** Healthcare
**Challenges (tick every one):** Healthcare track · MathWorks · Persona · ElevenLabs (sponsor) · MLH Best Use of ElevenLabs · MLH Best Use of Gemini · Presage · Tiger Data · Backboard · Vultr · GoDaddy Registry · Lilie Lab · Notability

## Inspiration

Two numbers decide a lot about how the next decades go, and almost nobody sees either one.

The first is already sitting in a blood panel on a patient portal. Nine ordinary analytes (albumin, creatinine, glucose, CRP, lymphocyte percentage, MCV, RDW, alkaline phosphatase, white cell count) feed a published clock, PhenoAge (Levine 2018), that says whether your body is running older or younger than your birthday. Nobody hands you that number, and nobody tells you which marker is costing you the years.

The second is invisible. How many real people do you actually exchange messages with, and is that circle quietly shrinking? Holt-Lunstad's meta-analyses put sustained isolation on the same mortality scale as the lab markers, yet no app measures it, partly because doing so honestly means never reading a message.

We wanted one screen that shows both on the same clock, labelled honestly, and then does one concrete thing about it before dinner tonight.

## What it does

**Upload the labs you already have.** Pick the PDF from any portal. The browser renders it with pdf.js, runs 17 redaction rules over the text layer (name, date of birth, record number, address, physician, contact details), and only the redacted text leaves the device. Gemini extracts the printed rows into a strict schema with the exact source line for each value. A unit normalizer converts to the paper's units, flags anything it cannot read instead of guessing, maps Spanish analyte names, and derives lymphocyte percentage from an absolute count when a lab omits it. The PhenoAge clock runs in the browser from MATLAB-exported coefficients. A waterfall shows the cohort offset and each analyte's cost in years, with NHANES percentiles for context. An imputed analyte is labelled "8 of 9 markers" and widens the uncertainty band. Any critical-range value hides the age and says "see a clinician first".

**Thirty seconds at a camera.** Press Start on the phone; the demo laptop's webcam, driven by the Presage SmartSpectra SDK, reads pulse and breathing with no wearable. A fitness age comes from the HUNT VO2max equation, and the QR landing page gives that same fitness age from four questions in ten seconds. If a capture fails, the laptop tells the phone why (webcam in use, no face found) instead of a generic timeout.

**Your circle, from metadata only.** Upload a WhatsApp export, run the iMessage exporter on a Mac, or connect an inbox through the Gmail metadata-only scope. Content is parsed on the device and discarded; what leaves is a hashed contact id, a timestamp, the app, the direction, and a length bucket. From that: active and close ties, initiation share, reply latency, churn, days of silence, a 52-week heatmap, an LSNS-6 proxy (four items from messaging, two you answer), and which specific ties are drifting past their own usual gap. Isolation is converted to risk-equivalent years from published hazard ratios via the Gompertz mortality doubling time (years = 8 × log2 HR), labelled "if sustained, population estimate", never "life lost". One tap forgets a contact; one tap deletes everything.

**One thing today.** A nudge before a tie goes cold. A plate decision: photograph or type a meal, and a SimBiology glucose-insulin sweep shows the curve for someone with your fasting glucose and weight, with and without a 30-minute walk. A last-coffee time from caffeine half-life. And a voice coach (ElevenLabs Agents) in English or Spanish with six tools that read your data, plus memory across days through Backboard.

**Every number is checked.** The coach may only say numbers that exist in the engine's output. A validator rejects any sentence containing a number not present in the user's context, and the app drops it before it is spoken.

**Trust and safety.** Persona verifies a government ID once; the over-65 large-type mode switches on from the verified birthdate, never from a typed age. The blood-sugar medication question turns off exercise-timing advice. Every estimate says "estimate, not diagnosis".

## How we built it

Four lanes, one contract file. Each teammate owned a directory and a Claude Code agent paired with them; every interface between lanes lived in `docs/contracts.md`, changed only by a `[contract]` commit, and grew only additively. Twelve contract versions and more than a hundred small commits straight to main, no force pushes.

**MATLAB engine.** PhenoAge with the exact affine waterfall, NHANES 2017-2020 weighted norms from 8,521 adults, the HUNT fitness-age lookup, a sourced risk-years table, caffeine PK, and a SimBiology meal model (the Cobelli/Dalla Man `insulindemo`) configured with body weight, three insulin-sensitivity variants from ADA fasting cut points, and a walk calibrated to Buffey 2022. A 144-cell sweep (432 simulations in 24 seconds), a Gaussian-process surrogate, an engineer's console with a Validation tab that reruns the full model against the interpolated grid, a MATLAB project, and a live script that runs the whole pipeline and writes six JSON files. The app reads those files; nothing re-derives a coefficient, and the API never calls MATLAB.

**Social engine.** A dependency-free TypeScript package: WhatsApp parsers for iOS and Android export formats, Gmail metadata-scope mapping with outgoing fan-out per recipient, contact hashing with a per-user salt, length buckets, per-contact strength tiers, and an iMessage exporter that turns a Mac's chat.db into the same hashed events.

**Product.** Expo with expo-router, TypeScript strict, web export on Vercel at scallion.us. A TypeScript port of the PhenoAge clock that reproduces the MATLAB reference vectors, in-browser redaction ported from the API's rules, the review screen with source-line highlights, the waterfall, the circle map, the 30-second capture flow, meal curves interpolated from the sweep, the ElevenLabs session with client tools, Supabase email sign-in, and Spanish text throughout.

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
- **A validated meal model, not a picture of one.** 432 SimBiology simulations, a surrogate with peak RMSE of 1.2 mg/dL (R² 0.9997) under 5-fold cross-validation, and a console that overlays the full model on the grid within about 1 mg/dL.
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

- **Longitudinal clocks.** The review screen already computes a re-test date and what to order to complete the nine markers; the next step is tracking PhenoAge across draws and showing the trend.
- **More fitness inputs.** Apple Health, Fitbit, and Garmin resting heart rate and VO2max alongside the camera reading.
- **Live inbox connect.** The Gmail metadata-scope flow is built and tested against fixtures; it needs a verified Google OAuth client. Then SMS backups and iMessage inside the app, and a second inbox.
- **Family and friend tagging** to complete the LSNS-6 rather than proxying it.
- **Spanish voice** to match the Spanish text, and a clinician handoff: a one-page export a patient can bring to an appointment.
- **Native builds** with on-device redaction on Android and iOS, beyond the web export.

## Built with

MATLAB R2026a (SimBiology, Statistics and Machine Learning Toolbox, Simulink), Expo / React Native, TypeScript, pdf.js, FastAPI, Python 3.12, Docker, Caddy, Vultr, Tiger Data (TimescaleDB), Supabase Auth, Gemini 3.6 Flash, Presage SmartSpectra Node SDK, ElevenLabs Agents, Persona, Backboard, Vercel, GoDaddy.

## Links to fill in Sunday

- Live app: https://scallion.us · API: https://api.scallion.us/health · Repo: https://github.com/Odey340/Scallion
- Video (3-4 min): media/
- MATLAB: `matlab/Scallion.prj`, `matlab/main_live_script.m`
