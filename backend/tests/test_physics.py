import math

from app.physics import current_for_power, dose_mg_per_L_per_CperL, energy_kwh, faraday_mass_g


def test_faraday_matches_brief_examples():
    # brief 6.2: 50 L, 5 A, 20 min
    assert math.isclose(faraday_mass_g(5, 1200, "Fe"), 1.74, abs_tol=0.01)
    assert math.isclose(faraday_mass_g(5, 1200, "Al"), 0.56, abs_tol=0.01)
    assert math.isclose(faraday_mass_g(5, 1200, "Fe") * 1000 / 50, 34.8, abs_tol=0.3)


def test_dose_per_charge_consistent():
    q = 120.0  # C/L
    assert math.isclose(q * dose_mg_per_L_per_CperL("Fe"), faraday_mass_g(5, 1200, "Fe") * 1000 / 50, rel_tol=1e-6)


def test_energy():
    assert math.isclose(energy_kwh(10, 5, 1200), 10 * 5 * 1200 / 3.6e6)


def test_current_for_power_roundtrip():
    for P in (20, 80, 300):
        I = current_for_power(P, R_ohm=1.4, U0_V=1.8, eff=0.92)
        assert math.isclose((1.8 + 1.4 * I) * I / 0.92, P, rel_tol=1e-6)
    assert current_for_power(0, 1.4, 1.8) == 0.0
    assert current_for_power(-5, 1.4, 1.8) == 0.0
