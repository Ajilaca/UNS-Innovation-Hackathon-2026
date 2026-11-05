#!/usr/bin/env bash
# Demo offline dengan Docker (satu perintah). Setelah image terbangun, tidak perlu internet.
#   ./scripts/demo-docker.sh          # mulai   -> http://localhost:8000
#   ./scripts/demo-docker.sh stop     # matikan (data tetap)
#   ./scripts/demo-docker.sh reset    # matikan dan hapus semua data demo
set -euo pipefail
cd "$(dirname "$0")/.."
C="docker compose --env-file .env -f infra/docker-compose.yml"
case "${1:-start}" in
  stop)  $C stop; exit 0 ;;
  reset) $C down -v; exit 0 ;;
esac
if [ ! -f .env ]; then
  rnd() { head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20; }
  cat > .env <<ENV
BJ_ADMIN_USER=admin
BJ_ADMIN_PASSWORD=demo-batikjernih
BJ_SECRET=$(rnd)$(rnd)
BJ_DEMO=1
BJ_AUTOSTART_SIM=1
MQTT_BACKEND_PASSWORD=$(rnd)
INFLUX_USER=admin
INFLUX_PASSWORD=$(rnd)
INFLUX_TOKEN=$(rnd)$(rnd)
ENV
  echo ".env dibuat (nilai acak, kecuali sandi admin demo)."
fi
set -a; . ./.env; set +a
$C up -d --build mosquitto influxdb
ENV_FILE=.env infra/mosquitto/make-users.sh backend "$MQTT_BACKEND_PASSWORD" >/dev/null
$C up -d --build backend
printf "Menunggu backend"; for _ in $(seq 60); do curl -sf localhost:8000/api/health >/dev/null && break; printf "."; sleep 1; done; echo
echo "Buka:  http://localhost:8000   (masuk: admin / ${BJ_ADMIN_PASSWORD}, atau tombol 'Lihat demo')"
echo "Model AI dilatih otomatis di latar belakang (±1 menit); simulasi live sudah berjalan."
