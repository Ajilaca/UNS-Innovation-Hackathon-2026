# sobat_ml

Paket Python mesin simulasi dan model AI. Jalankan dari folder `ML/` dengan `python -m sobat_ml.cli ...`.

| Berkas | Isi |
|---|---|
| `config.py` | Pemuat `config/sim.yaml` beserta skenario, dan lokasi folder `results/` serta `models/` |
| `plant.py`, `physics.py` | Reaktor: kinetika warna, Faraday, tegangan sel, pasivasi, panas |
| `sensors.py` | Sensor dengan noise, drift, saturasi, gelembung, dan gangguan flok |
| `solar.py` | Panel surya (NASA POWER Solo 2024) dan baterai |
| `wastewater.py` | Pembuat limbah acak |
| `control.py` | Kontroler batch. Ini implementasi acuan firmware: bila diubah, `firmware/lib/sobat_core` harus ikut diubah |
| `runner.py` | Menjalankan satu unit simulasi dan membuat ringkasan batch |
| `predictor.py` | Model dosis dan koreksi per unit |
| `experiments.py` | Data latih, pelatihan, perbandingan strategi, kampanye energi, ukuran panel |
| `sensitivity.py`, `robustness.py` | Uji asumsi dan ketahanan model |
| `cli.py` | Antarmuka baris perintah |
