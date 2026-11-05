# SEBAT

Solar-powered Electrocoagulation for BATik wastewater: elektrokoagulasi tenaga surya untuk limbah batik.

SEBAT mengolah limbah batik dengan elektrokoagulasi bertenaga surya dan kendali otomatis, untuk UMKM di Kampung Batik Laweyan, Solo. Proyek ini dibuat untuk UNS Innovation Hackathon 2026, Energy Track, sub-tema B (pengelolaan sampah dan ekonomi sirkular), dengan DLH Kota Surakarta sebagai problem owner.

> Status: prototipe perangkat lunak. Alatnya belum dirakit dan belum ada data eksperimen. Semua angka di bawah berasal dari kembaran digital (digital twin) dengan parameter tebakan tim. Simulasi membuktikan logika sistem, belum membuktikan akurasi alat atau penghematan nyata. Firmware sudah terkompilasi tetapi belum pernah dijalankan pada papan ESP32.

## Cara kerja

Arus DC melarutkan pelat besi menjadi gumpalan yang menangkap zat warna. Listriknya dari panel surya, dengan PLN sebagai cadangan. Sensor warna dibaca tiap 10 detik, dan kontroler menghentikan arus saat warna air memenuhi target baku mutu (200 Pt-Co, Permen LHK P.16/2019). Model ML memperkirakan muatan listrik yang dibutuhkan dari kondisi awal limbah, untuk perkiraan waktu, penjadwalan energi, dan peringatan anomali. Keputusan berhenti tetap dari sensor.

Tiga strategi kendali dibandingkan: waktu tetap, umpan balik sensor, dan AI (prediksi ditambah umpan balik). Tiga kebijakan energi dibandingkan: surya murni, hibrida, dan PLN saja. Pada hibrida, PLN menambal setelah menunggu paling lama 2 jam, atau lebih awal bila prakiraan surya kurang.

## Menjalankan di komputer sendiri

Cara termudah memakai Docker: satu perintah menyalakan dashboard, backend, broker MQTT, InfluxDB, dan simulasi live. Tidak perlu Python atau Node di komputer Anda, dan tidak perlu perangkat keras.

Yang perlu disiapkan:

- Docker dengan Compose v2 (`docker compose version` harus berjalan)
- Bash dan Git (Linux, macOS, atau WSL2 di Windows)
- Port 8000, 1883, dan 8086 yang belum dipakai
- Internet saat membangun image pertama kali; setelah itu demo berjalan tanpa internet

```bash
git clone https://github.com/Ajilaca/UNS-Innovation-Hackathon-2026.git
cd UNS-Innovation-Hackathon-2026
./scripts/demo-docker.sh
```

Buka http://localhost:8000, lalu masuk dengan `admin` / `demo-batikjernih` atau tombol "Lihat demo" (baca saja). Simulasi langsung berjalan. Model AI dilatih otomatis di latar belakang selama sekitar satu menit, jadi halaman Model AI baru terisi setelah itu.

```bash
./scripts/demo-docker.sh stop     # matikan, data tetap ada
./scripts/demo-docker.sh          # nyalakan lagi
./scripts/demo-docker.sh reset    # matikan dan hapus semua data demo
```

Skrip ini membuat berkas `.env` berisi kata sandi acak saat pertama dijalankan. Kata sandi `demo-batikjernih` hanya untuk demo lokal dan tertulis di repositori publik ini, jadi ganti `BJ_ADMIN_PASSWORD` di `.env` sebelum memasang aplikasi di jaringan yang bisa diakses orang lain.

Kedua cara di bagian ini (Docker dan tanpa Docker) sudah dicoba dari salinan bersih repositori di Linux, dengan Docker 29, Compose 5, Python 3.12, dan Node 24. Windows dan macOS belum dicoba.

### Tanpa Docker

Perlu Python 3.12 dan Node 22 atau lebih baru. Skrip ini memasang dependensi dan melatih model pada kali pertama, sekitar 2 menit, lalu menjalankan backend dengan simulasi. Riwayatnya disimpan di `/tmp` dan dihapus setiap kali skrip dijalankan. MQTT dan InfluxDB tidak ikut menyala.

```bash
./scripts/demo-offline.sh         # http://localhost:8000, Ctrl+C untuk berhenti
PORT=8011 ./scripts/demo-offline.sh   # bila port 8000 sudah terpakai
```

### Mode pengembangan

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
(cd web && npm install && npm run build)

