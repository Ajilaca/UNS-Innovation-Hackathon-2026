# firmware/host_tests

Uji kontroler firmware tanpa papan. `run.sh` mengompilasi `parity_main.cpp` dengan g++ menjadi `parity`, yang diabaikan git.

```
parity --defaults    cetak nilai bawaan, untuk dibandingkan dengan config/sim.yaml
parity --payload     cetak contoh telemetri dan ringkasan batch
parity < jejak.txt   putar pengamatan dan cetak keputusan
```

Biasanya tidak perlu dijalankan langsung, karena `backend/tests/test_firmware.py` memanggilnya. Tes ini mencakup mode waktu tetap, umpan balik, dan AI, surya murni, sensor macet, warna mentok, jeda surya, dan koreksi per unit.

Yang tidak teruji di sini adalah sensor, aktuator, jaringan, dan pengaman pada papan sungguhan.
