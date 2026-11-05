from datetime import datetime, timedelta

import numpy as np

from app.config import load_config
from app.solar import Battery, SolarModel


def day_energy(cfg, seed=0):
    m = SolarModel(cfg, np.random.default_rng(seed))
    t, e = datetime(2026, 11, 4), 0.0
    for _ in range(8640):
        e += m.pv_power(m.step(t, 10)) * 10 / 3600
        t += timedelta(seconds=10)
    return e


def test_night_is_dark_and_pv_bounded():
    cfg = load_config("baseline")
    m = SolarModel(cfg, np.random.default_rng(0))
    assert m.step(datetime(2026, 11, 4, 1, 0), 10) == 0.0
    for h in range(24):
        g = m.step(datetime(2026, 11, 4, h, 30), 10)
        assert 0 <= m.pv_power(g) <= cfg["unit"]["pv_wp"]


def test_real_data_loaded_and_day_energy_plausible():
    cfg = load_config("baseline")
    m = SolarModel(cfg, np.random.default_rng(0))
    assert len(m.days) >= 365
    e = day_energy(cfg)
    assert 250 < e < 1000          # Wh/day for 200 Wp


def test_weather_classes_are_ordered():
    e = {w: np.mean([day_energy(load_config(overrides={"solar": {"weather": w}}), s) for s in range(6)])
         for w in ("cerah", "mendung", "hujan")}
    assert e["cerah"] > e["mendung"] > e["hujan"]


def test_battery_limits():
    cfg = load_config("baseline")
    b = Battery(cfg)
    for _ in range(1000):
        b.update(0.0, 200.0, 60)
    assert 0.0 <= b.soc and b.discharge_available() == 0.0
    for _ in range(1000):
        b.update(200.0, 0.0, 60)
    assert b.soc <= 1.0


def test_no_battery_no_discharge():
    b = Battery(load_config("pln-saja"))
    assert b.discharge_available() == 0.0
