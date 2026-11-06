#include "hal.h"

#include <Adafruit_ADS1X15.h>
#include <Adafruit_TSL2591.h>
#include <Arduino.h>
#include <DallasTemperature.h>
#include <INA226.h>
#include <OneWire.h>
#include <Wire.h>

#include "pins.h"

namespace {
INA226 inaCell(ADDR_INA_CELL), inaPv(ADDR_INA_PV), inaBatt(ADDR_INA_BATT), inaGrid(ADDR_INA_GRID);
Adafruit_TSL2591 tsl(2591);
Adafruit_ADS1115 ads;
OneWire oneWire(PIN_DS18B20);
DallasTemperature ds(&oneWire);
bool tslOk = false, adsOk = false;

constexpr int CC_CH = 0, CC_RES_BITS = 10, CC_MAX = (1 << CC_RES_BITS) - 1;
double setpointA = 0, duty = 0, integral = 0;
int pol = 1;
enum class Rev { Idle, Off, Settle } rev = Rev::Idle;
uint32_t revAt = 0;

void inaInit(INA226& ina) {
  if (ina.begin()) ina.setMaxCurrentShunt(SHUNT_MAX_A, SHUNT_OHM);
}

/** Satu pembacaan cahaya (kanal penuh TSL2591). -1 bila sensor gagal atau jenuh. */
double readLight(int ledPin) {
  if (ledPin >= 0) digitalWrite(ledPin, HIGH);
  delay(20);
  uint32_t lum = tsl.getFullLuminosity();
  if (ledPin >= 0) digitalWrite(ledPin, LOW);
  uint16_t full = lum & 0xFFFF;
  if (full == 0xFFFF) return -1;
  return full;
}

double adcVolts(int ch) {
  float v[5];
  for (float& x : v) x = ads.computeVolts(ads.readADC_SingleEnded(ch));
  for (int i = 1; i < 5; i++) { float t = v[i]; int j = i - 1; while (j >= 0 && v[j] > t) { v[j + 1] = v[j]; j--; } v[j + 1] = t; }
  return v[2];
}
}  // namespace

