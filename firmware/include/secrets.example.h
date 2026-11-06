// Salin menjadi secrets.h (sudah diabaikan git), lalu isi. Jangan unggah secrets.h ke repositori.
#pragma once
#define WIFI_SSID "nama-wifi"
#define WIFI_PASS "kata-sandi-wifi"
#define SITE_ID "lwy"
#define UNIT_ID "lwy-001"                // juga nama pengguna MQTT, lihat dashboard/infra/mosquitto/acl
#define MQTT_HOST "192.168.1.10"         // komputer yang menjalankan stack Docker
#define MQTT_PORT 1883                   // 8883 untuk TLS
#define MQTT_PASS "kata-sandi-perangkat" // dashboard/infra/mosquitto/make-users.sh lwy-001 "..."
#define MQTT_TLS 0                       // wajib 1 bila broker di internet
