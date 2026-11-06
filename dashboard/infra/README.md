# infra

| Berkas | Isi |
|---|---|
| `Dockerfile` | Membangun dashboard, lalu memasangnya bersama backend dalam satu image |
| `docker-compose.yml` | Mosquitto, InfluxDB, dan backend |
| `docker-compose.online.yml` | Tambahan untuk internet: Caddy, DuckDNS, MQTT TLS. Baru divalidasi sintaksnya |

Image dibangun dari root repo karena ikut memuat `ML/`. Cara paling mudah adalah `./scripts/demo-docker.sh` dari folder `dashboard/`. Langkah manualnya ada di [../README.md](../README.md).

Port 1883 dan 8086 hanya terbuka untuk `127.0.0.1`, sedangkan 8000 terbuka untuk jaringan. ESP32 di jaringan lokal butuh port MQTT dibuka: ubah menjadi `1883:1883`.

Data disimpan di volume Docker. `demo-docker.sh stop` tidak menghapusnya, sedangkan `reset` menghapusnya.

- [caddy/](caddy/): HTTPS otomatis
- [mosquitto/](mosquitto/): broker MQTT
