// Firmware unit SEBAT. Kendali berjalan di perangkat dan tetap jalan walau internet putus.
// Logika keputusan ada di lib/sebat_core; berkas ini hanya menyambungkannya ke sensor, aktuator, dan jaringan.
//
// BELUM DIUJI PADA PERANGKAT KERAS. Lihat firmware/README.md sebelum menyambungkan sel elektrolisis.
#include <Arduino.h>
#include <Preferences.h>
#include <esp_task_wdt.h>
#include <time.h>

#include "controller.h"
#include "convert.h"
#include "hal.h"
#include "net.h"
#include "secrets.h"

using namespace sebat;

namespace {
Config cfg;
BatchController ctl(cfg, Mode::Ai);    // tanpa model ML di perangkat: prediksi memakai fisika
Calibration cal;
Ledger ledger;
Safety safety;
Reading rd;
Preferences prefs;

bool active = false;                   // ada batch berjalan
char batchId[48] = "idle";
long tsStart = 0;                      // 0 bila jam belum sinkron; dihitung mundur saat selesai
uint32_t startMs = 0, lastStepMs = 0, lastFastMs = 0, lastCkptMs = 0, lastPressMs = 0;
double soc = 0.5;
int badWater = 0;
double noCurrentS = 0;
State prevState = State::Idle;
bool stepNow = false;

// ---- penyimpanan --------------------------------------------------------------
struct Checkpoint { char id[48]; long ts_start; double q, kwh, run_s; bool active; };

void saveCal() { prefs.putBytes("cal", &cal, sizeof cal); }

void loadState() {
  if (prefs.getBytesLength("cal") == sizeof cal) prefs.getBytes("cal", &cal, sizeof cal);
  if (cal.eps_eff > 0) ctl.setColorCalibration(cal.eps_eff);
  double err[UnitCalibrator::kMaxWindow];
  size_t len = prefs.getBytes("calib", err, sizeof err);
  if (len) ctl.calibrator().restore(err, len / sizeof(double));
  String m = prefs.getString("mode", "ai");
  ctl.setMode(m == "fixed" ? Mode::Fixed : m == "feedback" ? Mode::Feedback : Mode::Ai);
  String p = prefs.getString("policy", "solar_first");
  ctl.setPolicy(p == "solar_only" ? Policy::SolarOnly : p == "grid_only" ? Policy::GridOnly : Policy::SolarFirst);
}

void saveCheckpoint(bool on) {
  Checkpoint c{};
  strlcpy(c.id, batchId, sizeof c.id);
  c.ts_start = tsStart;
  c.q = ctl.q();
  c.kwh = ctl.kwh();
  c.run_s = ctl.runS();
  c.active = on;
  prefs.putBytes("ckpt", &c, sizeof c);
}

/** Perangkat mati di tengah batch: laporkan apa adanya, jangan melanjutkan sendiri. Air belum tentu terolah. */
void reportInterruptedBatch() {
  Checkpoint c{};
  if (prefs.getBytesLength("ckpt") != sizeof c) return;
  prefs.getBytes("ckpt", &c, sizeof c);
  if (!c.active) return;
  static char buf[1200];
  Identity id = {SITE_ID, UNIT_ID, c.id};
  long end = net::now() ? net::now() : c.ts_start;
  if (restartJson(buf, sizeof buf, id, c.ts_start, end, cfg.batch_volume_L, c.q, c.kwh, c.run_s) > 0) net::queueBatch(buf);
  Serial.printf("[boot] batch %s terputus; periksa air di reaktor sebelum memulai lagi\n", c.id);
  c.active = false;
  prefs.putBytes("ckpt", &c, sizeof c);
}

void newBatchId() {
  uint32_t n = prefs.getUInt("ctr", 0) + 1;
  prefs.putUInt("ctr", n);
  char day[12] = "00000000";
  long t = net::now();
  if (t) { time_t tt = t; struct tm lt; localtime_r(&tt, &lt); strftime(day, sizeof day, "%Y%m%d", &lt); }
  snprintf(batchId, sizeof batchId, "%s-%s-%04u", UNIT_ID, day, (unsigned)n);
}

// ---- batch --------------------------------------------------------------------
void outputsOff() {
  hal::setCurrent(0);
  hal::setPump(false);
  hal::setMixer(false);
  hal::setDilute(false);
  hal::setGrid(false);
}

void startBatch() {
  if (active) { Serial.println("[batch] masih ada batch berjalan"); return; }
  if (!cal.colorOk()) {
    Serial.println("[batch] DITOLAK: sensor warna belum dikalibrasi. Jalankan 'cal zero' dengan air bersih dan 'cal eps <nilai>'.");
    return;
  }
  hal::readPower(rd);
  if (!rd.cell_ok || !rd.power_ok) { Serial.println("[batch] DITOLAK: INA226 tidak terbaca"); return; }
  hal::readWater(rd, cal, cfg.abs_sat);
  if (!rd.water_ok) { Serial.println("[batch] DITOLAK: sensor air tidak terbaca"); return; }
  newBatchId();
  ctl.begin();
  if (!cal.probesOk()) ctl.addFlag("KALIBRASI_PROBE_BELUM");
  long t = net::now();
  if (t && cal.i0_ts && t - cal.i0_ts > 36 * 3600) ctl.addFlag("NOL_SENSOR_KEDALUWARSA");
  ledger.reset();
  tsStart = t;
  active = true;
  badWater = 0;
  noCurrentS = 0;
  startMs = lastStepMs = millis();
  stepNow = true;
  saveCheckpoint(true);
  Serial.printf("[batch] mulai %s\n", batchId);
}

void finishBatch() {
  outputsOff();
  static char buf[2600];
  long end = net::now();
  long elapsed = (millis() - startMs) / 1000;
  long ts0 = tsStart ? tsStart : (end ? end - elapsed : 0);
  if (!end) end = ts0 + elapsed;      // jam belum sinkron selama batch: waktu berbasis 0, tetap terbaca sebagai batch
  Identity id = {SITE_ID, UNIT_ID, batchId};
  int n = batchJson(buf, sizeof buf, id, ts0, end, cfg.batch_volume_L, ctl, ledger);
  if (n < 0 || !net::queueBatch(buf)) Serial.println("[batch] GAGAL menyimpan ringkasan");
  UnitCalibrator& k = ctl.calibrator();
  double err[UnitCalibrator::kMaxWindow];
  for (int i = 0; i < k.count(); i++) err[i] = k.error(i);
  prefs.putBytes("calib", err, k.count() * sizeof(double));
  saveCheckpoint(false);
  active = false;
  Serial.printf("[batch] selesai %s: %s, %.0f C/L, %.3f kWh\n", batchId, statusName(ctl.status()), ctl.q(), ctl.kwh());
}

void trip(Status status, const char* flag) {
  if (!active) return;
  outputsOff();                        // arus mati dulu, baru dicatat
  ctl.abortBatch(status, flag);
  stepNow = true;
  Serial.printf("[pengaman] %s: %s\n", statusName(status), flag ? flag : "-");
}

double hourNow() {
  long t = net::now();
  if (!t) return 12;                   // jam belum sinkron: anggap tengah hari, prakiraan tetap dibatasi cakrawala
  time_t tt = t;
  struct tm lt;
  localtime_r(&tt, &lt);
  return lt.tm_hour + lt.tm_min / 60.0;
}

void updateSoc() {
  // Tegangan baru berarti saat arus baterai kecil
  if (rd.power_ok && fabs(rd.batt_W) < 20) soc = socFromVoltage(rd.bat_V);
}

void controlStep(double dt) {
  hal::readWater(rd, cal, cfg.abs_sat);
  if (ctl.state() != State::Fault && !rd.water_ok) {
    if (++badWater >= 6) trip(Status::GagalSensor, "SENSOR_GAGAL_BACA");
    else return;                       // lewati: dt berikutnya menghitung waktu yang terlewat, angka tidak dikarang
  } else {
    badWater = 0;
  }
  updateSoc();
  Obs o;
  o.abs_r = rd.abs_r; o.abs_g = rd.abs_g; o.abs_b = rd.abs_b;
  o.turb_ntu = rd.turb_ntu; o.ec_uScm = rd.ec_uScm; o.ph = rd.ph; o.temp_C = rd.temp_C;
  o.I_A = rd.I_A; o.U_V = rd.U_V; o.pv_W = rd.pv_W;
  o.batt_discharge_W = soc > cfg.battery_min_soc ? cfg.battery_max_discharge_w : 0;
  o.batt_usable_wh = fmax(0.0, soc - cfg.battery_min_soc) * cfg.battery_wh;
  o.pv_fc_wh = ctl.state() == State::Sampling ? pvForecastWh(rd.pv_W, hourNow(), 120) : 0;

  Cmd m = ctl.step(o, dt);

  // Sel tidak boleh berjalan tanpa elektroda terendam; tangki harus benar-benar terisi sebelum sampel dibaca
  if (prevState == State::Filling && m.state == State::Sampling && !rd.level_high) {
    trip(Status::GagalLevel, "LEVEL_RENDAH");
    m = Cmd();
    m.state = ctl.state();
  }
  prevState = ctl.state();

  bool run = ctl.state() != State::Fault;
  hal::setPump(run && m.pump && !rd.level_high);
  hal::setMixer(run && m.mixer);
  hal::setDilute(run && m.dilute > 1.0);
  hal::setGrid(run && m.grid_ok);
  hal::setCurrent(run ? m.I_set : 0);
  if (run && m.reverse) hal::requestReverse();

  // Arus diperintah tapi tidak mengalir: elektroda putus atau catu mati. Lebih baik berhenti daripada menunggu batas waktu.
  noCurrentS = (m.I_set > 0 && rd.I_A < 0.5) ? noCurrentS + dt : 0;
  if (noCurrentS > 120) { trip(Status::GagalPengamanListrik, "ARUS_TIDAK_MENGALIR"); }

  ledger.add(cfg, dt, rd.U_V * rd.I_A, m.pump || m.mixer, rd.batt_W, rd.grid_W);

  static char buf[1400];
  long t = net::now();
  if (t) {                             // tanpa jam, telemetri tidak bisa diberi waktu yang benar: jangan dikirim
    Identity id = {SITE_ID, UNIT_ID, batchId};
    TelemetryIn ti = {t, cfg.batch_volume_L, rd.abs_r, rd.abs_g, rd.abs_b, rd.turb_ntu, rd.ec_uScm, rd.ph, rd.temp_C,
                      rd.I_A, rd.U_V, rd.pv_W, rd.bat_V, soc, rd.grid_W, ledger.loadW(), hal::polarity()};
    if (telemetryJson(buf, sizeof buf, id, ti, ctl, ledger) > 0) net::sendTelemetry(buf);
  }

  if (m.done || ctl.state() == State::Done || ctl.state() == State::Fault) finishBatch();
}

// ---- konsol serial ---------------------------------------------------------------
double ph1V = 0, ph1Val = 0, turb1V = 0, turb1Val = 0;

void printStatus() {
  hal::readPower(rd);
  hal::readWater(rd, cal, cfg.abs_sat);
  Serial.printf("batch %s aktif=%d state=%s status=%s q=%.1f kWh=%.4f mode=%s kebijakan=%s\n", batchId, active, stateName(ctl.state()),
                statusName(ctl.status()), ctl.q(), ctl.kwh(), modeName(ctl.mode()), policyName(ctl.config().policy));
  Serial.printf("sel %.2f V %.2f A | PV %.1f W | baterai %.2f V %.1f W SoC~%.0f%% | PLN %.1f W | ina sel=%d lain=%d\n", rd.U_V, rd.I_A, rd.pv_W, rd.bat_V, rd.batt_W, 100 * soc, rd.grid_W, rd.cell_ok, rd.power_ok);
  Serial.printf("air ok=%d abs %.3f %.3f %.3f | pH %.2f (%.3f V) EC %.0f (%.3f V) NTU %.0f (%.3f V) | %.1f C | pelampung atas=%d bawah=%d\n", rd.water_ok, rd.abs_r, rd.abs_g, rd.abs_b, rd.ph, rd.v_ph, rd.ec_uScm, rd.v_ec, rd.turb_ntu, rd.v_turb, rd.temp_C, rd.level_high, rd.level_low_ok);
  Serial.printf("kalibrasi warna=%d probe=%d eps=%.3g | online=%d jam=%d kotak keluar=%d\n", cal.colorOk(), cal.probesOk(), cal.eps_eff, net::online(), net::timeSynced(), net::outboxCount());
}

void testOutput(const String& what) {
  if (active) { Serial.println("tidak boleh saat batch berjalan"); return; }
  Serial.printf("uji %s 3 detik\n", what.c_str());
  if (what == "pump") hal::setPump(true);
  else if (what == "mixer") hal::setMixer(true);
  else if (what == "dilute") hal::setDilute(true);
  else if (what == "grid") hal::setGrid(true);
  else if (what == "cell") {           // hanya lewat level bawah: jangan menyalakan arus pada elektroda kering
    hal::readPower(rd);
    if (!rd.level_low_ok) { Serial.println("ditolak: elektroda tidak terendam"); return; }
    hal::setCurrent(1.0);
  } else { Serial.println("pump | mixer | dilute | grid | cell"); return; }
  for (int i = 0; i < 30; i++) { delay(100); esp_task_wdt_reset(); hal::readPower(rd); hal::serviceCurrent(rd.I_A, 0.1); }
  if (what == "cell") Serial.printf("sel %.2f V %.2f A\n", rd.U_V, rd.I_A);
  outputsOff();
}

void handleLine(String s) {
  s.trim();
  int sp = s.indexOf(' ');
  String a = sp < 0 ? s : s.substring(0, sp);
  String b = sp < 0 ? "" : s.substring(sp + 1);
  b.trim();
  if (a == "help" || a == "?") {
    Serial.println(
        "status | start | stop\n"
        "mode ai|feedback|fixed | policy solar_first|solar_only|grid_only\n"
        "test pump|mixer|dilute|grid|cell\n"
        "cal zero            ruang ukur berisi air bersih\n"
        "cal eps <nilai>     absorbansi rata-rata per Pt-Co, dari uji bench\n"
        "cal ph1 <pH> lalu cal ph2 <pH>     dua larutan penyangga\n"
        "cal ec <uS/cm>      satu larutan standar\n"
        "cal turb1 <NTU> lalu cal turb2 <NTU>\n"
        "cal show | cal clear");
  } else if (a == "status") {
    printStatus();
  } else if (a == "start") {
    startBatch();
  } else if (a == "stop") {
    trip(Status::SelesaiTanpaVerifikasi, "DIHENTIKAN_OPERATOR");
  } else if (a == "test") {
    testOutput(b);
  } else if (a == "mode" && !active) {
    ctl.setMode(b == "fixed" ? Mode::Fixed : b == "feedback" ? Mode::Feedback : Mode::Ai);
    prefs.putString("mode", modeName(ctl.mode()));
    Serial.println(modeName(ctl.mode()));
  } else if (a == "policy" && !active) {
    ctl.setPolicy(b == "solar_only" ? Policy::SolarOnly : b == "grid_only" ? Policy::GridOnly : Policy::SolarFirst);
    prefs.putString("policy", policyName(ctl.config().policy));
    Serial.println(policyName(ctl.config().policy));
  } else if (a == "cal") {
    if (active) { Serial.println("tidak boleh saat batch berjalan"); return; }
    int sp2 = b.indexOf(' ');
    String k = sp2 < 0 ? b : b.substring(0, sp2);
    double v = sp2 < 0 ? 0 : b.substring(sp2 + 1).toDouble();
    Calibration tmp = cal;
    tmp.i0_r = tmp.i0_g = tmp.i0_b = 1;  // nilai sementara agar pembacaan mentah tetap keluar
    hal::readWater(rd, tmp, cfg.abs_sat);
    if (k != "clear" && k != "show" && k != "eps" && !rd.water_ok) { Serial.println("gagal: sensor air tidak terbaca"); return; }
    if (k == "zero") {
      cal.i0_r = rd.light_r - rd.dark; cal.i0_g = rd.light_g - rd.dark; cal.i0_b = rd.light_b - rd.dark; cal.i0_ts = net::now();
    } else if (k == "eps" && v > 0) {
      cal.eps_eff = v;
      ctl.setColorCalibration(v);
    } else if (k == "ph1") { ph1V = rd.v_ph; ph1Val = v; Serial.println("sekarang larutan kedua: cal ph2 <pH>"); return; }
    else if (k == "ph2" && fabs(rd.v_ph - ph1V) > 0.01) { cal.ph_slope = (v - ph1Val) / (rd.v_ph - ph1V); cal.ph_offset = ph1Val - cal.ph_slope * ph1V; }
    else if (k == "ec" && rd.v_ec > 0.01) { cal.ec_per_volt = v * (1 + 0.02 * (rd.temp_C - 25)) / rd.v_ec; }
    else if (k == "turb1") { turb1V = rd.v_turb; turb1Val = v; Serial.println("sekarang sampel kedua: cal turb2 <NTU>"); return; }
    else if (k == "turb2" && fabs(rd.v_turb - turb1V) > 0.01) { cal.turb_slope = (v - turb1Val) / (rd.v_turb - turb1V); cal.turb_offset = turb1Val - cal.turb_slope * turb1V; }
    else if (k == "clear") { cal = Calibration(); }
    else if (k != "show") { Serial.println("perintah kalibrasi tidak dikenal, atau dua titik terlalu berdekatan"); return; }
    saveCal();
    Serial.printf("i0 %.0f %.0f %.0f | eps %.3g | pH %.3f*V+%.3f | EC %.1f/V | NTU %.1f*V+%.1f\n", cal.i0_r, cal.i0_g, cal.i0_b, cal.eps_eff, cal.ph_slope, cal.ph_offset, cal.ec_per_volt, cal.turb_slope, cal.turb_offset);
  } else if (a.length()) {
    Serial.println("perintah tidak dikenal, ketik help");
  }
}
}  // namespace

