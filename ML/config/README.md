# config

| Berkas | Isi |
|---|---|
| `sim.yaml` | Semua parameter unit, reaktor, sensor, surya, kendali, PLN, dan biaya. Tiap nilai berlabel `[DATA]`, `[ESTIMASI]`, `[KALIBRASI]`, atau `[CEK]` |
| `simulations.yaml` | Opsi A, B, C, dan Otomatis di dashboard |

Nilai bawaan firmware (`firmware/lib/sobat_core/src/config.h`) harus sama dengan `sim.yaml`, dan `dashboard/backend/tests/test_firmware.py` memeriksanya. Bila satu diubah, ubah juga yang lain.

- [scenarios/](scenarios/): skenario yang menimpa sebagian parameter
- [baked_results/](baked_results/): hasil analisis yang ikut terpasang di image
