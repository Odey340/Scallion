"""Coach memory rows (POST /coach/checkin, /coach/meal, /coach/share)."""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

Kind = Literal["checkin", "nudge", "reply", "meal", "share", "plan"]


class CheckinIn(BaseModel):
    kind: Kind
    text: str | None = Field(default=None, max_length=2000)
    data: dict[str, Any] | None = None


class CheckinOut(CheckinIn):
    id: int
    ts: datetime


class MealIn(BaseModel):
    carbs_g: float = Field(ge=0, le=300)
    note: str | None = Field(default=None, max_length=200)


class ShareIn(BaseModel):
    target_contact: str = Field(pattern=r"^[0-9a-f]{64}$", description="contact hash from the circle")
    text: str | None = Field(default=None, max_length=500)
