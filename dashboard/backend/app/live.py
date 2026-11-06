"""Live simulated unit: runs the digital twin in (accelerated) real time and feeds the Hub like a real device would."""
from __future__ import annotations

import logging
import secrets
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone

import numpy as np

from sobat_ml import experiments as ex
from sobat_ml.config import load_config, load_presets
from .hub import Hub
from sobat_ml.runner import UnitSim

log = logging.getLogger("sobat.live")


class LiveSim:
    def __init__(self, hub: Hub):
        self.hub = hub
        self.thread: threading.Thread | None = None
        self.stop_evt = threading.Event()
        self.cfg_info: dict = {}
        self.log: deque = deque(maxlen=50)
        self.batches_done = 0

    @property
    def running(self) -> bool:
        return bool(self.thread and self.thread.is_alive())

    def status(self) -> dict:
        return {"running": self.running, **self.cfg_info, "batches_done": self.batches_done, "log": list(self.log)}

    def start(self, scenario: str, mode: str, speed: float, overrides: dict | None = None) -> dict:
        self.stop()
        cfg = load_config(scenario, overrides)
        return self._launch(lambda: (cfg, None), cfg, {"scenario": scenario, "preset": None}, mode, speed, overrides)

    def start_preset(self, preset: str, mode: str, speed: float, overrides: dict | None = None) -> dict:
        """preset: A, B, C from config/simulations.yaml, or 'auto' to pick one per batch."""
        data = load_presets()
        presets = data["presets"]
        if preset != "auto" and preset not in presets:
            raise FileNotFoundError(f"opsi simulasi tidak ada: {preset}")
        self.stop()
        cfgs = {k: load_config(v["scenario"], overrides) for k, v in presets.items()}
        if preset == "auto":
            ids, w = zip(*data["auto"]["weights"].items())
            rng = np.random.default_rng(int(time.time()) % 100000)
            def pick():
                k = str(rng.choice(ids, p=np.array(w, float) / sum(w)))
                return cfgs[k], k
            first = cfgs[ids[0]]
        else:
            pick = lambda: (cfgs[preset], preset)
            first = cfgs[preset]
        return self._launch(pick, first, {"scenario": "otomatis" if preset == "auto" else presets[preset]["scenario"], "preset": preset}, mode, speed, overrides)

    def _launch(self, pick, first_cfg: dict, info: dict, mode: str, speed: float, overrides: dict | None) -> dict:
        self.stop()
        self.cfg_info = {**info, "current": None, "mode": mode, "speed": speed, "overrides": overrides or {}, "unit_id": first_cfg["unit"]["unit_id"]}
        self.stop_evt = threading.Event()
        self.batches_done = 0
        self.thread = threading.Thread(target=self._run, args=(pick, first_cfg, mode, speed, self.stop_evt), daemon=True)
        self.thread.start()
        return self.status()

    def stop(self) -> None:
        if self.running:
            self.stop_evt.set()
            self.thread.join(timeout=5)

    def _resume_clock(self, cfg: dict) -> datetime | None:
        """Continue the simulated calendar after the unit's last simulated batch, so a restart never lists older days as newest."""
        last = self.hub.store.batches(cfg["unit"]["unit_id"], "simulator", 1)
        if not last:
            return None
        tz = timezone(timedelta(hours=cfg["site"]["tz_offset_h"]))
        h = cfg["solar"]["start_hour"]
        day = datetime.fromtimestamp(last[0]["ts_end"], tz).replace(tzinfo=None) + timedelta(days=1)
        return day.replace(hour=int(h), minute=int((h % 1) * 60), second=0, microsecond=0)

    def _run(self, pick, first_cfg: dict, mode: str, speed: float, stop: threading.Event) -> None:
        pred = ex.load_predictor(first_cfg)
        seed = int(time.time()) % 100000
        sim = UnitSim(first_cfg, mode, pred, env_seed=seed, run_tag=secrets.token_hex(2), start=self._resume_clock(first_cfg))
        dt = first_cfg["unit"]["sample_interval_s"]
        self.log.append(f"Simulasi mulai: {mode}, {first_cfg['site']['name']}")
        n = 0
        while not stop.is_set():
            cfg, key = pick()
            if cfg is not sim.cfg:
                n += 1
                nxt = UnitSim(cfg, mode, pred, env_seed=seed + n)
                nxt.adopt(sim)
                sim = nxt
            sim.scenario = key
            self.cfg_info["current"] = key
            if sim.clock.hour + sim.clock.minute / 60 > cfg["solar"]["last_start_hour"]:
                done = sim.maintenance()
                sim.skip_to_morning()
                self.log.append("Hari berakhir: " + ", ".join(done).lower().replace("_", " "))
                continue
            try:
                for msg in sim.iter_batch():
                    self.hub.telemetry(msg)
                    if stop.wait(dt / speed):
                        return
                self.hub.batch(sim.summary)
                self.batches_done += 1
                self.log.append(f"{sim.summary['batch_id']}: {sim.summary['status']}")
            except Exception as e:  # noqa: BLE001
                log.exception("simulasi live gagal")
                self.log.append(f"Galat: {e}")
                return
