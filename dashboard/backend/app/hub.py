"""Ingest hub: single entry point for telemetry/batches from MQTT, HTTP and the live simulator."""
from __future__ import annotations

import threading
import time
from collections import deque

from .models import BatchSummary, Telemetry
from .store import Store


class Hub:
    def __init__(self, store: Store, influx=None):
        self.store, self.influx = store, influx
        self.latest: dict[str, dict] = {}
        self.events: deque = deque(maxlen=100)
        self.lock = threading.Lock()

    def telemetry(self, t: Telemetry | dict) -> dict:
        d = t.model_dump() if isinstance(t, Telemetry) else Telemetry(**t).model_dump()
        self.store.add_telemetry(d)
        if self.influx:
            self.influx.write(d)
        with self.lock:
            prev = self.latest.get(d["unit_id"])
            self.latest[d["unit_id"]] = {"data": d, "rx": time.time()}
            if prev is None or prev["data"]["state"] != d["state"] or prev["data"]["batch_id"] != d["batch_id"]:
                self.events.append({"ts": d["ts"], "rx": time.time(), "unit_id": d["unit_id"],
                                    "batch_id": d["batch_id"], "msg": f"{d['unit_id']}: {d['state']}"})
        return d

    def batch(self, b: BatchSummary | dict) -> dict:
        d = b.model_dump() if isinstance(b, BatchSummary) else BatchSummary(**b).model_dump()
        if d["source"] == "device":
            d.pop("truth", None)            # ground truth can never come from a real device
        self.store.upsert_batch(d)
        with self.lock:
            self.events.append({"ts": d["ts_end"], "rx": time.time(), "unit_id": d["unit_id"], "batch_id": d["batch_id"],
                                "msg": f"Batch {d['batch_id']} selesai: {d['status']}"})
        return d

    def units(self, online_within_s: float = 180.0) -> list[dict]:
        now = time.time()
        with self.lock:
            items = list(self.latest.items())
        return [{"unit_id": u, "site_id": v["data"]["site_id"], "source": v["data"]["source"], "state": v["data"]["state"],
                 "batch_id": v["data"]["batch_id"], "ts": v["data"]["ts"], "online": now - v["rx"] < online_within_s}
                for u, v in sorted(items)]

    def recent_events(self, n: int = 30) -> list[dict]:
        with self.lock:
            return list(self.events)[-n:]
