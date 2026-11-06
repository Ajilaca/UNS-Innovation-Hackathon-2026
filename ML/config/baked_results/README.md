# ML/config/baked_results

Salinan hasil `compare`, `energy`, `sizing`, `sensitivity`, dan `robustness`, supaya demo baru langsung punya isi di halaman Perbandingan.

Backend mencari `ML/results/<jenis>.json` lebih dulu, baru berkas di sini. Setelah menghitung ulang analisis, salin hasilnya dari `ML/results/` ke folder ini, lalu bangun ulang image. Semua angkanya hasil simulasi.
