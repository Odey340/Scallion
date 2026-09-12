"""User profile: what Persona verified plus onboarding language. GET /me (contract section 3)."""
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field

OVER_65_YEARS = 65


class Profile(BaseModel):
    user_id: str
    verified: bool = False
    birthdate: date | None = None
    lang: Literal["en", "es"] = "en"
    inquiry_id: str | None = None
    answers: dict[str, Any] = {}


def age_on(birthdate: date, today: date) -> int:
    years = today.year - birthdate.year
    if (today.month, today.day) < (birthdate.month, birthdate.day):
        years -= 1
    return years


class Me(BaseModel):
    verified: bool
    over_65: bool
    lang: Literal["en", "es"]
    age: int | None = None  # only when verified; C never asks the user to type it
    verify_url: str | None = None  # Persona hosted flow, when a template is configured
    answers: dict[str, Any] = {}


class AnswersIn(BaseModel):
    """Onboarding answers. Only the keys sent are updated (merge)."""

    on_glucose_meds: bool | None = Field(default=None, description="'any medicine for blood sugar?' (suppresses exercise timing)")
    sleep_h: float | None = Field(default=None, ge=0, le=24)
    smoker: bool | None = None
    lonely: bool | None = None
    lives_alone: bool | None = None
    oral_contraceptive: bool | None = None
    help_family: Literal[0, 1, 2, 3, 4, 5] | None = Field(default=None, description="LSNS-6 item asked in the app")
    help_friends: Literal[0, 1, 2, 3, 4, 5] | None = None
    bedtime: str | None = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    coffee_mg_per_cup: float | None = Field(default=None, ge=0, le=500)


def me_from(p: Profile, today: date, verify_url: str | None) -> Me:
    age = age_on(p.birthdate, today) if (p.verified and p.birthdate) else None
    return Me(verified=p.verified, over_65=bool(age is not None and age >= OVER_65_YEARS), lang=p.lang, age=age,
              verify_url=None if p.verified else verify_url, answers=p.answers or {})
