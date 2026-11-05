# backend

Python 3.12 dan FastAPI. Folder ini memuat API, kembaran digital unit, kontroler acuan, dan model AI.

Jalankan semua perintah dari folder ini, karena modulnya bernama `app`:

```bash
../.venv/bin/uvicorn app.main:create_app --factory --port 8000
../.venv/bin/python -m app.cli train --n 1200
../.venv/bin/python -m pytest
```

Pengaturan dibaca dari variabel lingkungan berawalan `BJ_`, lihat `app/settings.py` dan `.env.example` di akar repositori. Bila `BJ_ADMIN_PASSWORD` kosong, backend membuat kata sandi sementara dan mencetaknya di log. Bila `BJ_SECRET` kosong, token login batal setiap restart, jadi isi keduanya di server sungguhan.

- [app/](app/): kode aplikasi
- [tests/](tests/): tes pytest
