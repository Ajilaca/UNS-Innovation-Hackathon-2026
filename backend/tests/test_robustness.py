import math

from app.config import load_config
from app.robustness import corrected, world_cfg
from app.sensitivity import _set, sensitivity


def test_correction_removes_a_constant_bias_after_warmup():
    obs = [100.0, 200.0, 150.0, 300.0, 250.0, 120.0]
    preds = [o * 0.5 for o in obs]          # a unit that always needs twice the prediction
    p, o = corrected(preds, obs, window=5, warmup=3)
    assert len(p) == 3
    assert all(math.isclose(a, b, rel_tol=1e-9) for a, b in zip(p, o))


def test_correction_uses_only_past_batches():
    preds, obs = [100.0] * 4, [100.0, 100.0, 100.0, 900.0]
    p, _ = corrected(preds, obs, warmup=3)
    assert math.isclose(p[0], 100.0)        # the surprise in batch 4 cannot leak into its own prediction


def test_world_scales_only_what_it_names():
    c = load_config("baseline")
    w = world_cfg(c, k_d=0.5)
    assert math.isclose(w["reactor"]["k_d_Fe"], c["reactor"]["k_d_Fe"] * 0.5)
    assert w["sensor"]["eps_scale"] == c["sensor"]["eps_scale"]
    assert c["unit"]["pv_wp"] != 0 and w["unit"]["pv_wp"] == 0   # input config untouched


def test_set_nested_does_not_touch_siblings():
    c = load_config("baseline")
    d = _set(c, "reactor.current_eff.Fe", 0.5)
    assert d["reactor"]["current_eff"] == {"Fe": 0.5, "Al": c["reactor"]["current_eff"]["Al"]}
    assert c["reactor"]["current_eff"]["Fe"] != 0.5


def test_sensor_miscalibration_breaks_feedback_but_not_the_timer(monkeypatch):
    """Guards the sweep's headline finding: closed-loop quality rests on sensor calibration."""
    import app.sensitivity as sn
    monkeypatch.setattr(sn, "PARAMS", [("Skala sensor", "sensor.eps_scale", [0.6])])
    c = load_config("baseline")
    res = sensitivity(c, None, n=12)
    rows = {r["label"]: r for r in res["rows"]}
    assert rows["Dasar"]["feedback"]["pass"] > 80
    assert rows["Skala sensor"]["feedback"]["pass"] < rows["Dasar"]["feedback"]["pass"] - 40
    assert rows["Skala sensor"]["fixed"]["pass"] == rows["Dasar"]["fixed"]["pass"]
