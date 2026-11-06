import numpy as np
import pytest

from sobat_ml.config import deep_merge, load_config
from sobat_ml.runner import UnitSim
from sobat_ml.wastewater import sample_wastewater


def run(cfg, mode, seed=3, predictor=None, ww=None):
    return UnitSim(cfg, mode, predictor, env_seed=seed).run_batch(ww)


def test_feedback_reaches_target_on_truth(sunny):
    s = run(sunny, "feedback")
    assert s["status"] == "LOLOS"
    assert s["truth"]["pass"] is True


def test_fixed_has_no_verification_and_can_fail(sunny):
    s = run(sunny, "fixed", seed=3)
    assert s["status"] == "SELESAI_TANPA_VERIFIKASI"
    # on a very concentrated batch the timer under-doses
    rng = np.random.default_rng(0)
    ww = sample_wastewater(sunny, rng)
    ww["color"], ww["turb"] = 9000.0, 1500.0
    assert run(sunny, "fixed", ww=ww)["truth"]["pass"] is False


def test_concentrated_sample_is_diluted_not_flagged_as_stuck(sunny):
    cfg = deep_merge(sunny, {"reactor": {"recalcitrant_scale": 0.0}})   # about dilution; the colour floor has its own test
    rng = np.random.default_rng(1)
    ww = sample_wastewater(cfg, rng)
    ww["color"] = 9000.0
    s = run(cfg, "feedback", ww=ww)
    assert "PENGENCERAN_OTOMATIS" in s["flags"]
    assert "SENSOR_MACET" not in s["flags"]
    assert s["status"] == "LOLOS" and s["truth"]["pass"]


def test_unreachable_colour_floor_fails_honestly(sunny):
    """Dye that cannot be removed down to the target must end as a failure, never as a pass."""
    cfg = deep_merge(sunny, {"reactor": {"recalcitrant_scale": 5.0}})
    ww = sample_wastewater(cfg, np.random.default_rng(1))
    ww["color"], ww["dye"] = 9000.0, "campuran_cokelat"     # floor = 20 + 0.15 x 9000, far above 200
    s = run(cfg, "feedback", ww=ww)
    assert not s["truth"]["pass"]
    assert s["status"] != "LOLOS"


def test_stuck_sensor_feedback_stops_safely():
    cfg = load_config("sensor-macet")
    s = run(cfg, "feedback")
    assert s["status"] in ("GAGAL_SENSOR", "GAGAL_WARNA", "LOLOS")
    assert s["run_s"] <= cfg["unit"]["t_max_min"] * 60


def test_energy_split_adds_up(sunny):
    s = run(sunny, "ai")
    assert s["kwh_pv"] + s["kwh_batt"] + s["kwh_grid"] == pytest.approx(s["kwh_total"], rel=0.05, abs=2e-3)
    assert 0 <= s["pct_renewable"] <= 100


def test_policies():
    solar_only = deep_merge(load_config("cerah-umkm-kecil"), {"grid": {"policy": "solar_only"}})
    assert run(solar_only, "feedback")["kwh_grid"] == 0.0
    nopv = deep_merge(load_config("pln-saja"), {"reactor": {"recalcitrant_scale": 0.0}})
    s = run(nopv, "feedback")
    assert s["kwh_grid"] > 0 and s["pct_renewable"] < 10 and s["status"] == "LOLOS"
    dead = deep_merge(load_config("pln-saja"), {"grid": {"policy": "solar_only"}})
    assert run(dead, "feedback")["status"] == "GAGAL_TANPA_DAYA"


def test_safety_temperature_limit():
    cfg = deep_merge(load_config("cerah-umkm-kecil"), {"unit": {"T_max_C": 20.0}})
    assert run(cfg, "feedback")["status"] == "GAGAL_PENGAMAN_SUHU"


def test_device_source_has_no_truth(sunny):
    s = UnitSim(sunny, "feedback", env_seed=3, source="device").run_batch()
    assert s["truth"] is None


def test_telemetry_contract_fields(sunny):
    _, tele = UnitSim(sunny, "ai", env_seed=3).run_batch(keep_telemetry=True)
    need = {"ts", "source", "unit_id", "batch_id", "state", "V_L", "I_A", "U_V", "abs_r", "abs_g", "abs_b",
            "turb_ntu", "ec_uScm", "ph", "temp_C", "pv_W", "bat_V"}
    assert need <= set(tele[0])
    assert all(t["source"] == "simulator" for t in tele)
    states = [t["state"] for t in tele]
    assert states[0] == "FILLING" and states[-1] == "DONE"
    assert [t["ts"] for t in tele] == sorted(t["ts"] for t in tele)


def test_reversals_counted_per_batch(sunny):
    sim = UnitSim(sunny, "feedback", env_seed=3)
    a = sim.run_batch()
    b = sim.run_batch()
    assert b["reversals"] <= a["reversals"] + 20 and b["reversals"] < sim.plant.reversals


def test_batch_ids_unique_across_runs(sunny):
    """Regression: the sim clock restarts on the same date, so without a run tag two runs shared batch ids
    and their telemetry interleaved in one series (sawtooth chart)."""
    a = UnitSim(sunny, "feedback", env_seed=3, run_tag="aaaa").run_batch()["batch_id"]
    b = UnitSim(sunny, "feedback", env_seed=3, run_tag="bbbb").run_batch()["batch_id"]
    assert a != b and a.endswith("-aaaa") and b.endswith("-bbbb")
    assert UnitSim(sunny, "feedback", env_seed=3).run_batch()["batch_id"].count("-") == 3   # default keeps the contract's id shape
