"""PV + battery model for Solo. Clear-sky irradiance x stochastic clearness (AR(1))."""
from __future__ import annotations

import json
import math
from datetime import datetime
from functools import lru_cache
from pathlib import Path

import numpy as np

from .config import ROOT


@lru_cache(maxsize=2)
def load_nasa_days(path: str) -> dict:
    """NASA POWER hourly all-sky/clear-sky GHI (W/m2, local solar time) -> per-day arrays."""
    P = json.loads(Path(path).read_text())["properties"]["parameter"]
    g, c = P["ALLSKY_SFC_SW_DWN"], P["CLRSKY_SFC_SW_DWN"]
    days = {}
    for d in sorted({k[:8] for k in g}):
        a = np.array([max(g[d + f"{h:02d}"], 0.0) for h in range(24)])
        b = np.array([max(c[d + f"{h:02d}"], 0.0) for h in range(24)])
        days[datetime.strptime(d, "%Y%m%d").date()] = {"ghi": a, "clr": b, "kt": a.sum() / max(b.sum(), 1.0)}
    return days


class SolarModel:
    """source=nasa_power: replay real days (hourly) + sub-hourly cloud flicker. source=synthetic: AR(1) clearness."""

    def __init__(self, cfg: dict, rng: np.random.Generator):
        self.cfg = cfg
        self.site = cfg["site"]
        self.sol = cfg["solar"]
        self.rng = rng
        self.kt = 0.7
        self.weather = "cerah"
        self._day = None
        self.real = self.sol.get("source", "nasa_power") == "nasa_power"
        self.flicker = 0.0
        self.day_info: dict | None = None
        if self.real:
            path = Path(self.sol["nasa_file"])
            self.days = load_nasa_days(str(path if path.is_absolute() else ROOT / path))
            self.keys = sorted(self.days)
            self.kts = np.array([self.days[k]["kt"] for k in self.keys])

    # ---- day selection ---------------------------------------------------
    def _pick_weather(self) -> str:
        w = self.sol["weather"]
        if w != "acak":
            return w
        names = list(self.sol["weights"])
        p = np.array([self.sol["weights"][n] for n in names], float)
        return str(self.rng.choice(names, p=p / p.sum()))

    def _pick_real_day(self, local: datetime):
        w = self.sol["weather"]
        doy = local.timetuple().tm_yday
        near = [i for i, k in enumerate(self.keys)
                if min(abs(k.timetuple().tm_yday - doy), 366 - abs(k.timetuple().tm_yday - doy)) <= 45]
        idx = np.array(near)
        if w == "acak":
            return self.keys[int(self.rng.choice(idx))], "acak"
        order = idx[np.argsort(self.kts[idx])]            # worst -> best within the season
        n = len(order)
        pools = {"hujan": order[: max(3, n // 30)], "mendung": order[: max(5, n // 8)],
                 "berawan": order[n // 8: n * 5 // 8], "cerah": order[n * 5 // 8:]}
        return self.keys[int(self.rng.choice(pools[w]))], w

    # ---- physics ---------------------------------------------------------
    def clear_sky(self, local: datetime) -> float:
        n = local.timetuple().tm_yday
        decl = math.radians(23.45) * math.sin(2 * math.pi * (284 + n) / 365)
        b = 2 * math.pi * (n - 81) / 364
        eot_min = 9.87 * math.sin(2 * b) - 7.53 * math.cos(b) - 1.5 * math.sin(b)
        hours = local.hour + local.minute / 60 + local.second / 3600
        solar_time = hours + (self.site["lon"] - 15 * self.site["tz_offset_h"]) / 15 + eot_min / 60
        h = math.radians(15 * (solar_time - 12))
        lat = math.radians(self.site["lat"])
        cosz = math.sin(lat) * math.sin(decl) + math.cos(lat) * math.cos(decl) * math.cos(h)
        return 1000.0 * max(cosz, 0.0) ** 1.15

    def _real_ghi(self, local: datetime) -> float:
        s = local.hour + local.minute / 60 + local.second / 3600 + (self.site["lon"] - 15 * self.site["tz_offset_h"]) / 15
        centers = np.arange(24) + 0.5
        return float(np.interp(s, np.r_[-0.5, centers, 24.5], np.r_[0.0, self.day_info["ghi"], 0.0]))

    def step(self, local: datetime, dt: float) -> float:
        """Advance weather state, return GHI in W/m2."""
        day = local.date()
        if day != self._day:
            self._day = day
            if self.real:
                d, self.weather = self._pick_real_day(local)
                self.day_info = self.days[d]
                self.kt = self.day_info["kt"]
                self.flicker = 0.0
                self.source_day = d.isoformat()
            else:
                self.weather = self._pick_weather()
                self.kt = self.sol["states"][self.weather]["kt"]
        if self.real:
            base = self._real_ghi(local)
            sd = self.sol.get("flicker_sd", 0.15) * (1 - min(self.day_info["kt"], 0.95))
            tau = self.sol["tau_s"] / 4
            self.flicker += -self.flicker * dt / tau + sd * math.sqrt(2 * dt / tau) * self.rng.standard_normal()
            ghi = float(min(max(base * (1 + self.flicker), 0.0), 1.1 * max(self.clear_sky(local), 1.0)))
            cs = self.clear_sky(local)
            if cs > 150:
                self.kt += (min(ghi / cs, 1.05) - self.kt) * dt / 900
            return ghi
        st = self.sol["states"][self.weather]
        tau = self.sol["tau_s"]
        self.kt += (st["kt"] - self.kt) * dt / tau + st["sd"] * math.sqrt(2 * dt / tau) * self.rng.standard_normal()
        self.kt = float(min(max(self.kt, 0.04), 1.05))
        return self.clear_sky(local) * self.kt

    def pv_power(self, ghi: float) -> float:
        wp = self.cfg["unit"]["pv_wp"]
        tcell = 30 + 0.03 * ghi
        return max(0.0, wp * ghi / 1000.0 * self.sol["pr"] * (1 - 0.004 * (tcell - 25)))


class Battery:
    def __init__(self, cfg: dict):
        u = cfg["unit"]
        self.cap = max(float(u["battery_wh"]), 1e-9)
        self.enabled = u["battery_wh"] > 0 and u["pv_wp"] > 0
        self.min_soc = u["battery_min_soc"]
        self.max_dis = u["battery_max_discharge_w"]
        self.soc = u.get("battery_init_soc", 0.5)

    def discharge_available(self) -> float:
        return self.max_dis if (self.enabled and self.soc > self.min_soc + 0.01) else 0.0

    def update(self, pv_w: float, load_w: float, dt: float) -> None:
        net = pv_w - load_w
        eff = 0.95
        self.soc += (net * eff if net > 0 else net / eff) * dt / 3600.0 / self.cap
        self.soc = float(min(max(self.soc, 0.0), 1.0))

    @property
    def voltage(self) -> float:
        return 11.8 + 1.6 * self.soc
