# ML

Mesin simulasi dan model AI SOBAT. Folder ini berisi kembaran digital unit (reaktor, sensor, surya, baterai, limbah), kontroler acuan yang juga menjadi acuan firmware, model prediksi dosis, eksperimen, beserta parameter dan datanya. Backend dashboard mengimpor paket `sobat_ml` dari sini.

| Folder | Isi |
|---|---|
| [sobat_ml/](sobat_ml/) | Kode Python: kembaran digital, kontroler, model AI, eksperimen, dan CLI |
| [config/](config/) | `sim.yaml` (semua parameter), skenario, opsi simulasi dashboard, dan hasil bawaan |
| [data/](data/) | Data asli: irradiansi dan suhu Solo 2024 dari NASA POWER |
| [tests/](tests/) | Tes pytest untuk fisika, reaktor, kontroler, model, surya, dan ketahanan |
| `models/` | Model hasil latih (dibuat ulang, tidak di-commit) |
| `results/` | Hasil eksperimen terbaru (dibuat ulang, tidak di-commit) |

## Menjalankan

Dari folder ini, dengan virtualenv di root repo:

```bash
../.venv/bin/pip install -r requirements.txt
../.venv/bin/python -m sobat_ml.cli train --n 1200      # latih model dosis, sekitar 1 menit
../.venv/bin/python -m sobat_ml.cli compare --n 100     # bandingkan strategi kendali
../.venv/bin/python -m sobat_ml.cli energy              # kampanye multi-hari, tiga kebijakan energi
../.venv/bin/python -m sobat_ml.cli sizing              # ukuran panel dan baterai
../.venv/bin/python -m sobat_ml.cli sensitivity         # asumsi mana yang paling berbahaya
../.venv/bin/python -m sobat_ml.cli robust              # ketahanan model bila simulator salah
../.venv/bin/python -m sobat_ml.cli batch --mode ai --scenario cerah-umkm-kecil
../.venv/bin/python -m pytest                           # 36 tes
```

Hasil eksperimen ditulis ke `results/*.json`, dan dashboard memakainya menggantikan hasil bawaan. Salin ke `config/baked_results/` supaya ikut terpasang di image Docker.

## Pembuatan data

Data latih berasal dari simulator, bukan dari lab. Untuk setiap batch, simulator membuat satu limbah acak:

- COD dari sebaran lognormal dengan median 2.500 mg/L, dibatasi pada rentang data UMS 2024 (409 sampai 11.545 mg/L); pH 8,4 sampai 10,8; konduktivitas sekitar 3.000 µS/cm; suhu sekitar 31 °C.
- Warna dihitung dari COD (0,9 Pt-Co per mg/L, dengan variasi) dan kekeruhan dari TSS. Kedua rasio ini tebakan tim.
- Jenis pewarna dipilih acak dari remazol merah, naftol biru, indigosol hijau, dan campuran cokelat. Tiap jenis punya laju hilang warna dan pola serapan cahaya merah, hijau, dan biru sendiri.

Warna turun eksponensial terhadap dosis besi, yang dihitung dari arus dengan hukum Faraday. Laju reaksi dipengaruhi kepekatan, pH, dan suhu, ditambah variasi acak 20% antar batch. Simulator juga menghitung tegangan sel, pasivasi elektroda, dan panas.

Sensor simulasi tidak membaca nilai sebenarnya. Ada noise, drift antar batch, saturasi pada limbah pekat, lonjakan dari gelembung gas, dan gangguan flok. Kontroler hanya melihat bacaan sensor ini, sama seperti alat asli.

Setiap parameter di `config/sim.yaml` berlabel `[DATA]` bila ada sumbernya, `[ESTIMASI]` bila tebakan tim, dan `[KALIBRASI]` bila wajib diganti setelah uji bench.

## Pelabelan

Label model adalah muatan listrik per liter (C/L) yang dipakai sampai sensor menyatakan warna lolos, dari batch kendali umpan balik saat cuaca cerah. Hanya batch berstatus lolos yang dipakai (461 batch pada model saat ini). Label sengaja diambil dari keputusan sensor, bukan dari nilai sebenarnya di simulator, supaya bentuk datanya sama dengan yang nanti dicatat alat asli.

Telemetri punya field `source` (`simulator` atau `device`) supaya data simulasi tidak tertukar dengan data alat. Batch simulasi membawa blok `truth` (warna akhir sebenarnya, COD, jenis pewarna) untuk menilai kontroler; blok ini tidak dikirim alat asli dan tidak dipakai sebagai label.

## Model AI

Gradient boosting (scikit-learn, 150 pohon, kedalaman 3, learning rate 0,07) yang mempelajari koreksi terhadap rumus fisika:

- q_fisika = ln(warna awal / (0,9 × target)) / k, dengan k = 0,0091 per C/L
- model mempelajari ln(q_teramati / q_fisika), dan prediksinya q = q_fisika × koreksi

Delapan masukan, semuanya dari kondisi awal sebelum arus dinyalakan:

