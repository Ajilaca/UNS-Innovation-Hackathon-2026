# backend/tests

Ada 39 kasus pytest. Jalankan dari folder `dashboard/backend/` dengan `../../.venv/bin/python -m pytest`.

`test_firmware.py` mengompilasi `firmware/host_tests` dengan g++, memutar pengamatan dari kontroler Python ke versi C++, lalu membandingkan keputusan keduanya di tiap langkah. Tes ini juga memeriksa nilai bawaan firmware sama dengan `ML/config/sim.yaml` dan payload firmware lolos model backend. Bila g++ tidak ada, tes ini dilewati.

Sisanya menguji API, login, MQTT, InfluxDB, koreksi per unit, dan opsi simulasi. Tes mesin simulasi dan model ada di `ML/tests/`.
