# firmware

Firmware ESP32 untuk unit SEBAT, dengan PlatformIO dan framework Arduino. Kendali berjalan di perangkat dan tetap jalan walau internet putus.

> Status: terkompilasi untuk `esp32dev` (RAM 18,1%, flash 68,4%), dan keputusan kontrolernya cocok dengan versi Python pada tes di komputer. Firmware ini belum pernah dijalankan pada papan. Pemetaan pin, jenis modul, dan penguatan pengatur arus adalah usulan yang harus diperiksa saat merakit.

## Membangun

```bash
pip install platformio
cd firmware
cp include/secrets.example.h include/secrets.h     # isi WiFi dan MQTT; berkas ini diabaikan git
pio run                    # kompilasi; unduhan pertama sekitar beberapa ratus MB
pio run -t upload
pio device monitor         # konsol serial 115200, ketik help
```

Tes tanpa papan, dari akar repositori (perlu g++):

```bash
.venv/bin/python -m pytest backend/tests/test_firmware.py
```

## Rakitan rujukan

| Bagian | Modul | Sambungan |
|---|---|---|
| Arus dan tegangan | INA226 x4 (sel, PV, baterai, PLN) | I2C 0x40, 0x41, 0x44, 0x45 |
| Warna | TSL2591 dan LED merah, hijau, biru | I2C 0x29, GPIO 16, 17, 19 |
| pH, EC, kekeruhan | Modul analog lewat ADS1115 | I2C 0x48, kanal 0, 1, 2 |
| Suhu | DS18B20 | GPIO 4 |
| Pompa, pengaduk, pengencer, PLN | Relai | GPIO 25, 26, 27, 33 |
| Pembalik polaritas | Relai DPDT | GPIO 32 |
| Catu reaktor | Buck converter mode arus konstan | Aktif GPIO 23, setelan arus PWM GPIO 18 |
| Level | Pelampung atas dan bawah, pull-up luar | GPIO 34, 35 (LOW berarti air ada) |
| Tombol | Mulai dan henti ke GND | GPIO 13, 14 |

Ubah pemetaan di `include/pins.h`. Tegangan di pin ADS1115 tidak boleh melebihi 3,3 V, jadi modul 5 V butuh pembagi tegangan. Relai dianggap aktif HIGH; bila modul Anda aktif LOW, keluarannya harus dibalik supaya semua tetap mati saat menyala.

## Urutan mencoba pertama kali

1. Unggah tanpa sel elektrolisis, lalu `status`. Semua sensor harus terbaca.
2. Uji aktuator satu per satu: `test pump`, `test mixer`, `test dilute`, `test grid`.
3. Sambungkan beban uji sebagai pengganti elektroda, lalu `test cell`. Periksa arus 1 A terbaca benar, dan polaritas berpindah hanya saat arus nol.
4. Periksa pengaman: angkat pelampung bawah saat batch berjalan, dan pastikan arus mati.
5. Kalibrasi, lalu coba air bersih sebelum limbah.

## Kalibrasi

Batch ditolak sampai sensor warna dikalibrasi. Nilai ini tidak diberi bawaan, karena analisis sensitivitas menunjukkan kalibrasi warna paling menentukan mutu.

```
cal zero                 ruang ukur berisi air bersih; ulangi tiap pagi
cal eps <nilai>          absorbansi rata-rata per Pt-Co, dari uji bench
cal ph1 7.00             larutan penyangga pertama
cal ph2 4.01             larutan penyangga kedua
cal ec 1413              larutan standar pada uS/cm
cal turb1 0              sampel kekeruhan pertama
cal turb2 800            sampel kekeruhan kedua
cal show
```

Tanpa kalibrasi probe, batch tetap boleh berjalan dengan flag `KALIBRASI_PROBE_BELUM`. Sensor warna yang belum dinolkan lebih dari 36 jam memberi flag `NOL_SENSOR_KEDALUWARSA`.

## Perintah lain

`status`, `start`, `stop`, `mode ai|feedback|fixed`, dan `policy solar_first|solar_only|grid_only`. Mode dan kebijakan tersimpan setelah perangkat mati. Batch dimulai dari konsol atau tombol, dan tidak pernah mulai sendiri.

## Beda dari simulasi

Logika keputusan sama dengan `backend/app/control.py`. Yang hanya ada di perangkat:

- Model ML tidak berjalan di ESP32, jadi mode `ai` memakai prior fisika untuk prediksi. `PredictFn` di `controller.h` sudah disiapkan untuk prediksi dari luar, tetapi belum tersambung, karena `/api/predict` belum menerima kunci perangkat.
- Pengaman tambahan mematikan arus lebih dulu, baru mencatat: tegangan atau arus lebih, sensor arus hilang, arus tidak mengalir selama 2 menit, level rendah, dan suhu 5 derajat di atas batas kontroler.
- Sensor yang gagal terbaca tidak diganti angka karangan. Langkah kendali dilewati, dan setelah 6 kegagalan berturut batch dihentikan dengan `GAGAL_SENSOR`.
- Bila perangkat mati di tengah batch, ia melapor `GAGAL_TANPA_DAYA` saat menyala lagi dan tidak melanjutkan sendiri, karena air di reaktor belum tentu terolah.

## Keterbatasan yang diketahui

- Tidak ada sensor hidrogen, jadi firmware tidak mengawasi ventilasi. Unit harus berada di ruang berventilasi.
- Telemetri yang tidak terkirim saat offline hilang. Ringkasan batch disimpan di flash (paling banyak 40) dan dikirim saat tersambung.
- Telemetri tidak dikirim sebelum jam NTP sinkron, karena waktunya tidak bisa diberikan dengan benar.
- Mode TLS memakai `setInsecure()`. Pasang sertifikat akar sebelum dipakai di internet.
- SoC baterai diperkirakan dari tegangan dan hanya diperbarui saat arus kecil. Prakiraan surya menganggap daya saat ini bertahan, tanpa data cuaca.
- Penguatan pengatur arus (`hal.cpp`) tebakan, dan pembacaan sensor air menahan putaran kendali lebih dari satu detik setiap 10 detik.
- `electrode_g` dan `sludge_kg` dihitung dengan hukum Faraday dari muatan terukur, belum ditimbang, dan lumpurnya belum menghitung TSS limbah.
- Belum ada pembaruan lewat udara (OTA).

## Isi folder

- [src/](src/): lapisan perangkat keras dan program utama
- [include/](include/): pemetaan pin dan rahasia
- [lib/](lib/): logika kendali yang bisa diuji tanpa papan
- [host_tests/](host_tests/): pemutar jejak untuk uji di komputer