namespace hal {

void allOff() {
  for (int p : {PIN_PUMP, PIN_MIXER, PIN_DILUTE, PIN_GRID, PIN_POLARITY, PIN_DCDC_EN, PIN_LED_R, PIN_LED_G, PIN_LED_B}) digitalWrite(p, LOW);
  ledcWrite(CC_CH, 0);
  setpointA = duty = integral = 0;
  rev = Rev::Idle;
  pol = 1;
}

void begin() {
  for (int p : {PIN_PUMP, PIN_MIXER, PIN_DILUTE, PIN_GRID, PIN_POLARITY, PIN_DCDC_EN, PIN_LED_R, PIN_LED_G, PIN_LED_B}) pinMode(p, OUTPUT);
  ledcSetup(CC_CH, 5000, CC_RES_BITS);
  ledcAttachPin(PIN_CC_PWM, CC_CH);
  allOff();
  pinMode(PIN_LEVEL_HIGH, INPUT);
  pinMode(PIN_LEVEL_LOW, INPUT);
  pinMode(PIN_START, INPUT_PULLUP);
  pinMode(PIN_STOP, INPUT_PULLUP);
  Wire.begin(PIN_SDA, PIN_SCL);
  inaInit(inaCell); inaInit(inaPv); inaInit(inaBatt); inaInit(inaGrid);
  tslOk = tsl.begin();
  if (tslOk) { tsl.setGain(TSL2591_GAIN_MED); tsl.setTiming(TSL2591_INTEGRATIONTIME_100MS); }
  adsOk = ads.begin(ADDR_ADS);
  if (adsOk) ads.setGain(GAIN_ONE);
  ds.begin();
  ds.setWaitForConversion(true);
}

void readPower(Reading& r) {
  r.cell_ok = inaCell.isConnected();
  r.power_ok = inaPv.isConnected() && inaBatt.isConnected() && inaGrid.isConnected();
  if (r.cell_ok) {
    r.I_A = fabs(inaCell.getCurrent());
    r.U_V = inaCell.getBusVoltage();
  }
  if (r.power_ok) {
    r.pv_W = fabs(inaPv.getPower());
    r.bat_V = inaBatt.getBusVoltage();
    r.batt_W = inaBatt.getCurrent() * r.bat_V;
    r.grid_W = fabs(inaGrid.getPower());
  }
  r.level_high = digitalRead(PIN_LEVEL_HIGH) == LOW;
  r.level_low_ok = digitalRead(PIN_LEVEL_LOW) == LOW;
}

void readWater(Reading& r, const sobat::Calibration& c, double abs_sat) {
  r.water_ok = false;
  if (!tslOk || !adsOk) return;
  ds.requestTemperatures();
  float t = ds.getTempCByIndex(0);
  if (t == DEVICE_DISCONNECTED_C || t < -10 || t > 120) return;
  r.temp_C = t;
  r.dark = readLight(-1);
  if (r.dark < 0) return;
  r.light_r = readLight(PIN_LED_R);
  r.light_g = readLight(PIN_LED_G);
  r.light_b = readLight(PIN_LED_B);
  // cahaya terlalu terang sehingga jenuh: pembacaan tidak bisa dipakai, bukan berarti air jernih
  if (r.light_r < 0 || r.light_g < 0 || r.light_b < 0) return;
  // i0 sudah dikurangi gelap saat dinolkan
  r.abs_r = sobat::absorbance(r.light_r, r.dark, c.i0_r, abs_sat);
  r.abs_g = sobat::absorbance(r.light_g, r.dark, c.i0_g, abs_sat);
  r.abs_b = sobat::absorbance(r.light_b, r.dark, c.i0_b, abs_sat);
  r.v_ph = adcVolts(ADC_PH);
  r.v_ec = adcVolts(ADC_EC);
  r.v_turb = adcVolts(ADC_TURB);
  r.ph = sobat::phFromVolt(c, r.v_ph);
  r.ec_uScm = sobat::ecFromVolt(c, r.v_ec, r.temp_C);
  r.turb_ntu = sobat::turbFromVolt(c, r.v_turb);
  r.water_ok = true;
}

void setCurrent(double amps) {
  if (amps <= 0) {
    setpointA = 0;
    if (rev == Rev::Idle) digitalWrite(PIN_DCDC_EN, LOW);
    ledcWrite(CC_CH, 0);
    duty = integral = 0;
    return;
  }
  setpointA = amps;
  if (rev == Rev::Idle) digitalWrite(PIN_DCDC_EN, HIGH);
}

void requestReverse() {
  if (rev != Rev::Idle) return;
  digitalWrite(PIN_DCDC_EN, LOW);      // relai tidak boleh berpindah saat arus mengalir
  rev = Rev::Off;
  revAt = millis();
}

void serviceCurrent(double measured_A, double dt) {
  if (rev == Rev::Off && millis() - revAt >= 2000) {
    pol = -pol;
    digitalWrite(PIN_POLARITY, pol < 0 ? HIGH : LOW);
    rev = Rev::Settle;
    revAt = millis();
  } else if (rev == Rev::Settle && millis() - revAt >= 500) {
    rev = Rev::Idle;
    integral = 0;
    if (setpointA > 0) digitalWrite(PIN_DCDC_EN, HIGH);
  }
  if (setpointA <= 0 || rev != Rev::Idle) return;
  // PI lambat: converter sudah menjaga arus sendiri, ini hanya menyamakan setelan dengan yang terukur [CEK penguatan di bench]
  double err = setpointA - measured_A;
  integral += err * dt;
  if (integral > 200) integral = 200;
  if (integral < -200) integral = -200;
  duty = 40.0 * setpointA + 8.0 * err + 2.0 * integral;
  ledcWrite(CC_CH, (uint32_t)constrain(duty, 0.0, (double)CC_MAX));
}

int polarity() { return pol; }
void setPump(bool on) { digitalWrite(PIN_PUMP, on); }
void setMixer(bool on) { digitalWrite(PIN_MIXER, on); }
void setDilute(bool on) { digitalWrite(PIN_DILUTE, on); }
void setGrid(bool on) { digitalWrite(PIN_GRID, on); }
bool startPressed() { return digitalRead(PIN_START) == LOW; }
bool stopPressed() { return digitalRead(PIN_STOP) == LOW; }

}  // namespace hal
