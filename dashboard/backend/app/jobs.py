"""Background jobs (train / compare / energy / sizing) with progress, results saved to data/*.json."""
from __future__ import annotations

import json
import threading
import time
import uuid

from sobat_ml import experiments as ex
from sobat_ml.config import RESULTS_DIR, load_config

RESULT_DIR = RESULTS_DIR
KINDS = {"train", "compare", "energy", "sizing", "sensitivity"}


class Jobs:
    def __init__(self):
        self.jobs: dict[str, dict] = {}
        self.lock = threading.Lock()

    def start(self, kind: str, scenario: str = "baseline", n: int = 100) -> dict:
        if kind not in KINDS:
            raise ValueError(kind)
        with self.lock:
            if any(j["state"] == "running" and j["kind"] == kind for j in self.jobs.values()):
                raise RuntimeError(f"job {kind} masih berjalan")
            jid = uuid.uuid4().hex[:8]
            self.jobs[jid] = {"id": jid, "kind": kind, "state": "running", "progress": 0.0, "started": time.time(), "error": None}
        threading.Thread(target=self._run, args=(jid, kind, scenario, n), daemon=True).start()
        return self.jobs[jid]

    def get(self, jid: str) -> dict | None:
        return self.jobs.get(jid)

    def _run(self, jid: str, kind: str, scenario: str, n: int) -> None:
        job = self.jobs[jid]
        prog = lambda p: job.__setitem__("progress", round(p, 3))
        try:
            cfg = load_config(scenario)
            RESULT_DIR.mkdir(exist_ok=True)
            if kind == "train":
                p = ex.train_predictor(cfg, n)
                res = {k: v for k, v in p.meta.items() if k != "scatter"}
            else:
                pred = ex.load_predictor(cfg)
                fn = {"compare": lambda: ex.compare_strategies(cfg, pred, n, prog),
                      "energy": lambda: ex.compare_energy(cfg, pred, progress=prog),
                      "sizing": lambda: ex.sizing(cfg, pred, progress=prog),
                      "sensitivity": lambda: _sensitivity(cfg, pred, prog)}[kind]
                res = fn()
                (RESULT_DIR / f"{kind}.json").write_text(json.dumps(res))
            job.update(state="done", progress=1.0, result=res, finished=time.time())
        except Exception as e:  # noqa: BLE001
            job.update(state="error", error=str(e), finished=time.time())


def _sensitivity(cfg, pred, prog):
    from sobat_ml.sensitivity import sensitivity
    return sensitivity(cfg, pred, progress=prog)
