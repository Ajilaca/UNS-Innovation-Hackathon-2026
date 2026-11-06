import json
import time

import pytest
from fastapi.testclient import TestClient

from app import mqtt_bridge
from app.influx import to_line
from app.main import create_app
from app.settings import Settings

TEL = {"ts": 1762400000, "source": "device", "site_id": "lwy", "unit_id": "lwy-001", "batch_id": "lwy-001-20261204-03",
       "state": "RUNNING", "V_L": 50.0, "I_A": 5.02, "U_V": 11.8, "abs_r": 0.412, "abs_g": 0.655, "abs_b": 0.301,
       "turb_ntu": 85.3, "ec_uScm": 3150, "ph": 9.6, "temp_C": 31.4, "pv_W": 142.0, "bat_V": 13.1}
BATCH = {"batch_id": "lwy-001-20261204-03", "unit_id": "lwy-001", "site_id": "lwy", "source": "device", "status": "LOLOS",
         "ts_start": 1762400000, "ts_end": 1762403600, "V_L": 50, "kwh": 0.04, "truth": {"color_end": 1}}


@pytest.fixture
def client():
    s = Settings(db_path=":memory:", admin_password="rahasia", secret="s" * 32, device_keys={"lwy-001": "kunci123"}).finalize()
    with TestClient(create_app(s)) as c:
        yield c


def admin(c):
    t = c.post("/api/auth/login", json={"username": "admin", "password": "rahasia"}).json()["token"]
    return {"Authorization": f"Bearer {t}"}


def viewer(c):
    return {"Authorization": "Bearer " + c.post("/api/auth/demo").json()["token"]}


def test_auth_required_and_login(client):
    assert client.get("/api/units").status_code == 401
    assert client.post("/api/auth/login", json={"username": "admin", "password": "salah"}).status_code == 401
    assert client.get("/api/units", headers=admin(client)).status_code == 200
    assert client.get("/api/units", headers={"Authorization": "Bearer abc.def"}).status_code == 401
    assert client.get("/api/health").json()["status"] == "ok"


def test_viewer_cannot_control(client):
    h = viewer(client)
    assert client.get("/api/units", headers=h).status_code == 200
    assert client.post("/api/sim/start", json={}, headers=h).status_code == 403
    assert client.post("/api/jobs/train", headers=h).status_code == 403


def test_device_ingest_rules(client):
    assert client.post("/api/ingest/telemetry", json=TEL).status_code == 401
    assert client.post("/api/ingest/telemetry", json=TEL, headers={"X-Device-Key": "salah"}).status_code == 401
    assert client.post("/api/ingest/telemetry", json=TEL, headers={"X-Device-Key": "kunci123"}).status_code == 202
    sim = dict(TEL, source="simulator")                     # a device key must not be able to inject simulator data
    assert client.post("/api/ingest/telemetry", json=sim, headers={"X-Device-Key": "kunci123"}).status_code == 401
    assert client.post("/api/ingest/telemetry", json=sim, headers=admin(client)).status_code == 202


def test_out_of_range_rejected(client):
    h = {"X-Device-Key": "kunci123"}
    assert client.post("/api/ingest/telemetry", json=dict(TEL, ph=19), headers=h).status_code == 422
    assert client.post("/api/ingest/telemetry", json=dict(TEL, state="TERBANG"), headers=h).status_code == 422
    bad = {k: v for k, v in TEL.items() if k != "source"}
    assert client.post("/api/ingest/telemetry", json=bad, headers=h).status_code == 422


def test_truth_stripped_for_device_and_read_back(client):
    h = {"X-Device-Key": "kunci123"}
    client.post("/api/ingest/telemetry", json=TEL, headers=h)
    client.post("/api/ingest/batch", json=BATCH, headers=h)
    a = admin(client)
    b = client.get(f"/api/batches/{BATCH['batch_id']}", headers=a).json()
    assert "truth" not in b["batch"] and len(b["points"]) == 1
    assert client.get("/api/units/lwy-001/latest", headers=a).json()["ph"] == 9.6
    u = client.get("/api/units", headers=a).json()["units"]
    assert u[0]["unit_id"] == "lwy-001" and u[0]["online"] is True
    assert client.get("/api/units/nope/latest", headers=a).status_code == 404


