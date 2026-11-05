#!/usr/bin/env bash
# Demo offline satu perintah (tanpa Docker, tanpa internet): backend + dashboard + simulasi live.
#   ./scripts/demo-offline.sh            # buka http://localhost:8000  (admin / demo-batikjernih)
# Butuh: Python 3.12 (venv di .venv) dan, sekali saja, Node untuk membangun web/dist.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -x .venv/bin/python ] || { python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; }
[ -d web/dist ] || { (cd web && npm ci --no-audit --no-fund && npm run build); }
[ -f models/dose_predictor.joblib ] || (cd backend && ../.venv/bin/python -m app.cli train --n 600)
export BJ_ADMIN_PASSWORD="${BJ_ADMIN_PASSWORD:-demo-batikjernih}" BJ_SECRET="${BJ_SECRET:-$(head -c 24 /dev/urandom | base64)}"
export BJ_DB_PATH="${BJ_DB_PATH:-/tmp/sebat-demo.sqlite}"; rm -f "$BJ_DB_PATH"*
cd backend
../.venv/bin/uvicorn app.main:create_app --factory --port "${PORT:-8000}" &
PID=$!; trap 'kill $PID 2>/dev/null' EXIT
for _ in $(seq 40); do curl -sf "localhost:${PORT:-8000}/api/health" >/dev/null && break; sleep 0.5; done
TOKEN=$(curl -s -X POST "localhost:${PORT:-8000}/api/auth/login" -H 'content-type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$BJ_ADMIN_PASSWORD\"}" | ../.venv/bin/python -c "import sys,json;print(json.load(sys.stdin)['token'])")
curl -s -X POST "localhost:${PORT:-8000}/api/sim/start" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"scenario":"cerah-umkm-kecil","mode":"ai","speed":120}' >/dev/null
echo "Buka http://localhost:${PORT:-8000}  (admin / $BJ_ADMIN_PASSWORD).  Ctrl+C untuk berhenti."
wait $PID
