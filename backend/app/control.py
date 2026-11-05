"""Closed-loop batch controller (reference implementation of the ESP32 firmware logic).

Modes:  fixed     timer only, no feedback (baseline "waktu tetap")
        feedback  stop on optical colour estimate, no prediction
        ai        dose prediction + feedback + energy awareness + sensor-fault fallback + anomaly flag
"""
from __future__ import annotations

import math
from collections import deque
from statistics import median

from .predictor import DosePredictor, UnitCalibrator, make_features, physics_q

STATES = ["IDLE", "FILLING", "SAMPLING", "WAITING_SOLAR", "RUNNING", "PAUSED_SOLAR", "SETTLING", "DONE", "FAULT"]


class BatchController:
    def __init__(self, cfg: dict, mode: str = "ai", predictor: DosePredictor | None = None):
        assert mode in ("fixed", "feedback", "ai")
        self.cfg, self.u, self.c = cfg, cfg["unit"], cfg["control"]
        self.mode, self.predictor = mode, predictor
        self.policy = cfg["grid"]["policy"]
        self.state = "IDLE"
        self.result: dict | None = None
        uc = self.c.get("unit_calibration") or {}
        # survives begin(): it is what this unit has learned about itself across batches
        self.calib = UnitCalibrator(uc.get("window", 5), uc.get("min_batches", 3), tuple(uc.get("limits", (0.25, 4.0)))) if uc.get("enabled") else None

    # ---- helpers ---------------------------------------------------------
    def _color_est(self, obs: dict, dil: float = 1.0) -> float:
        a = (obs["abs_r"] + obs["abs_g"] + obs["abs_b"]) / 3.0 * dil
        a -= self.c["floc_beta_est"] * self.c["floc_leak_est"] * obs["turb_ntu"]
        return max(a, 0.0) / self.c["eps_eff_cal"]

    def begin(self, batch_id: str) -> None:
        self.batch_id = batch_id
        self.state = "FILLING"
        self.result = None
        self.t_state = 0.0
        self.run_s = self.wait_s = self.low_power_s = 0.0
        self.q = self.kwh = 0.0
        self.dil = 1.0
        self.samples: list[dict] = []
        self.hist: deque = deque(maxlen=12)       # (q, ln C)
        self.cbuf: deque = deque(maxlen=self.c["median_window"])
        self.abs_hist: deque = deque(maxlen=14)
        self.retries = 0
        self.reversals = 0
        self.since_reverse = 0.0
        self.r_ref: float | None = None
        self.r_age = 0.0
        self.pred = None
        self.feat = None
        self.q_pred = self.q_lo = self.q_hi = None
        self.q_pred_raw = None
        self.calib_factor = 1.0
        self.plateau_buf: deque = deque(maxlen=30)     # 5 minutes of readings; turbidity noise is large at high dose
        self.plateau_hits = 0
        self.plateau_ref: tuple[float, float] | None = None     # (q, mean ln colour) at the last checkpoint
        self.color0_est = None
        self.color_now = None
        self.eta_s = None
        self.flags: list[str] = []
        self.status = None
        self.q_target_stop = None
        self.fixed_run_s = None
        self.measuring = False
        self.grid_on = False
        self.wait_limit_s = self.cfg["grid"]["max_wait_min"] * 60 if self.policy == "solar_first" else self.u["wait_max_min"] * 60
        self.e_need_wh = None

    def _p_avail(self, obs: dict) -> float:
        return obs["pv_W"] + obs["batt_discharge_W"]

    def _cmd(self, I_set=0.0, reverse=False, pump=False, mixer=False, dilute=None, done=False) -> dict:
        return {"state": self.state, "I_set": I_set, "reverse": reverse, "pump": pump, "mixer": mixer,
                "dilute": self.dil if dilute is None else dilute, "done": done, "grid_ok": self.grid_on or self.policy == "grid_only"}

    def _use_grid(self, why: str) -> None:
        if not self.grid_on:
            self.grid_on = True
            if "PLN_DIPAKAI" not in self.flags:
                self.flags.append("PLN_DIPAKAI")
            self.flags.append(why) if why not in self.flags else None

    def _energy_need_wh(self, obs_m: dict) -> float:
        """Electrical energy (Wh at the bus) the predicted charge will need, incl. converter loss and aux."""
        u, r = self.u, self.cfg["reactor"]
        kappa = obs_m["ec_uScm"] * 1e-4 * (1 + 0.02 * (obs_m["temp_C"] - 25))
        R = u["gap_cm"] / 100 / (kappa * u["electrode_area_cm2"] / 1e4) * r["solution_resistance_scale"] * 1.15
        U = r["overpotential_V"] + u["I_default_A"] * R
        t_h = self.q_pred * u["batch_volume_L"] / u["I_default_A"] / 3600
        return U * self.q_pred * u["batch_volume_L"] / 3600 / u["dcdc_eff"] + (u["aux_load_w"] + u["idle_load_w"]) * t_h

    def _finish(self, status: str) -> None:
        self.status = status
        self.state = "SETTLING"
        self.t_state = 0.0
        self.samples = []
        self.measuring = False

    # ---- main step -------------------------------------------------------
    def step(self, obs: dict, dt: float) -> dict:
        u, c = self.u, self.c
        st = self.state
        self.t_state += dt

        if st == "FILLING":
            if self.t_state >= u["fill_s"]:
                self.state, self.t_state, self.samples = "SAMPLING", 0.0, []
            return self._cmd(pump=self.state == "FILLING", mixer=True)

        if st == "SAMPLING":
            self.samples.append(obs)
            if len(self.samples) < c["sample_count"]:
                return self._cmd(mixer=True, dilute=self.dil)
            raw = median((s["abs_r"] + s["abs_g"] + s["abs_b"]) / 3 for s in self.samples)
            if self.dil == 1.0 and raw > c["sat_threshold"]:
                self.dil = float(self.cfg["sensor"]["dilution_ratio"])
                self.samples = []
                self.flags.append("PENGENCERAN_OTOMATIS")
                return self._cmd(mixer=True, dilute=self.dil)
            return self._plan(obs)

        if st == "WAITING_SOLAR":
            self.wait_s += dt
            if self._p_avail(obs) >= 1.3 * u["min_run_power_w"]:
                self.state, self.t_state = "RUNNING", 0.0
            elif self.wait_s >= self.wait_limit_s:
                if self.policy == "solar_first":
                    self._use_grid("BATAS_TUNGGU_SURYA_HABIS")
                    self.state, self.t_state = "RUNNING", 0.0
                else:
                    self.status = "GAGAL_TANPA_DAYA"
                    self.state = "FAULT"
                    return self._cmd(done=True)
            return self._cmd()

        if st in ("RUNNING", "PAUSED_SOLAR"):
            return self._run(obs, dt)

        if st == "SETTLING":
            return self._settle(obs, dt)

        return self._cmd(done=st in ("DONE", "FAULT"))

    # ---- planning --------------------------------------------------------
    def _plan(self, obs: dict) -> dict:
        s = self.samples
        m = lambda k: median(x[k] for x in s)
        obs_m = {k: m(k) for k in ("abs_r", "abs_g", "abs_b", "turb_ntu", "ec_uScm", "ph", "temp_C")}
        self.obs0 = obs_m
        self.color0_est = max(self._color_est(obs_m, self.dil), 1.05 * self.u["target_color_ptco"])
        target = self.u["target_color_ptco"]
        if self.mode == "fixed":
            self.q_pred = self.c["fixed_q_CperL"]
            self.fixed_run_s = self.q_pred * self.u["batch_volume_L"] / self.u["I_default_A"]
        else:
            rgb = tuple(obs_m[k] * self.dil for k in ("abs_r", "abs_g", "abs_b"))
            self.feat = make_features(self.color0_est, target, obs_m["ph"], obs_m["ec_uScm"], obs_m["temp_C"], obs_m["turb_ntu"], rgb)
            if self.mode == "ai" and self.predictor is not None:
                self.pred = self.predictor.predict(self.feat)
                self.q_pred_raw = self.pred["q"]
                self.calib_factor = self.calib.factor if self.calib else 1.0
                self.q_pred, self.q_lo, self.q_hi = (self.pred[k] * self.calib_factor for k in ("q", "q_lo", "q_hi"))
            else:
                self.q_pred = physics_q(self.color0_est, target, c_margin(self.c), self.c["k_phys_per_Cpl"])
        self.state, self.t_state = "RUNNING", 0.0
        p_ok = self._p_avail(obs) >= self.u["min_run_power_w"]
        if self.policy == "grid_only" or (self.mode == "fixed" and self.policy == "solar_first"):
            self.grid_on = self.policy != "solar_only"
            if self.grid_on:
                self.flags.append("PLN_DIPAKAI")
        elif self.mode == "ai" and self.q_pred and self.policy == "solar_first":
            self.e_need_wh = self._energy_need_wh(obs_m)
            solar_wh = obs["pv_fc_wh"] + obs["batt_usable_wh"]
            if solar_wh < self.e_need_wh:
                # waiting will not help: start now, solar first, grid tops up
                self._use_grid("PRAKIRAAN_SURYA_KURANG")
            elif not p_ok:
                self.state = "WAITING_SOLAR"
                self.flags.append("TUNDA_MENUNGGU_SURYA")
        elif self.mode != "fixed" and not p_ok:
            self.state = "WAITING_SOLAR"
            self.flags.append("TUNDA_MENUNGGU_SURYA")
        return self._cmd()

    # ---- running ---------------------------------------------------------
    def _run(self, obs: dict, dt: float) -> dict:
        u, c = self.u, self.c
        I_m, U_m = obs["I_A"], obs["U_V"]
        p_av = self._p_avail(obs)

        # solar pause / resume (not for the dumb fixed timer)
        if self.mode != "fixed" and not self.grid_on:
            if self.state == "RUNNING":
                self.low_power_s = self.low_power_s + dt if p_av < u["min_run_power_w"] else 0.0
                if self.low_power_s >= 60:
                    self.state = "PAUSED_SOLAR"
                    if "JEDA_DAYA_SURYA" not in self.flags:
                        self.flags.append("JEDA_DAYA_SURYA")
            elif p_av >= 1.3 * u["min_run_power_w"]:
                self.state, self.low_power_s = "RUNNING", 0.0
            if self.state == "PAUSED_SOLAR":
                self.wait_s += dt
                if self.wait_s >= self.wait_limit_s:
                    if self.policy == "solar_first":
                        self._use_grid("BATAS_TUNGGU_SURYA_HABIS")
                        self.state = "RUNNING"
                    else:
                        self.status = "GAGAL_TANPA_DAYA"
                        self._finish(self.status)
                return self._cmd(mixer=True)

        self.run_s += dt
        self.q += I_m * dt / u["batch_volume_L"]
        self.kwh += U_m * I_m * dt / 3.6e6
        self.since_reverse += dt

        # passivation watch: cell resistance
        reverse = False
        if I_m > 0.5:
            R = U_m / I_m
            self.r_age += dt
            if self.r_ref is None and self.r_age >= 30:
                self.r_ref = R
            elif self.r_ref is not None and R > c["reverse_rise"] * self.r_ref and self.since_reverse > 120:
                reverse = True
                if "PASIVASI_TERDETEKSI" not in self.flags:
                    self.flags.append("PASIVASI_TERDETEKSI")
        if self.since_reverse >= u["reverse_every_s"]:
            reverse = True
        if reverse:
            self.reversals += 1
            self.since_reverse, self.r_ref, self.r_age = 0.0, None, 0.0

        # safety
        if obs["temp_C"] > u["T_max_C"]:
            self._finish("GAGAL_PENGAMAN_SUHU")
            return self._cmd()
        if self.run_s > u["t_max_min"] * 60:
            self._finish("GAGAL_WAKTU" if self.mode != "fixed" else "SELESAI_TANPA_VERIFIKASI")
            return self._cmd()

        if self.mode == "fixed":
            if self.run_s >= self.fixed_run_s:
                self._finish("SELESAI_TANPA_VERIFIKASI")
                return self._cmd()
            return self._cmd(I_set=u["I_default_A"], reverse=reverse, mixer=True)

        # optical estimate
        sat = self.cfg["sensor"]["abs_sat"]
        a_mean = (obs["abs_r"] + obs["abs_g"] + obs["abs_b"]) / 3.0
        saturated = max(obs["abs_r"], obs["abs_g"], obs["abs_b"]) >= 0.97 * sat
        if saturated and self.dil == 1.0:
            self.dil = float(self.cfg["sensor"]["dilution_ratio"])      # sensor clipped: dilute and keep tracking
            self.cbuf.clear()
            if "PENGENCERAN_OTOMATIS" not in self.flags:
                self.flags.append("PENGENCERAN_OTOMATIS")
            return self._cmd(I_set=u["I_default_A"], reverse=reverse, mixer=True)
        if not saturated:
            self.abs_hist.append(round(obs["abs_g"], 5))
        c_est = self._color_est(obs, self.dil)
        self.cbuf.append(c_est)
        self.color_now = median(self.cbuf)
        if self.dil > 1.0 and self.color_now < c["undilute_below_ptco"]:
            self.dil = 1.0
            self.cbuf.clear()
            self.abs_hist.clear()
            self.plateau_buf.clear()
            self.plateau_ref = None
            self.plateau_hits = 0
        if self.q > 8:
            self.hist.append((self.q, math.log(max(self.color_now, 1.0))))
        self._eta(I_m)

        sensor_dead = len(self.abs_hist) == self.abs_hist.maxlen and len(set(self.abs_hist)) == 1 and not saturated
        if sensor_dead:
            if self.mode == "ai" and self.q_hi:
                if "SENSOR_MACET_FALLBACK_PREDIKSI" not in self.flags:
                    self.flags.append("SENSOR_MACET_FALLBACK_PREDIKSI")
                if self.q >= self.q_hi:
                    self._finish("SELESAI_TANPA_VERIFIKASI")
                    return self._cmd()
                return self._cmd(I_set=u["I_default_A"], reverse=reverse, mixer=True)
            self.flags.append("SENSOR_MACET")
            self._finish("GAGAL_SENSOR")
            return self._cmd()

        guard_ok = True
        if self.mode == "ai" and self.q_pred and self.retries == 0:
            guard_ok = self.q >= c["guard_frac"] * self.q_pred
        if (self.run_s > 60 and guard_ok and len(self.cbuf) == self.cbuf.maxlen
                and self.color_now <= c["stop_margin"] * u["target_color_ptco"]):
            self._finish("TARGET_TERCAPAI")
            return self._cmd()
        if self._plateaued():
            if "WARNA_MENTOK" not in self.flags:
                self.flags.append("WARNA_MENTOK")
            self._finish("GAGAL_WARNA_MENTOK")      # more current would only waste energy; settling still gets a final reading
            return self._cmd()
        return self._cmd(I_set=u["I_default_A"], reverse=reverse, mixer=True)

    def _plateaued(self) -> bool:
        """True when colour has stopped falling although charge keeps flowing. Averages a window to ride out sensor noise."""
        dq = self.c.get("plateau_dq_CperL")
        if not dq or not self.color_now:
            return False
        self.plateau_buf.append(math.log(max(self.color_now, 1.0)))
        if len(self.plateau_buf) < self.plateau_buf.maxlen:
            return False
        now = sum(self.plateau_buf) / len(self.plateau_buf)
        if self.plateau_ref is None:
            self.plateau_ref = (self.q, now)
            return False
        if self.q - self.plateau_ref[0] < dq:
            return False
        drop = self.plateau_ref[1] - now
        self.plateau_ref = (self.q, now)
        self.plateau_hits = self.plateau_hits + 1 if drop < self.c["plateau_min_drop"] else 0
        return self.plateau_hits >= 2               # one flat stretch can be noise; a slow plant must not be mistaken for a stuck one

    def _eta(self, I_m: float) -> None:
        u, c = self.u, self.c
        V = u["batch_volume_L"]
        goal = c["stop_margin"] * u["target_color_ptco"]
        if len(self.hist) >= 12:
            qs = [h[0] for h in self.hist]; ys = [h[1] for h in self.hist]
            n = len(qs); mq = sum(qs) / n; my = sum(ys) / n
            var = sum((x - mq) ** 2 for x in qs)
            if var > 1e-6:
                k = -sum((x - mq) * (y - my) for x, y in zip(qs, ys)) / var
                if k > 1e-4 and self.color_now:
                    q_rem = max(math.log(max(self.color_now, goal) / goal) / k, 0.0)
                    self.eta_s = q_rem * V / max(I_m, 0.5)
                    return
        if self.q_pred:
            self.eta_s = max(self.q_pred - self.q, 0.0) * V / max(I_m, 0.5)

    # ---- settling + final verification ---------------------------------
    def _settle(self, obs: dict, dt: float) -> dict:
        u, c = self.u, self.c
        if self.status == "GAGAL_TANPA_DAYA":
            self.state = "FAULT"
            return self._cmd(done=True)
        if not self.measuring:
            if self.t_state >= u["settle_min"] * 60:
                self.measuring, self.samples = True, []
            return self._cmd()
        self.samples.append(obs)
        if len(self.samples) < c["sample_count"]:
            return self._cmd()
        final = median(self._color_est(s) for s in self.samples)
        self.color_end_est = final
        if self.mode == "fixed" or self.status in ("SELESAI_TANPA_VERIFIKASI", "GAGAL_SENSOR", "GAGAL_PENGAMAN_SUHU"):
            self.state = "DONE"
            return self._cmd(done=True)
        if final <= u["target_color_ptco"]:
            self.status = "LOLOS"
            self.state = "DONE"
        elif self.status == "GAGAL_WARNA_MENTOK":
            self.state = "DONE"                     # a repeat cannot remove what the last charge could not
        elif self.retries < c["max_retries"]:
            self.retries += 1
            self.flags.append("ULANG_PROSES")
            self.state, self.t_state = "RUNNING", 0.0
            self.cbuf.clear(); self.hist.clear(); self.abs_hist.clear(); self.plateau_buf.clear()
            self.plateau_ref = None
            self.plateau_hits = 0
            self.run_s = min(self.run_s, u["t_max_min"] * 60 * 0.6)
            self.status = None
            return self._cmd()
        else:
            self.status = "GAGAL_WARNA"
            self.state = "DONE"
        if self.status == "LOLOS" and self.calib and self.q_pred_raw and self.retries == 0:
            self.calib.add(self.q, self.q_pred_raw)
        if self.status == "LOLOS" and self.mode == "ai" and self.pred:
            z = abs(math.log(max(self.q, 1e-6) / self.q_pred)) / self.pred["sigma_ln"]
            if z > c["anomaly_sigma"]:
                self.flags.append("ANOMALI_DOSIS_CEK_SENSOR_ATAU_LIMBAH")
        return self._cmd(done=True)


def c_margin(c: dict) -> float:
    return c["stop_margin"]
