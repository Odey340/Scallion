# Lane C: Product

**Mission.** Everything the judge sees. An Expo app whose web export is the demo surface (QR on the judge's phone, laptop for the extraction beat): six screens plus onboarding and the ten-second fitness-age landing, a design system, the heatmap and the PhenoAge waterfall, the lab review screen with text-layer highlights, the large-type Spanish mode, and the 3-4 minute video. Every number you render comes from A's JSON exports or B's package; you never compute a health number yourself except by evaluating those.

**You produce:** `web/` (Expo + expo-router + NativeWind, TypeScript strict), deployed to Vercel at the GoDaddy domain; `web/src/engine/phenoage.ts` (a port that reads `phenoage.json` and matches A's vectors); components `Heatmap`, `Waterfall`, `CurveBand`, `ReviewTable`; the video.
**You consume:** `web/public/engine/*.json` (A), `social/` (B), the API and coach tools (D). Contract sections 1-5.

## Setup (H0-1)

- [ ] Expo scaffold, expo-router, NativeWind; web export builds; Vercel project; `EXPO_PUBLIC_API_URL`.
- [ ] Design tokens (one file): clinical off-white ground, near-black text, a single professional blue accent, green for connection days, red for silence, tabular numerals for every number. Type: one display face, one body face. No emoji as UI. (Pivoted from an earlier dark-gold spec to a light, formal healthcare look — human request, see `docs/log/C.md`.)
- [ ] Route skeleton from contract section 5 with placeholder screens so every teammate can deep-link today.
- [ ] Everyone: request the patient-portal lab PDF; C keeps two printed copies of the consented one for judging.

## Block 1 (H1-6): the front door. Gate H6 (yours is H10).

- [ ] `/start`: age, sex, waist, resting HR (typed), one activity question -> fitness age from `hunt.json` with a band. This is the QR landing every judge gets; it must work with no login.
- [ ] Camera capture UI (30 s, signal-quality bar) and PDF/image picker; these only need to open on web at this point.
- [ ] `web/src/engine/phenoage.ts` reading `phenoage.json`; a test that reproduces `matlab/tests/vectors.json` within 0.05 years and checks the waterfall sums exactly. Until A's files land, use the shapes in the contract with placeholder values and a `TODO(A)`.

## Block 2 (H6-12): Home, Circle, Labs review. Gate H10.

- [ ] Home: the clock (PhenoAge if labs, else fitness age) with its band; the levers ledger (chips from `risk_years.json`, each with source, band, "if sustained"); today's one nudge; the "distancing / active" state.
- [ ] Circle: the 52 x 7 heatmap from `heatmap()`, active and close ties, initiation share, reply latency, churn, the LSNS proxy with the label "4 of 6 items from your messaging, 2 from you", the drift list with the nudge and its share-sheet action.
- [ ] Labs review: render the PDF with pdf.js, highlight each extracted value's `source_span` in the text layer (no crops), fasting-status question, hs-CRP flag, "identifiers stripped" note; typed-entry fallback.
- **Gate H10:** the deployed web export on a real iPhone and a real Android opens the camera, picks a PDF, plays an ElevenLabs sentence (D's endpoint), completes Google OAuth (B's flow). Test on real devices at H6, not H10.
- [ ] Sleep shift 2-6 am.

## Block 3 (H12-19): the numbers screens. Gate H19.

- [ ] Labs result: the waterfall (chronological age -> cohort offset -> nine analyte bars -> PhenoAge) that reconciles on screen; tap an analyte for its NHANES distribution with the user's marker; "8 of 9 markers" and "complete your clock" states; what-if sliders driven by `phenoage.ts`.
- [ ] Camera screen: shows the Presage result from `/vitals/latest` (pulse, breathing; HRV labelled exploratory); perceived age via `@vladmandic/human` in the browser with the "research predictor, +/- 6" label; fitness age from resting HR.
- [ ] Tonight: photograph the plate -> carbs from D's Gemini call -> two `CurveBand`s from `meal_grid.json` (eat now vs plus a walk), the walk label with Buffey 2022; the caffeine last-coffee line from `caffeine.json`. Medication flag replaces the walk advice with "discuss timing with your clinician".
- [ ] Large-type mode (one number, one sentence, one button) and Spanish strings for every screen; locale switch by device, manual toggle in onboarding.
- **Gate H19:** one real lab report and one real inbox end to end on a phone.

## Block 4 (H19-27): Coach, onboarding, daily loop. Freeze H27.

- [ ] Coach screen: push-to-talk to D's ElevenLabs agent, captions, text fallback, read-aloud button on every card.
- [ ] Onboarding: "what leaves your phone" card, the medication question, the two LSNS questions, optional family tag on the top 20 contacts, Persona hosted link only on the sharing step.
- [ ] Daily 1 pm card (nudge, last coffee, tonight's plate prompt); nudge feedback buttons wired to B's `applyFeedback`.
- [ ] Screen-record every feature into `media/` as it lands (20 s each).

## Block 5 (H27-37): the video and the demo

- [ ] Video to the handbook outline: 0:30 intro (name, members, track and challenges, purpose, tech), 2:00 demo (the five beats in the plan), 0:30 technical design, 0:30 impact and future. Edit from `media/`; A supplies the MATLAB segment.
- [ ] Cached extraction and GIF fallback for every live beat; QR cards printed; rehearse the 2:00 core twice.

## Your cut order

Perceived age -> bedtime window UI (keep the last-coffee line) -> Spanish voice (keep Spanish text) -> what-if sliders -> family tag step.

## Kickoff prompt (paste into Claude Code in the repo root)

```
Read CLAUDE.md, docs/contracts.md, docs/lanes/C.md and docs/log/C.md. You are the Lane C agent (product). Restate in ten lines: what this lane produces, what it consumes, the Block 1 tasks in order, and what the H10 gate requires. Then plan Block 1 in plan mode: the Expo scaffold with the route skeleton from contract section 5, the design tokens, and the /start fitness-age landing reading hunt.json. Build against the JSON shapes in the contract with placeholder files and TODO(A) comments where A's exports have not landed. Ask me only the questions that change the design.
```

## Session-restart prompt

```
Read docs/log/C.md and docs/contracts.md. Continue Lane C from the "next" line of the last log entry. Restate the next gate and the next task in three lines, then proceed.
```
