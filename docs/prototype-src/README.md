# docs/prototype-src

Sumber `docs/prototype.pdf`: dokumen prototipe SOBAT (tujuan riset, hasil uji bench skala gelas, alur kerja sistem, dashboard, keterbatasan, dan kesimpulan).

```bash
./build.sh     # butuh Google Chrome, Python 3, dan npm install di dashboard/web/ (untuk font)
```

`template.html` berisi teks dan tabel. `build.sh` membuat grafik kalibrasi dari Tabel 2, lalu mencetak PDF dengan Chrome. `img/` berisi salinan foto uji bench (01-20) dan tangkapan layar dashboard yang sudah diperkecil; berkas aslinya disimpan di luar repo.
