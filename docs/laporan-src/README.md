# docs/laporan-src

Sumber `docs/laporan.pdf`. Ubah `template.html`, ambil ulang `pantauan.png` bila tampilan berubah, lalu jalankan `./build.sh`.

```bash
node ../../dashboard/tools/shots.mjs --url http://localhost:8000 --token "<token admin>" --out /tmp/pantauan --routes "#/" --widths 1440 --height 900 --wait 3500
cp /tmp/pantauan/1440-_.png pantauan.png
./build.sh
```

`build.sh` butuh Google Chrome dan font dari `dashboard/web/node_modules` (jalankan `npm install` di `dashboard/web/`). Diagram batang dibuat dari angka di `docs/sensitivity.md`, yang ditulis langsung di `build.sh`; ubah di sana bila analisis sensitivitas dihitung ulang.
