# firmware/include

`pins.h` berisi pemetaan pin dan alamat I2C rakitan rujukan. `secrets.example.h` adalah contoh pengaturan WiFi dan MQTT: salin menjadi `secrets.h`, yang diabaikan git, lalu isi.

`UNIT_ID` harus sama dengan nama pengguna MQTT yang dibuat dengan `infra/mosquitto/make-users.sh`.
