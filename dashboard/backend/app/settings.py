"""Runtime settings from environment (BJ_*). Nothing secret has a default that would be safe in production."""
from __future__ import annotations

import logging
import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

DASH_ROOT = Path(__file__).resolve().parents[2]     # folder dashboard/

log = logging.getLogger("sobat")


@dataclass
class Settings:
    db_path: str = str(DASH_ROOT / "data" / "sobat.sqlite")
    admin_user: str = "admin"
    admin_password: str = ""
    secret: str = ""
    demo_enabled: bool = True
    device_keys: dict[str, str] = field(default_factory=dict)      # unit_id -> key (HTTP ingest)
    token_ttl_s: int = 12 * 3600
    mqtt_host: str = ""
    mqtt_port: int = 1883
    mqtt_user: str = ""
    mqtt_password: str = ""
    mqtt_tls: bool = False
    influx_url: str = ""
    influx_token: str = ""
    influx_org: str = "batikjernih"
    influx_bucket: str = "telemetry"
    web_dir: str = str(DASH_ROOT / "web" / "dist")
    cors_origins: list[str] = field(default_factory=list)
    autostart_sim: bool = False
    autostart_scenario: str = ""       # empty: use autostart_preset
    autostart_preset: str = "auto"
    autostart_mode: str = "ai"
    autostart_speed: float = 120.0
    autotrain: bool = True

    @classmethod
    def from_env(cls, env=os.environ) -> "Settings":
        g = lambda k, d="": env.get(f"BJ_{k}", d)
        keys = {}
        for part in g("DEVICE_KEYS").split(","):
            if ":" in part:
                u, k = part.split(":", 1)
                keys[u.strip()] = k.strip()
        s = cls(
            db_path=g("DB_PATH", cls.db_path), admin_user=g("ADMIN_USER", "admin"), admin_password=g("ADMIN_PASSWORD"),
            secret=g("SECRET"), demo_enabled=g("DEMO", "1") not in ("0", "false", "no"), device_keys=keys,
            mqtt_host=g("MQTT_HOST"), mqtt_port=int(g("MQTT_PORT", "1883")), mqtt_user=g("MQTT_USER"),
            mqtt_password=g("MQTT_PASSWORD"), mqtt_tls=g("MQTT_TLS", "0") in ("1", "true"),
            influx_url=g("INFLUX_URL"), influx_token=g("INFLUX_TOKEN"), influx_org=g("INFLUX_ORG", "batikjernih"),
            influx_bucket=g("INFLUX_BUCKET", "telemetry"), web_dir=g("WEB_DIR", cls.web_dir),
            cors_origins=[o for o in g("CORS_ORIGINS").split(",") if o],
            autostart_sim=g("AUTOSTART_SIM", "0") in ("1", "true"), autostart_scenario=g("AUTOSTART_SCENARIO"), autostart_preset=g("AUTOSTART_PRESET", "auto"),
            autostart_mode=g("AUTOSTART_MODE", "ai"), autostart_speed=float(g("AUTOSTART_SPEED", "120")),
            autotrain=g("AUTOTRAIN", "1") not in ("0", "false"),
        )
        return s.finalize()

    def finalize(self) -> "Settings":
        if not self.secret:
            self.secret = secrets.token_hex(32)
            log.warning("BJ_SECRET tidak diset: token login akan batal setiap restart. Set BJ_SECRET di produksi.")
        if not self.admin_password:
            self.admin_password = secrets.token_urlsafe(9)
            log.warning("BJ_ADMIN_PASSWORD tidak diset. Password sementara untuk '%s': %s", self.admin_user, self.admin_password)
        return self
