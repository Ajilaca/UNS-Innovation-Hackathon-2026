// WiFi, jam NTP, MQTT, dan kotak keluar. Berjalan di tugas sendiri supaya jaringan yang macet tidak pernah
// menahan kendali dan pengaman.
#pragma once
#include <stddef.h>

namespace net {
void begin();
/** Antrekan telemetri. Dibuang bila antrean penuh: telemetri boleh hilang saat offline. */
void sendTelemetry(const char* json);
/** Ringkasan batch ditulis ke flash dulu, lalu dikirim saat tersambung. Bertahan walau perangkat mati. */
bool queueBatch(const char* json);
bool online();
bool timeSynced();
long now();         // detik Unix, 0 bila jam belum sinkron
int outboxCount();
}  // namespace net
