#!/usr/bin/env bash
# Kompilasi pemutar jejak di komputer biasa (tanpa ESP32). Hasil: firmware/host_tests/parity
set -euo pipefail
cd "$(dirname "$0")"
g++ -std=c++17 -O1 -Wall -Wextra -I../lib/sobat_core/src parity_main.cpp ../lib/sobat_core/src/controller.cpp ../lib/sobat_core/src/convert.cpp -o parity -lm
echo "ok: $(pwd)/parity"
