"""Digital twin of one SEBAT electrocoagulation reactor (true physical state).

Ground truth lives here. What the controller sees goes through sensors.py (noise, bias, drift).
Colour kinetics:  C = C_res + (C - C_res) * exp(-k_d * dose_mg_per_L)   (dose from Faraday)
"""
from __future__ import annotations

import math

import numpy as np

from .physics import current_for_power, dose_mg_per_L_per_CperL, faraday_mass_g


class Plant:
    def __init__(self, cfg: dict, rng: np.random.Generator):
        self.cfg, self.rng = cfg, rng
        self.u, self.r = cfg["unit"], cfg["reactor"]
        self.el = self.u["electrode"]
        self.area = self.u["electrode_area_cm2"] / 1e4
        self.gap = self.u["gap_cm"] / 100.0
        self.L = 0.0            # passivation layer 0..1 (persists between batches)
        self.polarity = 1
        self.reversals = 0
        self.ww: dict | None = None

    # ---- batch lifecycle -------------------------------------------------
    def clean_electrodes(self) -> None:
        self.L = 0.0

    def load(self, ww: dict) -> None:
        r = self.r
        self.ww = ww
        self.V = float(self.u["batch_volume_L"])
        self.C0 = self.C = ww["color"]
        self.cod0 = self.cod = ww["cod"]
        self.tss0 = ww["tss"]
        self.ph, self.ec, self.T = ww["ph"], ww["ec"], ww["temp"]
        self.t_amb = 30.0
        self.eps = np.array(self.cfg["dyes"][ww["dye"]]["eps"], float)
        k_base = r["k_d_" + self.el] * self.cfg["dyes"][ww["dye"]]["k_mult"] * ww["kd_rand"]
        k_base *= (ww["color"] / 2000.0) ** r["load_exponent"]
        slope = r["ph_slope_" + self.el]
        k_base *= float(np.clip(1 + slope * (ww["ph"] - 9.5), 0.3, 1.5))
        self.k_d = k_base
        # fraction of colour that no dose removes (literature: removal plateaus at 58-71% for some dyes)
        self.c_floor = r["color_residual_ptco"] + r.get("recalcitrant_scale", 1.0) * self.cfg["dyes"][ww["dye"]].get("recalcitrant", 0.0) * self.C0
        self.turb_susp = ww["turb"]
        self.floc = 0.0
        self.q = 0.0            # C/L
        self.dose = 0.0         # mg/L metal
        self.e_dc_J = 0.0
        self.e_bus_J = 0.0
        self.metal_g = 0.0
        self.run_s = 0.0

    # ---- electrical -----------------------------------------------------
    def _kappa(self) -> float:
        return self.ec * 1e-4 * (1 + 0.02 * (self.T - 25.0))   # S/m

    def resistance(self) -> tuple[float, float]:
        r_sol = self.gap / (self._kappa() * self.area) * self.r["solution_resistance_scale"]
        r_pass = self.r["passivation_R_ohm_m2"] * self.L / self.area
        return r_sol + r_pass, r_sol

    def reverse_polarity(self) -> None:
        self.polarity *= -1
        self.L *= self.r["reversal_reset"]
        self.reversals += 1

    def step(self, dt: float, I_set: float, p_avail_bus_w: float) -> dict:
        """Advance dt seconds with current setpoint I_set limited by compliance voltage and available power."""
        R, _ = self.resistance()
        U0 = self.r["overpotential_V"]
        I = 0.0
        if I_set > 0 and self.ww is not None:
            I_u = (self.u["U_max_V"] - U0) / R
            I_p = current_for_power(p_avail_bus_w, R, U0, self.u["dcdc_eff"])
            I = max(0.0, min(I_set, self.u["I_max_A"], I_u, I_p))
        U = U0 + R * I if I > 1e-6 else 0.0
        p_dc = U * I
        if I > 0:
            ce = self.r["current_eff"][self.el] * (1 - self.r["passivation_ce_loss"] * self.L)
            m_g = faraday_mass_g(I, dt, self.el, ce)
            d_dose = m_g * 1000.0 / self.V
            dq = I * dt / self.V
            self.metal_g += m_g
            self.dose += d_dose
            self.q += dq
            res = self.c_floor
            self.C = res + (self.C - res) * math.exp(-self.k_d * d_dose)
            self.L = min(1.0, self.L + self.r["passivation_rate"] * dq)
            self.ph += (self.r["ph_target"] - self.ph) * self.r["ph_rate"] * dq
            fr = self.removal_frac()
            self.turb_susp = self.ww["turb"] * (1 - 0.85 * fr)
            target_floc = min(self.r["floc_ntu_per_mg"] * self.dose, self.r.get("floc_ntu_max", 1e9))  # suspended floc saturates: it settles/floats as it grows
            self.floc += (target_floc - self.floc) * (1 - math.exp(-dt / 120.0))
            self.run_s += dt
        loss = self.r["heat_loss_w_per_K"] * (self.T - self.t_amb)
        self.T += (p_dc - loss) * dt / (self.V * 4186.0)
        self.e_dc_J += p_dc * dt
        self.cod = self.cod0 * max(self.r["cod_floor_frac"], 1 - self.r["cod_removal_ratio"] * self.removal_frac())
        return {"I": I, "U": U, "p_dc": p_dc, "p_bus": p_dc / self.u["dcdc_eff"] if p_dc > 0 else 0.0, "R": R}

    def rest(self, dt: float) -> None:
        """No current: flocs settle, temperature relaxes."""
        tau = self.r["floc_settle_tau_s"]
        f = math.exp(-dt / tau)
        self.floc *= f
        self.turb_susp = max(8.0, self.turb_susp * f)
        loss = self.r["heat_loss_w_per_K"] * (self.T - self.t_amb)
        self.T += -loss * dt / (self.V * 4186.0)

    # ---- truth ----------------------------------------------------------
    def removal_frac(self) -> float:
        res = self.c_floor
        return float(np.clip(1 - (self.C - res) / max(self.C0 - res, 1e-9), 0, 1))

    @property
    def turb(self) -> float:
        return self.turb_susp + self.floc

    def truth(self) -> dict:
        sludge_kg = (self.metal_g * self.r["sludge_hydroxide_factor"][self.el]
                     + self.tss0 * self.V / 1000.0 * 0.9) / 1000.0
        return {
            "color": self.C, "color0": self.C0, "cod": self.cod, "cod0": self.cod0,
            "k_d": self.k_d, "dye": self.ww["dye"], "passivation": self.L,
            "metal_g": self.metal_g, "dose_mg_L": self.dose, "q": self.q, "sludge_kg": sludge_kg,
        }
