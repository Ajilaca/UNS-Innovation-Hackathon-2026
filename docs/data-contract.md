# Kontrak data SOBAT (v1.1, draf untuk disetujui tim)

Semua yang menghasilkan telemetri (firmware ESP32 **dan** simulator) harus mengirim persis bentuk ini. Backend dan frontend tidak boleh peduli sumbernya. Ubah file ini hanya atas kesepakatan tim dan naikkan versinya; firmware, simulator, dan backend diperbarui bersamaan.

## MQTT

- Telemetri: `sobat/{site_id}/{unit_id}/telemetry` (QoS 1, tiap 10 detik saat batch aktif)
- Ringkasan batch: `sobat/{site_id}/{unit_id}/batch` (QoS 1, sekali di akhir batch)
- Status perangkat: `sobat/{site_id}/{unit_id}/status` (retained; `{"online": true, "fw": "0.1.0", "rssi": -61}`)
- Satu pengguna MQTT per perangkat, TLS wajib di internet.

## Payload telemetri

```json
{
  "ts": 1762400000, "source": "device", "site_id": "lwy", "unit_id": "lwy-001",
  "batch_id": "lwy-001-20261204-03", "state": "RUNNING",
  "V_L": 50.0, "I_A": 5.02, "U_V": 11.8,
  "abs_r": 0.412, "abs_g": 0.655, "abs_b": 0.301,
  "turb_ntu": 85.3, "ec_uScm": 3150, "ph": 9.6, "temp_C": 31.4,
  "pv_W": 142.0, "bat_V": 13.1
}
```

| Field | Tipe | Satuan | Wajib | Catatan |
|---|---|---|---|---|
| `ts` | int | detik Unix (UTC) | ya | NTP di perangkat; jam simulasi di simulator |
| `source` | string | | **ya** | `"device"` untuk perangkat asli, `"simulator"` untuk simulasi. Agar data simulasi tidak pernah tertukar dengan data asli |
| `site_id`, `unit_id`, `batch_id` | string | | ya | Sama dengan topik |
| `state` | string | | ya | `FILLING SAMPLING WAITING_SOLAR RUNNING PAUSED_SOLAR SETTLING DONE FAULT` |
| `V_L` | number | liter | ya | Volume terisi |
| `I_A`, `U_V` | number | A, V | ya | Arus dan tegangan sel terukur (INA226) |
| `abs_r`, `abs_g`, `abs_b` | number | absorbansi | ya | Tiga panjang gelombang LED. `dilution` > 1 berarti sampel diencerkan |
| `turb_ntu`, `ec_uScm`, `ph`, `temp_C` | number | NTU, µS/cm, -, °C | ya | |
| `pv_W`, `bat_V` | number | W, V | ya | |

Field opsional yang dipakai dashboard (boleh dihitung di ESP32): `bat_soc`, `grid_W`, `load_W`, `energy_source` (`surya|baterai|pln|campuran|-`), `q_CperL`, `kwh`, `color_est_ptco`, `target_ptco`, `eta_s`, `q_pred`, `polarity`, `dilution`, `flags` (daftar string), `mode`.

Batas wajar yang divalidasi backend (di luar itu ditolak 422): `ph` 0-14, `temp_C` -10..120, `I_A` 0..60, `U_V` 0..60, `abs_*` -0.5..5, `turb_ntu` 0..10000, `ec_uScm` 0..100000.

## Ringkasan batch

Berisi: `batch_id, unit_id, site_id, source, mode, ts_start, ts_end, V_L, status, flags, run_s, total_s, q_CperL, q_pred, kwh, kwh_total, kwh_per_m3, kwh_pv, kwh_batt, kwh_grid, pct_renewable, policy, electricity_rp, wait_s, electrode_g, sludge_kg, reversals, retries, color0_est, color_end_est, target_ptco, cost_rp, cost_rp_per_m3, ph_in, ec_in, features`.

Field opsional: `q_pred_raw` (prediksi sebelum koreksi per unit), `calib_factor`, `scenario` (hanya simulasi).

`status`: `LOLOS`, `GAGAL_WARNA`, `GAGAL_WARNA_MENTOK`, `GAGAL_WAKTU`, `GAGAL_SENSOR`, `GAGAL_TANPA_DAYA`, `GAGAL_PENGAMAN_SUHU`, `SELESAI_TANPA_VERIFIKASI`. Khusus perangkat (v1.1): `GAGAL_PENGAMAN_LISTRIK` (tegangan atau arus lebih, arus tak terbaca, arus tak mengalir), `GAGAL_LEVEL` (tangki tak terisi atau elektroda tak terendam).

Blok `truth` (warna, COD, dan jenis pewarna sebenarnya) **hanya boleh ada bila `source = "simulator"`**. Backend membuangnya dari data berasal `device`.

## Aturan perubahan

Perubahan field = naikkan versi di judul + catat di commit. Menambah field opsional tidak memutus kompatibilitas; mengubah satuan atau menghapus field wajib memutusnya.

Riwayat: v1.1 menambah dua status khusus perangkat dan ringkasan batch terputus (`status` `GAGAL_TANPA_DAYA`, flag `RESTART_TENGAH_BATCH`, tanpa rincian energi per sumber karena pembukuannya hilang saat perangkat mati). Perkiraan `electrode_g` dan `sludge_kg` dari perangkat dihitung dengan hukum Faraday dari muatan terukur, belum ditimbang, dan lumpurnya belum menghitung TSS limbah.
