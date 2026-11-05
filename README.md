# SEBAT

**S**olar-powered **E**lectrocoagulation for **BAT**ik wastewater: elektrokoagulasi tenaga surya untuk limbah batik.

Pengolah limbah batik elektrokoagulasi bertenaga surya dengan kendali AI, untuk UMKM Kampung Batik Laweyan, Solo.
UNS Innovation Hackathon 2026, Energy Track, sub-tema B (pengelolaan sampah dan ekonomi sirkular). Problem owner: DLH Kota Surakarta.

> **Status: prototipe perangkat lunak (simulasi).** Belum ada hardware dan belum ada data eksperimen. Semua angka hasil di bawah berasal dari kembaran digital (digital twin) dengan parameter tebakan tim, bukan dari pengukuran. Simulasi membuktikan logika sistem, bukan akurasi alat atau penghematan nyata. Brief lengkap dan sumbernya ada di `batikjernih-project-brief.md` (satu folder di atas).

## Cara kerja singkat

Arus DC melarutkan pelat besi menjadi gumpalan yang menangkap zat warna. Listrik dari panel surya, dengan PLN sebagai cadangan. Sensor warna (LED + fotodioda) dibaca tiap 10 detik, dan kontroler menghentikan arus tepat saat warna air memenuhi target baku mutu (200 Pt-Co, Permen LHK P.16/2019). Model ML memprediksi muatan listrik yang dibutuhkan dari kondisi awal limbah, untuk ETA, penjadwalan energi, dan deteksi anomali.

Tiga strategi kendali dibandingkan: **waktu tetap**, **umpan balik sensor**, dan **AI** (prediksi + umpan balik). Tiga kebijakan energi: **surya murni**, **hibrida (surya dulu, PLN menambal setelah tunggu maks 2 jam atau lebih awal bila prakiraan surya kurang)**, dan **PLN saja**.

## Yang sudah ada

| Bagian | Isi | Status |
|---|---|---|
| Kembaran digital | Faraday, kinetika warna orde satu, tegangan sel, pasivasi, panas, sensor dengan noise/drift/saturasi/gelembung/flok | Berjalan, 27 tes |
| Surya + baterai + PLN | Irradiansi **asli** Solo 2024 (NASA POWER), baterai, pembagian sumber energi, kebijakan surya murni / hibrida / PLN saja | Berjalan |
| Kontroler | Isi, sampling, pengenceran otomatis, cek energi, jeda surya, pembalikan polaritas, endap, verifikasi, ulang | Berjalan |
| Model AI | Gradient boosting + prior fisika, dilatih dari data sendiri, dengan rentang ketidakpastian | Berjalan |
| Eksperimen | Perbandingan strategi, kampanye multi-hari, analisis ukuran panel/baterai | Berjalan |
| Backend FastAPI | Login (admin / demo baca-saja), ingest HTTP dan MQTT, riwayat batch, laporan CSV untuk DLH, prediksi, job latar belakang, simulasi live | Berjalan (total 61 tes backend) |
| MQTT + InfluxDB + Docker Compose | Mosquitto (ACL per perangkat), InfluxDB 2, backend + dashboard dalam satu image | **Diuji dengan kontainer asli**: 2 batch lewat MQTT, 1.080 titik di InfluxDB sama dengan SQLite |
| Dashboard React + TypeScript | Pantauan live dengan skema unit, batch, rincian batch, perbandingan, rekomendasi berbasis aturan, laporan DLH, model AI; bahasa Indonesia; terlipat di ponsel | Berjalan, dilihat di 1920 dan 390 px |
| Demo offline | `./scripts/demo-offline.sh` | Skrip ditulis, sintaks diperiksa; belum dijalankan penuh |
| TLS MQTT, Caddy, DuckDNS (`infra/docker-compose.online.yml`) | Konfigurasi dibuat dan divalidasi sintaksnya | **Belum diuji di server sungguhan** |
| Analisis sensitivitas dan uji ketahanan model | `app.cli sensitivity`, `app.cli robust`, tab Ketahanan asumsi | Berjalan (simulasi) |
| Skrip kalibrasi dari data bench | | **Belum** |
| Firmware ESP32, hardware | | **Belum** |

## Mulai cepat

Perlu Python 3.12 dan Node 22+ (untuk membangun dashboard).

**Demo offline, satu perintah** (tanpa Docker): `./scripts/demo-offline.sh`, lalu buka http://localhost:8000 (admin / `demo-batikjernih`).

