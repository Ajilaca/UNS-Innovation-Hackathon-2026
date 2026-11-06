# firmware/lib/sobat_core/src

| Berkas | Isi |
|---|---|
| `config.h` | Parameter, sama dengan `ML/config/sim.yaml` |
| `controller.h`, `controller.cpp` | Port dari `ML/sobat_ml/control.py`, ditambah `abortBatch()` untuk pengaman perangkat |
| `convert.h`, `convert.cpp` | Absorbansi, pH, EC, kekeruhan, SoC, prakiraan surya, pengaman cepat, pembukuan energi, dan JSON kontrak data |

Bila logika kontroler diubah, ubah juga versi Python. `dashboard/backend/tests/test_firmware.py` gagal bila keduanya berbeda.
