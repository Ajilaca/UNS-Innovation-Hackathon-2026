# backend/app

| Berkas | Isi |
|---|---|
| `main.py` | Rute API dan penyajian dashboard |
| `settings.py`, `config.py` | Pengaturan server dan pemuat `config/sim.yaml` beserta skenario |
| `models.py` | Model Pydantic untuk kontrak data |
| `auth.py` | Login dengan token HMAC, peran admin dan viewer (baca saja), kunci perangkat |
| `hub.py`, `store.py`, `influx.py` | Penerima data, SQLite untuk riwayat, InfluxDB untuk deret waktu |
| `mqtt_bridge.py` | Jembatan MQTT ke hub; menolak payload yang tidak cocok dengan topiknya |
| `control.py` | Kontroler batch. Ini implementasi acuan firmware: bila diubah, `firmware/lib/sebat_core` harus ikut diubah |
| `plant.py`, `physics.py`, `sensors.py`, `solar.py`, `wastewater.py` | Kembaran digital: reaktor, Faraday, sensor, surya dan baterai, limbah |
| `runner.py` | Menjalankan satu unit simulasi dan membuat ringkasan batch |
| `predictor.py` | Model dosis dan koreksi per unit |
| `experiments.py`, `sensitivity.py`, `robustness.py`, `cli.py` | Eksperimen dan antarmuka baris perintah |
| `live.py`, `jobs.py` | Simulasi live dan job latar belakang |

Blok `truth` (warna sebenarnya) hanya ada pada data simulasi, dan `hub.py` membuangnya dari data berasal `device`.
