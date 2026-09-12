# Scallion (HackRice 16, Healthcare track)

You are one of four Claude Code agents, each paired with one teammate who owns one lane. Read this file, then `docs/contracts.md`, then your lane file in `docs/lanes/`, then your log in `docs/log/`. Never start a task that belongs to another lane; if you need something from another lane, check `docs/contracts.md` for the agreed interface and build against it (with a stub or fixture if it does not exist yet).

## What Scallion is (one paragraph)

Upload the blood panel you already have and Scallion computes your biological age with a published clock (PhenoAge, Levine 2018) and shows which analyte costs you years. Point the camera at your face for thirty seconds and it reads pulse and breathing (Presage SDK) and gives a fitness age without labs. Connect your inbox and chat exports and it measures, from metadata only and never content, how many real people you exchange messages with, who is drifting, and what sustained isolation costs on the same clock (published hazard ratios converted to years via the Gompertz mortality doubling time: years = 8 x log2(HR)). Then it does one thing about it today: a nudge before a tie goes cold, a plate decision before dinner (a MATLAB SimBiology glucose-insulin simulation), a last-coffee time, and a voice coach (ElevenLabs) that explains any of it in English or Spanish. Tagline: *Know your biological age. Know your circle. Then move both.*

## Hard constraints

- Hacking: Fri 8:00 pm (H0) to Sun 9:00 am (H37). Feature freeze H27 (Sat 11 pm). Devpost video (3-4 min) due 9:00 am Sunday. Live judging Sunday 9:30-12:00: 2:00 demo + 1:00 Q&A, repeated 3-4 times.
- Gates: **H6** (engine numbers match references; Gmail headers arrive; Presage prints a pulse; insulindemo simulates two variants), **H10** (deployed web export works on a real iPhone and Android: camera, PDF pick, ElevenLabs sentence, Google OAuth), **H19** (one real lab report and one real inbox end to end on a phone), **H27** (freeze).
- Judging criteria: Technical Rigor, Originality, UX, Practicality/Impact, Relevance. MathWorks rubric (100 pts): Creativity 20, Real-world value 20, MATLAB mastery 20, Functionality (error-free run) 20, Presentation 20.
- Prizes targeted: Healthcare track, MathWorks, Persona, ElevenLabs (sponsor + MLH), MLH Gemini, Presage, Tiger Data, Backboard, Vultr, GoDaddy, Lilie Lab, Notability. Capital One Nessie is last and only if time. Skip Solana and Lovable.

## Lanes and owners

| Lane | Owns | Directory |
|---|---|---|
| **A: MATLAB engine** | Every model and every exported number: PhenoAge, NHANES norms, HUNT fitness age, risk-years table, SimBiology meal model + sweep + surrogate, caffeine PK, App Designer console, `.prj` + live script, JSON export | `matlab/` writes `web/public/engine/*.json` |
| **B: Social engine** | Metadata ingest (Gmail OAuth, WhatsApp/SMS/chat.db parsers), `contact_events`, the seven metrics, LSNS-6 proxy, `recurrence.ts`, heatmap data, alerts, privacy guarantees | `social/` (TypeScript package used by `web/` and `api/`) |
| **C: Product** | The Expo app (web export is the demo surface): six screens + onboarding + QR fitness-age landing, design system, heatmap and waterfall components, review screen, large-type Spanish mode, the video | `web/` |
| **D: Platform, intake, sponsors** | Tiger Data, Backboard, Vultr, domain, FastAPI, labs intake (Gemini extraction, unit normalizer, redaction), Persona, ElevenLabs agent + tools, Presage Node worker, Devpost | `api/`, `presage-worker/`, infra |

## Non-negotiable rules

1. **Every number on screen comes from a MATLAB export (`web/public/engine/*.json`) or from the `social/` package.** Gemini only extracts and narrates; it never produces a number that is displayed. A validator rejects narration containing numbers not present in the engine JSON.
2. **Privacy by construction.** Message content is parsed in the browser and discarded; only `{contact_hash, ts, app, dir, len_bucket}` leaves the device. Lab PDFs are redacted client-side (name, DOB, MRN, address) before upload. No PHI in the repo: `fixtures/` holds redacted samples only.
3. **Honest labels.** "Estimate, not diagnosis." "Risk-equivalent years, if sustained, population estimate" (never "life lost"). "LSNS-6 proxy, 4 of 6 items from your messaging, 2 from you." "8 of 9 markers" when an analyte is imputed. The meal curve is "a typical curve for someone with your fasting glucose and weight", never "your twin".
4. **Safety gates.** The medication question ("any medicine for blood sugar?") suppresses exercise-timing advice; any critical-range lab value suppresses the age number with "see a clinician first".
5. **Contracts change by agreement only.** Edit `docs/contracts.md`, commit with prefix `[contract]`, post in the team Discord. Everyone pulls and re-reads before continuing.
6. **Log every session.** Before you stop, append ten lines to `docs/log/<lane>.md`: done, blocked, next, any contract change needed. The next session (yours or a teammate's) starts by reading it.
7. **Record features when they work.** A 20-second screen recording into `media/` the moment a feature works; the video is an edit, not a shoot.
8. **Cut order** (first to go): Nessie, Android notification listener, perceived age, bedtime window (keep the caffeine line), Spanish voice (keep Spanish text), HRV, family/friend tagging, second inbox.

## Stack

- `web/`: Expo (React Native + expo-router + NativeWind), TypeScript strict; web export deployed on Vercel at the GoDaddy domain. Perceived age via `@vladmandic/human` in the browser.
- `social/`: TypeScript package, no runtime deps beyond a sha256; vitest tests against `fixtures/`.
- `api/`: FastAPI (Python 3.12) on Vultr (Docker); Tiger Data (TimescaleDB) as the database; Backboard for coach memory; Supabase or Clerk for auth.
- `matlab/`: MATLAB R2026a with SimBiology, Statistics and Machine Learning Toolbox, Simulink; the MATLAB Agentic Toolkit (MCP) so the agent can run code and tests. JSON export at build time; the API never calls MATLAB at runtime.
- `presage-worker/`: Node 20 with `@smartspectra/node-sdk`, runs on the demo laptop's webcam, POSTs vitals to the API.

## Working style for the agent

- Start every session by reading `docs/contracts.md` and your `docs/log/<lane>.md`, then restate in ten lines what you produce, what you consume, the next three tasks, and the next gate. Then plan the first task before writing code.
- Prefer the smallest thing that passes the next gate. Stubs against contracts are fine; invented interfaces are not.
- Commit small and often to `main` with a lane prefix (`[A] phenoage tests pass`, `[C] Circle heatmap`). No force pushes. Pull before you push.
- When a task depends on another lane and the artifact is missing, build against the contract with a fixture and leave a `TODO(<lane>)` comment; do not build the other lane's thing.
- Ask the human only questions that change the design. Everything else: pick the obvious option and note it in the log.
