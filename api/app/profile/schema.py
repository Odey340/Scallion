"""User profile: what Persona verified plus onboarding language. GET /me (contract section 3)."""
from datetime import date
from typing import Literal

from pydantic import BaseModel

OVER_65_YEARS = 65


class Profile(BaseModel):
    user_id: str
    verified: bool = False
    birthdate: date | None = None
    lang: Literal["en", "es"] = "en"
    inquiry_id: str | None = None


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


def me_from(p: Profile, today: date, verify_url: str | None) -> Me:
    age = age_on(p.birthdate, today) if (p.verified and p.birthdate) else None
    return Me(verified=p.verified, over_65=bool(age is not None and age >= OVER_65_YEARS), lang=p.lang, age=age,
              verify_url=None if p.verified else verify_url)
