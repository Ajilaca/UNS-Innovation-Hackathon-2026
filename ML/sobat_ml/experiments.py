"""Offline experiments on the digital twin: training data, model training, strategy comparison, campaigns."""
from __future__ import annotations

import copy
from pathlib import Path
from statistics import mean

import numpy as np

from .config import MODELS_DIR, deep_merge
from .predictor import DosePredictor
from .runner import UnitSim
from .wastewater import sample_wastewater

MODEL_PATH = MODELS_DIR / "dose_predictor.joblib"


# ---------------------------------------------------------------- training
def build_dataset(cfg: dict, n: int = 1200, seed0: int = 100_000) -> list[dict]:
    """Feedback-only runs in full sun: what a real unit would log (sensor-verified batches)."""
    c = deep_merge(cfg, {"solar": {"weather": "cerah"}, "grid": {"policy": "solar_first"}})
    rows = []
    for i in range(n):
        sim = UnitSim(c, "feedback", env_seed=seed0 + i)
        s = sim.run_batch()
        if s["status"] == "LOLOS" and s["features"]:
            rows.append({"feat": s["features"], "q": s["q_CperL"], "color0_true": s["truth"]["color0"]})
    return rows


def train_predictor(cfg: dict, n: int = 1200, save: bool = True) -> DosePredictor:
    rows = build_dataset(cfg, n)
    p = DosePredictor(cfg["control"]["k_phys_per_Cpl"], cfg["control"]["stop_margin"])
    p.fit(rows)
    if save:
        p.save(MODEL_PATH)
    return p


def load_predictor(cfg: dict) -> DosePredictor:
    return DosePredictor.load(MODEL_PATH, cfg["control"]["k_phys_per_Cpl"], cfg["control"]["stop_margin"])


# ---------------------------------------------------------------- aggregation
def aggregate(rows: list[dict]) -> dict:
    n = len(rows)
    if not n:
        return {"n": 0}
    pass_true = [r["truth"]["pass"] for r in rows]
    verified = [r["status"] == "LOLOS" for r in rows]
    flags: dict[str, int] = {}
    for r in rows:
        for f in r["flags"]:
            flags[f] = flags.get(f, 0) + 1
    tot_kwh = sum(r["kwh_pv"] + r["kwh_batt"] + r["kwh_grid"] for r in rows) or 1e-9
    m3 = sum(r["V_L"] for r in rows) / 1000
    return {
        "n": n,
        "pass_true_pct": 100 * sum(pass_true) / n,
        "pass_sensor_pct": 100 * sum(verified) / n,
        "false_pass_pct": 100 * sum(1 for r in rows if r["status"] == "LOLOS" and not r["truth"]["pass"]) / n,
        "kwh_per_m3": mean(r["kwh_per_m3"] for r in rows),
        "electrode_g_per_m3": sum(r["electrode_g"] for r in rows) / m3,
        "sludge_kg_per_m3": sum(r["sludge_kg"] for r in rows) / m3,
        "q_mean": mean(r["q_CperL"] for r in rows),
        "run_min_mean": mean(r["run_s"] for r in rows) / 60,
        "total_min_mean": mean(r["total_s"] for r in rows) / 60,
        "cost_rp_per_m3": sum(r["cost_rp"] for r in rows) / m3,
        "electricity_rp_per_m3": sum(r["electricity_rp"] for r in rows) / m3,
        "pct_renewable": 100 * sum(r["kwh_pv"] + r["kwh_batt"] for r in rows) / tot_kwh,
        "kwh_grid": sum(r["kwh_grid"] for r in rows),
        "wait_min_mean": mean(r["wait_s"] for r in rows) / 60,
        "retries": sum(r["retries"] for r in rows),
        "flags": flags,
    }


# ---------------------------------------------------------------- strategy comparison (isolated batches)
def run_set(cfg: dict, mode: str, predictor, n: int, seed0: int = 0) -> list[dict]:
    out = []
    for i in range(n):
        env = np.random.default_rng(seed0 + i)
        start_h = 8.0 + 6.5 * env.random()               # batches begin 08:00-14:30
        from datetime import datetime
        start = datetime(2026, 11, 4 + (i % 20), int(start_h), int(start_h % 1 * 60))
        out.append(UnitSim(cfg, mode, predictor, env_seed=seed0 + i, start=start).run_batch())
    return out


