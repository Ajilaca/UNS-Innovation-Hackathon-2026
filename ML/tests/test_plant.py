import math

import numpy as np

from sobat_ml.physics import faraday_mass_g
from sobat_ml.plant import Plant
from sobat_ml.wastewater import sample_wastewater


def make(cfg, seed=1):
    rng = np.random.default_rng(seed)
    p = Plant(cfg, rng)
    p.load(sample_wastewater(cfg, rng))
    return p


def test_color_decreases_monotonically_and_above_residual(cfg):
    p = make(cfg)
    prev = p.C
    for _ in range(300):
        p.step(10, 5.0, 500)
        assert p.C <= prev + 1e-9
        assert p.C >= cfg["reactor"]["color_residual_ptco"] - 1e-9
        prev = p.C


def test_metal_mass_follows_faraday_with_current_efficiency(cfg):
    p = make(cfg)
    p.step(10, 5.0, 500)
    e = p.step(10, 5.0, 500)
    assert e["I"] > 0
    assert p.metal_g > 0
    # no passivation yet -> ce ~ nominal
    approx = faraday_mass_g(5.0, 10, "Fe", cfg["reactor"]["current_eff"]["Fe"])
    assert math.isclose(p.metal_g / 2, approx, rel_tol=0.15)


def test_voltage_never_exceeds_compliance_and_power_limit_respected(cfg):
    p = make(cfg)
    for P in (10, 40, 120, 1000):
        e = p.step(10, 10.0, P)
        assert e["U"] <= cfg["unit"]["U_max_V"] + 1e-6
        assert e["p_bus"] <= P + 1e-6


def test_no_power_no_current(cfg):
    p = make(cfg)
    e = p.step(10, 5.0, 0.0)
    assert e["I"] == 0.0 and p.q == 0.0


def test_reversal_reduces_passivation(cfg):
    p = make(cfg)
    p.L = 0.6
    p.reverse_polarity()
    assert p.L < 0.3 and p.polarity == -1 and p.reversals == 1


def test_flocs_settle_when_idle(cfg):
    p = make(cfg)
    for _ in range(60):
        p.step(10, 5.0, 500)
    f0 = p.floc
    assert f0 > 0
    for _ in range(180):
        p.rest(10)
    assert p.floc < 0.1 * f0


def _run_to_end(cfg, charge_CperL, ww):
    from sobat_ml.plant import Plant
    p = Plant(cfg, np.random.default_rng(0))
    p.load(ww)
    I = 5.0
    for _ in range(int(charge_CperL * p.V / I / 10)):
        p.step(10.0, I, 1e6)
    return p


def test_recalcitrant_fraction_sets_a_floor_no_dose_can_cross():
    from sobat_ml.config import deep_merge, load_config
    cfg = deep_merge(load_config("baseline"), {"dyes": {"remazol_merah": {"recalcitrant": 0.2}}})
    ww = {"cod": 2500, "tss": 800, "ph": 9.5, "ec": 3000, "temp": 31, "color": 2000.0, "turb": 300, "dye": "remazol_merah", "kd_rand": 1.0}
    p = _run_to_end(cfg, 3000, ww)
    floor = cfg["reactor"]["color_residual_ptco"] + 0.2 * 2000
    assert p.C >= floor
    assert abs(p.C - floor) < 5   # it does get there
    assert p.removal_frac() > 0.98   # removal is measured against what is removable


def test_suspended_floc_saturates():
    from sobat_ml.config import load_config
    cfg = load_config("baseline")
    ww = {"cod": 2500, "tss": 800, "ph": 9.5, "ec": 3000, "temp": 31, "color": 2000.0, "turb": 300, "dye": "remazol_merah", "kd_rand": 1.0}
    p = _run_to_end(cfg, 3000, ww)
    assert p.floc <= cfg["reactor"]["floc_ntu_max"] + 1
