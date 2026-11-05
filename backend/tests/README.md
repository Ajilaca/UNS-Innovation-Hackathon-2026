# backend/tests

Ada 75 kasus pytest. Jalankan dari folder `backend/` dengan `../.venv/bin/python -m pytest`.

`test_firmware.py` mengompilasi `firmware/host_tests` dengan g++, memutar pengamatan dari kontroler Python ke versi C++, lalu membandingkan keputusan keduanya di tiap langkah. Tes ini juga memeriksa nilai bawaan firmware sama dengan `config/sim.yaml` dan payload firmware lolos model backend. Bila g++ tidak ada, tes ini dilewati.

Sisanya menguji API, kontroler, fisika, reaktor, prediktor, ketahanan, surya, koreksi per unit, dan opsi simulasi.
