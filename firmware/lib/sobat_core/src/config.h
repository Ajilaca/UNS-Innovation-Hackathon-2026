// Parameter unit dan kendali. Nilai bawaan sama dengan ML/config/sim.yaml; dashboard/backend/tests/test_firmware.py
// memeriksa keduanya tidak menyimpang. Nilai bertanda [KALIBRASI] masih tebakan sampai ada uji bench.
#pragma once

namespace sobat {

enum class Mode { Fixed, Feedback, Ai };
enum class Policy { SolarFirst, SolarOnly, GridOnly };

struct Config {
  // unit
  double batch_volume_L = 50;
  double electrode_area_cm2 = 400;
  double gap_cm = 1.5;
  double I_default_A = 5.0;
  double I_max_A = 10.0;
  double U_max_V = 15.0;
  double T_max_C = 45.0;
  double target_color_ptco = 200;
  double t_max_min = 120;
  double wait_max_min = 120;
  double fill_s = 120;
  double settle_min = 30;
  double sample_interval_s = 10;
  double reverse_every_s = 600;
  double battery_wh = 600;
  double battery_min_soc = 0.20;
  double battery_max_discharge_w = 250;
  double dcdc_eff = 0.92;
  double aux_load_w = 18;
  double idle_load_w = 3;
  double min_run_power_w = 35;
  // reaktor
  double overpotential_V = 1.8;              // [KALIBRASI]
  double solution_resistance_scale = 1.0;    // [KALIBRASI]
  double current_eff_Fe = 1.05;              // [KALIBRASI]
  double sludge_hydroxide_factor_Fe = 1.91;
  // sensor
  double abs_sat = 2.3;
  double dilution_ratio = 5;
  // kendali
  double eps_eff_cal = 3.0e-4;               // [KALIBRASI] paling menentukan mutu, lihat docs/sensitivity.md
  double floc_beta_est = 2.0e-4;             // [KALIBRASI]
  double floc_leak_est = 0.30;               // [KALIBRASI]
  double stop_margin = 0.90;
  double guard_frac = 0.5;
  double sat_threshold = 1.8;
  double undilute_below_ptco = 3000;
  int median_window = 3;
  int sample_count = 6;
  double k_phys_per_Cpl = 0.0091;            // [KALIBRASI]
  int max_retries = 1;
  double reverse_rise = 1.4;
  double fixed_q_CperL = 300;
  double anomaly_sigma = 2.5;
  double plateau_dq_CperL = 120;             // 0 = matikan
  double plateau_min_drop = 0.04;
  bool calib_enabled = true;
  int calib_window = 5;
  int calib_min_batches = 3;
  double calib_limit_lo = 0.25;
  double calib_limit_hi = 4.0;
  // PLN
  Policy policy = Policy::SolarFirst;
  double grid_max_wait_min = 120;
  double tariff_rp_per_kwh = 1444;           // [CEK]
  // biaya
  double pv_rp_per_kwh = 600;                // [CEK]
  double electrode_rp_per_kg = 12000;        // [CEK]
  double sludge_rp_per_kg = 3000;            // [CEK]
};

}  // namespace sobat
