#include "convert.h"

#include <math.h>
#include <stdarg.h>
#include <stdio.h>

namespace sebat {

static inline double clampd(double v, double lo, double hi) { return v < lo ? lo : v > hi ? hi : v; }

double absorbance(double light, double dark, double i0, double abs_sat) {
  double net = light - dark;
  if (net <= 0 || i0 <= 0) return abs_sat;          // tak ada cahaya tembus: sensor jenuh
  return clampd(log10(i0 / net), -0.5, abs_sat);
}

double phFromVolt(const Calibration& c, double v) { return clampd(c.ph_slope * v + c.ph_offset, 0, 14); }

double ecFromVolt(const Calibration& c, double v, double temp_C) {
  double f = 1 + 0.02 * (temp_C - 25);
  return clampd(c.ec_per_volt * v / (f > 0.1 ? f : 0.1), 0, 100000);
}

double turbFromVolt(const Calibration& c, double v) { return clampd(c.turb_slope * v + c.turb_offset, 0, 3000); }

double socFromVoltage(double v) {
  // kurva tegangan istirahat LiFePO4 4 sel [CEK dengan baterai yang dipakai]
  static const double V[] = {10.0, 12.0, 12.8, 12.9, 13.0, 13.1, 13.2, 13.3, 13.4, 13.6};
  static const double S[] = {0.00, 0.09, 0.14, 0.17, 0.20, 0.30, 0.40, 0.70, 0.90, 1.00};
  const int n = sizeof(V) / sizeof(V[0]);
  if (v <= V[0]) return 0;
  if (v >= V[n - 1]) return 1;
  for (int i = 1; i < n; i++)
    if (v <= V[i]) return S[i - 1] + (S[i] - S[i - 1]) * (v - V[i - 1]) / (V[i] - V[i - 1]);
  return 1;
}

double pvForecastWh(double pv_W, double hour_of_day, double horizon_min, double last_sun_hour) {
  double hours = clampd(last_sun_hour - hour_of_day, 0, horizon_min / 60.0);
  return (pv_W > 0 ? pv_W : 0) * hours;
}

bool Safety::check(const Config& c, const SafetyIn& in, Status* status, const char** flag) {
  over_u_ = in.running && in.U_V > c.U_max_V ? over_u_ + 1 : 0;
  over_i_ = in.running && in.I_A > 1.2 * c.I_max_A ? over_i_ + 1 : 0;
  over_t_ = in.temp_C > c.T_max_C + 5 ? over_t_ + 1 : 0;   // kontroler berhenti di T_max; ini lapis kedua
  low_level_ = in.running && in.level_low ? low_level_ + 1 : 0;
  if (over_u_ >= 3) { *status = Status::GagalPengamanListrik; *flag = "TEGANGAN_LEBIH"; return true; }
  if (over_i_ >= 3) { *status = Status::GagalPengamanListrik; *flag = "ARUS_LEBIH"; return true; }
  if (over_t_ >= 3) { *status = Status::GagalPengamanSuhu; *flag = "SUHU_LEBIH"; return true; }
  if (low_level_ >= 3) { *status = Status::GagalLevel; *flag = "LEVEL_RENDAH"; return true; }
  return false;
}

void Ledger::reset() { pv_wh_ = batt_wh_ = grid_wh_ = total_s_ = load_w_ = 0; }

void Ledger::add(const Config& c, double dt, double cell_W, bool aux_on, double batt_W, double grid_W) {
  double load = cell_W / c.dcdc_eff + c.idle_load_w + (aux_on ? c.aux_load_w : 0);
  double b = batt_W > 0 ? batt_W : 0, g = grid_W > 0 ? grid_W : 0;
  if (b + g > load) load = b + g;                   // yang terukur lebih dipercaya daripada perkiraan beban
  double from_pv = load - b - g;
  pv_wh_ += from_pv * dt / 3600;
  batt_wh_ += b * dt / 3600;
  grid_wh_ += g * dt / 3600;
  total_s_ += dt;
  load_w_ = load;
}

double Ledger::pctRenewable() const {
  double t = kwhTotal();
  return t > 1e-9 ? 100 * (kwhPv() + kwhBatt()) / t : 100;
}

const char* modeName(Mode m) { return m == Mode::Fixed ? "fixed" : m == Mode::Feedback ? "feedback" : "ai"; }

const char* policyName(Policy p) {
  return p == Policy::SolarFirst ? "solar_first" : p == Policy::SolarOnly ? "solar_only" : "grid_only";
}

const char* energySource(const Ledger& e, double batt_W, double grid_W) {
  double load = e.loadW();
  if (load <= 1) return "-";
  if (grid_W > 1) return grid_W >= 0.9 * load ? "pln" : "campuran";
  double pv = load - (batt_W > 0 ? batt_W : 0);
  return pv >= 0.9 * load ? "surya" : pv < 1 ? "baterai" : "campuran";
}

// ---- JSON ------------------------------------------------------------------
namespace {
class J {
 public:
  J(char* out, int cap) : o_(out), cap_(cap) { raw("{"); }
  void raw(const char* s) { put("%s", s); }
  void put(const char* fmt, ...) {
    if (n_ < 0) return;
    va_list a;
    va_start(a, fmt);
    int w = vsnprintf(o_ + n_, cap_ - n_, fmt, a);
    va_end(a);
    n_ = (w < 0 || w >= cap_ - n_) ? -1 : n_ + w;
  }
  void key(const char* k) { if (!first_) raw(","); first_ = false; put("\"%s\":", k); }
  void str(const char* k, const char* v) { key(k); put("\"%s\"", v); }
  void num(const char* k, double v, int dec) { key(k); if (isnan(v) || isinf(v)) raw("null"); else put("%.*f", dec, v); }
  void i(const char* k, long v) { key(k); put("%ld", v); }
  void flags(const BatchController& c) {
    key("flags");
    raw("[");
    for (int f = 0; f < c.flagCount(); f++) put("%s\"%s\"", f ? "," : "", c.flag(f));
    raw("]");
  }
  int end() { raw("}"); return n_; }
 private:
  char* o_;
  int cap_, n_ = 0;
  bool first_ = true;
};
}  // namespace

int telemetryJson(char* out, int cap, const Identity& id, const TelemetryIn& t, const BatchController& c, const Ledger& e) {
  J j(out, cap);
  j.i("ts", t.ts);
  j.str("source", "device");       // perangkat asli selalu "device", tak bisa diubah dari luar
  j.str("site_id", id.site_id);
  j.str("unit_id", id.unit_id);
  j.str("batch_id", id.batch_id);
  j.str("state", stateName(c.state()));
  j.str("mode", modeName(c.mode()));
  j.num("V_L", t.V_L, 1);
  j.num("I_A", t.I_A, 3);
  j.num("U_V", t.U_V, 2);
  j.num("abs_r", t.abs_r, 4);
  j.num("abs_g", t.abs_g, 4);
  j.num("abs_b", t.abs_b, 4);
  j.num("turb_ntu", t.turb_ntu, 1);
  j.num("ec_uScm", t.ec_uScm, 0);
  j.num("ph", t.ph, 2);
  j.num("temp_C", t.temp_C, 1);
  j.num("pv_W", t.pv_W, 1);
  j.num("bat_V", t.bat_V, 2);
  j.num("bat_soc", t.bat_soc, 3);
  j.num("grid_W", t.grid_W, 1);
  j.num("load_W", t.load_W, 1);
  j.str("energy_source", energySource(e, t.load_W - t.pv_W - t.grid_W, t.grid_W));
  j.num("q_CperL", c.q(), 2);
  j.num("kwh", c.kwh(), 4);
  j.num("color_est_ptco", c.colorNow(), 1);
  j.num("target_ptco", c.config().target_color_ptco, 0);
  j.num("eta_s", c.etaS(), 0);
  j.num("q_pred", c.qPred(), 1);
  j.i("polarity", t.polarity);
  j.num("dilution", c.dilution(), 0);
  j.flags(c);
  return j.end();
}

int batchJson(char* out, int cap, const Identity& id, long ts_start, long ts_end, double V_L, const BatchController& c, const Ledger& e) {
  const Config& k = c.config();
  double V_m3 = V_L / 1000.0;
  // Muatan terukur + Faraday. Besi dan lumpur adalah perkiraan, belum ditimbang; lumpur belum menghitung TSS limbah.
  double fe_g = k.current_eff_Fe * c.q() * V_L * 55.845 / (2 * 96485.0);
  double sludge_kg = fe_g * k.sludge_hydroxide_factor_Fe / 1000.0;
  double elec_rp = (e.kwhPv() + e.kwhBatt()) * k.pv_rp_per_kwh + e.kwhGrid() * k.tariff_rp_per_kwh;
  double cost_rp = elec_rp + fe_g / 1000 * k.electrode_rp_per_kg + sludge_kg * k.sludge_rp_per_kg;
  J j(out, cap);
  j.str("batch_id", id.batch_id);
  j.str("unit_id", id.unit_id);
  j.str("site_id", id.site_id);
  j.str("source", "device");
  j.str("mode", modeName(c.mode()));
  j.i("ts_start", ts_start);
  j.i("ts_end", ts_end);
  j.num("V_L", V_L, 1);
  j.str("status", statusName(c.status()));
  j.flags(c);
  j.num("run_s", c.runS(), 0);
  j.num("total_s", e.totalS(), 0);
  j.num("q_CperL", c.q(), 2);
  j.num("q_pred", c.qPred(), 1);
  j.num("q_pred_raw", c.qPredRaw(), 1);
  j.num("calib_factor", c.calibFactor(), 3);
  j.num("kwh", c.kwh(), 4);
  j.num("kwh_total", e.kwhTotal(), 4);
  j.num("kwh_per_m3", V_m3 > 0 ? c.kwh() / V_m3 : NAN, 3);
  j.num("kwh_pv", e.kwhPv(), 4);
  j.num("kwh_batt", e.kwhBatt(), 4);
  j.num("kwh_grid", e.kwhGrid(), 4);
  j.num("pct_renewable", e.pctRenewable(), 1);
  j.str("policy", policyName(k.policy));
  j.num("electricity_rp", elec_rp, 0);
  j.num("wait_s", c.waitS(), 0);
  j.num("electrode_g", fe_g, 2);
  j.num("sludge_kg", sludge_kg, 3);
  j.i("reversals", c.reversals());
  j.i("retries", c.retries());
  j.num("color0_est", c.color0(), 1);
  j.num("color_end_est", c.colorEnd(), 1);
  j.num("target_ptco", k.target_color_ptco, 0);
  j.num("cost_rp", cost_rp, 0);
  j.num("cost_rp_per_m3", V_m3 > 0 ? cost_rp / V_m3 : NAN, 0);
  j.num("ph_in", c.ph0(), 2);
  j.num("ec_in", c.ec0(), 0);
  j.key("features");
  if (c.hasFeatures()) {
    j.raw("[");
    for (int f = 0; f < 8; f++) j.put("%s%.5f", f ? "," : "", c.features()[f]);
    j.raw("]");
  } else {
    j.raw("null");
  }
  return j.end();
}

int restartJson(char* out, int cap, const Identity& id, long ts_start, long ts_end, double V_L, double q, double kwh, double run_s) {
  J j(out, cap);
  j.str("batch_id", id.batch_id);
  j.str("unit_id", id.unit_id);
  j.str("site_id", id.site_id);
  j.str("source", "device");
  j.i("ts_start", ts_start);
  j.i("ts_end", ts_end);
  j.num("V_L", V_L, 1);
  j.str("status", "GAGAL_TANPA_DAYA");
  j.key("flags");
  j.raw("[\"RESTART_TENGAH_BATCH\"]");
  j.num("run_s", run_s, 0);
  j.num("total_s", run_s, 0);
  j.num("q_CperL", q, 2);
  j.num("kwh", kwh, 4);
  j.num("kwh_total", kwh, 4);
  j.num("kwh_per_m3", V_L > 0 ? kwh / (V_L / 1000) : NAN, 3);
  j.num("kwh_pv", 0, 0);
  j.num("kwh_batt", 0, 0);
  j.num("kwh_grid", 0, 0);
  j.num("pct_renewable", NAN, 0);      // tak bisa diketahui: pembukuan hilang saat perangkat mati
  j.i("reversals", 0);
  j.i("retries", 0);
  j.num("electrode_g", 0, 0);
  j.num("sludge_kg", 0, 0);
  j.num("cost_rp", 0, 0);
  j.num("cost_rp_per_m3", 0, 0);
  return j.end();
}

}  // namespace sebat
