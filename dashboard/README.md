# dashboard

Website pemantauan SOBAT: dashboard React untuk operator dan DLH, backend FastAPI yang menerima data dari alat atau simulator, serta konfigurasi Docker untuk menjalankan semuanya. Mesin simulasi dan model AI yang dipakai backend ada di [../ML/](../ML/).

| Folder | Isi |
|---|---|
| [web/](web/) | Frontend React, TypeScript, dan Vite |
| [backend/](backend/) | API FastAPI: login, penerimaan data HTTP dan MQTT, riwayat batch, laporan CSV, simulasi live |
| [infra/](infra/) | Dockerfile, Docker Compose, Mosquitto, dan Caddy |
| [scripts/](scripts/) | Skrip demo satu perintah |
| [tools/](tools/) | Simulator unit mandiri, pemeriksa navigasi, dan pengambil tangkapan layar |

## Halaman dashboard

Pantauan menampilkan keadaan unit saat ini, dengan opsi simulasi A (hari cerah), B (hari mendung), C (kondisi sulit), atau Otomatis. Batch berisi riwayat dan rincian tiap batch. Perbandingan punya empat tab: strategi kendali, sumber energi, ukuran panel dan baterai, serta ketahanan asumsi. Rekomendasi disusun dari aturan tetap atas pembacaan unit, tanpa model AI, supaya alasannya bisa ditelusuri. Laporan merangkum batch untuk DLH dan bisa diunduh sebagai CSV. Model AI menampilkan galat model, pengaruh tiap fitur, dan formulir coba prediksi.

Ilustrasi unit di dashboard (`web/public/scene/sistem.png`) dibuat dengan AI dan bukan foto alat.

## Menjalankan di komputer sendiri

Cara termudah memakai Docker: satu perintah menyalakan dashboard, backend, broker MQTT, InfluxDB, dan simulasi live. Tidak perlu Python atau Node di komputer Anda, dan tidak perlu perangkat keras.

Yang perlu disiapkan:

- Docker dengan Compose v2 (`docker compose version` harus berjalan)
- Bash dan Git (Linux, macOS, atau WSL2 di Windows)
- Port 8000, 1883, dan 8086 yang belum dipakai
- Internet saat membangun image pertama kali; setelah itu demo berjalan tanpa internet

```bash
git clone https://github.com/Ajilaca/UNS-Innovation-Hackathon-2026.git
cd UNS-Innovation-Hackathon-2026/dashboard
./scripts/demo-docker.sh
```

Buka http://localhost:8000, lalu masuk dengan `admin` / `demo-batikjernih` atau tombol "Lihat demo" (baca saja). Simulasi langsung berjalan. Model AI dilatih otomatis di latar belakang selama sekitar satu menit, jadi halaman Model AI baru terisi setelah itu.

```bash
./scripts/demo-docker.sh stop     # matikan, data tetap ada
./scripts/demo-docker.sh          # nyalakan lagi
./scripts/demo-docker.sh reset    # matikan dan hapus semua data demo
```

Skrip ini membuat `dashboard/.env` berisi kata sandi acak saat pertama dijalankan. Kata sandi `demo-batikjernih` hanya untuk demo lokal dan tertulis di repositori publik ini, jadi ganti `BJ_ADMIN_PASSWORD` di `.env` sebelum memasang aplikasi di jaringan yang bisa diakses orang lain.

Cara Docker dan tanpa Docker sudah dicoba di Linux dengan Docker 29, Compose 5, Python 3.12, dan Node 24. Windows dan macOS belum dicoba.

### Tanpa Docker

Perlu Python 3.12 dan Node 22 atau lebih baru. Skrip ini membuat virtualenv `.venv` di root repo, memasang dependensi, dan melatih model pada kali pertama (sekitar 2 menit), lalu menjalankan backend dengan simulasi. Riwayatnya disimpan di `/tmp` dan dihapus setiap kali skrip dijalankan. MQTT dan InfluxDB tidak ikut menyala.