void setup() {
  hal::begin();                        // keluaran mati lebih dulu dari apa pun
  Serial.begin(115200);
  prefs.begin("sebat", false);
  loadState();
  net::begin();
  reportInterruptedBatch();
  esp_task_wdt_init(30, true);         // kendali macet 30 detik: mulai ulang, keluaran kembali mati
  esp_task_wdt_add(nullptr);
  Serial.printf("SEBAT firmware 0.1.0, unit %s. Ketik help.\n", UNIT_ID);
  if (!cal.colorOk()) Serial.println("Sensor warna belum dikalibrasi: batch akan ditolak.");
}

void loop() {
  esp_task_wdt_reset();
  uint32_t now = millis();

  if (Serial.available()) {
    static String line;
    while (Serial.available()) {
      char ch = Serial.read();
      if (ch == '\n') { handleLine(line); line = ""; }
      else if (ch != '\r' && line.length() < 80) line += ch;
    }
  }

  if (now - lastPressMs > 500) {
    if (hal::stopPressed() && active) { lastPressMs = now; trip(Status::SelesaiTanpaVerifikasi, "DIHENTIKAN_OPERATOR"); }
    else if (hal::startPressed() && !active) { lastPressMs = now; startBatch(); }
  }

  // putaran cepat: pengaman dan arus
  if (now - lastFastMs >= 200) {
    double dt = (now - lastFastMs) / 1000.0;
    lastFastMs = now;
    hal::readPower(rd);
    if (active) {
      if (!rd.cell_ok) trip(Status::GagalPengamanListrik, "SENSOR_ARUS_HILANG");   // arus tak terukur = tak terkendali
      Status st;
      const char* fl;
      SafetyIn si = {rd.U_V, rd.I_A, rd.temp_C, !rd.level_low_ok, ctl.state() == State::Running};
      if (ctl.state() != State::Fault && safety.check(cfg, si, &st, &fl)) trip(st, fl);
    }
    hal::serviceCurrent(rd.I_A, dt);
  }

  // langkah kendali, sama dengan simulasi: tiap 10 detik
  if (active && (stepNow || now - lastStepMs >= cfg.sample_interval_s * 1000)) {
    double dt = stepNow && lastStepMs == now ? cfg.sample_interval_s : (now - lastStepMs) / 1000.0;
    stepNow = false;
    lastStepMs = now;
    if (dt <= 0) dt = 0.001;
    controlStep(dt);
    if (active && now - lastCkptMs > 60000) { lastCkptMs = now; saveCheckpoint(true); }
  }
  delay(5);
}
