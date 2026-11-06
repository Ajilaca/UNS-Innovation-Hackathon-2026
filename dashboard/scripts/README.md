# scripts

| Skrip | Isi |
|---|---|
| `demo-docker.sh` | Menyalakan seluruh stack dengan Docker. Argumen `stop` mematikan, `reset` menghapus data. Membuat `dashboard/.env` bila belum ada |
| `demo-offline.sh` | Backend dan simulasi tanpa Docker. Riwayat di `/tmp` dihapus tiap kali dijalankan. `PORT` bisa diganti |

Keduanya bisa dijalankan dari folder mana pun, misalnya `./dashboard/scripts/demo-docker.sh` dari root repo. Penjelasan lengkap ada di [../README.md](../README.md).