| Fitur | Isi | Bobot kepentingan |
|---|---|---|
| `r_rel` | Serapan kanal merah dibagi rata-rata tiga kanal | 27,6% |
| `ln_ratio` | ln(warna awal / target) | 16,0% |
| `b_rel` | Serapan kanal biru dibagi rata-rata tiga kanal | 14,6% |
| `ln_c0` | ln(warna awal) | 13,2% |
| `ph` | pH | 11,3% |
| `ln_turb` | ln(1 + kekeruhan NTU) | 6,5% |
| `temp` | Suhu | 5,6% |
| `ec_k` | Konduktivitas (mS/cm) | 5,2% |

Dua model kuantil (10% dan 90%) memberi rentang ketidakpastian. Validasi silang 5 lipatan memberi galat 17,4%, dibanding 26,7% untuk rumus fisika saja, dengan R² 0,47 pada skala log.

Koreksi per unit mengalikan prediksi dengan rata-rata galat lima batch terverifikasi terakhir unit itu (mulai setelah tiga batch, dibatasi 0,25 sampai 4 kali).

Prediksi dipakai untuk perkiraan waktu, penjadwalan energi surya, pengaman (sinyal berhenti diabaikan sebelum muatan mencapai separuh prediksi), titik berhenti cadangan bila sensor macet, dan peringatan anomali (penyimpangan lebih dari 2,5 sigma). Keputusan berhenti tetap dari sensor warna.

Batasnya: model hanya dilatih dari data sintetis. Bila laju reaksi sebenarnya 0,5 sampai 2 kali asumsi simulator, galatnya naik ke 47 sampai 102%; koreksi per unit menekannya ke sekitar 20%. Di ESP32 mode AI baru memakai rumus fisika, karena model ini berjalan di server.

## Hasil simulasi

Angka ini bukan hasil eksperimen. Kondisi dasar, 100 batch acak, irradiansi Solo asli:

| Strategi | Lolos 200 Pt-Co | Energi (kWh/m³) | Waktu proses |
|---|---|---|---|
| Waktu tetap, disetel rata-rata | 59% | 0,88 | 61 menit |
| Waktu tetap, disetel aman (P90) | 89% | 1,49 | 104 menit |
| Umpan balik sensor | 95% | 0,99 | 68 menit |
| AI (prediksi dan umpan balik) | 95% | 0,99 | 68 menit |

Umpan balik sensor adalah sumber keunggulan utama: mutunya lebih tinggi dari waktu tetap yang disetel aman, dengan energi dan waktu jauh lebih kecil. Pada kondisi ini AI tidak mengubah mutu air.

Dengan irradiansi asli, panel 200 Wp dan baterai 600 Wh menjalankan 3 sampai 5 batch per hari tanpa PLN. Pada panel 50 sampai 100 Wp surya murni tidak andal (9 sampai 93% batch lolos), sedangkan hibrida umpan balik menjaga 90 sampai 100% lolos. Pada 50 Wp, 150 Wh, 3 batch per hari, AI menurunkan waktu tunggu dari 114 menjadi 27 menit dan menaikkan batch selesai dari 82% menjadi 97%, dengan konsekuensi porsi terbarukan turun dari 49% menjadi 44% dan batch lolos dari 96% menjadi 93%.

Kalibrasi sensor paling menentukan ([../docs/sensitivity.md](../docs/sensitivity.md)): bila skala sensor sebenarnya 0,6 kali nilai kalibrasi, batch lolos jatuh dari 98% ke 0% pada kendali umpan balik. Berikutnya laju warna (`k_d`) dan fraksi warna membandel.

Paper Fadzli dkk. 2024 (elektroda Al, pH 3) menyiratkan kebutuhan muatan bisa sekitar 7 kali asumsi kami. Pada kasus itu unit standar hanya lolos 5%, sedangkan reaktor 1600 cm² dengan 35 A lolos 60% pada 7,8 kWh/m³.

Energi simulasi (0,6 sampai 1,8 kWh/m³) berada di ujung bawah rentang literatur limbah batik (0,7 sampai 20) dan di bawah asumsi desain (3 sampai 5). Ini tebakan yang harus dikalibrasi.

## Setelah uji bench

Parameter yang wajib diganti dengan hasil ukur: `reactor.k_d_Fe`, `sensor.eps_scale`, `control.eps_eff_cal`, `wastewater.color_per_cod`, dan `reactor.overpotential_V`. Setelah itu hitung ulang semua eksperimen dan latih ulang model. Begitu ada batch nyata, model dilatih dari data itu dengan fitur dan label yang sama.

## Data eksternal

Irradiansi dan suhu per jam Solo 2024 berasal dari [NASA POWER](https://power.larc.nasa.gov/) dan disimpan di `data/external/`. Data ini berbasis satelit dan model dengan sel grid sekitar 0,5 derajat, jadi variasi awan lokal bisa lebih buruk; cek dengan BMKG atau PVGIS. Sebaran kualitas limbah dan volume berasal dari Ariani dkk., UMS 2024 (3 UMKM, 4 sampel).
