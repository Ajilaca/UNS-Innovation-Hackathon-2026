# tools

| Alat | Isi |
|---|---|
| `sim_unit.py` | Simulator sebagai klien mandiri: mengirim kontrak data yang sama dengan ESP32, lewat MQTT atau HTTP, atau mencetaknya |
| `navcheck.mjs` | Mengklik semua menu dan opsi simulasi di Chrome tanpa memuat ulang, dan gagal bila ada galat |
| `shots.mjs` | Tangkapan layar dashboard pada beberapa lebar, tanpa dependensi |
| `demo-gif.mjs` | Merekam demo dashboard menjadi `docs/demo.gif`: Chrome menelusuri halaman, ffmpeg menyusun GIF. Butuh ffmpeg dan aplikasi yang sedang berjalan |

```bash
# dari root repo
.venv/bin/python dashboard/tools/sim_unit.py --scenario cerah-umkm-kecil --mode ai --dry-run
.venv/bin/python dashboard/tools/sim_unit.py --mqtt-host localhost --mqtt-user lwy-001 --mqtt-password sandi --speed 120
node dashboard/tools/navcheck.mjs http://localhost:8000 demo-batikjernih
```

`navcheck.mjs` butuh Node 22 atau lebih baru, Chrome, dan aplikasi yang sedang berjalan.
