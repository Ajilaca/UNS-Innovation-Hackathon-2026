"""One-at-a-time sensitivity analysis of the digital twin.

Question answered: which guessed parameters change the conclusions, and which do not?
Everything here is SIMULATION. It maps how robust the conclusions are to wrong guesses; it does not validate them.
"""
from __future__ import annotations

from .config import deep_merge
from .experiments import aggregate, run_set


# (label, dotted path, multipliers) -- multiplier applied to the baseline value
PARAMS = [
    ("Laju hilang warna k_d (Fe)", "reactor.k_d_Fe", [0.14, 0.33, 3.0]),
    ("Efisiensi arus (Fe)", "reactor.current_eff.Fe", [0.57, 0.8]),
    ("Fraksi warna membandel", "reactor.recalcitrant_scale", [0.0, 3.0, 6.0]),
    ("Tegangan lebih elektroda", "reactor.overpotential_V", [0.5, 2.0]),
    ("Resistansi larutan", "reactor.solution_resistance_scale", [0.5, 3.0]),
    ("Variasi antar batch", "reactor.batch_sigma", [0.5, 2.0]),
    ("COD limbah (median)", "wastewater.cod_scale", [0.5, 2.0]),
    ("Warna per COD", "wastewater.color_per_cod", [0.5, 2.0]),
    ("Skala sensor sebenarnya", "sensor.eps_scale", [0.6, 1.6]),
    ("Drift sensor", "sensor.drift_per_batch", [0.0, 3.0]),
]

def _get(cfg: dict, path: str):
    d = cfg
    for k in path.split("."):
        d = d[k]
    return d


def _set(cfg: dict, path: str, val) -> dict:
    keys = path.split(".")
    over: dict = {}
    d = over
    for k in keys[:-1]:
        d[k] = {}
        d = d[k]
    d[keys[-1]] = val
    return deep_merge(cfg, over)


def _measure(cfg: dict, predictor, n: int) -> dict:
    out = {}
    for mode in ("fixed", "feedback", "ai"):
        a = aggregate(run_set(cfg, mode, predictor, n))
        out[mode] = {"pass": a["pass_true_pct"], "false_pass": a["false_pass_pct"], "kwh_m3": a["kwh_per_m3"],
                     "run_min": a["run_min_mean"], "fe_g_m3": a["electrode_g_per_m3"]}
    return out


def sensitivity(cfg: dict, predictor, n: int = 40, progress=None) -> dict:
    cases = [{"label": "Dasar", "param": None, "mult": 1.0, "cfg": cfg}]
    for label, path, mults in PARAMS:
        base = _get(cfg, path)
        for m in mults:
            cases.append({"label": label, "param": path, "mult": m, "cfg": _set(cfg, path, base * m)})
    # high-demand case: ~7x charge (literature), with a reactor sized for it (bigger electrodes and current cap)
    hd = _set(cfg, "reactor.k_d_Fe", cfg["reactor"]["k_d_Fe"] * 0.14)
    cases.append({"label": "Kebutuhan tinggi, reaktor standar", "param": "combo", "mult": 0.14, "cfg": hd})
    hd2 = deep_merge(hd, {"unit": {"I_default_A": 35.0, "I_max_A": 40.0, "electrode_area_cm2": 1600}})
    cases.append({"label": "Kebutuhan tinggi, reaktor besar (1600 cm², 35 A)", "param": "combo", "mult": 0.14, "cfg": hd2})
    res = []
    for i, c in enumerate(cases):
        res.append({"label": c["label"], "param": c["param"], "mult": c["mult"], **_measure(c["cfg"], predictor, n)})
        if progress:
            progress((i + 1) / len(cases))
    return {"n": n, "rows": res}


def to_markdown(res: dict) -> str:
    L = ["| Parameter | ×nilai dasar | Waktu tetap (lolos %) | Umpan balik (lolos %) | AI (lolos %) | kWh/m³ umpan balik | Menit proses |",
         "|---|---|---|---|---|---|---|"]
    for r in res["rows"]:
        L.append(f"| {r['label']} | {r['mult']:g} | {r['fixed']['pass']:.0f} | {r['feedback']['pass']:.0f} | {r['ai']['pass']:.0f} | "
                 f"{r['feedback']['kwh_m3']:.2f} | {r['feedback']['run_min']:.0f} |")
    return "\n".join(L)
