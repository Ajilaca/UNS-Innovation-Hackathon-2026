"""How wrong does the dose model get when the real plant differs from the simulator it learned from?

Trains on (a) the single baseline world and (b) many randomised worlds (domain randomisation), tests on
worlds never seen in training, and measures a per-unit online correction learned from the unit's own recent
batches. SIMULATION ONLY: this measures robustness to wrong guesses, not field accuracy.
"""
from __future__ import annotations

import math

import numpy as np

from .config import deep_merge
from .predictor import DosePredictor, UnitCalibrator
from .runner import UnitSim

BASE = {"solar": {"weather": "cerah"}, "grid": {"policy": "grid_only"}, "unit": {"pv_wp": 0, "battery_wh": 0, "t_max_min": 600}}

# hold-out worlds: none of these exact parameter sets is used in training
WORLDS = [
    ("Sama dengan dasar", {}),
    ("Laju warna ×0,5", {"k_d": 0.5}),
    ("Laju warna ×2", {"k_d": 2.0}),
    ("Laju warna ×0,33", {"k_d": 0.33}),
    ("Efisiensi arus ×0,7", {"ce": 0.7}),
    ("Warna membandel ×3", {"recalc": 3.0}),
    ("Sensor skala ×1,3", {"eps": 1.3}),
]


def world_cfg(cfg: dict, k_d: float = 1.0, ce: float = 1.0, recalc: float = 1.0, eps: float = 1.0) -> dict:
    r, s = cfg["reactor"], cfg["sensor"]
    return deep_merge(cfg, deep_merge(BASE, {
        "reactor": {"k_d_Fe": r["k_d_Fe"] * k_d, "current_eff": {"Fe": r["current_eff"]["Fe"] * ce}, "recalcitrant_scale": r["recalcitrant_scale"] * recalc},
        "sensor": {"eps_scale": s["eps_scale"] * eps},
    }))


def random_world(rng: np.random.Generator) -> dict:
    return {"k_d": float(math.exp(rng.normal(0, 0.6))), "ce": float(rng.uniform(0.65, 1.0)),
            "recalc": float(rng.uniform(0, 3)), "eps": float(math.exp(rng.normal(0, 0.15)))}


def _row(cfg: dict, seed: int) -> dict | None:
    s = UnitSim(cfg, "feedback", env_seed=seed).run_batch()
    return {"feat": s["features"], "q": s["q_CperL"]} if s["status"] == "LOLOS" and s["features"] else None


def train(cfg: dict, n: int, randomize: bool, seed0: int = 200_000) -> DosePredictor:
    rng = np.random.default_rng(seed0)
    rows = []
    for i in range(n):
        c = world_cfg(cfg, **random_world(rng)) if randomize else world_cfg(cfg)
        r = _row(c, seed0 + i)
        if r:
            rows.append(r)
    p = DosePredictor(cfg["control"]["k_phys_per_Cpl"], cfg["control"]["stop_margin"])
    p.fit(rows)
    return p


def _mape(pred, obs) -> float:
    return float(100 * np.mean(np.abs(np.array(pred) - np.array(obs)) / np.array(obs)))


def corrected(preds: list[float], obs: list[float], window: int = 5, warmup: int = 3) -> tuple[list[float], list[float]]:
    """Offline replay of UnitCalibrator; scored only once it has `warmup` batches."""
    cal = UnitCalibrator(window, warmup, (0.0, float("inf")))
    out_p, out_o = [], []
    for i, (p, o) in enumerate(zip(preds, obs)):
        if i >= warmup:
            out_p.append(p * cal.factor)
            out_o.append(o)
        cal.add(o, p)
    return out_p, out_o


def _campaign(cfg: dict, predictor, n: int, seed: int) -> dict:
    """One unit running n batches in a row, so what it learns carries over. Energy and pass rate are ground truth."""
    sim = UnitSim(cfg, "ai", predictor, env_seed=seed)
    rows = [sim.run_batch() for _ in range(n)]
    scored = [r for r in rows[3:] if r["status"] == "LOLOS" and r["q_pred"]]
    return {
        "pass_pct": 100 * sum(r["truth"]["pass"] for r in rows) / n,
        "kwh_m3": float(np.mean([r["kwh_per_m3"] for r in rows])),
        "run_min": float(np.mean([r["run_s"] for r in rows])) / 60,
        "mape": _mape([r["q_pred"] for r in scored], [r["q_CperL"] for r in scored]) if scored else None,
        "plateau_stops": sum(r["status"] == "GAGAL_WARNA_MENTOK" for r in rows),
        "false_plateau": sum("WARNA_MENTOK" in r["flags"] and r["truth"]["pass"] for r in rows),
    }


def closed_loop(cfg: dict, predictor, n: int = 40, seeds=(1, 2)) -> dict:
    """The features switched on and off inside the real controller."""
    def avg(c):
        runs = [_campaign(c, predictor, n, s) for s in seeds]
        return {k: (None if any(r[k] is None for r in runs) else float(np.mean([r[k] for r in runs]))) for k in runs[0]}
    off_cal = {"control": {"unit_calibration": {"enabled": False}}}
    off_pla = {"control": {"plateau_dq_CperL": None}}
    calib = [{"world": label, "off": avg(deep_merge(world_cfg(cfg, **w), off_cal)), "on": avg(world_cfg(cfg, **w))} for label, w in WORLDS]
    worlds = [("Warna membandel ×3", {"recalc": 3.0}), ("Warna membandel ×6", {"recalc": 6.0}), ("Sama dengan dasar", {})]
    # default time limit, because the time limit is what a plateau would otherwise run into
    t = {"unit": {"t_max_min": cfg["unit"]["t_max_min"]}}
    plateau = [{"world": label, "off": avg(deep_merge(deep_merge(world_cfg(cfg, **w), t), off_pla)), "on": avg(deep_merge(world_cfg(cfg, **w), t))} for label, w in worlds]
    return {"n": n, "seeds": list(seeds), "calibration": calib, "plateau": plateau}


def robustness(cfg: dict, predictor, n: int = 600, n_test: int = 60, progress=None) -> dict:
    a = train(cfg, n, False)
    b = train(cfg, n, True)
    rows = []
    for wi, (label, w) in enumerate(WORLDS):
        c = world_cfg(cfg, **w)
        data = [r for r in (_row(c, 900_000 + wi * 1000 + i) for i in range(n_test)) if r]
        obs = [r["q"] for r in data]
        pa = [a.predict(r["feat"]) for r in data]
        pb = [b.predict(r["feat"]) for r in data]
        phys = [a._q_phys(r["feat"]) for r in data]
        qb = [p["q"] for p in pb]
        cp, co = corrected(qb, obs)
        rows.append({
            "world": label, "n": len(data), "q_median": float(np.median(obs)) if obs else None,
            "mape_physics": _mape(phys, obs), "mape_single": _mape([p["q"] for p in pa], obs), "mape_random": _mape(qb, obs),
            "mape_random_corrected": _mape(cp, co),
            "cover80_single": float(100 * np.mean([p["q_lo"] <= q <= p["q_hi"] for p, q in zip(pa, obs)])),
            "cover80_random": float(100 * np.mean([p["q_lo"] <= q <= p["q_hi"] for p, q in zip(pb, obs)])),
        })
        if progress:
            progress((wi + 1) / len(WORLDS))
    return {"n_train": n, "n_test": n_test, "train_single": a.meta["mape_ml"], "train_random": b.meta["mape_ml"], "rows": rows,
            "closed_loop": closed_loop(cfg, predictor)}
