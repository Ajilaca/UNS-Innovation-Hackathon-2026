"""Random wastewater batches, distributed to match the Laweyan data range."""
from __future__ import annotations

import math

import numpy as np


def sample_wastewater(cfg: dict, rng: np.random.Generator) -> dict:
    w = cfg["wastewater"]
    lo, hi = w["cod_range"]
    cod = float(np.clip(w["cod_median"] * w["cod_scale"] * math.exp(w["cod_sigma"] * rng.standard_normal()), lo * 0.8, hi * 1.1))
    tss = float(np.clip(cod * w["tss_cod_ratio"] * math.exp(0.35 * rng.standard_normal()), *w["tss_range"]))
    ph = float(np.clip(rng.normal(w["ph_mean"], w["ph_sd"]), *w["ph_range"]))
    ec = float(max(w["ec_min"], rng.normal(w["ec_mean"], w["ec_sd"])))
    temp = float(rng.normal(w["temp_mean"], w["temp_sd"]))
    color = cod * w["color_per_cod"] * math.exp(w["color_per_cod_sigma"] * rng.standard_normal())
    names = list(cfg["dyes"])
    p = np.array([cfg["dyes"][n]["weight"] for n in names], float)
    dye = str(rng.choice(names, p=p / p.sum()))
    return {
        "cod": cod, "tss": tss, "ph": ph, "ec": ec, "temp": temp,
        "color": float(max(color, 60.0)), "turb": float(min(tss * w["turb_per_tss"], 3000.0)),
        "dye": dye,
        "kd_rand": float(math.exp(cfg["reactor"]["batch_sigma"] * rng.standard_normal())),
    }
