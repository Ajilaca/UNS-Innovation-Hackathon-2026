#include "controller.h"

#include <math.h>
#include <string.h>

namespace sobat {

const char* stateName(State s) {
  switch (s) {
    case State::Idle: return "IDLE";
    case State::Filling: return "FILLING";
    case State::Sampling: return "SAMPLING";
    case State::WaitingSolar: return "WAITING_SOLAR";
    case State::Running: return "RUNNING";
    case State::PausedSolar: return "PAUSED_SOLAR";
    case State::Settling: return "SETTLING";
    case State::Done: return "DONE";
    case State::Fault: return "FAULT";
  }
  return "FAULT";
}

const char* statusName(Status s) {
  switch (s) {
    case Status::None: return "SELESAI";
    case Status::TargetTercapai: return "TARGET_TERCAPAI";
    case Status::Lolos: return "LOLOS";
    case Status::GagalWarna: return "GAGAL_WARNA";
    case Status::GagalWarnaMentok: return "GAGAL_WARNA_MENTOK";
    case Status::GagalWaktu: return "GAGAL_WAKTU";
    case Status::GagalSensor: return "GAGAL_SENSOR";
    case Status::GagalTanpaDaya: return "GAGAL_TANPA_DAYA";
    case Status::GagalPengamanSuhu: return "GAGAL_PENGAMAN_SUHU";
    case Status::SelesaiTanpaVerifikasi: return "SELESAI_TANPA_VERIFIKASI";
    case Status::GagalPengamanListrik: return "GAGAL_PENGAMAN_LISTRIK";
    case Status::GagalLevel: return "GAGAL_LEVEL";
  }
  return "SELESAI";
}

// ---- pembantu ------------------------------------------------------------
static double medianOf(double* a, int n) {   // insertion sort: n paling banyak 16
  for (int i = 1; i < n; i++) {
    double v = a[i];
    int j = i - 1;
    while (j >= 0 && a[j] > v) { a[j + 1] = a[j]; j--; }
    a[j + 1] = v;
  }
  return n % 2 ? a[n / 2] : (a[n / 2 - 1] + a[n / 2]) / 2.0;
}

template <typename Fn>
static double medianBy(const Obs* s, int n, Fn f) {
  double t[16];
  for (int i = 0; i < n; i++) t[i] = f(s[i]);
  return medianOf(t, n);
}

static inline bool truthy(double x) { return !isnan(x) && x != 0.0; }
static inline double dmax(double a, double b) { return a > b ? a : b; }
static inline double dmin(double a, double b) { return a < b ? a : b; }

static double physicsQ(double c0, double target, double margin, double k) {
  return log(dmax(c0 / (margin * target), 1.05)) / k;
}

// ---- koreksi per unit ------------------------------------------------------
void UnitCalibrator::configure(int window, int min_batches, double lo, double hi) {
  window_ = window > kMaxWindow ? kMaxWindow : window;
  min_ = min_batches; lo_ = lo; hi_ = hi; n_ = 0;
}

double UnitCalibrator::factor() const {
  if (n_ < min_) return 1.0;
  double s = 0;
  for (int i = 0; i < n_; i++) s += e_[i];
  return dmin(dmax(exp(s / n_), lo_), hi_);
}

void UnitCalibrator::add(double q_observed, double q_raw) {
  if (!(q_observed > 0 && q_raw > 0)) return;
  if (n_ == window_) { for (int i = 1; i < n_; i++) e_[i - 1] = e_[i]; n_--; }
  e_[n_++] = log(q_observed / q_raw);
}

void UnitCalibrator::restore(const double* errors, int n) {
  n_ = 0;
  for (int i = 0; i < n && n_ < window_; i++) e_[n_++] = errors[i];
}

// ---- kontroler -------------------------------------------------------------
BatchController::BatchController(const Config& cfg, Mode mode, PredictFn predict, void* ctx)
    : c_(cfg), mode_(mode), predict_(predict), ctx_(ctx) {
  calib_.configure(c_.calib_window, c_.calib_min_batches, c_.calib_limit_lo, c_.calib_limit_hi);
  q_pred_ = q_lo_ = q_hi_ = q_pred_raw_ = color0_est_ = color_now_ = color_end_est_ = eta_s_ = ph0_ = ec0_ = NAN;
}

double BatchController::colorEst(const Obs& o, double dil) const {
  double a = (o.abs_r + o.abs_g + o.abs_b) / 3.0 * dil;
  a -= c_.floc_beta_est * c_.floc_leak_est * o.turb_ntu;
  return dmax(a, 0.0) / c_.eps_eff_cal;
}

void BatchController::begin() {
  state_ = State::Filling;
  status_ = Status::None;
  t_state_ = run_s_ = wait_s_ = low_power_s_ = q_ = kwh_ = 0;
  dil_ = 1;
  n_samples_ = 0;
  hist_.setCap(12);
  cbuf_.setCap(c_.median_window);
  abs_hist_.setCap(14);
  plateau_buf_.setCap(30);
  retries_ = reversals_ = 0;
  since_reverse_ = r_age_ = 0;
  has_r_ref_ = false;
  has_pred_ = false;
  has_feat_ = false;
  q_pred_ = q_lo_ = q_hi_ = q_pred_raw_ = NAN;
  calib_factor_ = 1;
  plateau_hits_ = 0;
  has_plateau_ref_ = false;
  color0_est_ = color_now_ = color_end_est_ = eta_s_ = ph0_ = ec0_ = NAN;
  n_flags_ = 0;
  fixed_run_s_ = 0;
  measuring_ = false;
  grid_on_ = false;
  wait_limit_s_ = (c_.policy == Policy::SolarFirst ? c_.grid_max_wait_min : c_.wait_max_min) * 60;
}

Cmd BatchController::cmd(double I_set, bool reverse, bool pump, bool mixer, bool done) const {
  Cmd r;
  r.state = state_;
  r.I_set = I_set;
  r.reverse = reverse;
  r.pump = pump;
  r.mixer = mixer;
  r.dilute = dil_;
  r.done = done;
  r.grid_ok = grid_on_ || c_.policy == Policy::GridOnly;
  return r;
}

void BatchController::addFlag(const char* f) { if (n_flags_ < kMaxFlags) flags_[n_flags_++] = f; }

bool BatchController::hasFlag(const char* f) const {
  for (int i = 0; i < n_flags_; i++) if (strcmp(flags_[i], f) == 0) return true;
  return false;
}

void BatchController::addFlagOnce(const char* f) { if (!hasFlag(f)) addFlag(f); }

void BatchController::useGrid(const char* why) {
  if (grid_on_) return;
  grid_on_ = true;
  addFlagOnce("PLN_DIPAKAI");
  addFlagOnce(why);
}

double BatchController::energyNeedWh(const Obs& m) const {
  double kappa = m.ec_uScm * 1e-4 * (1 + 0.02 * (m.temp_C - 25));
  double R = c_.gap_cm / 100 / (kappa * c_.electrode_area_cm2 / 1e4) * c_.solution_resistance_scale * 1.15;
  double U = c_.overpotential_V + c_.I_default_A * R;
  double t_h = q_pred_ * c_.batch_volume_L / c_.I_default_A / 3600;
  return U * q_pred_ * c_.batch_volume_L / 3600 / c_.dcdc_eff + (c_.aux_load_w + c_.idle_load_w) * t_h;
}

void BatchController::finish(Status s) {
  status_ = s;
  state_ = State::Settling;
  t_state_ = 0;
  n_samples_ = 0;
  measuring_ = false;
}

void BatchController::abortBatch(Status status, const char* flag) {
  status_ = status;
  state_ = State::Fault;
  if (flag) addFlagOnce(flag);
}

Cmd BatchController::step(const Obs& o, double dt) {
  State st = state_;
  t_state_ += dt;

  if (st == State::Filling) {
    if (t_state_ >= c_.fill_s) { state_ = State::Sampling; t_state_ = 0; n_samples_ = 0; }
    return cmd(0, false, state_ == State::Filling, true);
  }

  if (st == State::Sampling) {
    if (n_samples_ < kMaxSamples) samples_[n_samples_++] = o;
    if (n_samples_ < c_.sample_count) return cmd(0, false, false, true);
    double raw = medianBy(samples_, n_samples_, [](const Obs& s) { return (s.abs_r + s.abs_g + s.abs_b) / 3; });
    if (dil_ == 1.0 && raw > c_.sat_threshold) {
      dil_ = c_.dilution_ratio;
      n_samples_ = 0;
      addFlag("PENGENCERAN_OTOMATIS");
      return cmd(0, false, false, true);
    }
    return plan(o);
  }

  if (st == State::WaitingSolar) {
    wait_s_ += dt;
    if (pAvail(o) >= 1.3 * c_.min_run_power_w) {
      state_ = State::Running; t_state_ = 0;
    } else if (wait_s_ >= wait_limit_s_) {
      if (c_.policy == Policy::SolarFirst) {
        useGrid("BATAS_TUNGGU_SURYA_HABIS");
        state_ = State::Running; t_state_ = 0;
      } else {
        status_ = Status::GagalTanpaDaya;
        state_ = State::Fault;
        return cmd(0, false, false, false, true);
      }
    }
    return cmd();
  }

  if (st == State::Running || st == State::PausedSolar) return run(o, dt);
  if (st == State::Settling) {
    // sampel dikumpulkan di sini agar settle() tidak perlu tahu bentuk Obs
    if (measuring_ && n_samples_ < kMaxSamples) samples_[n_samples_++] = o;
    return settle(dt);
  }
  return cmd(0, false, false, false, st == State::Done || st == State::Fault);
}

Cmd BatchController::plan(const Obs& o) {
  Obs m;
  const Obs* s = samples_;
  int n = n_samples_;
  m.abs_r = medianBy(s, n, [](const Obs& x) { return x.abs_r; });
  m.abs_g = medianBy(s, n, [](const Obs& x) { return x.abs_g; });
  m.abs_b = medianBy(s, n, [](const Obs& x) { return x.abs_b; });
  m.turb_ntu = medianBy(s, n, [](const Obs& x) { return x.turb_ntu; });
  m.ec_uScm = medianBy(s, n, [](const Obs& x) { return x.ec_uScm; });
  m.ph = medianBy(s, n, [](const Obs& x) { return x.ph; });
  m.temp_C = medianBy(s, n, [](const Obs& x) { return x.temp_C; });
  ph0_ = m.ph;
  ec0_ = m.ec_uScm;
  double target = c_.target_color_ptco;
  color0_est_ = dmax(colorEst(m, dil_), 1.05 * target);
  if (mode_ == Mode::Fixed) {
    q_pred_ = c_.fixed_q_CperL;
    fixed_run_s_ = q_pred_ * c_.batch_volume_L / c_.I_default_A;
  } else {
    double r = m.abs_r * dil_, g = m.abs_g * dil_, b = m.abs_b * dil_;
    double a_mean = dmax((r + g + b) / 3.0, 1e-6);
    feat_[0] = log(dmax(color0_est_, 1.05 * target) / target);
    feat_[1] = m.ph;
    feat_[2] = m.ec_uScm / 1000.0;
    feat_[3] = m.temp_C;
    feat_[4] = log1p(dmax(m.turb_ntu, 0.0));
    feat_[5] = r / a_mean;
    feat_[6] = b / a_mean;
    feat_[7] = log(dmax(color0_est_, 1.0));
    has_feat_ = true;
    if (mode_ == Mode::Ai && predict_ && predict_(feat_, &pred_, ctx_)) {
      has_pred_ = true;
      q_pred_raw_ = pred_.q;
      calib_factor_ = c_.calib_enabled ? calib_.factor() : 1.0;
      q_pred_ = pred_.q * calib_factor_;
      q_lo_ = pred_.q_lo * calib_factor_;
      q_hi_ = pred_.q_hi * calib_factor_;
    } else {
      q_pred_ = physicsQ(color0_est_, target, c_.stop_margin, c_.k_phys_per_Cpl);
    }
  }
  state_ = State::Running;
  t_state_ = 0;
  bool p_ok = pAvail(o) >= c_.min_run_power_w;
  if (c_.policy == Policy::GridOnly || (mode_ == Mode::Fixed && c_.policy == Policy::SolarFirst)) {
    grid_on_ = c_.policy != Policy::SolarOnly;
    if (grid_on_) addFlag("PLN_DIPAKAI");
  } else if (mode_ == Mode::Ai && truthy(q_pred_) && c_.policy == Policy::SolarFirst) {
    double solar_wh = o.pv_fc_wh + o.batt_usable_wh;
    if (solar_wh < energyNeedWh(m)) {
      useGrid("PRAKIRAAN_SURYA_KURANG");     // menunggu tidak akan membantu: mulai sekarang, PLN menambal
    } else if (!p_ok) {
      state_ = State::WaitingSolar;
      addFlag("TUNDA_MENUNGGU_SURYA");
    }
  } else if (mode_ != Mode::Fixed && !p_ok) {
    state_ = State::WaitingSolar;
    addFlag("TUNDA_MENUNGGU_SURYA");
  }
  return cmd();
}

Cmd BatchController::run(const Obs& o, double dt) {
  double I_m = o.I_A, U_m = o.U_V;
  double p_av = pAvail(o);

  if (mode_ != Mode::Fixed && !grid_on_) {
    if (state_ == State::Running) {
      low_power_s_ = p_av < c_.min_run_power_w ? low_power_s_ + dt : 0.0;
      if (low_power_s_ >= 60) {
        state_ = State::PausedSolar;
        addFlagOnce("JEDA_DAYA_SURYA");
      }
    } else if (p_av >= 1.3 * c_.min_run_power_w) {
      state_ = State::Running;
      low_power_s_ = 0;
    }
    if (state_ == State::PausedSolar) {
      wait_s_ += dt;
      if (wait_s_ >= wait_limit_s_) {
        if (c_.policy == Policy::SolarFirst) {
          useGrid("BATAS_TUNGGU_SURYA_HABIS");
          state_ = State::Running;
        } else {
          finish(Status::GagalTanpaDaya);
        }
      }
      return cmd(0, false, false, true);
    }
  }

  run_s_ += dt;
  q_ += I_m * dt / c_.batch_volume_L;
  kwh_ += U_m * I_m * dt / 3.6e6;
  since_reverse_ += dt;

  // pengawasan pasivasi lewat tahanan sel
  bool reverse = false;
  if (I_m > 0.5) {
    double R = U_m / I_m;
    r_age_ += dt;
    if (!has_r_ref_ && r_age_ >= 30) {
      r_ref_ = R;
      has_r_ref_ = true;
    } else if (has_r_ref_ && R > c_.reverse_rise * r_ref_ && since_reverse_ > 120) {
      reverse = true;
      addFlagOnce("PASIVASI_TERDETEKSI");
    }
  }
  if (since_reverse_ >= c_.reverse_every_s) reverse = true;
  if (reverse) {
    reversals_++;
    since_reverse_ = 0;
    has_r_ref_ = false;
    r_age_ = 0;
  }

  // pengaman
  if (o.temp_C > c_.T_max_C) { finish(Status::GagalPengamanSuhu); return cmd(); }
  if (run_s_ > c_.t_max_min * 60) {
    finish(mode_ != Mode::Fixed ? Status::GagalWaktu : Status::SelesaiTanpaVerifikasi);
    return cmd();
  }

  if (mode_ == Mode::Fixed) {
    if (run_s_ >= fixed_run_s_) { finish(Status::SelesaiTanpaVerifikasi); return cmd(); }
    return cmd(c_.I_default_A, reverse, false, true);
  }

  // perkiraan warna dari sensor optik
  double top = dmax(dmax(o.abs_r, o.abs_g), o.abs_b);
  bool saturated = top >= 0.97 * c_.abs_sat;
  if (saturated && dil_ == 1.0) {
    dil_ = c_.dilution_ratio;       // sensor jenuh: encerkan dan terus memantau
    cbuf_.clear();
    addFlagOnce("PENGENCERAN_OTOMATIS");
    return cmd(c_.I_default_A, reverse, false, true);
  }
  if (!saturated) abs_hist_.push(llround(o.abs_g * 1e5));
  cbuf_.push(colorEst(o, dil_));
  {
    double t[16];
    for (int i = 0; i < cbuf_.size(); i++) t[i] = cbuf_[i];
    color_now_ = medianOf(t, cbuf_.size());
  }
  if (dil_ > 1.0 && color_now_ < c_.undilute_below_ptco) {
    dil_ = 1.0;
    cbuf_.clear();
    abs_hist_.clear();
    plateau_buf_.clear();
    has_plateau_ref_ = false;
    plateau_hits_ = 0;
  }
  if (q_ > 8) hist_.push({q_, log(dmax(color_now_, 1.0))});
  eta(I_m);

  bool same = abs_hist_.full();
  for (int i = 1; same && i < abs_hist_.size(); i++) same = abs_hist_[i] == abs_hist_[0];
  if (same && !saturated) {
    if (mode_ == Mode::Ai && truthy(q_hi_)) {
      addFlagOnce("SENSOR_MACET_FALLBACK_PREDIKSI");
      if (q_ >= q_hi_) { finish(Status::SelesaiTanpaVerifikasi); return cmd(); }
      return cmd(c_.I_default_A, reverse, false, true);
    }
    addFlag("SENSOR_MACET");
    finish(Status::GagalSensor);
    return cmd();
  }

  bool guard_ok = true;
  if (mode_ == Mode::Ai && truthy(q_pred_) && retries_ == 0) guard_ok = q_ >= c_.guard_frac * q_pred_;
  if (run_s_ > 60 && guard_ok && cbuf_.full() && color_now_ <= c_.stop_margin * c_.target_color_ptco) {
    finish(Status::TargetTercapai);
    return cmd();
  }
  if (plateaued()) {
    addFlagOnce("WARNA_MENTOK");
    finish(Status::GagalWarnaMentok);    // arus tambahan hanya membuang energi; pembacaan akhir tetap dilakukan
    return cmd();
  }
  return cmd(c_.I_default_A, reverse, false, true);
}

bool BatchController::plateaued() {
  if (c_.plateau_dq_CperL <= 0 || !truthy(color_now_)) return false;
  plateau_buf_.push(log(dmax(color_now_, 1.0)));
  if (!plateau_buf_.full()) return false;
  double sum = 0;
  for (int i = 0; i < plateau_buf_.size(); i++) sum += plateau_buf_[i];
  double now = sum / plateau_buf_.size();
  if (!has_plateau_ref_) {
    has_plateau_ref_ = true;
    plateau_ref_q_ = q_;
    plateau_ref_y_ = now;
    return false;
  }
  if (q_ - plateau_ref_q_ < c_.plateau_dq_CperL) return false;
  double drop = plateau_ref_y_ - now;
  plateau_ref_q_ = q_;
  plateau_ref_y_ = now;
  plateau_hits_ = drop < c_.plateau_min_drop ? plateau_hits_ + 1 : 0;
  return plateau_hits_ >= 2;
}

void BatchController::eta(double I_m) {
  double V = c_.batch_volume_L;
  double goal = c_.stop_margin * c_.target_color_ptco;
  if (hist_.size() >= 12) {
    int n = hist_.size();
    double mq = 0, my = 0;
    for (int i = 0; i < n; i++) { mq += hist_[i].q; my += hist_[i].y; }
    mq /= n; my /= n;
    double var = 0, cov = 0;
    for (int i = 0; i < n; i++) {
      var += (hist_[i].q - mq) * (hist_[i].q - mq);
      cov += (hist_[i].q - mq) * (hist_[i].y - my);
    }
    if (var > 1e-6) {
      double k = -cov / var;
      if (k > 1e-4 && truthy(color_now_)) {
        double q_rem = dmax(log(dmax(color_now_, goal) / goal) / k, 0.0);
        eta_s_ = q_rem * V / dmax(I_m, 0.5);
        return;
      }
    }
  }
  if (truthy(q_pred_)) eta_s_ = dmax(q_pred_ - q_, 0.0) * V / dmax(I_m, 0.5);
}

Cmd BatchController::settle(double dt) {
  (void)dt;
  if (status_ == Status::GagalTanpaDaya) {
    state_ = State::Fault;
    return cmd(0, false, false, false, true);
  }
  if (!measuring_) {
    if (t_state_ >= c_.settle_min * 60) { measuring_ = true; n_samples_ = 0; }
    return cmd();
  }
  if (n_samples_ < c_.sample_count) return cmd();
  double t[16];
  for (int i = 0; i < n_samples_; i++) t[i] = colorEst(samples_[i]);
  double final_c = medianOf(t, n_samples_);
  color_end_est_ = final_c;
  if (mode_ == Mode::Fixed || status_ == Status::SelesaiTanpaVerifikasi || status_ == Status::GagalSensor ||
      status_ == Status::GagalPengamanSuhu) {
    state_ = State::Done;
    return cmd(0, false, false, false, true);
  }
  if (final_c <= c_.target_color_ptco) {
    status_ = Status::Lolos;
    state_ = State::Done;
  } else if (status_ == Status::GagalWarnaMentok) {
    state_ = State::Done;              // pengulangan tidak bisa menghapus yang tak terangkat muatan terakhir
  } else if (retries_ < c_.max_retries) {
    retries_++;
    addFlag("ULANG_PROSES");
    state_ = State::Running;
    t_state_ = 0;
    cbuf_.clear();
    hist_.clear();
    abs_hist_.clear();
    plateau_buf_.clear();
    has_plateau_ref_ = false;
    plateau_hits_ = 0;
    run_s_ = dmin(run_s_, c_.t_max_min * 60 * 0.6);
    status_ = Status::None;
    return cmd();
  } else {
    status_ = Status::GagalWarna;
    state_ = State::Done;
  }
  if (status_ == Status::Lolos && c_.calib_enabled && truthy(q_pred_raw_) && retries_ == 0) calib_.add(q_, q_pred_raw_);
  if (status_ == Status::Lolos && mode_ == Mode::Ai && has_pred_) {
    double z = fabs(log(dmax(q_, 1e-6) / q_pred_)) / pred_.sigma_ln;
    if (z > c_.anomaly_sigma) addFlag("ANOMALI_DOSIS_CEK_SENSOR_ATAU_LIMBAH");
  }
  return cmd(0, false, false, false, true);
}

}  // namespace sobat