def test_csv_report(client):
    client.post("/api/ingest/batch", json=BATCH, headers={"X-Device-Key": "kunci123"})
    r = client.get("/api/report.csv", headers=admin(client))
    assert r.status_code == 200 and r.text.startswith("﻿Waktu selesai")
    assert "LOLOS" in r.text and "Perangkat" in r.text


def test_predict(client):
    r = client.post("/api/predict", json={"color0_ptco": 2500, "ph": 9.5}, headers=admin(client)).json()
    assert r["q_lo"] < r["q"] < r["q_hi"] and r["minutes"] > 0
    assert client.post("/api/predict", json={"color0_ptco": -1}, headers=admin(client)).status_code == 422


def test_mqtt_handler(client):
    hub = client.app.state.hub
    ok = mqtt_bridge.handle(hub, "sobat/lwy/lwy-001/telemetry", json.dumps(TEL).encode())
    assert ok == "telemetry"
    assert mqtt_bridge.handle(hub, "sobat/lwy/lwy-001/batch", json.dumps(BATCH).encode()) == "batch"
    assert mqtt_bridge.handle(hub, "sobat/lwy/lain-9/telemetry", json.dumps(TEL).encode()).startswith("rejected")
    assert mqtt_bridge.handle(hub, "sobat/lwy/lwy-001/telemetry", b"bukan json").startswith("rejected")
    assert mqtt_bridge.handle(hub, "topik/lain", b"{}") == "ignored"


def test_influx_line_protocol():
    line = to_line(dict(TEL, source="device"))
    assert line.startswith("telemetry,unit_id=lwy-001,site_id=lwy,source=device,state=RUNNING ")
    assert "ph=9.6" in line and line.endswith(str(1762400000 * 10**9))


def test_live_sim_feeds_hub(client):
    a = admin(client)
    r = client.post("/api/sim/start", json={"scenario": "cerah-umkm-kecil", "mode": "feedback", "speed": 1200}, headers=a)
    assert r.status_code == 200
    for _ in range(40):
        time.sleep(0.25)
        if client.get("/api/units/lwy-001/series", headers=a).json()["points"]:
            break
    pts = client.get("/api/units/lwy-001/series", headers=a).json()["points"]
    assert pts and all(p["source"] == "simulator" for p in pts)
    assert client.post("/api/sim/start", json={"scenario": "tidak-ada"}, headers=a).status_code == 404
    client.post("/api/sim/stop", headers=a)
    assert client.get("/api/sim", headers=a).json()["running"] is False


def test_live_restart_continues_after_last_simulated_batch(client):
    a = admin(client)
    client.app.state.store.upsert_batch({**BATCH, "batch_id": "lama", "source": "simulator", "ts_end": 1794000000})   # 12 Nov 2026 WIB-ish
    live = client.app.state.live
    from sobat_ml.config import load_config
    start = live._resume_clock(load_config("cerah-umkm-kecil"))
    assert start.timestamp() > 1794000000 - 8 * 3600 and start.hour == 8
    client.post("/api/sim/start", json={"scenario": "cerah-umkm-kecil", "mode": "feedback", "speed": 1200}, headers=a)
    for _ in range(40):
        time.sleep(0.2)
        pts = client.get("/api/units/lwy-001/series", headers=a).json()["points"]
        if pts:
            break
    client.post("/api/sim/stop", headers=a)
    assert pts[0]["ts"] > 1794000000                # newer than the old batch, so it sorts first


def test_live_restarts_do_not_mix_series(client):
    a = admin(client)
    ids = []
    for _ in range(2):
        client.post("/api/sim/start", json={"scenario": "cerah-umkm-kecil", "mode": "feedback", "speed": 1200}, headers=a)
        for _ in range(40):
            time.sleep(0.2)
            pts = client.get("/api/units/lwy-001/series", headers=a).json()
            if pts["points"]:
                break
        ids.append(pts["batch_id"])
        client.post("/api/sim/stop", headers=a)
    assert ids[0] != ids[1]
    pts = client.get("/api/units/lwy-001/series", headers=a).json()["points"]
    stamps = [p["ts"] for p in pts]
    assert len(stamps) == len(set(stamps))          # one run only: no duplicated timestamps
