"""Per-unit calibration, colour-plateau stop, and the A/B/C/auto simulation options."""
import math
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import deep_merge, load_config, load_presets
from app.main import create_app
from app.predictor import DosePredictor, UnitCalibrator
from app.robustness import world_cfg
from app.runner import UnitSim
from app.settings import Settings
from app.wastewater import sample_wastewater


def test_calibrator_waits_then_learns_then_forgets():
    c = UnitCalibrator(window=3, min_batches=2, limits=(0.25, 4.0))
    c.add(200, 100)
    assert c.factor == 1.0                          # one batch is not enough to change behaviour
    c.add(200, 100)
    assert math.isclose(c.factor, 2.0)
    for _ in range(3):
        c.add(100, 100)
    assert math.isclose(c.factor, 1.0)              # old errors fall out of the window


def test_calibrator_is_bounded():
    c = UnitCalibrator(5, 1, (0.25, 4.0))
    c.add(1000, 1)
    assert c.factor == 4.0


@pytest.fixture(scope="module")
def predictor():
    """A small real model, trained on the baseline world."""
    from app.robustness import train
    return train(load_config("baseline"), 150, False)


def test_unit_learns_a_plant_slower_than_the_model_expects(predictor):
    cfg = world_cfg(load_config("baseline"), k_d=0.5)
    sim = UnitSim(cfg, "ai", predictor, env_seed=11)
    rows = [sim.run_batch() for _ in range(12)]
    assert rows[0]["calib_factor"] == 1.0
    assert rows[-1]["calib_factor"] > 1.3
    assert rows[-1]["q_pred"] == pytest.approx(rows[-1]["q_pred_raw"] * rows[-1]["calib_factor"], rel=0.01)


def test_calibration_can_be_switched_off(predictor):
    cfg = deep_merge(world_cfg(load_config("baseline"), k_d=0.5), {"control": {"unit_calibration": {"enabled": False}}})
    sim = UnitSim(cfg, "ai", predictor, env_seed=11)
    assert all(sim.run_batch()["calib_factor"] == 1.0 for _ in range(6))


def _stubborn(cfg):
    ww = sample_wastewater(cfg, np.random.default_rng(1))
    ww["color"], ww["dye"] = 5000.0, "campuran_cokelat"   # floor = 20 + 0.03 x scale x 5000
    return ww


def test_plateau_stops_early_and_fails_honestly():
    base = deep_merge(load_config("cerah-umkm-kecil"), {"reactor": {"recalcitrant_scale": 6.0}, "unit": {"t_max_min": 300}})
    off = deep_merge(base, {"control": {"plateau_dq_CperL": None}})
    on_s = UnitSim(base, "feedback", env_seed=3).run_batch(_stubborn(base))
    off_s = UnitSim(off, "feedback", env_seed=3).run_batch(_stubborn(off))
    assert on_s["status"] == "GAGAL_WARNA_MENTOK" and "WARNA_MENTOK" in on_s["flags"] and not on_s["truth"]["pass"]
    assert on_s["retries"] == 0                      # repeating cannot help
    assert on_s["kwh"] < 0.7 * off_s["kwh"]          # the whole point: energy is not wasted


def test_plateau_does_not_fire_on_normal_batches():
    cfg = deep_merge(load_config("cerah-umkm-kecil"), {"reactor": {"recalcitrant_scale": 0.0}})
    rows = [UnitSim(cfg, "feedback", env_seed=i).run_batch() for i in range(25)]
    assert not any("WARNA_MENTOK" in r["flags"] for r in rows)


def test_plateau_does_not_fire_on_slow_plant():
    cfg = world_cfg(load_config("baseline"), k_d=0.14, recalc=0.0)
    rows = [UnitSim(cfg, "feedback", env_seed=i).run_batch() for i in range(6)]
    assert not any("WARNA_MENTOK" in r["flags"] for r in rows)


def test_adopt_keeps_the_same_physical_unit():
    a = UnitSim(load_config("cerah-umkm-kecil"), "feedback", env_seed=1, run_tag="abcd")
    a.run_batch()
    a.plant.L = 0.2
    b = UnitSim(load_config("hibrida-mendung"), "feedback", env_seed=2)
    b.adopt(a)
    assert b.clock == a.clock and b.n_batch == a.n_batch and b.run_tag == "abcd"
    assert b.battery.soc == a.battery.soc and b.plant.L == 0.2 and b.ctrl.calib is a.ctrl.calib
    assert (b.sensors.baseline == a.sensors.baseline).all()
    assert b.cfg["solar"]["weather"] == "mendung"    # but new conditions


def test_presets_point_at_real_scenarios_and_weights_are_sane():
    d = load_presets()
    assert set(d["presets"]) == {"A", "B", "C"}
    for v in d["presets"].values():
        load_config(v["scenario"])
    assert set(d["auto"]["weights"]) == set(d["presets"]) and sum(d["auto"]["weights"].values()) == pytest.approx(1)


@pytest.fixture
def client():
    s = Settings(db_path=":memory:", admin_password="rahasia", secret="s" * 32).finalize()
    with TestClient(create_app(s)) as c:
        yield c


def _admin(c):
    return {"Authorization": "Bearer " + c.post("/api/auth/login", json={"username": "admin", "password": "rahasia"}).json()["token"]}


@pytest.mark.parametrize("preset,expected", [("A", "A"), ("C", "C")])
def test_api_starts_a_fixed_option(client, preset, expected):
    a = _admin(client)
    r = client.post("/api/sim/start", json={"preset": preset, "mode": "feedback", "speed": 1200}, headers=a).json()
    assert r["preset"] == preset
    for _ in range(40):
        time.sleep(0.1)
        if client.get("/api/sim", headers=a).json()["current"]:
            break
    assert client.get("/api/sim", headers=a).json()["current"] == expected
    client.post("/api/sim/stop", headers=a)


def test_api_auto_mixes_options_and_keeps_going(client):
    a = _admin(client)
    assert client.post("/api/sim/start", json={"preset": "auto", "mode": "feedback", "speed": 1200}, headers=a).json()["preset"] == "auto"
    seen, stamps = set(), []
    for _ in range(120):
        time.sleep(0.25)
        seen |= {b.get("scenario") for b in client.get("/api/batches?limit=200", headers=a).json()["batches"]}
        if len(seen - {None}) >= 2:
            break
    client.post("/api/sim/stop", headers=a)
    assert len(seen - {None}) >= 2 and (seen - {None}) <= {"A", "B", "C"}


def test_api_rejects_unknown_option_and_viewers(client):
    a = _admin(client)
    assert client.post("/api/sim/start", json={"preset": "Z"}, headers=a).status_code == 404
    v = {"Authorization": "Bearer " + client.post("/api/auth/demo").json()["token"]}
    assert client.post("/api/sim/start", json={"preset": "A"}, headers=v).status_code == 403
    assert client.get("/api/sim/presets", headers=v).status_code == 200


def test_grid_only_has_no_renewable_share():
    """No panel and no battery: pumps and sensors run on the grid from the first second."""
    s = UnitSim(load_config("pln-saja"), "feedback", env_seed=5).run_batch()
    assert s["kwh_pv"] == 0 and s["kwh_batt"] == 0 and s["pct_renewable"] == 0 and s["kwh_grid"] > 0


def test_energy_by_source_adds_up_to_load_served():
    s = UnitSim(load_config("cerah-umkm-kecil"), "feedback", env_seed=5).run_batch()
    assert s["kwh_pv"] + s["kwh_batt"] + s["kwh_grid"] == pytest.approx(s["kwh_total"], abs=0.002)
