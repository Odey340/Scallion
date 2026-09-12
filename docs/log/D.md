# Lane D log

Append ten lines per session: done, blocked, next, contract changes needed.

## Session 1 (Fri, H0-H2)
1. Done: `api/` scaffold (FastAPI, pydantic-settings, Supabase HS256 JWT dependency with `DEV_AUTH_BYPASS`, CORS, Dockerfile, README), `GET /health` reporting gemini fake/live and auth jwt/bypass.
2. Done: `POST /extract`: Gemini 2.5 Flash with a strict pydantic response schema (raw_name, value, unit, ref range, source_text, fasting, lang); canonical mapping in Python from `phenoage.json` keys; spans located in the pypdf text layer; `FakeExtractor` for offline runs; upload held in memory only.
3. Done: `fixtures/lab_report_synthetic.pdf` (generated, no PHI) + canned Gemini response; 48 tests pass offline; curl run returns all nine analytes with spans.
4. Done: root `.env.example` with every key empty; `[contract]` v2 for the `/extract` additive fields (post in Discord).
5. Not verified: Docker build (no daemon in this sandbox); live Gemini call (no key here). Both are one command each in `api/README.md`.
6. Blocked: real `fixtures/lab_report_redacted.pdf` not in repo; `GEMINI_API_KEY` and `SUPABASE_JWT_SECRET` not in hand. H6 needs the real PDF through live Gemini.
7. Next: redaction rules JSON for C (Block 1 item 2); Tiger Data schema + Apple Health import; `presage-worker/` pulse.
8. Next: Block 2 unit normalizer (+ lymph % from absolutes, Spanish aliases) on top of `app/extract/canonical.py`.
9. Choices made without asking: `phenoage.json` fallback lives at `api/fixtures/phenoage.contract.json` (TODO(A)); a token with no `SUPABASE_JWT_SECRET` configured returns 503, not 401, so misconfiguration is visible; duplicate canonical rows (a second glucose) come back as `other:`.
10. Contract changes needed: none beyond v2 above.