```bash
./scripts/demo-offline.sh             # http://localhost:8000, Ctrl+C untuk berhenti
PORT=8011 ./scripts/demo-offline.sh   # bila port 8000 sudah terpakai
```

### Mode pengembangan

Dari root repo:

```bash
python3 -m venv .venv && .venv/bin/pip install -r dashboard/backend/requirements.txt
(cd dashboard/web && npm install && npm run build)
(cd ML && ../.venv/bin/python -m sobat_ml.cli train --n 1200)     # latih model, sekitar 1 menit

cd dashboard/backend
BJ_ADMIN_PASSWORD=sandi BJ_SECRET=rahasia-panjang PYTHONPATH=../../ML \
  ../../.venv/bin/python -m uvicorn app.main:create_app --factory --port 8000
```

Untuk dashboard dengan hot reload, jalankan `cd dashboard/web && npm run dev` di terminal lain (permintaan `/api` diteruskan ke port 8000).

Tes:

```bash
(cd dashboard/backend && ../../.venv/bin/python -m pytest)   # 39 tes API, termasuk perbandingan firmware C++ dengan kontroler Python (perlu g++)
(cd ML && ../.venv/bin/python -m pytest)                      # 36 tes simulasi dan model
(cd dashboard/web && npx tsc --noEmit && npx vitest run)      # 23 tes frontend
node dashboard/tools/navcheck.mjs                             # klik semua menu di Chrome, aplikasi harus sedang berjalan
```

### Server dengan konfigurasi sendiri

Dari folder `dashboard/`, salin `.env.example` menjadi `.env` dan ganti semua nilainya (termasuk teks contoh yang memakai tanda backtick), lalu jalankan:

```bash
C="docker compose --env-file .env -f infra/docker-compose.yml"
set -a; . ./.env; set +a
$C up -d --build mosquitto influxdb
ENV_FILE=.env infra/mosquitto/make-users.sh backend "$MQTT_BACKEND_PASSWORD"
ENV_FILE=.env infra/mosquitto/make-users.sh lwy-001 "sandi-perangkat"    # satu pengguna per unit
$C up -d --build backend
```

Untuk HTTPS dan MQTT TLS tambahkan `-f infra/docker-compose.online.yml` (Caddy dan DuckDNS). Konfigurasi online ini baru divalidasi sintaksnya, belum dicoba di server sungguhan.

Pengaturan backend dibaca dari variabel lingkungan berawalan `BJ_`, lihat [backend/README.md](backend/README.md).

### Masalah yang sering muncul

| Gejala | Penyebab dan solusi |
|---|---|
| `port is already allocated` | Port 8000, 1883, atau 8086 dipakai program lain. Matikan program itu, atau ubah bagian `ports` di `infra/docker-compose.yml`. |
| `permission denied` pada Docker | Pengguna Anda belum masuk grup `docker`. Jalankan `sudo usermod -aG docker $USER`, lalu masuk ulang. |
| Halaman Model AI kosong | Model masih dilatih. Tunggu sekitar satu menit. |
| Angka Perbandingan berbeda dari README | Tombol "Jalankan ulang" menyimpan hasil baru di server, dan hasil itu mengalahkan hasil bawaan. `./scripts/demo-docker.sh reset` mengembalikannya. |
| Riwayat batch kosong | Batch pertama perlu waktu untuk selesai walau simulasi dipercepat. Tunggu beberapa menit. |

## Menyambungkan perangkat

ESP32 mengirim telemetri dan ringkasan batch lewat MQTT dengan bentuk yang sama seperti simulator, sesuai [../docs/data-contract.md](../docs/data-contract.md), jadi backend dan dashboard tidak perlu diubah. Langkah perakitan, pengkabelan, dan kalibrasinya ada di [../firmware/README.md](../firmware/README.md).

Compose bawaan membuka port MQTT hanya untuk komputer itu sendiri. Untuk mencoba ESP32 di jaringan lokal, ubah `127.0.0.1:1883:1883` menjadi `1883:1883` di `infra/docker-compose.yml`. Untuk internet, pakai TLS.
