"""POST /vitals body and GET /vitals/latest row (docs/contracts.md section 3).

The contract fields are source, pulse_bpm, breathing_bpm, stress_index, captured_at; the rest are
optional extras the presage-worker may send (hrv is exploratory, last in the cut order)."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class VitalsIn(BaseModel):
    source: Literal["presage", "manual"] = "presage"
    pulse_bpm: float = Field(ge=20, le=250)
    breathing_bpm: float | None = Field(default=None, ge=2, le=60)
    stress_index: float | None = Field(default=None, ge=0)
    captured_at: datetime
    hrv_rmssd_ms: float | None = Field(default=None, ge=0)
    confidence: float | None = Field(default=None, ge=0, le=1)
    samples: int | None = Field(default=None, ge=0)


class VitalsOut(VitalsIn):
    received_at: datetime
