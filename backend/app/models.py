"""Pydantic models of the data contract (docs/data-contract.md)."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

STATES = ("IDLE", "FILLING", "SAMPLING", "WAITING_SOLAR", "RUNNING", "PAUSED_SOLAR", "SETTLING", "DONE", "FAULT")


class Telemetry(BaseModel):
    model_config = ConfigDict(extra="allow")
    ts: int
    source: Literal["device", "simulator"]
    site_id: str = Field(min_length=1, max_length=40)
    unit_id: str = Field(min_length=1, max_length=40)
    batch_id: str = Field(min_length=1, max_length=80)
    state: Literal["IDLE", "FILLING", "SAMPLING", "WAITING_SOLAR", "RUNNING", "PAUSED_SOLAR", "SETTLING", "DONE", "FAULT"]
    V_L: float = Field(ge=0, le=100000)
    I_A: float = Field(ge=0, le=60)
    U_V: float = Field(ge=0, le=60)
    abs_r: float = Field(ge=-0.5, le=5)
    abs_g: float = Field(ge=-0.5, le=5)
    abs_b: float = Field(ge=-0.5, le=5)
    turb_ntu: float = Field(ge=0, le=10000)
    ec_uScm: float = Field(ge=0, le=100000)
    ph: float = Field(ge=0, le=14)
    temp_C: float = Field(ge=-10, le=120)
    pv_W: float = Field(ge=0, le=100000)
    bat_V: float = Field(ge=0, le=100)


class BatchSummary(BaseModel):
    model_config = ConfigDict(extra="allow")
    batch_id: str = Field(min_length=1, max_length=80)
    unit_id: str = Field(min_length=1, max_length=40)
    site_id: str = "unknown"
    source: Literal["device", "simulator"]
    status: str
    ts_start: int
    ts_end: int


class PredictIn(BaseModel):
    color0_ptco: float = Field(gt=0, le=50000)
    ph: float = Field(default=9.5, ge=0, le=14)
    ec_uScm: float = Field(default=3000, ge=0, le=100000)
    temp_C: float = Field(default=31, ge=-10, le=120)
    turb_ntu: float = Field(default=500, ge=0, le=10000)
    abs_rgb: tuple[float, float, float] = (0.5, 0.6, 0.4)
    target_ptco: float = Field(default=200, gt=0)
    volume_L: float = Field(default=50, gt=0)
    current_A: float = Field(default=5, gt=0, le=60)


class LoginIn(BaseModel):
    username: str
    password: str


class SimStart(BaseModel):
    scenario: str = "baseline"
    preset: str | None = None       # A, B, C or auto; takes precedence over scenario
    mode: Literal["fixed", "feedback", "ai"] = "ai"
    speed: float = Field(default=60, ge=1, le=1200)
    overrides: dict = Field(default_factory=dict)
