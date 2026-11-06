#include "net.h"

#include <Arduino.h>
#include <LittleFS.h>
#include <MQTT.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <time.h>

#include "secrets.h"

namespace {
constexpr int MAX_OUTBOX = 40;
constexpr int MSG_SIZE = 2600;
const char* OUTBOX = "/outbox";

#if MQTT_TLS
WiFiClientSecure tcp;
#else
WiFiClient tcp;
#endif
MQTTClient mqtt(MSG_SIZE);
QueueHandle_t teleQ;
SemaphoreHandle_t fsLock;
char topicT[64], topicB[64], topicS[64];
volatile bool isOnline = false;
const long MIN_VALID_TIME = 1700000000;   // jam di bawah ini berarti NTP belum berhasil

void publishStatus() {
  char s[80];
  snprintf(s, sizeof s, "{\"online\":true,\"fw\":\"0.1.0\",\"rssi\":%d}", WiFi.RSSI());
  mqtt.publish(topicS, s, strlen(s), true, 1);
}

void sendOneFromOutbox() {
  static char buf[MSG_SIZE];
  String path;
  xSemaphoreTake(fsLock, portMAX_DELAY);
  File dir = LittleFS.open(OUTBOX);
  String oldest;
  if (dir) {
    File f;
    while ((f = dir.openNextFile())) {
      String n = String(OUTBOX) + "/" + f.name();
      if (oldest.isEmpty() || n < oldest) oldest = n;
      f.close();
    }
    dir.close();
  }
  int len = -1;
  if (!oldest.isEmpty()) {
    File f = LittleFS.open(oldest, "r");
    if (f) { len = f.readBytes(buf, sizeof buf - 1); f.close(); }
  }
  xSemaphoreGive(fsLock);
  if (len <= 0) return;
  buf[len] = 0;
  if (mqtt.publish(topicB, buf, len, false, 1)) {   // QoS 1: baru dihapus setelah broker mengakui
    xSemaphoreTake(fsLock, portMAX_DELAY);
    LittleFS.remove(oldest);
    xSemaphoreGive(fsLock);
  }
}

void task(void*) {
  uint32_t lastTry = 0, lastStatus = 0;
  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      isOnline = false;
      if (millis() - lastTry > 15000) { lastTry = millis(); WiFi.disconnect(); WiFi.begin(WIFI_SSID, WIFI_PASS); }
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }
    if (!mqtt.connected()) {
      isOnline = false;
      if (millis() - lastTry > 5000) {
        lastTry = millis();
        if (mqtt.connect(UNIT_ID, UNIT_ID, MQTT_PASS)) publishStatus();
      }
      vTaskDelay(pdMS_TO_TICKS(200));
      continue;
    }
    isOnline = true;
    mqtt.loop();
    char* msg;
    while (xQueueReceive(teleQ, &msg, 0) == pdTRUE) {
      mqtt.publish(topicT, msg, strlen(msg), false, 1);
      free(msg);
    }
    sendOneFromOutbox();
    if (millis() - lastStatus > 60000) { lastStatus = millis(); publishStatus(); }
    vTaskDelay(pdMS_TO_TICKS(200));
  }
}
}  // namespace

namespace net {

void begin() {
  snprintf(topicT, sizeof topicT, "sobat/%s/%s/telemetry", SITE_ID, UNIT_ID);
  snprintf(topicB, sizeof topicB, "sobat/%s/%s/batch", SITE_ID, UNIT_ID);
  snprintf(topicS, sizeof topicS, "sobat/%s/%s/status", SITE_ID, UNIT_ID);
  fsLock = xSemaphoreCreateMutex();
  teleQ = xQueueCreate(6, sizeof(char*));
  if (!LittleFS.begin(true)) Serial.println("[net] LittleFS gagal: ringkasan batch tidak bisa disimpan");
  LittleFS.mkdir(OUTBOX);
#if MQTT_TLS
  tcp.setInsecure();   // [CEK] pasang sertifikat akar sebelum dipakai di internet: setCACert()
#endif
  static const char will[] = "{\"online\":false}";
  mqtt.setWill(topicS, will, true, 1);
  mqtt.setOptions(30, true, 3000);
  mqtt.begin(MQTT_HOST, MQTT_PORT, tcp);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  configTzTime("WIB-7", "pool.ntp.org", "time.google.com");
  xTaskCreatePinnedToCore(task, "net", 8192, nullptr, 1, nullptr, 0);   // inti 0; kendali di inti 1
}

void sendTelemetry(const char* json) {
  if (!isOnline || !teleQ) return;
  char* copy = strdup(json);
  if (!copy) return;
  if (xQueueSend(teleQ, &copy, 0) != pdTRUE) free(copy);
}

bool queueBatch(const char* json) {
  xSemaphoreTake(fsLock, portMAX_DELAY);
  int count = 0;
  String oldest;
  File dir = LittleFS.open(OUTBOX);
  if (dir) {
    File f;
    while ((f = dir.openNextFile())) {
      String n = String(OUTBOX) + "/" + f.name();
      if (oldest.isEmpty() || n < oldest) oldest = n;
      count++;
      f.close();
    }
    dir.close();
  }
  if (count >= MAX_OUTBOX && !oldest.isEmpty()) {
    Serial.printf("[net] kotak keluar penuh, membuang %s\n", oldest.c_str());
    LittleFS.remove(oldest);
  }
  // Nama berurutan agar urutan kirim sama dengan urutan selesai, juga setelah perangkat mati.
  static uint32_t seq = 0;
  if (seq == 0) seq = (uint32_t)esp_random() >> 8;
  if (!oldest.isEmpty()) {
    uint32_t last = 0;
    File d2 = LittleFS.open(OUTBOX);
    File f;
    while (d2 && (f = d2.openNextFile())) { uint32_t v = strtoul(f.name(), nullptr, 10); if (v > last) last = v; f.close(); }
    if (d2) d2.close();
    seq = last;
  }
  seq++;
  char path[40];
  snprintf(path, sizeof path, "%s/%010u.json", OUTBOX, (unsigned)seq);
  File out = LittleFS.open(path, "w");
  bool ok = false;
  if (out) { ok = out.print(json) == strlen(json); out.close(); }
  xSemaphoreGive(fsLock);
  return ok;
}

bool online() { return isOnline; }
bool timeSynced() { return time(nullptr) > MIN_VALID_TIME; }
long now() { long t = time(nullptr); return t > MIN_VALID_TIME ? t : 0; }

int outboxCount() {
  xSemaphoreTake(fsLock, portMAX_DELAY);
  int count = 0;
  File dir = LittleFS.open(OUTBOX);
  File f;
  while (dir && (f = dir.openNextFile())) { count++; f.close(); }
  if (dir) dir.close();
  xSemaphoreGive(fsLock);
  return count;
}

}  // namespace net
