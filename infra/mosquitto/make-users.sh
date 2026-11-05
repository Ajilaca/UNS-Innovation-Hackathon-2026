#!/usr/bin/env bash
# Buat/ubah pengguna MQTT di volume password.
#   ./make-users.sh backend  "<password>"
#   ./make-users.sh lwy-001  "<password-perangkat>"
set -euo pipefail
ENV_FILE="${ENV_FILE:-$(dirname "$0")/../../.env}"
C="docker compose --env-file $ENV_FILE -f $(dirname "$0")/../docker-compose.yml"
user="${1:?pengguna}"; pass="${2:?password}"
$C run --rm --no-deps --entrypoint sh mosquitto -c \
  "touch /mosquitto/passwd/passwd && mosquitto_passwd -b /mosquitto/passwd/passwd '$user' '$pass'"
$C restart mosquitto
