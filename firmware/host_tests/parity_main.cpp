// Pemutar jejak: menerima pengamatan yang direkam dari kontroler Python, lalu mencetak keputusan versi C++.
// Dipanggil oleh backend/tests/test_firmware.py. Tiga perintah:
//   parity --defaults      cetak nilai bawaan Config, untuk dibandingkan dengan config/sim.yaml
//   parity --payload       cetak contoh telemetri dan ringkasan batch, untuk divalidasi model backend
//   parity < jejak.txt     putar jejak
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "controller.h"
#include "convert.h"

using namespace sebat;

static Prediction g_pred;
static bool g_has_pred = false;
static bool predictFromTrace(const double*, Prediction* out, void*) {
  if (!g_has_pred) return false;
  *out = g_pred;
  return true;
}

static void printNum(double v) { if (isnan(v)) printf(" None"); else printf(" %.12g", v); }

static int dumpDefaults() {
  Config c;
#define P(k) printf("%s %.12g\n", #k, (double)c.k)
  P(batch_volume_L); P(electrode_area_cm2); P(gap_cm); P(I_default_A); P(I_max_A); P(U_max_V); P(T_max_C);
  P(target_color_ptco); P(t_max_min); P(wait_max_min); P(fill_s); P(settle_min); P(sample_interval_s); P(reverse_every_s);
  P(battery_wh); P(battery_min_soc); P(battery_max_discharge_w); P(dcdc_eff); P(aux_load_w); P(idle_load_w); P(min_run_power_w);
  P(overpotential_V); P(solution_resistance_scale); P(current_eff_Fe); P(sludge_hydroxide_factor_Fe); P(abs_sat); P(dilution_ratio);
  P(eps_eff_cal); P(floc_beta_est); P(floc_leak_est); P(stop_margin); P(guard_frac); P(sat_threshold); P(undilute_below_ptco);
  P(median_window); P(sample_count); P(k_phys_per_Cpl); P(max_retries); P(reverse_rise); P(fixed_q_CperL); P(anomaly_sigma);
  P(plateau_dq_CperL); P(plateau_min_drop); P(calib_window); P(calib_min_batches); P(calib_limit_lo); P(calib_limit_hi);
  P(grid_max_wait_min); P(tariff_rp_per_kwh); P(pv_rp_per_kwh); P(electrode_rp_per_kg); P(sludge_rp_per_kg);
#undef P
  return 0;
}

// Satu batch sungguhan melalui kontroler, lalu dua JSON: baris 1 telemetri, baris 2 ringkasan, baris 3 ringkasan setelah mati di tengah batch.
static int dumpPayload() {
  Config cfg;
  BatchController c(cfg, Mode::Feedback);
  Ledger led;
  c.begin();
  led.reset();
  Obs o;
  o.abs_r = o.abs_g = o.abs_b = 0.9; o.turb_ntu = 500; o.ec_uScm = 3000; o.ph = 9.5; o.temp_C = 31;
  o.pv_W = 120; o.batt_discharge_W = 250; o.batt_usable_wh = 300;
  static char buf[2600];
  Identity id = {"lwy", "lwy-001", "lwy-001-20261105-01"};
  TelemetryIn t = {1762400000, 50, 0.9, 0.9, 0.9, 500, 3000, 9.5, 31, 5.0, 8.0, 120, 13.1, 0.6, 0, 60, 1};
  bool printed = false;
  for (int i = 0; i < 4000 && c.state() != State::Done && c.state() != State::Fault; i++) {
    Cmd m = c.step(o, 10);
    o.I_A = m.I_set; o.U_V = m.I_set > 0 ? 8 : 0;
    o.abs_r = o.abs_g = o.abs_b = o.abs_g * (m.I_set > 0 ? 0.985 : 1.0) + (i % 7) * 1e-5;
    led.add(cfg, 10, o.U_V * o.I_A, m.mixer, 20, 0);
    if (!printed && c.state() == State::Running && c.q() > 20) {
      if (telemetryJson(buf, sizeof buf, id, t, c, led) < 0) return 2;
      puts(buf);
      printed = true;
    }
  }
  if (batchJson(buf, sizeof buf, id, 1762400000, 1762407000, 50, c, led) < 0) return 3;
  puts(buf);
  if (restartJson(buf, sizeof buf, id, 1762400000, 1762401000, 50, 80.5, 0.12, 900) < 0) return 5;
  puts(buf);
  return printed ? 0 : 4;
}

int main(int argc, char** argv) {
  if (argc > 1 && !strcmp(argv[1], "--defaults")) return dumpDefaults();
  if (argc > 1 && !strcmp(argv[1], "--payload")) return dumpPayload();

  Config cfg;
  BatchController* c = nullptr;
  char word[32];
  while (scanf("%31s", word) == 1) {
    if (!strcmp(word, "config")) {      // config <mode> <policy> <fill_s> <settle_min> <plateau_dq>
      char m[16], p[16];
      if (scanf("%15s %15s %lf %lf %lf", m, p, &cfg.fill_s, &cfg.settle_min, &cfg.plateau_dq_CperL) != 5) return 2;
      cfg.policy = !strcmp(p, "solar_first") ? Policy::SolarFirst : !strcmp(p, "solar_only") ? Policy::SolarOnly : Policy::GridOnly;
      Mode mode = !strcmp(m, "fixed") ? Mode::Fixed : !strcmp(m, "feedback") ? Mode::Feedback : Mode::Ai;
      c = new BatchController(cfg, mode, predictFromTrace, nullptr);
    } else if (!strcmp(word, "begin")) {   // begin <has_pred> <q> <lo> <hi> <sigma>
      int has;
      if (scanf("%d %lf %lf %lf %lf", &has, &g_pred.q, &g_pred.q_lo, &g_pred.q_hi, &g_pred.sigma_ln) != 5) return 2;
      g_has_pred = has != 0;
      c->begin();
    } else if (!strcmp(word, "obs")) {
      Obs o; double dt;
      if (scanf("%lf %lf %lf %lf %lf %lf %lf %lf %lf %lf %lf %lf %lf %lf", &o.abs_r, &o.abs_g, &o.abs_b, &o.turb_ntu, &o.ec_uScm, &o.ph, &o.temp_C,
                &o.I_A, &o.U_V, &o.pv_W, &o.batt_discharge_W, &o.pv_fc_wh, &o.batt_usable_wh, &dt) != 14) return 2;
      Cmd m = c->step(o, dt);
      printf("%s", stateName(c->state()));
      printNum(m.I_set);
      printf(" %d %d %d", m.reverse, m.pump, m.mixer);
      printNum(m.dilute);
      printf(" %d %d", m.done, m.grid_ok);
      printNum(c->q()); printNum(c->kwh()); printNum(c->colorNow()); printNum(c->etaS()); printNum(c->qPred());
      printNum(c->color0()); printNum(c->colorEnd());
      printf(" %d %d %s ", c->retries(), c->reversals(), statusName(c->status()));
      for (int f = 0; f < c->flagCount(); f++) printf("%s%s", f ? "," : "", c->flag(f));
      printf(" .\n");
    } else {
      fprintf(stderr, "kata tak dikenal: %s\n", word);
      return 2;
    }
  }
  return 0;
}
