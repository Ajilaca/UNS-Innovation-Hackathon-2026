# web/src/views

Satu berkas per halaman: `Live.tsx` (Pantauan), `Batches.tsx`, `BatchDetail.tsx`, `Compare.tsx` (Perbandingan), `Rekomendasi.tsx`, `Laporan.tsx`, `Model.tsx`, dan `Login.tsx`.

Kalimat kesimpulan di tab Perbandingan dihitung dari data lewat fungsi seperti `robustVerdict` dan `energyVerdict`, dan diuji di `Compare.test.ts`. Bila hasil simulasi berubah, kalimatnya ikut berubah.
