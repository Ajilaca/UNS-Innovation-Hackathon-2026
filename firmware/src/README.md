# firmware/src

| Berkas | Isi |
|---|---|
| `main.cpp` | Putaran cepat (pengaman dan arus, tiap 200 ms), langkah kendali (tiap 10 detik), penyimpanan, dan konsol serial |
| `hal.h`, `hal.cpp` | Sensor dan aktuator. Hanya berkas ini yang tahu pin dan pustaka sensor |
| `net.h`, `net.cpp` | WiFi, NTP, MQTT, dan kotak keluar di flash |

Jaringan berjalan di tugas sendiri pada inti 0, dan kendali di inti 1, supaya jaringan yang macet tidak menahan pengaman. Watchdog memulai ulang perangkat bila kendali macet 30 detik. Saat menyala, semua keluaran dimatikan lebih dulu.
