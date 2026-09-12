#!/usr/bin/env bash
# Deploy the API to the Vultr box over SSH.
#   api/deploy/deploy.sh [root@104.238.145.198] [~/.ssh/scallion_vultr]
# Copies api/ (no .venv, no tests) and the repo-root .env (with DEV_AUTH_BYPASS forced off by
# compose) to /srv/scallion, then `docker compose up -d --build`. Idempotent.
set -euo pipefail
HOST="${1:-root@104.238.145.198}"
KEY="${2:-$HOME/.ssh/scallion_vultr}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 $HOST"

[ -f "$ROOT/.env" ] || { echo "no $ROOT/.env"; exit 2; }

echo "== packing api/"
TMPTAR="$(mktemp -t scallion-api-XXXX.tgz)"
tar -C "$ROOT" -czf "$TMPTAR" \
  --exclude='api/.venv' --exclude='api/tests' --exclude='api/__pycache__' --exclude='api/**/__pycache__' \
  --exclude='api/.pytest_cache' api/ web/public/engine/

echo "== uploading"
$SSH 'mkdir -p /srv/scallion'
scp -i "$KEY" -o StrictHostKeyChecking=accept-new "$TMPTAR" "$HOST:/srv/scallion/api.tgz"
scp -i "$KEY" -o StrictHostKeyChecking=accept-new "$ROOT/.env" "$HOST:/srv/scallion/.env"
rm -f "$TMPTAR"

echo "== building + starting"
$SSH 'set -e; command -v docker >/dev/null || (curl -fsSL https://get.docker.com | sh && systemctl enable --now docker)
      docker compose version >/dev/null 2>&1 || apt-get install -y docker-compose-plugin
      cd /srv/scallion && tar -xzf api.tgz && rm api.tgz && chmod 600 .env
      cd api/deploy && docker compose up -d --build --remove-orphans
      sleep 4; docker compose ps; curl -s http://127.0.0.1/health || true; echo'
echo "== done: http://$(echo "$HOST" | cut -d@ -f2)/health and https://api.scallion.us/health once DNS points here"
