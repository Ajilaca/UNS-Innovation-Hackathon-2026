"""SEBAT API. Run:  uvicorn app.main:create_app --factory --reload   (from backend/)"""
from __future__ import annotations

import csv
import io
import json
import logging
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import experiments as ex
from . import mqtt_bridge
from .auth import Auth, make_deps
from .config import ROOT, list_scenarios, load_config, load_presets
from .hub import Hub
from .influx import InfluxSink
from .jobs import KINDS, Jobs
from .live import LiveSim
from .models import BatchSummary, LoginIn, PredictIn, SimStart, Telemetry
from .predictor import make_features
from .settings import Settings
from .store import Store

log = logging.getLogger("sebat")
WIB = timezone(timedelta(hours=7))


def create_app(settings: Settings | None = None) -> FastAPI:
    s = settings or Settings.from_env()
    store = Store(s.db_path)
    influx = InfluxSink(s.influx_url, s.influx_token, s.influx_org, s.influx_bucket) if s.influx_url else None
    hub = Hub(store, influx)
    auth = Auth(s)
    current, admin = make_deps(auth)
    live, jobs = LiveSim(hub), Jobs()
    base_cfg = load_config("baseline")
    cache = {"mtime": None, "pred": None}

    def predictor():
        mt = ex.MODEL_PATH.stat().st_mtime if ex.MODEL_PATH.exists() else None
        if cache["pred"] is None or mt != cache["mtime"]:
            cache.update(mtime=mt, pred=ex.load_predictor(base_cfg))
        return cache["pred"]

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        mq = None
        if s.mqtt_host:
            try:
                mq = mqtt_bridge.start(s, hub)
            except Exception:  # noqa: BLE001
                log.exception("MQTT bridge gagal start; API tetap jalan")
        if s.autotrain and not predictor().trained:
            def _train():
                try:
                    ex.train_predictor(base_cfg, 500)
                    log.info("model dosis dilatih otomatis (500 batch simulasi)")
                except Exception:  # noqa: BLE001
                    log.exception("pelatihan otomatis gagal; kontrol memakai fisika")
            threading.Thread(target=_train, daemon=True).start()
        if s.autostart_sim:
            if s.autostart_scenario:
                live.start(s.autostart_scenario, s.autostart_mode, s.autostart_speed)
            else:
                live.start_preset(s.autostart_preset, s.autostart_mode, s.autostart_speed)
        yield
        live.stop()
        if mq:
            mq.loop_stop()
        if influx:
            influx.stop.set()

    app = FastAPI(title="SEBAT API", version="0.1.0", lifespan=lifespan)
    app.state.hub, app.state.live, app.state.store, app.state.settings = hub, live, store, s
    if s.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=s.cors_origins, allow_methods=["*"], allow_headers=["*"])

    # ------------------------------------------------------------ public
    @app.get("/api/health")
    def health():
        return {"status": "ok", "live_sim": live.running, "model_trained": predictor().trained,
                "mqtt": bool(s.mqtt_host), "influx": bool(influx)}

    @app.post("/api/auth/login")
    def login(b: LoginIn):
        tok = auth.login(b.username, b.password)
        if not tok:
            raise HTTPException(401, "Nama pengguna atau kata sandi salah")
        return {"token": tok, "role": "admin", "user": b.username}

    @app.post("/api/auth/demo")
    def demo():
        if not s.demo_enabled:
            raise HTTPException(403, "Mode demo dimatikan")
        return {"token": auth.issue("demo", "viewer"), "role": "viewer", "user": "demo"}

    @app.get("/api/me")
    def me(u: dict = Depends(current)):
        return {"user": u["u"], "role": u["r"]}

    # ------------------------------------------------------------ ingest (device key or admin)
    def ingest_auth(unit_id: str, source: str, key: str | None, authorization: str | None):
        if authorization and authorization.lower().startswith("bearer "):
            d = auth.verify(authorization[7:].strip())
            if d and d["r"] == "admin":
                return
        if source == "device" and auth.device_ok(unit_id, key):
            return
        raise HTTPException(401, "Kunci perangkat/token tidak valid (simulator hanya boleh dikirim admin)")

    @app.post("/api/ingest/telemetry", status_code=202)
    def ingest_t(t: Telemetry, x_device_key: str | None = Header(default=None), authorization: str | None = Header(default=None)):
        ingest_auth(t.unit_id, t.source, x_device_key, authorization)
        hub.telemetry(t)
        return {"ok": True}

    @app.post("/api/ingest/batch", status_code=202)
    def ingest_b(b: BatchSummary, x_device_key: str | None = Header(default=None), authorization: str | None = Header(default=None)):
        ingest_auth(b.unit_id, b.source, x_device_key, authorization)
        hub.batch(b)
        return {"ok": True}

    # ------------------------------------------------------------ read
    @app.get("/api/units")
    def units(_: dict = Depends(current)):
        return {"units": hub.units(), "live": live.status()}

    @app.get("/api/units/{unit_id}/latest")
    def latest(unit_id: str, _: dict = Depends(current)):
        v = hub.latest.get(unit_id)
        if not v:
            raise HTTPException(404, "Belum ada data untuk unit ini")
        return v["data"]

    def thin(rows: list, limit: int) -> list:
        if len(rows) <= limit:
            return rows
        step = len(rows) / limit
        out = [rows[int(i * step)] for i in range(limit)]
        out[-1] = rows[-1]
        return out

    @app.get("/api/units/{unit_id}/series")
    def series(unit_id: str, batch_id: str | None = None, limit: int = Query(800, ge=10, le=5000), _: dict = Depends(current)):
        bid = batch_id or store.latest_batch_id(unit_id)
        if not bid:
            return {"batch_id": None, "points": []}
        return {"batch_id": bid, "points": thin(store.series(unit_id, bid), limit)}

    @app.get("/api/events")
    def events(_: dict = Depends(current)):
        return {"events": hub.recent_events()}

    @app.get("/api/batches")
    def batches(unit_id: str | None = None, source: str | None = None, limit: int = Query(50, ge=1, le=500), _: dict = Depends(current)):
        rows = store.batches(unit_id, source, limit)
        for r in rows:
            r.pop("features", None)
        return {"batches": rows}

    @app.get("/api/batches/{batch_id}")
    def batch(batch_id: str, _: dict = Depends(current)):
        b = store.batch(batch_id)
        if not b:
            raise HTTPException(404, "Batch tidak ditemukan")
        return {"batch": b, "points": thin(store.series(b["unit_id"], batch_id), 800)}

    @app.get("/api/report.csv")
    def report(unit_id: str | None = None, source: str | None = None, limit: int = 500, _: dict = Depends(current)):
        """Laporan batch untuk DLH. Warna = estimasi sensor (bukan kebenaran fisik)."""
        head = ["Waktu selesai (WIB)", "Unit", "Batch", "Volume (L)", "Warna awal est. (Pt-Co)", "Warna akhir est. (Pt-Co)",
                "Target (Pt-Co)", "Status", "Energi reaktor (kWh)", "Energi (kWh/m3)", "Porsi EBT (%)", "Besi terlarut (g)",
                "Lumpur (kg)", "Biaya (Rp/m3)", "Sumber data"]
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(head)
        for b in store.batches(unit_id, source, limit):
            when = datetime.fromtimestamp(b["ts_end"], WIB).strftime("%Y-%m-%d %H:%M")
            w.writerow([when, b["unit_id"], b["batch_id"], b.get("V_L"), b.get("color0_est"), b.get("color_end_est"),
                        b.get("target_ptco"), b["status"], b.get("kwh"), b.get("kwh_per_m3"), b.get("pct_renewable"),
                        b.get("electrode_g"), b.get("sludge_kg"), b.get("cost_rp_per_m3"),
                        "SIMULASI" if b["source"] == "simulator" else "Perangkat"])
        return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": "attachment; filename=laporan-sebat.csv"})

    # ------------------------------------------------------------ AI
    @app.post("/api/predict")
    def predict(b: PredictIn, _: dict = Depends(current)):
        feat = make_features(b.color0_ptco, b.target_ptco, b.ph, b.ec_uScm, b.temp_C, b.turb_ntu, b.abs_rgb)
        r = predictor().predict(feat)
        mins = lambda q: q * b.volume_L / b.current_A / 60
        return {**r, "minutes": mins(r["q"]), "minutes_lo": mins(r["q_lo"]), "minutes_hi": mins(r["q_hi"])}

    @app.get("/api/model")
    def model(_: dict = Depends(current)):
        return predictor().meta

    @app.get("/api/scenarios")
    def scenarios(_: dict = Depends(current)):
        return {"scenarios": list_scenarios()}

    @app.get("/api/sim/presets")
    def sim_presets(_: dict = Depends(current)):
        return load_presets()

    @app.get("/api/sim")
    def sim_status(_: dict = Depends(current)):
        return live.status()

    @app.post("/api/sim/start")
    def sim_start(b: SimStart, _: dict = Depends(admin)):
        try:
            if b.preset:
                return live.start_preset(b.preset, b.mode, b.speed, b.overrides)
            return live.start(b.scenario, b.mode, b.speed, b.overrides)
        except FileNotFoundError as e:
            raise HTTPException(404, str(e))

    @app.post("/api/sim/stop")
    def sim_stop(_: dict = Depends(admin)):
        live.stop()
        return live.status()

    @app.post("/api/jobs/{kind}")
    def job_start(kind: str, scenario: str = "baseline", n: int = Query(100, ge=10, le=2000), _: dict = Depends(admin)):
        if kind not in KINDS:
            raise HTTPException(404, "Jenis job tidak dikenal")
        try:
            return jobs.start(kind, scenario, n)
        except RuntimeError as e:
            raise HTTPException(409, str(e))

    @app.get("/api/jobs/{jid}")
    def job_get(jid: str, _: dict = Depends(current)):
        j = jobs.get(jid)
        if not j:
            raise HTTPException(404, "Job tidak ada")
        return j

    @app.get("/api/results/{kind}")
    def results(kind: str, _: dict = Depends(current)):
        if kind not in ("compare", "energy", "sizing", "sensitivity", "robustness"):
            raise HTTPException(404, "Jenis hasil tidak dikenal.")
        # a run on this server wins; otherwise the results shipped with the image, so a fresh demo is not empty
        for p in (ROOT / "data" / f"{kind}.json", ROOT / "config" / "baked_results" / f"{kind}.json"):
            if p.exists():
                return JSONResponse(json.loads(p.read_text()))
        raise HTTPException(404, "Belum ada hasil. Jalankan job dulu (admin).")

    # ------------------------------------------------------------ frontend build (React)
    web = Path(s.web_dir)
    if web.exists():
        app.mount("/", StaticFiles(directory=web, html=True), name="web")
    else:
        @app.get("/")
        def root():
            return {"app": "SEBAT API", "docs": "/docs", "frontend": "belum dibangun (web/dist tidak ada)"}

    return app