**Pengembangan manual:**

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd web && npm install && npm run build && cd ..                 # dashboard -> web/dist
cd backend
../.venv/bin/python -m app.cli train --n 1200                   # latih model dosis (±1 menit)
BJ_ADMIN_PASSWORD=... BJ_SECRET=... ../.venv/bin/uvicorn app.main:create_app --factory --port 8000
../.venv/bin/python -m pytest                                    # 61 tes backend
```

Dashboard dev dengan hot reload: `cd web && npm run dev` (proksi `/api` ke port 8000).

**Eksperimen tanpa server:** `python -m app.cli compare --n 100` · `energy` · `sizing` · `batch --mode ai --scenario cerah-umkm-kecil`. Hasil ditulis ke `data/*.json`; model ke `models/` (tidak masuk git). Salinan hasil yang ikut di image ada di `config/baked_results/`; salin ulang setelah menjalankan ulang analisis, supaya demo baru tidak kosong.

**Server penuh dengan Docker:** salin `.env.example` ke `.env` dan isi, lalu `docker compose -f infra/docker-compose.yml --env-file .env up -d --build`. Buat pengguna MQTT dengan `infra/mosquitto/make-users.sh`. Untuk HTTPS dan MQTT TLS tambahkan `-f infra/docker-compose.online.yml`.

**Simulator sebagai klien mandiri** (mengirim kontrak data yang sama seperti ESP32): `python tools/sim_unit.py --mqtt-host localhost --mqtt-user lwy-001 --mqtt-password ... --batches 3`. Kontrak: [docs/data-contract.md](docs/data-contract.md).

## Konfigurasi dan skenario

Semua parameter ada di [config/sim.yaml](config/sim.yaml), diberi label **[DATA]**, **[ESTIMASI]**, atau **[KALIBRASI]**. Skenario di [config/scenarios/](config/scenarios/) menimpa sebagian parameter:

`baseline`, `kondisi-sulit`, `cerah-umkm-kecil`, `mendung-limbah-pekat`, `hibrida-mendung`, `surya-murni-mendung`, `pln-saja`, `sensor-kotor-flok`, `sensor-macet`, `elektroda-pasif`, `ec-rendah-boros`.

Opsi di dashboard (`config/simulations.yaml`): **A** hari cerah, **B** hari mendung, **C** kondisi sulit, **Otomatis** memilih salah satunya per batch.

Parameter yang **wajib diganti** setelah uji bench 6-7 Nov: `reactor.k_d_Fe`, `sensor.eps_scale`, `control.eps_eff_cal`, `wastewater.color_per_cod`, `reactor.overpotential_V`.

## Hasil simulasi sementara (bukan hasil eksperimen)

Kondisi `baseline`, 100 batch acak, irradiansi Solo asli (setelah fraksi warna membandel ditambahkan ke model):

| Strategi | Lolos 200 Pt-Co (kebenaran fisik) | Energi (kWh/m³) | Waktu proses |
|---|---|---|---|
| Waktu tetap, disetel rata-rata | 59% | 0,88 | 61 menit |
| Waktu tetap, disetel aman (P90) | 89% | 1,49 | 104 menit |
| Umpan balik sensor | 95% | 0,99 | 68 menit |
| AI (prediksi + umpan balik) | 95% | 0,99 | 68 menit |

Yang bisa dibaca dengan jujur:
- Kendali berumpan balik adalah sumber utama keunggulan: kualitas setara waktu tetap "aman" dengan energi dan waktu jauh lebih kecil.
- **Pada kondisi ini AI tidak mengubah mutu air dibanding umpan balik saja.** Nilainya ada di ETA, penjadwalan energi, cadangan saat sensor macet, dan peringatan anomali, yang belum diukur terpisah.
- Model dosis: galat prediksi 16,8% vs 23,7% untuk fisika saja (validasi silang). Data latih sintetis, jadi ini membuktikan alur belajar, bukan akurasi di lapangan.
- Dengan irradiansi asli, panel 200 Wp dan baterai 600 Wh sudah menutup 3-5 batch/hari, sehingga PLN hampir tidak terpakai.
- Analisis ukuran (10 hari, 2 pengulangan, jadi angkanya bergeser beberapa persen): pada panel **50-100 Wp**, surya murni tidak andal (9-93% batch lolos, terendah pada 50 Wp, karena batch menunggu daya lalu dibatalkan), sedangkan hibrida umpan balik menjaga 90-100% lolos dengan porsi terbarukan 45-100%. Panel 200 Wp dengan baterai 600 Wh tidak membutuhkan PLN.
- Di sini AI mulai berguna: pada panel kecil AI memperkirakan surya tidak cukup lalu langsung memulai dengan PLN menambal, memangkas waktu tunggu dari ±105-114 menit menjadi ±14-27 menit dan menaikkan batch selesai (mis. 82% → 97% pada 50 Wp, 150 Wh, 3 batch/hari). **Konsekuensinya porsi terbarukan turun** (mis. 49% → 44%). Ini pertukaran kecepatan dan kehijauan, bukan keunggulan gratis.
- **Kalibrasi sensor paling menentukan** (`app.cli sensitivity`, [docs/sensitivity.md](docs/sensitivity.md)): bila skala sensor sebenarnya 0,6× nilai kalibrasi, batch lolos jatuh dari 98% ke 0% pada kendali umpan balik, karena arus berhenti terlalu cepat. Berikutnya laju warna (k_d) dan fraksi warna membandel.
- **Model AI tidak tahan bila simulator salah** (`app.cli robust`): galat 16% pada kondisi latih naik ke 47-102% saat laju warna sebenarnya ×0,5-×2. Latihan pada kondisi acak saja tidak menyelesaikannya. Koreksi per unit dari 5 batch terakhir menjaga galat 23-32% di semua kondisi uji, dan kini terpasang di kontroler (lihat di bawah).
- Paper Fadzli dkk. 2024 (Al, pH 3) menyiratkan kebutuhan muatan bisa ±7× asumsi kami (turunan kami, dengan efisiensi arus 100%). Pada kasus itu unit standar hanya lolos 5%; reaktor 1600 cm² / 35 A lolos 60% dengan 7,8 kWh/m³.
- **Koreksi per unit di kontroler** (40 batch berturut, 2 pengulangan): galat prediksi muatan turun dari 49-81% ke 20-21% saat laju warna ×0,33-×2, dan sedikit memburuk pada kondisi yang sudah tepat (18,0% → 18,6%). Mutu dan energi nyaris tidak berubah, karena arus tetap dihentikan oleh sensor. Manfaatnya pada perkiraan waktu dan rencana energi.
- **Deteksi warna mentok** memberi status jujur dan mencegah proses ulang, tetapi dengan batas waktu 120 menit **hampir tidak menghemat energi** (warna membandel ×6: 127 → 125 menit, 1,8 kWh/m³ tetap).
- Energi simulasi (0,6-1,8 kWh/m³) berada di ujung bawah rentang literatur batik (0,7-20) dan di bawah asumsi desain brief (3-5). Ini tebakan yang harus dikalibrasi.

## Data eksternal

- `web/public/scene/sistem.png`: ilustrasi unit buatan AI (ChatGPT), bukan foto alat asli.

- Irradiansi dan suhu per jam Solo 2024: [NASA POWER](https://power.larc.nasa.gov/), disimpan di `data/external/`. Data satelit/model dengan sel grid ±0,5°, jadi variasi awan lokal bisa lebih buruk; cek dengan BMKG atau PVGIS.
- Sebaran kualitas limbah dan volume: Ariani dkk., UMS 2024 (3 UMKM x 4 sampel), lewat brief.

## Rencana

1. Skrip kalibrasi dari CSV uji bench (6-7 Nov), lalu latih ulang model dari simulator terkalibrasi dan batch nyata.
2. Uji deployment online sungguhan (VM gratis, DuckDNS, Caddy, MQTT TLS) dan verifikasi syarat tier gratis penyedia saat mendaftar.
3. Firmware ESP32 yang mengirim kontrak data yang sama.
4. Tes frontend yang lebih luas; saat ini pemformat angka dan aturan rekomendasi (12 tes), `tools/navcheck.mjs` (klik menu dan opsi simulasi di Chrome), dan pemeriksaan visual manual.

## Keselamatan

Elektrolisis menghasilkan gas hidrogen (ventilasi, jauhkan dari api). Tegangan rendah (≤15 V DC), sarung tangan dan kacamata. Jangan menambah garam dapur berlebihan (risiko gas klorin). Endapan diperlakukan sebagai limbah B3 (PP 22/2021) dan tidak dibuang ke saluran. Panel surya dan baterai LiFePO4 wajib bersekring.

## Lisensi

[MIT](LICENSE). Data NASA POWER dan sumber lain tetap tunduk pada ketentuan masing-masing.
