# backend/app

| Berkas | Isi |
|---|---|
| `main.py` | Rute API dan penyajian dashboard |
| `settings.py` | Pengaturan server dari variabel `BJ_*` |
| `models.py` | Model Pydantic untuk kontrak data |
| `auth.py` | Login dengan token HMAC, peran admin dan viewer (baca saja), kunci perangkat |
| `hub.py`, `store.py`, `influx.py` | Penerima data, SQLite untuk riwayat, InfluxDB untuk deret waktu |
| `mqtt_bridge.py` | Jembatan MQTT ke hub; menolak payload yang tidak cocok dengan topiknya |
| `live.py` | Simulasi live untuk dashboard, memakai `sobat_ml.runner` |
| `jobs.py` | Job latar belakang: melatih model dan menghitung ulang eksperimen, hasilnya ke `ML/results/` |

Blok `truth` (warna sebenarnya) hanya ada pada data simulasi, dan `hub.py` membuangnya dari data berasal `device`.