def compare_strategies(cfg: dict, predictor: DosePredictor, n: int = 100, progress=None) -> dict:
    meta = predictor.meta if predictor.trained else {}
    q50 = meta.get("q_obs_median", cfg["control"]["fixed_q_CperL"])
    q90 = meta.get("q_obs_p90", q50 * 1.8)
    plan = [("fixed_p50", "fixed", q50, "Waktu tetap (limbah rata-rata)"),
            ("fixed_p90", "fixed", q90, "Waktu tetap (aman, P90)"),
            ("feedback", "feedback", None, "Umpan balik sensor"),
            ("ai", "ai", None, "AI: prediksi + umpan balik")]
    res = {}
    for i, (key, mode, q, label) in enumerate(plan):
        c = cfg if q is None else deep_merge(cfg, {"control": {"fixed_q_CperL": q}})
        rows = run_set(c, mode, predictor, n)
        res[key] = {"label": label, "mode": mode, "fixed_q": q, **aggregate(rows)}
        if progress:
            progress((i + 1) / (len(plan) + 1))
    # fixed-time Pareto: how much charge does a timer need to be reliable?
    pareto = []
    for q in (100, 150, 200, 300, 400, 600, 800):
        rows = run_set(deep_merge(cfg, {"control": {"fixed_q_CperL": q}}), "fixed", None, max(n // 2, 20), seed0=0)
        a = aggregate(rows)
        pareto.append({"q": q, "pass_true_pct": a["pass_true_pct"], "kwh_per_m3": a["kwh_per_m3"], "electrode_g_per_m3": a["electrode_g_per_m3"]})
    if progress:
        progress(1.0)
    return {"n": n, "target_ptco": cfg["unit"]["target_color_ptco"], "strategies": res, "fixed_pareto": pareto,
            "model": {k: v for k, v in meta.items() if k != "scatter"}}


# ---------------------------------------------------------------- multi-day campaign (battery carries over)
def campaign(cfg: dict, mode: str, predictor, days: int = 10, per_day: int = 4, seed: int = 0) -> dict:
    sim = UnitSim(cfg, mode, predictor, env_seed=seed)
    last = cfg["solar"]["last_start_hour"]
    rows, backlog, per_day_done = [], 0, []
    idx = 0
    for _ in range(days):
        done = 0
        for _b in range(per_day):
            if sim.clock.hour + sim.clock.minute / 60 > last:
                break
            ww = sample_wastewater(cfg, np.random.default_rng(seed * 100_000 + idx))
            idx += 1
            rows.append(sim.run_batch(ww))
            done += 1
        backlog += per_day - done
        per_day_done.append({"done": done, "soc_end": round(sim.battery.soc, 3), "weather": sim.solar.weather})
        sim.skip_to_morning()
        sim.maintenance()
    a = aggregate(rows)
    a.update({"days": days, "per_day": per_day, "backlog_batches": backlog, "daily": per_day_done,
              "throughput_pct": 100 * len(rows) / (days * per_day)})
    return a


def compare_energy(cfg: dict, predictor, days: int = 10, per_day: int = 4, seeds=(0, 1, 2), progress=None) -> dict:
    out = {}
    cases = [("solar_only", "Surya murni"), ("solar_first", "Hibrida (surya dulu)"), ("grid_only", "PLN saja")]
    modes = ["fixed", "feedback", "ai"]
    k = 0
    for pol, plabel in cases:
        c = deep_merge(cfg, {"grid": {"policy": pol}})
        if pol == "grid_only":
            c = deep_merge(c, {"unit": {"pv_wp": 0, "battery_wh": 0}})
        for mode in modes:
            runs = [campaign(c, mode, predictor, days, per_day, s) for s in seeds]
            keys = ["pass_true_pct", "pct_renewable", "kwh_grid", "electricity_rp_per_m3", "cost_rp_per_m3", "throughput_pct",
                    "backlog_batches", "wait_min_mean", "total_min_mean", "kwh_per_m3"]
            out[f"{pol}/{mode}"] = {"policy": pol, "policy_label": plabel, "mode": mode,
                                    **{kk: float(np.mean([r[kk] for r in runs])) for kk in keys}}
            k += 1
            if progress:
                progress(k / (len(cases) * len(modes)))
    return {"days": days, "per_day": per_day, "seeds": list(seeds), "cases": out}


# ---------------------------------------------------------------- sizing sweep (panel x battery x load)
def sizing(cfg: dict, predictor, days: int = 10, seeds=(0, 1), pv_list=(50, 100, 200), batt_list=(150, 600),
           per_day_list=(3, 5), progress=None) -> dict:
    cases = [("solar_only", "feedback"), ("solar_first", "feedback"), ("solar_first", "ai")]
    keys = ["pass_true_pct", "pct_renewable", "kwh_grid", "throughput_pct", "backlog_batches", "wait_min_mean",
            "electricity_rp_per_m3", "cost_rp_per_m3"]
    out, k, total = [], 0, len(pv_list) * len(batt_list) * len(per_day_list) * len(cases)
    for pv in pv_list:
        for bt in batt_list:
            for pd_ in per_day_list:
                for pol, mode in cases:
                    c = deep_merge(cfg, {"grid": {"policy": pol}, "unit": {"pv_wp": pv, "battery_wh": bt}})
                    runs = [campaign(c, mode, predictor, days, pd_, s) for s in seeds]
                    out.append({"pv_wp": pv, "battery_wh": bt, "per_day": pd_, "policy": pol, "mode": mode,
                                **{kk: float(np.mean([r[kk] for r in runs])) for kk in keys}})
                    k += 1
                    if progress:
                        progress(k / total)
    return {"days": days, "seeds": list(seeds), "rows": out}
