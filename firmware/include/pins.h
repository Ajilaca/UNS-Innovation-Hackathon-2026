// Pemetaan pin dan alamat I2C untuk rakitan rujukan. Ini usulan, belum diuji pada papan nyata:
// sesuaikan dengan rakitan Anda sebelum mengunggah. Hindari GPIO 0, 2, 5, 12, 15 (strapping).
#pragma once

// I2C: INA226 (4x), TSL2591, ADS1115
constexpr int PIN_SDA = 21, PIN_SCL = 22;
constexpr int ADDR_INA_CELL = 0x40;   // sel elektrolisis
constexpr int ADDR_INA_PV = 0x41;     // keluaran MPPT
constexpr int ADDR_INA_BATT = 0x44;   // baterai; shunt dipasang agar arus keluar baterai terbaca positif
constexpr int ADDR_INA_GRID = 0x45;   // catu PLN
constexpr int ADDR_ADS = 0x48;
constexpr float SHUNT_OHM = 0.005f;   // shunt 75 mV / 15 A; ganti sesuai yang dibeli
constexpr float SHUNT_MAX_A = 15.0f;

// ADS1115: tegangan masuk tidak boleh melebihi 3,3 V. Modul 5 V butuh pembagi tegangan.
// Kalibrasi dilakukan pada tegangan di pin ADC, jadi nilai pembagi tidak perlu dimasukkan.
constexpr int ADC_PH = 0, ADC_EC = 1, ADC_TURB = 2;

constexpr int PIN_DS18B20 = 4;

// Keluaran. Semua LOW saat menyala: pompa, pengaduk, PLN, dan arus mati sampai diperintah.
constexpr int PIN_PUMP = 25;
constexpr int PIN_MIXER = 26;
constexpr int PIN_DILUTE = 27;
constexpr int PIN_GRID = 33;          // relai PLN
constexpr int PIN_POLARITY = 32;      // relai DPDT pembalik polaritas; hanya berpindah saat arus nol
constexpr int PIN_DCDC_EN = 23;       // aktifkan buck converter
constexpr int PIN_CC_PWM = 18;        // setelan arus: PWM lewat filter RC ke pin trim converter [CEK datasheet]
constexpr int PIN_LED_R = 16, PIN_LED_G = 17, PIN_LED_B = 19;

// Masukan, dengan resistor pull-up luar (GPIO 34/35 tidak punya pull-up internal).
constexpr int PIN_LEVEL_HIGH = 34;    // pelampung atas: LOW berarti air sudah sampai
constexpr int PIN_LEVEL_LOW = 35;     // pelampung bawah: LOW berarti elektroda masih terendam
constexpr int PIN_START = 13;         // tombol mulai ke GND
constexpr int PIN_STOP = 14;          // tombol henti ke GND
