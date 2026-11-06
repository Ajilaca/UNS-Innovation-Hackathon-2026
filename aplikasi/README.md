# aplikasi

Rencana aplikasi ponsel SOBAT. Belum ada kode di folder ini.

Dashboard web sudah bisa dibuka di ponsel, tetapi perajin dan petugas lapangan butuh alat yang lebih sederhana dan tetap berguna saat sinyal lemah. Aplikasi ini akan memakai backend dan kontrak data yang sama dengan dashboard ([../docs/data-contract.md](../docs/data-contract.md)), jadi tidak perlu server baru.

## Pengguna dan kebutuhan

| Pengguna | Yang dibutuhkan |
|---|---|
| Perajin (operator unit) | Status unit saat ini, perkiraan selesai, tombol mulai dan hentikan batch, pemberitahuan bila batch selesai atau gagal, pengingat membersihkan sensor dan mengambil lumpur |
| Petugas DLH | Daftar unit dan status kepatuhan, riwayat batch per unit, unduh laporan |
| Teknisi | Kalibrasi sensor langkah demi langkah, catatan perawatan, diagnosis galat |

## Fitur yang direncanakan

1. Masuk dengan akun yang sama seperti dashboard (token dari `/api/auth/login`).
2. Layar status: warna air, sisa waktu, sumber energi, dan peringatan.
3. Pemberitahuan dorong saat batch selesai, gagal, atau butuh tindakan. Notifikasi Telegram yang direncanakan di MVP bisa menjadi langkah awal sebelum aplikasi jadi.
4. Riwayat batch dan laporan untuk DLH, tersimpan di ponsel supaya bisa dibuka tanpa sinyal.
5. Panduan kalibrasi sensor yang menggantikan konsol serial firmware.
6. Bahasa Indonesia, tulisan besar, dan alur sesedikit mungkin.

## Pilihan teknologi (belum diputuskan)

- Progressive Web App dari dashboard yang sudah ada: paling cepat dan memakai ulang kode React, tetapi notifikasi dorong di iOS terbatas.
- React Native atau Flutter: notifikasi dan mode offline lebih baik, tetapi butuh basis kode baru.

## Urutan kerja

Aplikasi baru dibangun setelah alat lolos uji bench dan pilot di UMKM berjalan, supaya fiturnya mengikuti kebutuhan perajin yang sebenarnya.
