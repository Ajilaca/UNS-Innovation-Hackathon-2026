"""MQTT -> Hub bridge. Topics: sobat/{site}/{unit}/telemetry | batch. Payload must match the data contract."""
from __future__ import annotations

import json
import logging

from pydantic import ValidationError

from .hub import Hub
from .models import BatchSummary, Telemetry
from .settings import Settings

log = logging.getLogger("sobat.mqtt")


def handle(hub: Hub, topic: str, payload: bytes) -> str:
    """Pure function (testable): returns 'telemetry'|'batch'|'ignored'|'rejected:<why>'."""
    parts = topic.split("/")
    if len(parts) != 4 or parts[0] != "sobat":
        return "ignored"
    _, site, unit, kind = parts
    try:
        data = json.loads(payload)
        if kind not in ("telemetry", "batch"):
            return "ignored"
        if data.get("unit_id") != unit or data.get("site_id", site) != site:
            return "rejected:topik tidak cocok dengan payload"
        data.setdefault("site_id", site)
        if kind == "telemetry":
            hub.telemetry(Telemetry(**data))
        else:
            hub.batch(BatchSummary(**data))
        return kind
    except (ValidationError, ValueError, TypeError) as e:
        log.warning("payload ditolak di %s: %s", topic, str(e)[:200])
        return f"rejected:{type(e).__name__}"


def start(settings: Settings, hub: Hub):
    import paho.mqtt.client as mqtt

    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="sobat-backend")
    if settings.mqtt_user:
        c.username_pw_set(settings.mqtt_user, settings.mqtt_password)
    if settings.mqtt_tls:
        c.tls_set()
    c.on_connect = lambda cl, ud, fl, rc, pr=None: cl.subscribe([("sobat/+/+/telemetry", 1), ("sobat/+/+/batch", 1)])
    c.on_message = lambda cl, ud, m: handle(hub, m.topic, m.payload)
    c.reconnect_delay_set(1, 30)
    c.connect_async(settings.mqtt_host, settings.mqtt_port)
    c.loop_start()
    log.info("MQTT bridge ke %s:%s", settings.mqtt_host, settings.mqtt_port)
    return c
