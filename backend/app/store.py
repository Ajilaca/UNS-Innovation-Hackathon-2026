"""SQLite system of record (batches, telemetry). InfluxDB is an optional additional telemetry sink (influx.py)."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path


class Store:
    def __init__(self, path: str):
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        with self.lock:
            self.db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS telemetry(
                    id INTEGER PRIMARY KEY, unit_id TEXT NOT NULL, batch_id TEXT NOT NULL, ts INTEGER NOT NULL,
                    source TEXT NOT NULL, data TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS ix_tel ON telemetry(unit_id, batch_id, ts);
                CREATE TABLE IF NOT EXISTS batches(
                    batch_id TEXT PRIMARY KEY, unit_id TEXT NOT NULL, ts_end INTEGER NOT NULL, status TEXT NOT NULL,
                    source TEXT NOT NULL, mode TEXT, rx INTEGER NOT NULL, data TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS ix_b ON batches(unit_id, ts_end);
            """)

    def add_telemetry(self, d: dict) -> None:
        with self.lock:
            self.db.execute("INSERT INTO telemetry(unit_id,batch_id,ts,source,data) VALUES(?,?,?,?,?)",
                            (d["unit_id"], d["batch_id"], d["ts"], d["source"], json.dumps(d)))
            self.db.commit()

    def upsert_batch(self, d: dict) -> None:
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO batches(batch_id,unit_id,ts_end,status,source,mode,rx,data) VALUES(?,?,?,?,?,?,?,?)",
                            (d["batch_id"], d["unit_id"], d["ts_end"], d["status"], d["source"], d.get("mode"), int(time.time()), json.dumps(d)))
            self.db.commit()

    def series(self, unit_id: str, batch_id: str, limit: int = 5000) -> list[dict]:
        with self.lock:
            rows = self.db.execute("SELECT data FROM telemetry WHERE unit_id=? AND batch_id=? ORDER BY ts, id LIMIT ?",
                                   (unit_id, batch_id, limit)).fetchall()
        return [json.loads(r["data"]) for r in rows]

    def latest_batch_id(self, unit_id: str) -> str | None:
        with self.lock:
            r = self.db.execute("SELECT batch_id FROM telemetry WHERE unit_id=? ORDER BY id DESC LIMIT 1", (unit_id,)).fetchone()
        return r["batch_id"] if r else None

    def batches(self, unit_id: str | None = None, source: str | None = None, limit: int = 50) -> list[dict]:
        q, args = "SELECT data FROM batches WHERE 1=1", []
        if unit_id:
            q += " AND unit_id=?"; args.append(unit_id)
        if source:
            q += " AND source=?"; args.append(source)
        q += " ORDER BY ts_end DESC, rx DESC LIMIT ?"; args.append(limit)
        with self.lock:
            rows = self.db.execute(q, args).fetchall()
        return [json.loads(r["data"]) for r in rows]

    def batch(self, batch_id: str) -> dict | None:
        with self.lock:
            r = self.db.execute("SELECT data FROM batches WHERE batch_id=?", (batch_id,)).fetchone()
        return json.loads(r["data"]) if r else None

    def purge_telemetry_older_than(self, days: int) -> int:
        cutoff = int(time.time()) - days * 86400
        with self.lock:
            n = self.db.execute("DELETE FROM telemetry WHERE ts < ?", (cutoff,)).rowcount
            self.db.commit()
        return n
