from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..auth import CurrentUser
from ..coach.context import build_context
from ..coach.validator import validate_narration
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
