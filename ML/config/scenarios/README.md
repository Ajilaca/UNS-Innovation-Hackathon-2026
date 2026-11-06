# ML/config/scenarios

Tiap berkas menimpa sebagian `ML/config/sim.yaml`. Pilih dengan `--scenario <nama>` di CLI, atau dari dashboard.

| Skenario | Kondisi |
|---|---|
| `baseline` | Tanpa perubahan |
| `cerah-umkm-kecil` | Limbah ringan, matahari cukup (opsi A) |
| `hibrida-mendung` | Surya kurang, PLN menambal (opsi B) |
| `kondisi-sulit` | Pewarna membandel, limbah pekat, sensor bermasalah (opsi C) |
| `mendung-limbah-pekat` | Mendung dan limbah pekat |
| `surya-murni-mendung` | Mendung tanpa PLN |
| `pln-saja` | Tanpa surya |
| `sensor-kotor-flok` | Sensor terganggu flok |
| `sensor-macet` | Sensor warna macet di tengah batch |
| `elektroda-pasif` | Elektroda mengalami pasivasi |
| `ec-rendah-boros` | Konduktivitas rendah, energi boros |
