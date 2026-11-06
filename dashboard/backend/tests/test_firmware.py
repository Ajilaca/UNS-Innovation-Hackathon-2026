"""The C++ firmware controller must decide exactly what the Python reference decides, step by step."""
import json
import math
import shutil
import subprocess
from pathlib import Path

import pytest

from sobat_ml.config import load_config
from app.models import BatchSummary, Telemetry
from sobat_ml.predictor import physics_q
from sobat_ml.runner import UnitSim

FW = Path(__file__).resolve().parents[3] / "firmware" / "host_tests"
pytestmark = pytest.mark.skipif(shutil.which("g++") is None, reason="butuh g++")


@pytest.fixture(scope="module")
def parity_bin():
    subprocess.run([str(FW / "run.sh")], check=True, capture_output=True)
    return str(FW / "parity")


class StubPredictor:
    """Deterministic stand-in for the trained model: only the numbers cross the language boundary."""
    trained = True

    def __init__(self, scale=1.2):
        self.scale = scale

    def predict(self, feat):
        q = (feat[0] + 0.105) / 0.0091 * self.scale
        return {"q": q, "q_lo": 0.7 * q, "q_hi": 1.4 * q, "sigma_ln": 0.2}


def record(cfg, mode, predictor, n_batches, seed):
    """Run the Python controller in the closed-loop twin; keep every observation and every decision."""
    sim = UnitSim(cfg, mode, predictor, env_seed=seed)
    u = cfg["unit"]
    lines = [f"config {mode} {cfg['grid']['policy']} {u['fill_s']} {u['settle_min']} {cfg['control']['plateau_dq_CperL'] or 0}"]
    expected = []
    orig = sim.ctrl.step

    def step(obs, dt):
        cmd = orig(obs, dt)
        block.append("obs " + " ".join(repr(float(obs[k])) for k in (
            "abs_r", "abs_g", "abs_b", "turb_ntu", "ec_uScm", "ph", "temp_C", "I_A", "U_V", "pv_W",
            "batt_discharge_W", "pv_fc_wh", "batt_usable_wh")) + f" {dt!r}")
        c = sim.ctrl
        expected.append(dict(state=c.state, I_set=cmd["I_set"], reverse=int(cmd["reverse"]), pump=int(cmd["pump"]), mixer=int(cmd["mixer"]),
                             dilute=cmd["dilute"], done=int(cmd["done"]), grid_ok=int(cmd["grid_ok"]), q=c.q, kwh=c.kwh,
                             color=c.color_now, eta=c.eta_s, q_pred=c.q_pred, c0=c.color0_est, cend=c.color_end_est if c.state == "DONE" else None,
                             retries=c.retries, reversals=c.reversals, status=c.status or "SELESAI", flags=list(c.flags)))
        return cmd

    sim.ctrl.step = step
    for _ in range(n_batches):
        block = []
        sim.run_batch()
        p = sim.ctrl.pred
        head = f"begin 1 {p['q']!r} {p['q_lo']!r} {p['q_hi']!r} {p['sigma_ln']!r}" if p else "begin 0 0 0 0 0"
        lines.append(head)
        lines.extend(block)
    return "\n".join(lines) + "\n", expected, sim


def same(a, b):
    if a is None or b is None:
        return a is None and b is None
    return math.isclose(float(a), float(b), rel_tol=1e-9, abs_tol=1e-9)


def replay(parity_bin, trace, expected):
    out = subprocess.run([parity_bin], input=trace, capture_output=True, text=True, check=True).stdout.splitlines()
    assert len(out) == len(expected)
    num = lambda s: None if s == "None" else float(s)
    for i, (line, e) in enumerate(zip(out, expected)):
        f = line.split(" ")
        got = dict(state=f[0], I_set=num(f[1]), reverse=int(f[2]), pump=int(f[3]), mixer=int(f[4]), dilute=num(f[5]), done=int(f[6]), grid_ok=int(f[7]),
                   q=num(f[8]), kwh=num(f[9]), color=num(f[10]), eta=num(f[11]), q_pred=num(f[12]), c0=num(f[13]), cend=num(f[14]),
                   retries=int(f[15]), reversals=int(f[16]), status=f[17], flags=[x for x in f[18].split(",") if x])
        for k, want in e.items():
            if k == "cend" and want is None:
                continue                # only meaningful once the batch is done
            if isinstance(want, (str, list)):
                assert got[k] == want, f"langkah {i} {k}: C++ {got[k]} != Python {want}"
            else:
                assert same(got[k], want), f"langkah {i} {k}: C++ {got[k]} != Python {want} (state {e['state']})"


CASES = [
    ("fixed", {}, 3),
    ("feedback", {}, 4),
    ("ai", {}, 4),                                             # physics prior: what the device does offline
    ("feedback", {"grid": {"policy": "solar_only"}}, 3),
    ("feedback", {"sensor": {"stuck_after_s": 1500}}, 2),      # stuck sensor
    ("feedback", {"reactor": {"recalcitrant_scale": 6.0}}, 2),  # colour plateau
    ("feedback", {"unit": {"pv_wp": 50, "battery_wh": 150}}, 3),   # pauses and waits on a small panel
]


