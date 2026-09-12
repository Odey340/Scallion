# Scallion API (Lane D)

FastAPI service: labs intake (`POST /extract`), and later vitals, circle summary, coach context.

```
cp ../.env.example ../.env          # fill GEMINI_API_KEY and SUPABASE_JWT_SECRET
uv sync                             # installs deps + dev tools
uv run pytest                       # offline: fake Gemini, dev auth
GEMINI_FAKE=1 DEV_AUTH_BYPASS=1 uv run uvicorn app.main:app --reload
curl -F file=@../fixtures/lab_report_synthetic.pdf localhost:8000/extract
```

Live mode needs `GEMINI_API_KEY`; `/health` reports `"gemini": "live"|"fake"` and `"auth": "jwt"|"bypass"`.
Uploads are read into memory and never written to disk. Docker: `docker build -t scallion-api . && docker run -p 8000:8000 --env-file ../.env scallion-api`.
Redaction rules for lane C live in `redaction_rules.json` (contract section 7); `app/redaction.py` is the reference applier and `tests/test_redaction.py` runs them against the fixture.
Canonical analyte keys come from `web/public/engine/phenoage.json` (A) with `fixtures/phenoage.contract.json` as the fallback.