cd backend
../.venv/bin/python -m app.cli train --n 1200      # latih model, sekitar 1 menit
BJ_ADMIN_PASSWORD=sandi BJ_SECRET=rahasia-panjang ../.venv/bin/uvicorn app.main:create_app --factory --port 8000
```

Untuk dashboard dengan hot reload, jalankan `cd web && npm run dev` di terminal lain (permintaan `/api` diteruskan ke port 8000).

Tes:

```bash
.venv/bin/python -m pytest backend     # 75 tes, termasuk perbandingan firmware C++ dengan kontroler Python (perlu g++)
(cd web && npx tsc --noEmit && npx vitest run)     # 20 tes
node tools/navcheck.mjs                # klik semua menu di Chrome, aplikasi harus sedang berjalan
```

### Server dengan konfigurasi sendiri

Salin `.env.example` menjadi `.env` dan ganti semua nilainya (termasuk teks contoh yang memakai tanda backtick), lalu jalankan:

```bash
C="docker compose --env-file .env -f infra/docker-compose.yml"
set -a; . ./.env; set +a
$C up -d --build mosquitto influxdb
ENV_FILE=.env infra/mosquitto/make-users.sh backend "$MQTT_BACKEND_PASSWORD"
ENV_FILE=.env infra/mosquitto/make-users.sh lwy-001 "sandi-perangkat"    # satu pengguna per unit
$C up -d --build backend
```

Untuk HTTPS dan MQTT TLS tambahkan `-f infra/docker-compose.online.yml` (Caddy dan DuckDNS). Konfigurasi online ini baru divalidasi sintaksnya, belum dicoba di server sungguhan.

### Masalah yang sering muncul

| Gejala | Penyebab dan solusi |
|---|---|
| `port is already allocated` | Port 8000, 1883, atau 8086 dipakai program lain. Matikan program itu, atau ubah bagian `ports` di `infra/docker-compose.yml`. |
| `permission denied` pada Docker | Pengguna Anda belum masuk grup `docker`. Jalankan `sudo usermod -aG docker $USER`, lalu masuk ulang. |
| Halaman Model AI kosong | Model masih dilatih. Tunggu sekitar satu menit. |
| Angka Perbandingan berbeda dari README | Tombol "Jalankan ulang" menyimpan hasil baru di server, dan hasil itu mengalahkan hasil bawaan. `./scripts/demo-docker.sh reset` mengembalikannya. |
| Riwayat batch kosong | Batch pertama perlu waktu untuk selesai walau simulasi dipercepat. Tunggu beberapa menit. |

## Isi repositori

| Folder | Isi |
|---|---|
| [backend/](backend/) | API FastAPI, kembaran digital, kontroler acuan, model AI, dan tes |
| [web/](web/) | Dashboard React dan TypeScript |
| [firmware/](firmware/) | Firmware ESP32 dan uji di komputer |
| [config/](config/) | Parameter simulasi, skenario, dan hasil bawaan |
| [data/](data/) | Data irradiansi asli dan hasil hitung lokal |
| [infra/](infra/) | Dockerfile, Compose, Mosquitto, dan Caddy |
| [scripts/](scripts/) | Skrip demo satu perintah |
| [tools/](tools/) | Simulator unit mandiri, pemeriksa navigasi, dan pengambil tangkapan layar |
| [docs/](docs/) | Kontrak data dan hasil analisis sensitivitas |

Setiap folder punya README sendiri. Brief proyek dan sumber literaturnya disimpan di luar repositori ini.

## Progres

| Bagian | Isi | Status |
|---|---|---|
| Kembaran digital | Faraday, kinetika warna orde satu, tegangan sel, pasivasi, panas, dan sensor dengan noise, drift, saturasi, gelembung, serta flok | Berjalan, ada tes |
| Surya, baterai, PLN | Irradiansi asli Solo 2024 (NASA POWER), pembagian sumber energi, tiga kebijakan | Berjalan |
| Kontroler | Isi, sampling, pengenceran otomatis, cek energi, jeda surya, pembalikan polaritas, endap, verifikasi, ulang, koreksi per unit, deteksi warna mentok | Berjalan |
| Model AI | Gradient boosting dengan prior fisika dan rentang ketidakpastian, dilatih dari data simulasi | Berjalan, belum ada data nyata |
| Eksperimen | Perbandingan strategi, kampanye multi-hari, ukuran panel dan baterai, sensitivitas, ketahanan model | Berjalan (simulasi) |
| Backend | Login, ingest HTTP dan MQTT, riwayat batch, laporan CSV untuk DLH, prediksi, job latar belakang, simulasi live | Berjalan |
| MQTT, InfluxDB, Docker | Mosquitto dengan ACL per perangkat, InfluxDB 2, satu image untuk backend dan dashboard | Dicoba dengan kontainer asli |
| Dashboard | Pantauan, Batch, Perbandingan, Rekomendasi, Laporan, Model AI; bahasa Indonesia; menyesuaikan ponsel | Berjalan, diperiksa di 1920, 1440, dan 390 px |
| Firmware ESP32 | Port kontroler ke C++, sensor, aktuator, pengaman, MQTT, kotak keluar, konsol kalibrasi | Terkompilasi dan keputusannya cocok dengan Python; belum dicoba pada papan |
| Perangkat keras | Reaktor, panel, sensor | Belum dirakit |
| TLS MQTT, Caddy, DuckDNS | `infra/docker-compose.online.yml` | Belum dicoba di server sungguhan |
| Skrip kalibrasi dari data bench | | Belum ada |

## Halaman dashboard

Pantauan menampilkan keadaan unit saat ini, dan opsi simulasi A (hari cerah), B (hari mendung), C (kondisi sulit), atau Otomatis. Batch berisi riwayat dan rincian tiap batch. Perbandingan punya empat tab: strategi kendali, sumber energi, ukuran panel dan baterai, serta ketahanan asumsi. Rekomendasi disusun dari aturan tetap atas pembacaan unit, tanpa model AI, supaya alasannya bisa ditelusuri. Laporan merangkum batch untuk DLH dan bisa diunduh sebagai CSV. Model AI menampilkan galat model, pengaruh tiap fitur, dan formulir coba prediksi.

Ilustrasi unit di dashboard (`web/public/scene/sistem.png`) dibuat dengan AI dan bukan foto alat.

## Hasil simulasi sementara

Angka ini bukan hasil eksperimen. Kondisi `baseline`, 100 batch acak, irradiansi Solo asli:

| Strategi | Lolos 200 Pt-Co | Energi (kWh/m³) | Waktu proses |
|---|---|---|---|
| Waktu tetap, disetel rata-rata | 59% | 0,88 | 61 menit |
| Waktu tetap, disetel aman (P90) | 89% | 1,49 | 104 menit |
| Umpan balik sensor | 95% | 0,99 | 68 menit |
| AI (prediksi dan umpan balik) | 95% | 0,99 | 68 menit |

Umpan balik sensor adalah sumber keunggulan utama: mutunya lebih tinggi dari waktu tetap yang disetel aman, dengan energi dan waktu jauh lebih kecil.

Pada kondisi ini AI tidak mengubah mutu air dibanding umpan balik saja. Nilainya ada pada perkiraan waktu, penjadwalan energi, cadangan saat sensor macet, dan peringatan anomali, yang belum diukur terpisah.

Galat prediksi model dosis 16,9%, dibanding 27,1% untuk fisika saja (validasi silang, 1.108 batch). Data latihnya sintetis, jadi ini membuktikan alur belajarnya, belum akurasi di lapangan. Model yang dilatih di kontainer demo memakai data sendiri, sehingga angkanya sedikit berbeda.

Dengan irradiansi asli, panel 200 Wp dan baterai 600 Wh menjalankan 3-5 batch per hari tanpa PLN. Pada 5 batch per hari, 88% batch sempat selesai.

Analisis ukuran (10 hari, 2 pengulangan, jadi angkanya bergeser beberapa persen): pada panel 50-100 Wp surya murni tidak andal, dengan 9-93% batch lolos dan terendah pada 50 Wp, karena batch menunggu daya lalu dibatalkan. Hibrida umpan balik menjaga 90-100% lolos dengan porsi terbarukan 45-100%.

Pada panel kecil, AI memperkirakan surya tidak cukup lalu langsung memulai dengan PLN menambal. Pada 50 Wp, 150 Wh, 3 batch per hari, waktu tunggu turun dari 114 menjadi 27 menit dan batch selesai naik dari 82% menjadi 97%. Konsekuensinya, porsi terbarukan turun dari 49% menjadi 44% dan batch lolos dari 96% menjadi 93%.

Kalibrasi sensor paling menentukan ([docs/sensitivity.md](docs/sensitivity.md)): bila skala sensor sebenarnya 0,6 kali nilai kalibrasi, batch lolos jatuh dari 98% ke 0% pada kendali umpan balik, karena arus berhenti terlalu cepat. Berikutnya laju warna (k_d) dan fraksi warna membandel.

Model AI tidak tahan bila simulator salah (`app.cli robust`): galat 16% pada kondisi latih naik ke 47-102% saat laju warna sebenarnya 0,5 sampai 2 kali. Koreksi per unit dari 5 batch terakhir, yang kini terpasang di kontroler, menurunkan galat prediksi muatan dari 49-81% ke 20-21% saat laju warna 0,33 sampai 2 kali, dan sedikit memburuk pada kondisi yang sudah tepat (18,0% menjadi 18,6%). Mutu dan energi nyaris tidak berubah karena arus tetap dihentikan sensor, jadi manfaatnya ada pada perkiraan waktu dan rencana energi.

Paper Fadzli dkk. 2024 (elektroda Al, pH 3) menyiratkan kebutuhan muatan bisa sekitar 7 kali asumsi kami (turunan kami, dengan efisiensi arus 100%). Pada kasus itu unit standar hanya lolos 5%, sedangkan reaktor 1600 cm² dengan 35 A lolos 60% pada 7,8 kWh/m³.

Deteksi warna mentok memberi status yang jujur dan mencegah proses ulang, tetapi dengan batas waktu 120 menit hampir tidak menghemat energi (warna membandel 6 kali: 127 menjadi 125 menit, tetap 1,8 kWh/m³).

Energi simulasi (0,6-1,8 kWh/m³) berada di ujung bawah rentang literatur batik (0,7-20) dan di bawah asumsi desain brief (3-5). Ini tebakan yang harus dikalibrasi.

## Konfigurasi

Semua parameter ada di [config/sim.yaml](config/sim.yaml), berlabel `[DATA]`, `[ESTIMASI]`, atau `[KALIBRASI]`. Setelah uji bench, parameter ini wajib diganti: `reactor.k_d_Fe`, `sensor.eps_scale`, `control.eps_eff_cal`, `wastewater.color_per_cod`, dan `reactor.overpotential_V`. Skenario ada di [config/scenarios/](config/scenarios/).

Eksperimen bisa dijalankan tanpa server, dari folder `backend/`:

```bash
../.venv/bin/python -m app.cli compare --n 100
../.venv/bin/python -m app.cli energy
../.venv/bin/python -m app.cli sizing
../.venv/bin/python -m app.cli batch --mode ai --scenario cerah-umkm-kecil
```

Hasilnya ditulis ke `data/*.json`. Salin ke `config/baked_results/` supaya ikut terpasang di image demo.

## Menyambungkan perangkat

ESP32 mengirim telemetri dan ringkasan batch lewat MQTT dengan bentuk yang sama seperti simulator, sesuai [docs/data-contract.md](docs/data-contract.md). Backend dan dashboard tidak perlu diubah. Langkah perakitan, pengkabelan, dan kalibrasinya ada di [firmware/README.md](firmware/README.md).

Compose bawaan membuka port MQTT hanya untuk komputer itu sendiri. Untuk mencoba ESP32 di jaringan lokal, ubah `127.0.0.1:1883:1883` menjadi `1883:1883` di `infra/docker-compose.yml`. Untuk internet, pakai TLS.

## Data eksternal

Irradiansi dan suhu per jam Solo 2024 berasal dari [NASA POWER](https://power.larc.nasa.gov/) dan disimpan di `data/external/`. Data ini berbasis satelit dan model dengan sel grid sekitar 0,5 derajat, jadi variasi awan lokal bisa lebih buruk; cek dengan BMKG atau PVGIS. Sebaran kualitas limbah dan volume berasal dari Ariani dkk., UMS 2024 (3 UMKM, 4 sampel).

## Rencana

1. Skrip kalibrasi dari CSV uji bench, lalu latih ulang model dari simulator terkalibrasi dan batch nyata.
2. Merakit unit bench dan menjalankan firmware pada papan, mengikuti urutan di `firmware/README.md`.
3. Memasang di server sungguhan (VM gratis, DuckDNS, Caddy, MQTT TLS) dan memeriksa syarat penyedianya.

## Keselamatan

Elektrolisis menghasilkan gas hidrogen, jadi unit harus berada di ruang berventilasi dan jauh dari api. Tegangan sel rendah (paling tinggi 15 V DC), tetapi tetap pakai sarung tangan dan kacamata. Jangan menambah garam dapur berlebihan karena berisiko membentuk gas klorin. Endapan diperlakukan sebagai limbah B3 (PP 22/2021) dan tidak dibuang ke saluran. Panel surya dan baterai LiFePO4 wajib bersekring.

## Lisensi

[MIT](LICENSE). Data NASA POWER dan sumber lain tetap tunduk pada ketentuan masing-masing.
