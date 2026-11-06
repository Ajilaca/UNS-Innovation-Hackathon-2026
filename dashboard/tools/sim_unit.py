"""Unit simulator as an independent client: sends the SAME contract as a real ESP32 (MQTT or HTTP) or prints it.

  python tools/sim_unit.py --scenario cerah-umkm-kecil --mode ai --dry-run
  python tools/sim_unit.py --mqtt-host localhost --mqtt-user lwy-001 --mqtt-password ... --speed 120
  python tools/sim_unit.py --http http://localhost:8000 --token <admin-token> --speed 120
Run from the project root with the project venv.
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "ML"))
from sobat_ml import experiments as ex  # noqa: E402
from sobat_ml.config import load_config  # noqa: E402
from sobat_ml.runner import UnitSim  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", default="baseline")
    ap.add_argument("--mode", default="ai", choices=["fixed", "feedback", "ai"])
    ap.add_argument("--batches", type=int, default=3)
    ap.add_argument("--speed", type=float, default=0, help="0 = secepat mungkin")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--tag", default=None, help="penanda jalan pada batch_id (default: acak) supaya ID tidak bentrok antar jalan")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--mqtt-host"); ap.add_argument("--mqtt-port", type=int, default=1883)
    ap.add_argument("--mqtt-user"); ap.add_argument("--mqtt-password")
    ap.add_argument("--http"); ap.add_argument("--token")
    a = ap.parse_args()
    cfg = load_config(a.scenario)
    import secrets
    sim = UnitSim(cfg, a.mode, ex.load_predictor(cfg), env_seed=a.seed, run_tag=a.tag if a.tag is not None else secrets.token_hex(2))
    site, unit = cfg["site"]["id"], cfg["unit"]["unit_id"]
    send_t = send_b = lambda d: print(json.dumps(d))
    pending = []
    if a.mqtt_host:
        import paho.mqtt.client as mqtt
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        if a.mqtt_user:
            c.username_pw_set(a.mqtt_user, a.mqtt_password)
        c.connect(a.mqtt_host, a.mqtt_port)
        c.loop_start()
        def pub(topic, d):
            pending.append(c.publish(topic, json.dumps(d), qos=1))
            if len(pending) > 200:                      # jangan biarkan antrean tak terbatas
                pending.pop(0).wait_for_publish(timeout=10)
        send_t = lambda d: pub(f"sobat/{site}/{unit}/telemetry", d)
        send_b = lambda d: pub(f"sobat/{site}/{unit}/batch", d)
    elif a.http:
        import httpx
        h = {"Authorization": f"Bearer {a.token}"}
        send_t = lambda d: httpx.post(a.http + "/api/ingest/telemetry", json=d, headers=h, timeout=10).raise_for_status()
        send_b = lambda d: httpx.post(a.http + "/api/ingest/batch", json=d, headers=h, timeout=10).raise_for_status()
    elif not a.dry_run:
        sys.exit("pilih --dry-run, --mqtt-host, atau --http")
    dt = cfg["unit"]["sample_interval_s"]
    for _ in range(a.batches):
        for m in sim.iter_batch():
            send_t(m)
            if a.speed > 0:
                time.sleep(dt / a.speed)
        send_b({k: v for k, v in sim.summary.items() if k != "features"})
        if sim.clock.hour + sim.clock.minute / 60 > cfg["solar"]["last_start_hour"]:
            sim.maintenance()
            sim.skip_to_morning()
    for info in pending:                                 # tunggu semua pesan benar-benar terkirim sebelum keluar
        info.wait_for_publish(timeout=10)
    if a.mqtt_host:
        c.loop_stop()


if __name__ == "__main__":
    main()
