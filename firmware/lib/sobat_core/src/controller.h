// Kontroler batch. Port langsung dari ML/sobat_ml/control.py, yang menjadi implementasi acuan:
// host_tests/ membandingkan keputusan keduanya langkah demi langkah. Ubah keduanya bersamaan.
// Tambahan khusus perangkat: abortBatch(), untuk pengaman yang tidak ada di simulasi.
#pragma once
#include <stdint.h>

#include "config.h"

namespace sobat {

enum class State { Idle, Filling, Sampling, WaitingSolar, Running, PausedSolar, Settling, Done, Fault };
enum class Status {
  None, TargetTercapai, Lolos, GagalWarna, GagalWarnaMentok, GagalWaktu, GagalSensor, GagalTanpaDaya,
  GagalPengamanSuhu, SelesaiTanpaVerifikasi,
  // hanya di perangkat: pengaman yang tidak ada padanannya di simulasi
  GagalPengamanListrik, GagalLevel
};

const char* stateName(State s);
const char* statusName(Status s);   // None menjadi "SELESAI", sama dengan runner simulasi

struct Obs {
  double abs_r = 0, abs_g = 0, abs_b = 0, turb_ntu = 0, ec_uScm = 0, ph = 0, temp_C = 0;
  double I_A = 0, U_V = 0, pv_W = 0, batt_discharge_W = 0, pv_fc_wh = 0, batt_usable_wh = 0;
};

struct Cmd {
  State state = State::Idle;
  double I_set = 0;
  bool reverse = false, pump = false, mixer = false;
  double dilute = 1;
  bool done = false, grid_ok = false;
};

struct Prediction { double q, q_lo, q_hi, sigma_ln; };
// Mengembalikan false bila prediksi tidak tersedia; kontroler memakai fisika saja.
typedef bool (*PredictFn)(const double features[8], Prediction* out, void* ctx);

/** Koreksi per unit: pengali dari galat prediksi beberapa batch terverifikasi terakhir. */
class UnitCalibrator {
 public:
  static const int kMaxWindow = 16;
  void configure(int window, int min_batches, double lo, double hi);
  double factor() const;
  void add(double q_observed, double q_raw);
  int count() const { return n_; }
  double error(int i) const { return e_[i]; }
  void restore(const double* errors, int n);
 private:
  int window_ = 5, min_ = 3, n_ = 0;
  double lo_ = 0.25, hi_ = 4.0, e_[kMaxWindow] = {0};
};

/** Antrean berjendela: isi lama keluar saat penuh, seperti deque(maxlen=N). */
template <typename T, int N>
class Ring {
 public:
  void setCap(int cap) { cap_ = cap < N ? cap : N; clear(); }
  void clear() { n_ = 0; head_ = 0; }
  void push(const T& v) {
    if (n_ < cap_) { d_[(head_ + n_) % cap_] = v; n_++; }
    else { d_[head_] = v; head_ = (head_ + 1) % cap_; }
  }
  int size() const { return n_; }
  int cap() const { return cap_; }
  bool full() const { return n_ == cap_; }
  const T& operator[](int i) const { return d_[(head_ + i) % cap_]; }
 private:
  T d_[N];
  int cap_ = N, n_ = 0, head_ = 0;
};

class BatchController {
 public:
  static const int kMaxFlags = 16;

  BatchController(const Config& cfg, Mode mode, PredictFn predict = nullptr, void* ctx = nullptr);
  void begin();
  Cmd step(const Obs& obs, double dt);
  /** Pengaman perangkat: hentikan batch sekarang juga. Langkah berikutnya mengembalikan done. */
  void abortBatch(Status status, const char* flag);
  void addFlag(const char* flag);
  /** Kalibrasi warna hasil uji bench, dari penyimpanan perangkat. */
  void setColorCalibration(double eps_eff) { c_.eps_eff_cal = eps_eff; }
  void setMode(Mode m) { mode_ = m; }
  void setPolicy(Policy p) { c_.policy = p; }

  State state() const { return state_; }
  Status status() const { return status_; }
  Mode mode() const { return mode_; }
  double q() const { return q_; }
  double kwh() const { return kwh_; }
  double runS() const { return run_s_; }
  double waitS() const { return wait_s_; }
  double dilution() const { return dil_; }
  int retries() const { return retries_; }
  int reversals() const { return reversals_; }
  bool gridOn() const { return grid_on_; }
  bool hasFeatures() const { return has_feat_; }
  const double* features() const { return feat_; }
  // NAN berarti belum ada nilai (None di Python)
  double qPred() const { return q_pred_; }
  double qPredRaw() const { return q_pred_raw_; }
  double calibFactor() const { return calib_factor_; }
  double colorNow() const { return color_now_; }
  double color0() const { return color0_est_; }
  double colorEnd() const { return color_end_est_; }
  double etaS() const { return eta_s_; }
  double ph0() const { return ph0_; }
  double ec0() const { return ec0_; }
  int flagCount() const { return n_flags_; }
  const char* flag(int i) const { return flags_[i]; }
  UnitCalibrator& calibrator() { return calib_; }
  const Config& config() const { return c_; }

 private:
  double colorEst(const Obs& o, double dil = 1.0) const;
  double pAvail(const Obs& o) const { return o.pv_W + o.batt_discharge_W; }
  Cmd cmd(double I_set = 0, bool reverse = false, bool pump = false, bool mixer = false, bool done = false) const;
  bool hasFlag(const char* f) const;
  void addFlagOnce(const char* f);
  void useGrid(const char* why);
  double energyNeedWh(const Obs& m) const;
  void finish(Status s);
  Cmd plan(const Obs& o);
  Cmd run(const Obs& o, double dt);
  Cmd settle(double dt);
  bool plateaued();
  void eta(double I_m);

  Config c_;
  Mode mode_;
  PredictFn predict_;
  void* ctx_;
  UnitCalibrator calib_;

  State state_ = State::Idle;
  Status status_ = Status::None;
  double t_state_ = 0, run_s_ = 0, wait_s_ = 0, low_power_s_ = 0, q_ = 0, kwh_ = 0, dil_ = 1;
  static const int kMaxSamples = 16;
  Obs samples_[kMaxSamples];
  int n_samples_ = 0;
  struct QLn { double q, y; };
  Ring<QLn, 12> hist_;
  Ring<double, 16> cbuf_;
  Ring<long long, 14> abs_hist_;
  Ring<double, 30> plateau_buf_;
  int retries_ = 0, reversals_ = 0;
  double since_reverse_ = 0, r_ref_ = 0, r_age_ = 0;
  bool has_r_ref_ = false;
  bool has_pred_ = false;
  Prediction pred_ = {0, 0, 0, 0};
  bool has_feat_ = false;
  double feat_[8] = {0};
  double q_pred_, q_lo_, q_hi_, q_pred_raw_, calib_factor_ = 1;
  int plateau_hits_ = 0;
  bool has_plateau_ref_ = false;
  double plateau_ref_q_ = 0, plateau_ref_y_ = 0;
  double color0_est_, color_now_, color_end_est_, eta_s_;
  double ph0_, ec0_;
  const char* flags_[kMaxFlags];
  int n_flags_ = 0;
  double fixed_run_s_ = 0;
  bool measuring_ = false, grid_on_ = false;
  double wait_limit_s_ = 0;
};

}  // namespace sobat
