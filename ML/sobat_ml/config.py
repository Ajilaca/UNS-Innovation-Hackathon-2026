"""Load simulator config: ML/config/sim.yaml deep-merged with a scenario and runtime overrides."""
from __future__ import annotations

import copy
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]          # folder ML/
REPO_ROOT = ROOT.parent
CONFIG_DIR = ROOT / "config"
RESULTS_DIR = ROOT / "results"                      # hasil eksperimen (dibuat ulang, tidak di-commit)
MODELS_DIR = ROOT / "models"                        # model hasil latih (tidak di-commit)
BAKED_DIR = CONFIG_DIR / "baked_results"            # hasil yang ikut di repo sebagai cadangan
SCENARIO_DIR = CONFIG_DIR / "scenarios"


def deep_merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def list_scenarios() -> list[dict]:
    res = []
    for p in sorted(SCENARIO_DIR.glob("*.yaml")):
        d = yaml.safe_load(p.read_text()) or {}
        res.append({"id": p.stem, "name": d.get("name", p.stem), "description": d.get("description", "")})
    return res


def load_presets() -> dict:
    return yaml.safe_load((CONFIG_DIR / "simulations.yaml").read_text())


def load_config(scenario: str | None = None, overrides: dict | None = None) -> dict:
    cfg = yaml.safe_load((CONFIG_DIR / "sim.yaml").read_text())
    if scenario:
        path = SCENARIO_DIR / f"{scenario}.yaml"
        if not path.exists():
            raise FileNotFoundError(f"scenario tidak ada: {scenario}")
        sc = yaml.safe_load(path.read_text()) or {}
        sc = {k: v for k, v in sc.items() if k not in ("name", "description")}
        cfg = deep_merge(cfg, sc)
    if overrides:
        cfg = deep_merge(cfg, overrides)
    return cfg
