# Deploying the API to Vultr (api.scallion.us)

Box: Vultr Cloud Compute, Dallas, Ubuntu 24.04, 104.238.145.198. Stack: the API container behind
Caddy (automatic Let's Encrypt) via `docker-compose.yml`. Secrets come from the repo-root `.env`
copied to `/srv/scallion/.env`; compose forces `DEV_AUTH_BYPASS=0` and `GEMINI_FAKE=0`.

First time (reinstalls the box with the deploy key + Docker through cloud-init):

```
python api/deploy/vultr_bootstrap.py --apply     # needs VULTR_API_KEY and this IP on its allow-list
```

Every later deploy:

```
bash api/deploy/deploy.sh                         # scp api/ + engine JSON + .env, docker compose up -d --build
```

DNS at GoDaddy: `A api -> 104.238.145.198`. The apex and `www` belong to lane C's Vercel export.
Persona webhook URL: `https://api.scallion.us/persona/webhook`. JWT logins need
`SUPABASE_JWT_SECRET` in `.env` before C's real users can call the deployed API.
