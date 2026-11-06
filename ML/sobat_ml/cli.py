"""CLI:  python -m sobat_ml.cli train | compare | energy | batch   (jalankan dari ML/)."""
from __future__ import annotations

import argparse
import json
import time

from . import experiments as ex
from .config import REPO_ROOT, RESULTS_DIR, load_config


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["train", "compare", "energy", "sizing", "sensitivity", "robust", "batch"])
    ap.add_argument("--scenario", default="baseline")
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--mode", default="ai")
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    cfg = load_config(a.scenario)
    out = RESULTS_DIR
    out.mkdir(exist_ok=True)
    t = time.time()
    if a.cmd == "train":
        p = ex.train_predictor(cfg, a.n)
        print(json.dumps({k: v for k, v in p.meta.items() if k != "scatter"}, indent=1))
    elif a.cmd == "compare":
        res = ex.compare_strategies(cfg, ex.load_predictor(cfg), a.n)
        (out / "compare.json").write_text(json.dumps(res))
        for k, v in res["strategies"].items():
            print(f"{k:10} pass={v['pass_true_pct']:5.1f}% sens={v['pass_sensor_pct']:5.1f}% kWh/m3={v['kwh_per_m3']:.2f} Fe={v['electrode_g_per_m3']:.0f} g/m3 run={v['run_min_mean']:.0f}m Rp/m3={v['cost_rp_per_m3']:.0f}")
        print("pareto", [(p["q"], round(p["pass_true_pct"]), round(p["kwh_per_m3"], 2)) for p in res["fixed_pareto"]])
    elif a.cmd == "energy":
        res = ex.compare_energy(cfg, ex.load_predictor(cfg))
        (out / "energy.json").write_text(json.dumps(res))
        for k, v in res["cases"].items():
            print(f"{k:20} pass={v['pass_true_pct']:5.1f}% EBT={v['pct_renewable']:5.1f}% grid={v['kwh_grid']:.2f}kWh thru={v['throughput_pct']:5.1f}% backlog={v['backlog_batches']:.1f} wait={v['wait_min_mean']:.0f}m Rp/m3={v['cost_rp_per_m3']:.0f}")
    elif a.cmd == "sizing":
        res = ex.sizing(cfg, ex.load_predictor(cfg))
        (out / "sizing.json").write_text(json.dumps(res))
        for r in res["rows"]:
            print(f"pv={r['pv_wp']:3} bat={r['battery_wh']:3} /day={r['per_day']} {r['policy']:11}/{r['mode']:8} pass={r['pass_true_pct']:5.1f}% EBT={r['pct_renewable']:5.1f}% grid={r['kwh_grid']:.2f} thru={r['throughput_pct']:5.1f}% wait={r['wait_min_mean']:.0f}m")
    elif a.cmd == "sensitivity":
        from . import sensitivity as sn
        res = sn.sensitivity(cfg, ex.load_predictor(cfg), a.n if a.n != 100 else 40)
        (out / "sensitivity.json").write_text(json.dumps(res))
        md = sn.to_markdown(res)
        (REPO_ROOT / "docs" / "sensitivity.md").write_text("# Analisis sensitivitas (SIMULASI)\n\nSatu parameter diubah per baris; lainnya tetap dasar. Bukan hasil eksperimen.\n\n" + md + "\n")
        print(md)
    elif a.cmd == "robust":
        from . import robustness as rb
        res = rb.robustness(cfg, ex.load_predictor(cfg), a.n if a.n != 100 else 600)
        (out / "robustness.json").write_text(json.dumps(res))
        print(json.dumps(res, indent=1))
    else:
        s = ex.UnitSim(cfg, a.mode, ex.load_predictor(cfg), env_seed=a.seed).run_batch()
        print(json.dumps(s, indent=1))
    print(f"[{time.time() - t:.1f}s]")


if __name__ == "__main__":
    main()
