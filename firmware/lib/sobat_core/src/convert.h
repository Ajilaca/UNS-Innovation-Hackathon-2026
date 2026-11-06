// Konversi pembacaan mentah ke satuan kontrak data, pengaman, dan pembukuan energi. Tanpa perangkat keras.
#pragma once
#include "controller.h"

namespace sobat {

/** Absorbansi dari cahaya tembus, dengan cahaya air bersih (i0) dan gelap sebagai acuan. Beer-Lambert. */
double absorbance(double light, double dark, double i0, double abs_sat);

/** Kalibrasi sensor. Semua nilai bawaan kosong: perangkat tidak boleh mengarang angka. */
struct Calibration {
  double i0_r = 0, i0_g = 0, i0_b = 0;     // cahaya tembus air bersih, dikurangi gelap
  long i0_ts = 0;                          // kapan terakhir dinolkan (detik Unix, 0 = tidak diketahui)
  double eps_eff = 0;                      // absorbansi rata-rata per Pt-Co, dari uji bench
  double ph_slope = 0, ph_offset = 0;      // pH = slope * volt + offset
  double ec_per_volt = 0;                  // uS/cm per volt pada 25 C
  double turb_slope = 0, turb_offset = 0;  // NTU = slope * volt + offset
  bool opticalOk() const { return i0_r > 0 && i0_g > 0 && i0_b > 0; }
  bool colorOk() const { return opticalOk() && eps_eff > 0; }
  bool probesOk() const { return ph_slope != 0 && ec_per_volt > 0 && turb_slope != 0; }
};

double phFromVolt(const Calibration& c, double v);
/** Konduktivitas setara 25 C, sama dengan yang dipakai kontroler. */
double ecFromVolt(const Calibration& c, double v, double temp_C);
double turbFromVolt(const Calibration& c, double v);

/** Perkiraan kasar SoC LiFePO4 12,8 V dari tegangan. Hanya berarti saat beban kecil. */
double socFromVoltage(double v);

/** Perkiraan energi surya: daya sekarang bertahan sampai cakrawala atau sampai matahari turun. Tanpa data cuaca. */
double pvForecastWh(double pv_W, double hour_of_day, double horizon_min, double last_sun_hour = 17.0);

struct SafetyIn { double U_V, I_A, temp_C; bool level_low; bool running; };

/** Pengaman cepat, dipanggil beberapa kali per detik. Tiga pelanggaran berturut baru dianggap nyata. */
class Safety {
 public:
  /** true bila batch harus dihentikan; status dan flag terisi. */
  bool check(const Config& c, const SafetyIn& in, Status* status, const char** flag);
 private:
  int over_u_ = 0, over_i_ = 0, over_t_ = 0, low_level_ = 0;
};

/** Pembukuan energi per sumber selama satu batch. */
class Ledger {
 public:
  void reset();
  /** cell_W daya sel; batt_W dan grid_W terukur, positif berarti memberi daya ke beban. */
  void add(const Config& c, double dt, double cell_W, bool aux_on, double batt_W, double grid_W);
  double kwhPv() const { return pv_wh_ / 1000; }
  double kwhBatt() const { return batt_wh_ / 1000; }
  double kwhGrid() const { return grid_wh_ / 1000; }
  double kwhTotal() const { return kwhPv() + kwhBatt() + kwhGrid(); }
  double pctRenewable() const;
  double loadW() const { return load_w_; }
  double totalS() const { return total_s_; }
 private:
  double pv_wh_ = 0, batt_wh_ = 0, grid_wh_ = 0, total_s_ = 0, load_w_ = 0;
};

struct Identity { const char* site_id; const char* unit_id; const char* batch_id; };

struct TelemetryIn {
  long ts;
  double V_L, abs_r, abs_g, abs_b, turb_ntu, ec_uScm, ph, temp_C, I_A, U_V, pv_W, bat_V, bat_soc, grid_W, load_W;
  int polarity;
};

/** Menulis JSON sesuai docs/data-contract.md. Mengembalikan panjang, atau -1 bila buffer kurang. */
int telemetryJson(char* out, int cap, const Identity& id, const TelemetryIn& t, const BatchController& ctl, const Ledger& e);
int batchJson(char* out, int cap, const Identity& id, long ts_start, long ts_end, double V_L, const BatchController& ctl, const Ledger& e);

/** Ringkasan untuk batch yang terputus karena perangkat mati di tengah proses. Air belum tentu terolah. */
int restartJson(char* out, int cap, const Identity& id, long ts_start, long ts_end, double V_L, double q, double kwh, double run_s);

const char* modeName(Mode m);
const char* policyName(Policy p);
const char* energySource(const Ledger& e, double batt_W, double grid_W);

}  // namespace sobat
