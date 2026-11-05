"""AI dose predictor: how much specific charge (C/L) will this batch need?

Physics-informed: q_phys = ln(C0/(margin*target)) / k  (first-order kinetics, nominal k).
Gradient boosting learns the log-ratio ln(q_obs / q_phys) from initial-state features
(dye family via absorbance-channel ratios, pH, EC, temp, turbidity, concentration) and two
quantile models give an uncertainty band. Trained only on our own batch data.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import KFold

FEATURES = ["ln_ratio", "ph", "ec_k", "temp", "ln_turb", "r_rel", "b_rel", "ln_c0"]


def make_features(c0_est: float, target: float, ph: float, ec: float, temp: float, turb: float,
                  abs_rgb: tuple[float, float, float]) -> list[float]:
    a_mean = max(sum(abs_rgb) / 3.0, 1e-6)
    return [
        math.log(max(c0_est, 1.05 * target) / target), ph, ec / 1000.0, temp, math.log1p(max(turb, 0.0)),
        abs_rgb[0] / a_mean, abs_rgb[2] / a_mean, math.log(max(c0_est, 1.0)),
    ]


def physics_q(c0_est: float, target: float, margin: float, k_per_Cpl: float) -> float:
    return math.log(max(c0_est / (margin * target), 1.05)) / k_per_Cpl


class UnitCalibrator:
    """Per-unit correction: scale predictions by the geometric mean error of this unit's recent verified batches.
    Handles what no pre-trained model can see from initial features: this reactor's own overall rate."""

    def __init__(self, window: int = 5, min_batches: int = 3, limits: tuple[float, float] = (0.25, 4.0)):
        self.window, self.min_batches, self.limits = window, min_batches, tuple(limits)
        self.errors: list[float] = []

    @property
    def factor(self) -> float:
        if len(self.errors) < self.min_batches:
            return 1.0
        f = math.exp(sum(self.errors) / len(self.errors))
        return min(max(f, self.limits[0]), self.limits[1])

    def add(self, q_observed: float, q_raw_prediction: float) -> None:
        if q_observed > 0 and q_raw_prediction > 0:
            self.errors = (self.errors + [math.log(q_observed / q_raw_prediction)])[-self.window:]


class DosePredictor:
    def __init__(self, k_phys: float, margin: float):
        self.k_phys, self.margin = k_phys, margin
        self.mid = self.lo = self.hi = None
        self.meta: dict = {"trained": False}

    @property
    def trained(self) -> bool:
        return self.mid is not None

    def _q_phys(self, feat: list[float]) -> float:
        # ln_ratio = ln(C0/target); physics uses margin*target
        return max(feat[0] - math.log(self.margin), math.log(1.05)) / self.k_phys

    def predict(self, feat: list[float]) -> dict:
        q0 = self._q_phys(feat)
        if not self.trained:
            return {"q": q0, "q_lo": q0 * 0.65, "q_hi": q0 * 1.6, "sigma_ln": 0.3, "source": "fisika"}
        x = np.array([feat])
        m, lo, hi = (float(self.mid.predict(x)[0]), float(self.lo.predict(x)[0]), float(self.hi.predict(x)[0]))
        lo, hi = min(lo, m), max(hi, m)
        return {"q": q0 * math.exp(m), "q_lo": q0 * math.exp(lo), "q_hi": q0 * math.exp(hi),
                "sigma_ln": max((hi - lo) / 2.56, 0.05), "source": "ml"}

    def fit(self, rows: list[dict]) -> dict:
        """rows: {'feat': [...], 'q': observed C/L at (verified) stop}."""
        X = np.array([r["feat"] for r in rows], float)
        q0 = np.array([self._q_phys(r["feat"]) for r in rows])
        y = np.log(np.array([r["q"] for r in rows], float) / q0)
        mk = lambda **kw: GradientBoostingRegressor(n_estimators=150, max_depth=3, learning_rate=0.07, subsample=0.8, random_state=0, **kw)
        # honest out-of-fold error vs physics-only baseline
        oof = np.zeros_like(y)
        for tr, te in KFold(5, shuffle=True, random_state=0).split(X):
            oof[te] = mk(loss="squared_error").fit(X[tr], y[tr]).predict(X[te])
        q_obs = q0 * np.exp(y)
        mape_ml = float(np.mean(np.abs(q0 * np.exp(oof) - q_obs) / q_obs))
        mape_phys = float(np.mean(np.abs(q0 - q_obs) / q_obs))
        ss = float(np.sum((y - oof) ** 2)); st = float(np.sum((y - y.mean()) ** 2))
        self.mid = mk(loss="squared_error").fit(X, y)
        self.lo = mk(loss="quantile", alpha=0.1).fit(X, y)
        self.hi = mk(loss="quantile", alpha=0.9).fit(X, y)
        imp = dict(zip(FEATURES, (float(v) for v in self.mid.feature_importances_)))
        self.meta = {"trained": True, "n": len(rows), "mape_ml": mape_ml, "mape_physics": mape_phys,
                     "r2_ln_oof": 1 - ss / st if st > 0 else 0.0, "importance": imp,
                     "q_obs_median": float(np.median(q_obs)), "q_obs_p90": float(np.percentile(q_obs, 90)),
                     "scatter": [{"obs": float(a), "pred": float(b)} for a, b in list(zip(q_obs, q0 * np.exp(oof)))[:300]]}
        return self.meta

    # ---- persistence -----------------------------------------------------
    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({"mid": self.mid, "lo": self.lo, "hi": self.hi, "meta": self.meta,
                     "k_phys": self.k_phys, "margin": self.margin}, path)
        path.with_suffix(".json").write_text(json.dumps(self.meta))

    @classmethod
    def load(cls, path: Path, k_phys: float, margin: float) -> "DosePredictor":
        p = cls(k_phys, margin)
        if path.exists():
            d = joblib.load(path)
            p.mid, p.lo, p.hi, p.meta = d["mid"], d["lo"], d["hi"], d["meta"]
        return p
