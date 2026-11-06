"""Sensor suite model: what the ESP32 would actually read (noise, bias, drift, saturation, bubbles, floc leak)."""
from __future__ import annotations

import numpy as np

from .plant import Plant


class SensorModel:
    def __init__(self, cfg: dict, rng: np.random.Generator):
        self.s = cfg["sensor"]
        self.rng = rng
        self.baseline = np.zeros(3)
        self._frozen: dict | None = None

    def zero(self) -> None:
        """Blank calibration with clean water (operator / daily routine): removes accumulated baseline drift."""
        self.baseline[:] = 0.0

    def new_batch(self) -> None:
        self.baseline += self.rng.normal(0, self.s["drift_per_batch"], 3)
        self._frozen = None

    def read(self, plant: Plant, t_batch_s: float, running: bool, dilution: float = 1.0) -> dict:
        s, rng = self.s, self.rng
        stuck = s.get("stuck_after_s")
        if stuck is not None and t_batch_s >= stuck and self._frozen is not None:
            return dict(self._frozen)
        c = plant.C / dilution
        a = plant.eps * s["eps_scale"] * c
        a = a + s["floc_beta"] * s["floc_leak"] * plant.turb / dilution
        a = (a + self.baseline) * (1 + s["bias_pct"] / 100.0)
        a = a * (1 + rng.normal(0, s["led_jitter_pct"] / 100.0)) + rng.normal(0, s["abs_noise"], 3)
        if running and rng.random() < s["bubble_prob"]:
            lo, hi = s["bubble_mag"]
            a = a + rng.uniform(lo, hi) * rng.uniform(0.7, 1.3, 3)
        a = np.clip(a, -0.02, s["abs_sat"])
        out = {
            "abs_r": float(a[0]), "abs_g": float(a[1]), "abs_b": float(a[2]),
            "turb_ntu": float(np.clip(plant.turb * (1 + rng.normal(0, s["turb_noise_pct"] / 100)), 0, s["turb_max"])),
            "ec_uScm": float(plant.ec * (1 + rng.normal(0, s["ec_noise_pct"] / 100))),
            "ph": float(plant.ph + s["ph_offset"] + rng.normal(0, s["ph_noise"])),
            "temp_C": float(plant.T + rng.normal(0, s["temp_noise"])),
        }
        self._frozen = dict(out)
        return out

    def read_electrical(self, I: float, U: float) -> tuple[float, float]:
        return (float(max(0.0, I + self.rng.normal(0, self.s["current_noise_A"]))),
                float(max(0.0, U + self.rng.normal(0, 0.02))) if U > 0 else 0.0)
