# Demo runbook (Lane D): live steps, fallbacks, 20-second sponsor swap-ins

Judging Sunday 9:30-12:00, 2:00 demo + 1:00 Q&A, three to four times. The API is at
`https://api.scallion.us`, the web export at `https://scallion.us`. Every live step has a fallback
that produces the same numbers; switch without apology.

## Before the first slot (10 minutes)

```
curl -s https://api.scallion.us/health          # expect gemini live, auth jwt, db tiger, tts live, memory backboard
cd presage-worker && node index.mjs --dry-run   # camera + key sanity; needs a face
cd api && uv run python scripts/seed_demo.py --user <demo supabase uuid>   # once; idempotent
```

Phone: signed in to the demo account, `/me` shows `verified: true` (run the Persona sandbox inquiry
Saturday night with force-pass and a birthdate before 1961 if you want the large-type switch).
Laptop: MATLAB open on `Scallion.prj` (Lane A), the worker terminal open, `media/` GIFs ready.

## The live steps and their fallbacks

| Step | Live | If it breaks | Same numbers? |
|---|---|---|---|
| Labs upload | Phone picks the redacted PDF, `/extract` via Gemini (~30 s) | C sends `X-Scallion-Cache: prefer`, the API returns the cached response for that file's hash instantly (`api/fixtures/cache/`) | Yes, cached from a live run |
| Camera pulse | `node index.mjs` on the laptop webcam (45-60 s from launch to `POST ok`; it posts to every account in `SCALLION_API_TOKEN`, so the phone can be on the demo account or the presenter's; press Start on the phone any time from launch until 60 s after the post) | `node index.mjs --replay test/fixtures/capture_real.json` posts the real Saturday capture (68.5 bpm) | Yes, real capture replayed |
| Circle | B's parser on the demo inbox export | the seeded `contact_events` rows already in Tiger; `daily_connection` shows them | Yes |
| Coach voice | ElevenLabs agent via `/coach/session` | text mode: `/coach/context` + `/coach/explain/{name}` rendered by C; `/tts` for one sentence | Yes, same context |
| Persona | hosted flow from `/me.verify_url` | say "verified Saturday" and show `/me` returning `verified: true, over_65: true` | Yes |

## 20-second sponsor swap-ins (say the sentence, show the thing)

- **MathWorks.** "Every number on screen is a MATLAB export." Show `web/public/engine/phenoage.json` next to the waterfall; the affine identity closes exactly. Lane A drives the App Designer console.
- **Tiger Data.** "Metadata only, in a hypertable." Run `uv run python migrations/apply.py --show`: three hypertables and the `daily_connection` continuous aggregate with today's rows live.
- **Presage.** "Thirty seconds, no wearable." Run the worker; the terminal prints `pulse 68 bpm`, then `GET /vitals/latest` shows the row. Fallback: `--replay`.
- **ElevenLabs.** "The coach may only say numbers that exist." Ask "what was my plan yesterday"; show `POST /coach/validate` rejecting a sentence with a made-up number (`{"ok": false, "unknown_numbers": ["12"]}`).
- **Gemini.** "Gemini extracts, never computes." Show the `/extract` response: `value` as printed, `si_value` normalised, `source_span` highlighting the line in the PDF.
- **Persona.** "Age from an ID, never typed." `/me` before and after the inquiry; the large-type mode flips from the verified birthdate.
- **Backboard.** "Memory across days." `GET /coach/recall?q=did I walk yesterday` returns the seeded check-in.
- **Vultr + GoDaddy.** "One box, one domain, TLS by Caddy." `https://api.scallion.us/health`.

## Q&A one-liners

- Privacy: content parsed on device and discarded; only `{contact_hash, ts, app, dir, len_bucket}` leaves the phone; PDFs redacted client-side (`api/redaction_rules.json`, 17 rules), uploads never stored.
- Honesty: "estimate, not diagnosis"; social years are "risk-equivalent years, if sustained, population estimate"; derived lymphocyte % is labelled; critical labs hide the age.
- Safety: the blood-sugar medication answer switches off exercise-timing advice; critical ranges from `phenoage.json`.
- Why PhenoAge: published, nine common analytes, reproducible from coefficients; NHANES percentiles for context.

## After each slot

`docker compose logs --tail 50` on the box only if something failed; otherwise touch nothing. Do not redeploy during judging.
