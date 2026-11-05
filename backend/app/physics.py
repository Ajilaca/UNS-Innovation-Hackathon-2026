"""Electrochemistry helpers (Faraday, energy). Pure functions, SI-ish units."""
from __future__ import annotations

import math

F = 96485.0
MOLAR = {"Fe": (55.845, 2), "Al": (26.982, 3)}  # g/mol, valence


def faraday_mass_g(I: float, t: float, electrode: str, ce: float = 1.0) -> float:
    M, z = MOLAR[electrode]
    return ce * I * t * M / (z * F)


def dose_mg_per_L_per_CperL(electrode: str, ce: float = 1.0) -> float:
    """mg/L of dissolved metal per C/L of specific charge."""
    M, z = MOLAR[electrode]
    return ce * M / (z * F) * 1000.0


def energy_kwh(U: float, I: float, t: float) -> float:
    return U * I * t / 3.6e6


def current_for_power(P_w: float, R_ohm: float, U0_V: float, eff: float = 1.0) -> float:
    """Largest I with (U0 + R*I)*I/eff <= P. Solves R I^2 + U0 I - P*eff = 0."""
    P = max(P_w, 0.0) * eff
    if P <= 0:
        return 0.0
    if R_ohm <= 1e-9:
        return P / max(U0_V, 1e-9)
    return (-U0_V + math.sqrt(U0_V ** 2 + 4 * R_ohm * P)) / (2 * R_ohm)
