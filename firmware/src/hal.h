// Lapisan perangkat keras. Satu-satunya berkas yang tahu pin dan pustaka sensor.
#pragma once
#include "convert.h"

struct Reading {
  double abs_r = 0, abs_g = 0, abs_b = 0, turb_ntu = 0, ec_uScm = 0, ph = 0, temp_C = 0;
  double light_r = 0, light_g = 0, light_b = 0, dark = 0, v_ph = 0, v_ec = 0, v_turb = 0;
  double I_A = 0, U_V = 0, pv_W = 0, bat_V = 0, batt_W = 0, grid_W = 0;
  bool level_high = false, level_low_ok = false;
  bool power_ok = false, cell_ok = false, water_ok = false;
};

namespace hal {
/** Pertama kali dipanggil saat boot: semua keluaran mati dulu, baru sensor dibuka. */
void begin();
void allOff();
/** Listrik dan pelampung. Cepat, aman dipanggil beberapa kali per detik. */
void readPower(Reading& r);
/** Optik, pH, EC, kekeruhan, suhu. Memblokir kira-kira satu detik. Tidak pernah mengarang nilai. */
void readWater(Reading& r, const sobat::Calibration& c, double abs_sat);
/** Menjaga arus sel dan pembalikan polaritas. Panggil tiap putaran cepat. */
void serviceCurrent(double measured_A, double dt);
void setCurrent(double amps);
void requestReverse();
int polarity();
void setPump(bool on);
void setMixer(bool on);
void setDilute(bool on);
void setGrid(bool on);
bool startPressed();
bool stopPressed();
}  // namespace hal
