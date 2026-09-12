# Lane D: Platform, labs intake, sponsors

**Mission.** The glue and the keys. You stand up the API, the database, hosting and the domain; you own the labs intake pipeline (Gemini extraction with a strict schema, the unit normalizer with Spanish aliases, client-side redaction rules); you integrate Persona, the ElevenLabs coach with its tools and Backboard memory, and the Presage worker on the demo laptop; and you own the Devpost page. Nessie is not in your plan unless everything else is done (see the end).

**You produce:** `api/` (FastAPI on Vultr, Docker), the Tiger Data schema and continuous aggregates, `presage-worker/`, the ElevenLabs agent and its client tools, Persona template + webhook, the redaction rules C applies in the browser, the Devpost submission.
**You consume:** A's `phenoage.json` (canonical analyte names and critical ranges), B's `social/` (to serve `/circle/summary`), C's screens (to test the endpoints). Contract sections 2-4.

## Setup (H0-1)

- [ ] Keys: Google AI Studio on the paid tier with data use off; ElevenLabs via their Discord bot; Persona sandbox; Presage developer portal (API key); Tiger Data; Backboard; Vultr; GoDaddy code at check-in. Put them in `.env.example` with empty values and in the team password manager.
- [ ] `api/` scaffold: FastAPI, auth middleware (Supabase or Clerk JWT), Docker, deployed to a 4 GB Vultr instance behind the domain; `GET /health`.
- [ ] Tiger Data: `contact_events` hypertable + `daily_connection` continuous aggregate (contract section 2), `vitals`, `clock_history`. Import one teammate's full Apple Health export tonight so the aggregates have real rows.
- [ ] `presage-worker/`: `npm i @smartspectra/node-sdk`; the sample with `useCamera()` prints a pulse on the laptop.

## Block 1 (H1-6): extraction on real PDFs. Gate H6.

- [ ] `POST /extract`: Gemini 2.5 Flash with a response schema (analyte, value, unit, ref range, source span, fasting flag if printed, language). Canonical names from `phenoage.json`; unknowns as `other:<raw>`. Test on two real (redacted) PDFs; store nothing.
- [ ] Redaction rules for C: which text-layer lines to drop before upload (name, DOB, MRN, address, ordering physician patterns); write them as a small JSON C can import.
- **Gate H6:** Presage prints a pulse; `/extract` returns nine analytes from a real CBC + CMP.

## Block 2 (H6-12): normalizer, Persona, coach v0. Gate H10.

- [ ] Unit normalizer to the paper's units (albumin g/L, creatinine umol/L, glucose mmol/L, CRP mg/dL with hs-CRP mg/L conversion, ALP U/L, WBC 10^9/L); lymphocyte % from absolute count when only absolutes are given; the 30-line Spanish alias table (Glucosa, Creatinina, Proteina C reactiva, Leucocitos, Linfocitos %, VCM, ADE, Fosfatasa alcalina, Albumina).
- [ ] Persona: Government-ID + selfie inquiry template (selfie-only returns no birthdate); hosted link; `POST /persona/webhook` sets `verified` and `birthdate`; `GET /me` returns `over_65`. Pre-verify one demo account; test the force-pass and force-fail toggles.
- [ ] ElevenLabs Agents v0: one agent, push-to-talk from the web build, text fallback, a `GET /tts` sentence endpoint for C's H10 device test. Confirm Spanish is in the agent's language list.
- [ ] Backboard: seed two prior check-ins for the demo user.
- **Gate H10:** the deployed web export on real phones plays an ElevenLabs sentence (C tests; you fix).
- [ ] Sleep shift 6-10 am.

## Block 3 (H12-19): the coach with tools, safety gates. Gate H19.

- [ ] `GET /coach/context` assembling clock, circle, today, levers and flags from A's exports, B's package and the DB.
- [ ] Coach client tools: `get_clock`, `get_circle`, `explain_analyte`, `get_today_plan`, `log_meal`, `share_with_circle` (refuses unless verified). System prompt: answer only from tool JSON; a validator rejects any number not present in it. Curated one-paragraph explanations per analyte with a citation.
- [ ] Medication gate and critical-value banner in `/coach/context` flags; the coach refers to a clinician when either is set.
- [ ] Third real PDF and one Spanish-format report through `/extract` and the normalizer.
- [ ] `POST /vitals` from the worker; `GET /vitals/latest`.
- **Gate H19:** one real lab report and one real inbox end to end on a phone.

## Block 4 (H19-27): memory, Spanish, states. Freeze H27.

- [ ] Backboard memory wired so "same plan as yesterday?" answers from the seeded check-ins; every nudge and reply is stored.
- [ ] Spanish voice for the coach; the 65+ switch tested with the force-pass birthdate.
- [ ] Missing-analyte and non-fasting states flow through `/extract` -> C's review screen; "complete your clock" data (what to order, Houston direct-to-consumer price, re-test date).
- [ ] Devpost page draft: title, tagline, track and every challenge checkbox (Healthcare, MathWorks, Persona, ElevenLabs, Lilie, Notability, MLH: Gemini, ElevenLabs, Presage, Tiger Data, Backboard, Vultr, GoDaddy).

## Block 5 (H27-37)

- [ ] Cached extraction JSON and GIF fallbacks for every live step; QR cards.
- [ ] Devpost submitted by 8:30 am with the video; check every checkbox above.
- [ ] Rehearse the Persona, Presage, ElevenLabs and Tiger Data 20-second swap-ins.

## Last, only if everything above is done (Nessie, in this order)

Get the key Friday since it costs nothing, then do nothing with it until Block 4 is finished. (1) Streak transfer `/accounts/{id}/transfers` to a "Future You" account, about an hour with a seeded customer; (2) purchase feed into B's recurrence interface as a second stream; (3) a standing bill. First thing cut.

## Your cut order

Nessie -> Spanish voice (keep Spanish text) -> Backboard (fall back to a Postgres table) -> HRV field.

## Kickoff prompt (paste into Claude Code in the repo root)

```
Read CLAUDE.md, docs/contracts.md, docs/lanes/D.md and docs/log/D.md. You are the Lane D agent (platform, labs intake, sponsors). Restate in ten lines: what this lane produces, what it consumes, the Setup and Block 1 tasks in order, and what the H6 gate requires. Then plan the api/ scaffold plus POST /extract with a strict Gemini response schema in plan mode, using fixtures/lab_report_redacted.pdf as the test input. Never store an uploaded file. Ask me only the questions that change the design.
```

## Session-restart prompt

```
Read docs/log/D.md and docs/contracts.md. Continue Lane D from the "next" line of the last log entry. Restate the next gate and the next task in three lines, then proceed.
```
