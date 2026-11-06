# dashboard/infra/mosquitto

| Berkas | Isi |
|---|---|
| `mosquitto.conf`, `mosquitto.tls.conf` | Konfigurasi broker, tanpa dan dengan TLS |
| `acl` | Hak akses. Backend boleh membaca `sobat/#`; perangkat hanya boleh menulis ke topik unitnya sendiri |
| `make-users.sh` | Membuat atau mengubah pengguna MQTT |

```bash
# dari folder dashboard/
ENV_FILE=.env infra/mosquitto/make-users.sh backend "sandi"
ENV_FILE=.env infra/mosquitto/make-users.sh lwy-001 "sandi-perangkat"
```

Nama pengguna perangkat harus sama dengan `unit_id`, karena ACL memakainya untuk menentukan topik.
