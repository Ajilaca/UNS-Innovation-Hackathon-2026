"""Simple login: HMAC-signed bearer tokens, roles admin|viewer. Device HTTP ingest uses per-unit keys."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from fastapi import Depends, Header, HTTPException

from .settings import Settings


class Auth:
    def __init__(self, s: Settings):
        self.s = s

    # ---- tokens ----------------------------------------------------------
    def _sign(self, payload: bytes) -> str:
        return hmac.new(self.s.secret.encode(), payload, hashlib.sha256).hexdigest()

    def issue(self, user: str, role: str) -> str:
        body = base64.urlsafe_b64encode(json.dumps({"u": user, "r": role, "exp": int(time.time()) + self.s.token_ttl_s}).encode())
        return f"{body.decode()}.{self._sign(body)}"

    def verify(self, token: str) -> dict | None:
        try:
            body, sig = token.rsplit(".", 1)
            if not hmac.compare_digest(sig, self._sign(body.encode())):
                return None
            data = json.loads(base64.urlsafe_b64decode(body.encode()))
            return data if data["exp"] > time.time() else None
        except Exception:
            return None

    def login(self, user: str, password: str) -> str | None:
        ok_u = hmac.compare_digest(user.encode(), self.s.admin_user.encode())
        ok_p = hmac.compare_digest(password.encode(), self.s.admin_password.encode())
        return self.issue(user, "admin") if (ok_u and ok_p) else None

    def device_ok(self, unit_id: str, key: str | None) -> bool:
        want = self.s.device_keys.get(unit_id)
        return bool(want and key and hmac.compare_digest(want.encode(), key.encode()))


def make_deps(auth: Auth):
    def current(authorization: str | None = Header(default=None)) -> dict:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise HTTPException(401, "Perlu login")
        data = auth.verify(authorization[7:].strip())
        if not data:
            raise HTTPException(401, "Token tidak valid atau kedaluwarsa")
        return data

    def admin(user: dict = Depends(current)) -> dict:
        if user["r"] != "admin":
            raise HTTPException(403, "Hanya admin")
        return user

    return current, admin
