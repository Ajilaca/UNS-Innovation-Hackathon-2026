"""UnitSim: wires plant + sensors + solar + battery + controller. Emits contract-shaped telemetry."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np

from .control import BatchController
from .physics import faraday_mass_g
from .plant import Plant
from .predictor import DosePredictor
from .sensors import SensorModel
from .solar import Battery, SolarModel
from .wastewater import sample_wastewater


class UnitSim:
    def __init__(self, cfg: dict, mode: str = "ai", predictor: DosePredictor | None = None,
                 env_seed: int = 0, noise_seed: int | None = None, start: datetime | None = None,
                 source: str = "simulator", run_tag: str = ""):
        self.cfg, self.mode, self.source = cfg, mode, source
        self.run_tag = run_tag          # makes batch ids unique across restarts (the sim clock always restarts on the same date)
        self.u = cfg["unit"]
        self.env_rng = np.random.default_rng(env_seed)
        nrng = np.random.default_rng(env_seed + 7919 if noise_seed is None else noise_seed)
        self.plant = Plant(cfg, nrng)
        self.sensors = SensorModel(cfg, nrng)
        self.solar = SolarModel(cfg, np.random.default_rng(env_seed + 104729))
        self.battery = Battery(cfg)
        self.ctrl = BatchController(cfg, mode, predictor)
        self.clock = start or datetime(2026, 11, 4, int(cfg["solar"]["start_hour"]), int((cfg["solar"]["start_hour"] % 1) * 60))
        self.n_batch = 0
        self.summary: dict | None = None
        self._last = {"I": 0.0, "U": 0.0}
        self.scenario: str | None = None

    def adopt(self, prev: "UnitSim") -> None:
        """Continue from another sim: same physical unit under new conditions (automatic simulation).
        Clock, battery, electrode layer, sensor drift and what the unit has learned all carry over."""
        self.clock, self.n_batch, self.run_tag = prev.clock, prev.n_batch, prev.run_tag
        self.battery.soc = prev.battery.soc
        self.plant.L, self.plant.polarity, self.plant.reversals = prev.plant.L, prev.plant.polarity, prev.plant.reversals
        self.sensors.baseline = prev.sensors.baseline.copy()
        self.ctrl.calib = prev.ctrl.calib

    # ---- time ------------------------------------------------------------
    def epoch(self) -> int:
        tz = timezone(timedelta(hours=self.cfg["site"]["tz_offset_h"]))
        return int(self.clock.replace(tzinfo=tz).timestamp())

    def skip_to_morning(self) -> None:
        """Idle through the night (battery self-consumption, PV charging in the late afternoon)."""
        h = self.cfg["solar"]["start_hour"]
        target = self.clock.replace(hour=int(h), minute=int((h % 1) * 60), second=0)
        if target <= self.clock:
            target += timedelta(days=1)
        step = 600.0
        while self.clock < target:
            pv = self.solar.pv_power(self.solar.step(self.clock, step))
            self.battery.update(pv, self.u["idle_load_w"], step)
            self.clock += timedelta(seconds=step)
        self.clock = target

    def maintenance(self) -> list[str]:
        """Morning routine an operator would do: zero the optical sensor; clean electrodes if passivated."""
        done = ["NOL_SENSOR_AIR_BERSIH"]
        self.sensors.zero()
        if self.plant.L > 0.25:
            self.plant.clean_electrodes()
            done.append("BERSIHKAN_ELEKTRODA")
        return done

    def pv_forecast_wh(self) -> float:
        """Expected PV energy over the forecast horizon: clear-sky shape x current clearness (persistence)."""
        hz = self.cfg["grid"]["forecast_horizon_min"]
        wh = 0.0
        for m in range(0, hz, 10):
            ghi = self.solar.clear_sky(self.clock + timedelta(minutes=m)) * self.solar.kt
            wh += self.solar.pv_power(ghi) * (10 / 60)
        return wh

    # ---- one batch -------------------------------------------------------
    def iter_batch(self, ww: dict | None = None):
        """Generator of telemetry dicts; sets self.summary when finished."""
        u, cfg = self.u, self.cfg
        dt = float(u["sample_interval_s"])
        self.n_batch += 1
        ww = ww or sample_wastewater(cfg, self.env_rng)
        self.plant.load(ww)
        self.sensors.new_batch()
        bid = f"{u['unit_id']}-{self.clock:%Y%m%d}-{self.n_batch:02d}" + (f"-{self.run_tag}" if self.run_tag else "")
        self.ctrl.begin(bid)
        rev0 = self.plant.reversals
        ts0, t = self.epoch(), 0.0
        dil, kwh_total = 1.0, 0.0
        e_pv = e_batt = e_grid = 0.0     # Wh by source
        soc0 = self.battery.soc
        grid_cfg = self.cfg["grid"]
        while True:
            ghi = self.solar.step(self.clock, dt)
            pv = self.solar.pv_power(ghi)
            st = self.ctrl.state
            reading = self.sensors.read(self.plant, t, running=st in ("RUNNING",), dilution=dil)
            I_m, U_m = self.sensors.read_electrical(self._last["I"], self._last["U"])
            obs = dict(reading, I_A=I_m, U_V=U_m, pv_W=pv, batt_discharge_W=self.battery.discharge_available(),
                       pv_fc_wh=self.pv_forecast_wh() if st == "SAMPLING" else 0.0,
                       batt_usable_wh=max(0.0, self.battery.soc - self.battery.min_soc) * self.battery.cap)
            cmd = self.ctrl.step(obs, dt)
            dil = cmd["dilute"]

            # actuate
            aux = u["aux_load_w"] if (cmd["pump"] or cmd["mixer"]) else 0.0
            if cmd["reverse"]:
                self.plant.reverse_polarity()
            grid_cap = grid_cfg["max_w"] if cmd["grid_ok"] else 0.0
            p_av_bus = pv + self.battery.discharge_available() + grid_cap - aux - u["idle_load_w"]
            if cmd["I_set"] > 0:
                el = self.plant.step(dt, cmd["I_set"], p_av_bus)
            else:
                el = {"I": 0.0, "U": 0.0, "p_dc": 0.0, "p_bus": 0.0, "R": self.plant.resistance()[0]}
                self.plant.rest(dt)
            self._last = el
            load = u["idle_load_w"] + aux + el["p_bus"]
            from_pv = min(pv, load)
            rem = load - from_pv
            batt_w = min(rem, self.battery.discharge_available())
            grid_w = max(0.0, rem - batt_w) if cmd["grid_ok"] else 0.0
            self.battery.update(pv, load - grid_w, dt)
            kwh_total += load * dt / 3.6e6
            e_pv += from_pv * dt / 3600
            e_batt += batt_w * dt / 3600      # only what the battery really gave; load nobody could supply is not renewable energy
            e_grid += grid_w * dt / 3600
            if grid_w > 1:
                src = "pln" if grid_w >= 0.9 * load else "campuran"
            elif load > 1:
                src = "surya" if from_pv >= 0.9 * load else "baterai" if from_pv < 1 else "campuran"
            else:
                src = "-"

            V_L = self.plant.V * (min(self.ctrl.t_state / u["fill_s"], 1.0) if st == "FILLING" else 1.0)
            yield {
                "ts": self.epoch(), "source": self.source, "site_id": cfg["site"]["id"], "unit_id": u["unit_id"],
                "batch_id": bid, "state": cmd["state"], "mode": self.mode,
                "V_L": round(V_L, 1), "I_A": round(I_m, 3), "U_V": round(U_m, 2),
                "abs_r": round(reading["abs_r"], 4), "abs_g": round(reading["abs_g"], 4), "abs_b": round(reading["abs_b"], 4),
                "turb_ntu": round(reading["turb_ntu"], 1), "ec_uScm": round(reading["ec_uScm"], 0),
                "ph": round(reading["ph"], 2), "temp_C": round(reading["temp_C"], 1),
                "pv_W": round(pv, 1), "grid_W": round(grid_w, 1), "load_W": round(load, 1), "energy_source": src,
                "bat_V": round(self.battery.voltage, 2), "bat_soc": round(self.battery.soc, 3),
                "q_CperL": round(self.ctrl.q, 2), "kwh": round(self.ctrl.kwh, 4),
                "color_est_ptco": None if self.ctrl.color_now is None else round(self.ctrl.color_now, 1),
                "target_ptco": u["target_color_ptco"],
                "eta_s": None if self.ctrl.eta_s is None else round(self.ctrl.eta_s),
                "q_pred": None if self.ctrl.q_pred is None else round(self.ctrl.q_pred, 1),
                "polarity": self.plant.polarity, "dilution": dil,
                "flags": list(self.ctrl.flags),
            }
            self.clock += timedelta(seconds=dt)
            t += dt
            if cmd["done"]:
                break
        self.summary = self._summarize(bid, ts0, t, kwh_total, soc0, ww, (e_pv / 1000, e_batt / 1000, e_grid / 1000), rev0)

    def _summarize(self, bid: str, ts0: int, t: float, kwh_total: float, soc0: float, ww: dict, split: tuple, rev0: int = 0) -> dict:
        c, p, u, cost = self.ctrl, self.plant, self.u, self.cfg["cost"]
        tr = p.truth()
        V_m3 = p.V / 1000.0
        fe_g = p.metal_g
        kwh = p.e_dc_J / 3.6e6
        k_pv, k_batt, k_grid = split
        elec_rp = (k_pv + k_batt) * cost["pv_rp_per_kwh"] + k_grid * self.cfg["grid"]["tariff_rp_per_kwh"]
        cost_rp = elec_rp + fe_g / 1000 * cost["electrode_rp_per_kg"] + tr["sludge_kg"] * cost["sludge_rp_per_kg"]
        tot = max(k_pv + k_batt + k_grid, 1e-9)
        pass_true = tr["color"] <= u["target_color_ptco"]
        return {
            "batch_id": bid, "unit_id": u["unit_id"], "site_id": self.cfg["site"]["id"], "source": self.source,
            "mode": self.mode, "ts_start": ts0, "ts_end": self.epoch(), "V_L": p.V,
            "status": c.status or "SELESAI", "flags": list(c.flags),
            "run_s": round(p.run_s), "total_s": round(t), "q_CperL": round(p.q, 2), "q_pred": None if c.q_pred is None else round(c.q_pred, 1),
            "q_pred_raw": None if c.q_pred_raw is None else round(c.q_pred_raw, 1), "calib_factor": round(c.calib_factor, 3), "scenario": self.scenario,
            "kwh": round(kwh, 4), "kwh_total": round(kwh_total, 4), "kwh_per_m3": round(kwh / V_m3, 3),
            "kwh_pv": round(k_pv, 4), "kwh_batt": round(k_batt, 4), "kwh_grid": round(k_grid, 4),
            "pct_renewable": round(100 * (k_pv + k_batt) / tot, 1), "policy": self.cfg["grid"]["policy"],
            "electricity_rp": round(elec_rp), "wait_s": round(c.wait_s),
            "electrode_g": round(fe_g, 2), "sludge_kg": round(tr["sludge_kg"], 3), "reversals": p.reversals - rev0,
            "retries": c.retries, "color0_est": None if c.color0_est is None else round(c.color0_est, 1),
            "color_end_est": None if getattr(c, "color_end_est", None) is None else round(c.color_end_est, 1),
            "features": None if c.feat is None else [round(x, 5) for x in c.feat],
            "target_ptco": u["target_color_ptco"], "cost_rp": round(cost_rp), "cost_rp_per_m3": round(cost_rp / V_m3),
            "ph_in": round(ww["ph"], 2), "ec_in": round(ww["ec"]),
            # ground truth exists only in simulation; real devices never send this block
            "truth": {"color0": round(tr["color0"], 1), "color_end": round(tr["color"], 1), "pass": bool(pass_true),
                      "cod0": round(tr["cod0"]), "cod_end": round(tr["cod"]), "dye": tr["dye"],
                      "k_d": round(tr["k_d"], 4), "passivation": round(tr["passivation"], 3)} if self.source == "simulator" else None,
        }

    def run_batch(self, ww: dict | None = None, keep_telemetry: bool = False):
        tele = []
        for m in self.iter_batch(ww):
            if keep_telemetry:
                tele.append(m)
        return (self.summary, tele) if keep_telemetry else self.summary
