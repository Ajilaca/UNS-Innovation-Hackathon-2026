# backend

Server API SOBAT dengan Python 3.12 dan FastAPI. Backend menerima data dari alat (MQTT atau HTTP) dan dari simulator, menyimpan riwayat batch, menyajikan dashboard, dan menjalankan simulasi live. Mesin simulasi dan model AI diimpor dari paket `sobat_ml` di [../../ML/](../../ML/), jadi `PYTHONPATH` harus menunjuk ke folder itu.

Jalankan dari folder ini:

```bash
PYTHONPATH=../../ML ../../.venv/bin/python -m uvicorn app.main:create_app --factory --port 8000
../../.venv/bin/python -m pytest      # pytest.ini sudah menambahkan ../../ML ke path
```

Dependensi ada di `requirements.txt`, yang ikut memasang `../../ML/requirements.txt`.

Pengaturan dibaca dari variabel lingkungan berawalan `BJ_`, lihat `app/settings.py` dan `../.env.example`. Bila `BJ_ADMIN_PASSWORD` kosong, backend membuat kata sandi sementara dan mencetaknya di log. Bila `BJ_SECRET` kosong, token login batal setiap restart, jadi isi keduanya di server sungguhan. Database SQLite bawaan ada di `dashboard/data/sobat.sqlite`.

- [app/](app/): kode server
- [tests/](tests/): tes pytest
