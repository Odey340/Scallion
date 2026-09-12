# Devpost draft (Lane D owns; everyone edits before 8:30 am Sunday)

**Title:** Scallion
**Tagline:** Know your biological age. Know your circle. Then move both.
**Track:** Healthcare
**Challenges (tick every one):** Healthcare track · MathWorks · Persona · ElevenLabs (sponsor) · MLH Best Use of ElevenLabs · MLH Best Use of Gemini · Presage · Tiger Data · Backboard · Vultr · GoDaddy Registry · Lilie Lab · Notability

## Inspiration

Two numbers decide how the next decades go, and almost nobody sees either one. The first is in a blood panel most adults already have on a patient portal: nine ordinary analytes that, combined with a published clock, say whether your body is running older or younger than your birthday. The second is invisible: how many real people you actually exchange messages with, and whether that circle is shrinking. Sustained isolation carries a mortality hazard on the same scale as the lab markers. We wanted one screen that shows both, on the same clock, and then does one concrete thing about it today.

## What it does

- **Upload the labs you already have.** A PDF from any portal is redacted in the browser (name, date of birth, record number, address, physician), sent as text only, and Gemini extracts the printed rows into a strict schema. A unit normalizer converts to the paper's units, flags anything it cannot read, and derives lymphocyte percentage from an absolute count when a lab omits it. The PhenoAge clock (Levine 2018) runs from MATLAB-exported coefficients, and a waterfall shows which analyte costs you the most years, with NHANES percentiles for context. A critical-range value hides the age and says "see a clinician first".
- **Thirty seconds at the camera.** The Presage SmartSpectra SDK reads pulse and breathing from the webcam; a fitness age comes from the HUNT VO2max equation. Nothing but the numbers leaves the laptop.
- **Your circle from metadata only.** Message content is parsed on the device and discarded; only hashed contact ids, timestamps, direction and a length bucket are stored in Tiger Data. Seven metrics, an LSNS-6 proxy, who is drifting, and the risk-equivalent years of sustained isolation from published hazard ratios via the Gompertz doubling time (years = 8 × log2 HR). Labelled honestly: population estimate, if sustained, never "life lost".
- **One thing today.** A nudge before a tie goes cold, a plate decision from a SimBiology glucose-insulin sweep, a last-coffee time from the caffeine half-life rule, and an ElevenLabs voice coach in English or Spanish whose every number is checked against the engine before it is spoken.
- **Trust.** Persona verifies the ID once; the over-65 large-type mode switches on from the verified birthdate, never from a typed age.

## How we built it

Four lanes against one contract file. **MATLAB** (Lane A): PhenoAge, NHANES norms, HUNT, the risk-years table, a SimBiology meal model with a 144-cell sweep and a surrogate, caffeine PK, an App Designer console; every number is exported as JSON at build time and the app never re-derives a coefficient. **Social engine** (Lane B): a dependency-free TypeScript package with Gmail metadata OAuth, WhatsApp/SMS/iMessage parsers, recurrence, heatmap, alerts. **Product** (Lane C): Expo with a web export on Vercel at scallion.us, six screens, onboarding, a QR fitness-age landing, Spanish and large type. **Platform** (Lane D): FastAPI on Vultr behind Caddy at api.scallion.us, Tiger Data hypertables and a continuous aggregate for daily connection, Gemini extraction with a fake for offline demos, the client-side redaction rules, the Presage worker, Persona webhook, ElevenLabs sentence endpoint and coach tools, and a narration validator that rejects any number not present in the engine JSON.

## Challenges

Keeping every displayed number traceable to a published model when two language models sit in the pipeline; we solved it structurally (Gemini extracts, MATLAB computes, a validator gates the coach). Reading a pulse headlessly from a webcam SDK that streams continuously and waits for a face. Continuous aggregates that default to materialized-only on Tiger Cloud. Retired Gemini model ids. A deploy key that would not survive a web console.

## Accomplishments

Nine analytes with spans from a real lab report in about thirty seconds. A pulse from the demo laptop stored in Tiger Data. A biological-age waterfall that closes exactly (age + cohort offset + analyte years = PhenoAge). A privacy story we can defend line by line.

## What we learned

Hazard ratios become years people understand with one line of arithmetic, but only if you label them honestly. Metadata is enough to see a circle. Contracts between lanes beat meetings.

## What's next

Apple Health and Fitbit as fitness inputs, a second inbox, family tagging, longitudinal clocks with re-test reminders, and a Spanish voice.

## Built with

MATLAB R2026a (SimBiology, Statistics and Machine Learning Toolbox, Simulink, App Designer), Expo / React Native, TypeScript, FastAPI, Python 3.12, Docker, Caddy, Vultr, Tiger Data (TimescaleDB), Gemini 3.6 Flash, Presage SmartSpectra Node SDK, ElevenLabs Agents, Persona, Backboard, Vercel, GoDaddy.

## Links to fill in Sunday

- Live app: https://scallion.us · API: https://api.scallion.us/health · Repo: https://github.com/Odey340/Scallion
- Video (3-4 min): media/
- MATLAB: `matlab/Scallion.prj`, `matlab/main_live_script.m`
