# dashboard/web/src

| Berkas | Isi |
|---|---|
| `main.tsx`, `App.tsx` | Titik masuk, menu, dan rute hash |
| `api.ts`, `hooks.ts`, `hooks.job.ts` | Panggilan API, polling, dan job latar belakang |
| `types.ts` | Tipe data sesuai kontrak |
| `format.ts` | Format angka, durasi, serta label status dan flag |
| `recommend.ts` | Aturan rekomendasi. Tanpa model dan tanpa angka karangan |
| `styles.css` | Semua gaya |

Label untuk flag dan status baru ditambahkan di `format.ts`, termasuk yang dikirim firmware.

- [components/](components/): komponen bersama
- [views/](views/): satu berkas per halaman
