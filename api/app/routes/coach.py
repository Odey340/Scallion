import json
from functools import lru_cache
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import CurrentUser
from ..coach.context import build_context
from ..coach.validator import validate_narration
from ..config import API_DIR
from ..config import Settings, get_settings
from . import clock as clock_route
from . import persona as persona_route
from . import vitals as vitals_route

router = APIRouter()


def _context(user_id: str, settings: Settings) -> dict:
    profile = persona_route.get_store().get(user_id)
    clocks = clock_route.get_store().latest(user_id)
    vitals = vitals_route.get_store().latest(user_id)
    circle = None  # TODO(B): social/ metrics once POST /events data is summarised by B's package
    return build_context(settings, profile, clocks, vitals, circle)


@router.get("/coach/context")
def coach_context(user: CurrentUser, settings: Annotated[Settings, Depends(get_settings)]) -> dict:
    """Everything the coach may say numbers about: clock, circle, today, levers, flags."""
    return _context(user.id, settings)


class ValidateIn(BaseModel):
    text: str = Field(max_length=4000)


@router.post("/coach/validate")
def coach_validate(user: CurrentUser, settings: Annotated[Settings, Depends(get_settings)], body: ValidateIn) -> dict:
    """Rejects narration containing any number not present in this user's coach context."""
    return validate_narration(body.text, _context(user.id, settings))


@lru_cache
def explanations() -> dict:
    return json.loads((API_DIR / "app" / "coach" / "explanations.json").read_text(encoding="utf-8"))


@router.get("/coach/explain/{name}")
def coach_explain(user: CurrentUser, name: str, lang: Literal["en", "es"] = "en") -> dict:
    """Curated one-paragraph explanation of one PhenoAge analyte with its citation, plus the user's
    latest value (from the clock C posted) and the paper's unit. The explain_analyte coach tool."""
    ex = explanations()
    if name not in ex["analytes"]:
        raise HTTPException(status_code=404, detail="unknown analyte")
    entry = ex["analytes"][name]
    latest = clock_route.get_store().latest(user.id).get("phenoage")
    inputs = (latest.inputs if latest else None) or {}
    value = inputs.get(name)
    unit = (_export_units() or {}).get(name)
    return {
        "name": name,
        "lang": lang,
        "text": entry[lang],
        "source": entry["source"],
        "value": value if isinstance(value, (int, float)) else None,
        "unit": unit,
        "imputed": name in (inputs.get("imputed") or []),
        "disclaimer": ex["disclaimer"][lang],
    }


@lru_cache
def _export_units() -> dict | None:
    from ..extract.normalize import target_units

    return target_units()
