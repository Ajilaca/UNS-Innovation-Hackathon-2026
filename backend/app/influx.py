"""Optional InfluxDB 2.x sink using the HTTP line-protocol API (no extra dependency). Best effort, never blocks ingest.
NOTE: written against the documented API; verify against a running InfluxDB (docker compose) before relying on it."""
from __future__ import annotations

import logging
import queue
import threading
import time

import httpx

log = logging.getLogger("sebat.influx")
FIELDS = ["V_L", "I_A", "U_V", "abs_r", "abs_g", "abs_b", "turb_ntu", "ec_uScm", "ph", "temp_C", "pv_W", "bat_V",
          "bat_soc", "grid_W", "load_W", "q_CperL", "kwh", "color_est_ptco", "target_ptco", "eta_s", "q_pred"]


def _esc(s: str) -> str:
    return str(s).replace(",", r"\,").replace(" ", r"\ ").replace("=", r"\=")


def to_line(d: dict) -> str:
    tags = f"unit_id={_esc(d['unit_id'])},site_id={_esc(d['site_id'])},source={_esc(d['source'])},state={_esc(d['state'])}"
    fields = ",".join(f"{k}={float(d[k])}" for k in FIELDS if isinstance(d.get(k), (int, float)) and not isinstance(d.get(k), bool))
    return f"telemetry,{tags} {fields} {int(d['ts']) * 10**9}"


class InfluxSink:
    def __init__(self, url: str, token: str, org: str, bucket: str, flush_s: float = 1.0):
        self.url, self.org, self.bucket = url.rstrip("/"), org, bucket
        self.headers = {"Authorization": f"Token {token}", "Content-Type": "text/plain; charset=utf-8"}
        self.q: queue.Queue = queue.Queue(maxsize=20000)
        self.flush_s = flush_s
        self.stop = threading.Event()
        self.t = threading.Thread(target=self._loop, daemon=True)
        self.t.start()

    def write(self, d: dict) -> None:
        try:
            self.q.put_nowait(to_line(d))
        except queue.Full:
            log.warning("Influx queue penuh, titik dibuang")

    def _loop(self) -> None:
        buf: list[str] = []
        last = time.time()
        while not self.stop.is_set():
            try:
                buf.append(self.q.get(timeout=0.2))
            except queue.Empty:
                pass
            if buf and (len(buf) >= 200 or time.time() - last >= self.flush_s):
                self._flush(buf)
                buf, last = [], time.time()

    def _flush(self, lines: list[str]) -> None:
        try:
            r = httpx.post(f"{self.url}/api/v2/write", params={"org": self.org, "bucket": self.bucket, "precision": "ns"},
                           headers=self.headers, content="\n".join(lines), timeout=5)
            if r.status_code >= 300:
                log.warning("Influx menolak tulis: %s %s", r.status_code, r.text[:200])
        except Exception as e:  # noqa: BLE001
            log.warning("Influx tidak terjangkau: %s", e)