@pytest.mark.parametrize("mode,over,n", CASES)
def test_decisions_match_python(parity_bin, mode, over, n):
    cfg = load_config(overrides=over)
    trace, expected, _ = record(cfg, mode, None, n, seed=11)
    assert len(expected) > 100
    replay(parity_bin, trace, expected)


def test_prediction_path_and_unit_correction_match(parity_bin):
    """With a predictor: guard band, fallback on a stuck sensor, anomaly flag and the per-unit factor across batches."""
    cfg = load_config()
    trace, expected, sim = record(cfg, "ai", StubPredictor(), 6, seed=5)
    assert sim.ctrl.calib.errors, "koreksi per unit harus sudah belajar di jejak ini"
    replay(parity_bin, trace, expected)
    cfg = load_config(overrides={"sensor": {"stuck_after_s": 1500}})
    trace, expected, sim = record(cfg, "ai", StubPredictor(), 2, seed=5)
    assert any("SENSOR_MACET_FALLBACK_PREDIKSI" in e["flags"] for e in expected)
    replay(parity_bin, trace, expected)


def test_traces_cover_the_outcomes_that_matter(parity_bin):
    """Guards the test itself: the cases above must really reach these branches."""
    seen, flags = set(), set()
    for mode, over, n in CASES:
        _, expected, _ = record(load_config(overrides=over), mode, None, n, seed=11)
        seen |= {e["status"] for e in expected}
        flags |= {f for e in expected for f in e["flags"]}
    assert {"LOLOS", "SELESAI_TANPA_VERIFIKASI", "GAGAL_SENSOR", "GAGAL_WARNA_MENTOK"} <= seen
    assert {"SENSOR_MACET", "WARNA_MENTOK", "JEDA_DAYA_SURYA"} <= flags


def test_defaults_match_sim_yaml(parity_bin):
    cfg = load_config()
    u, r, s, c, g, k = cfg["unit"], cfg["reactor"], cfg["sensor"], cfg["control"], cfg["grid"], cfg["cost"]
    uc = c["unit_calibration"]
    want = {**{x: u[x] for x in ("batch_volume_L", "electrode_area_cm2", "gap_cm", "I_default_A", "I_max_A", "U_max_V", "T_max_C", "t_max_min", "wait_max_min",
                                 "fill_s", "settle_min", "sample_interval_s", "reverse_every_s", "battery_wh", "battery_min_soc", "battery_max_discharge_w",
                                 "dcdc_eff", "aux_load_w", "idle_load_w", "min_run_power_w")},
            "target_color_ptco": u["target_color_ptco"], "overpotential_V": r["overpotential_V"], "solution_resistance_scale": r["solution_resistance_scale"],
            "current_eff_Fe": r["current_eff"]["Fe"], "sludge_hydroxide_factor_Fe": r["sludge_hydroxide_factor"]["Fe"],
            "abs_sat": s["abs_sat"], "dilution_ratio": s["dilution_ratio"],
            **{x: c[x] for x in ("eps_eff_cal", "floc_beta_est", "floc_leak_est", "stop_margin", "guard_frac", "sat_threshold", "undilute_below_ptco", "median_window",
                                 "sample_count", "k_phys_per_Cpl", "max_retries", "reverse_rise", "fixed_q_CperL", "anomaly_sigma", "plateau_dq_CperL", "plateau_min_drop")},
            "calib_window": uc["window"], "calib_min_batches": uc["min_batches"], "calib_limit_lo": uc["limits"][0], "calib_limit_hi": uc["limits"][1],
            "grid_max_wait_min": g["max_wait_min"], "tariff_rp_per_kwh": g["tariff_rp_per_kwh"], "pv_rp_per_kwh": k["pv_rp_per_kwh"],
            "electrode_rp_per_kg": k["electrode_rp_per_kg"], "sludge_rp_per_kg": k["sludge_rp_per_kg"]}
    got = dict(l.split() for l in subprocess.run([parity_bin, "--defaults"], capture_output=True, text=True, check=True).stdout.splitlines())
    assert set(want) == set(got)
    for key, v in want.items():
        assert math.isclose(float(got[key]), float(v), rel_tol=1e-9), f"{key}: firmware {got[key]} != sim.yaml {v}"


def test_payloads_pass_backend_validation(parity_bin):
    r = subprocess.run([parity_bin, "--payload"], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    tele, batch, restart = [json.loads(l) for l in r.stdout.splitlines()]
    assert BatchSummary(**restart).status == "GAGAL_TANPA_DAYA"
    Telemetry(**tele)
    b = BatchSummary(**batch)
    assert tele["source"] == "device" and b.source == "device" and "truth" not in batch
    # every field the contract lists for the batch summary is present
    for k in "batch_id unit_id site_id source mode ts_start ts_end V_L status flags run_s total_s q_CperL q_pred kwh kwh_total kwh_per_m3 kwh_pv kwh_batt kwh_grid pct_renewable policy electricity_rp wait_s electrode_g sludge_kg reversals retries color0_est color_end_est target_ptco cost_rp cost_rp_per_m3 ph_in ec_in features".split():
        assert k in batch, k


def test_physics_prior_formula_is_shared():
    assert math.isclose(physics_q(2000, 200, 0.9, 0.0091), math.log(2000 / 180) / 0.0091)
