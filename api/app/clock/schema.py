"""POST /clock: C records the age number it computed from A's export (the API stores, never computes)."""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

Clock = Literal["phenoage", "fitness", "social_risk"]


class ClockIn(BaseModel):
    clock: Clock
    years: float = Field(ge=-50, le=150, description="biological / fitness age, or risk-equivalent years")
    chronological_age: float | None = Field(default=None, ge=0, le=130)
    band: float | None = Field(default=None, ge=0)
    inputs: dict[str, Any] | None = Field(default=None, description="phenoage: si values by canonical key (+ imputed list); fitness: rhr, vo2max")
    engine_version: str | None = None


class ClockOut(ClockIn):
    computed_at: datetime
