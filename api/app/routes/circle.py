from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from ..auth import CurrentUser
from ..circle.metrics import summarize
from ..coach.context import _export
from ..config import Settings, get_settings
from . import events as events_route
from . import persona as persona_route

router = APIRouter()


def circle_summary(user_id: str, settings: Settings, window_days: int = 30) -> dict:
    events = events_route.get_store().all(user_id, since_days=400)
    if not events:
        return {"available": False, "events": 0, "todo": "no contact events yet: upload an export or connect Gmail"}
    answers = persona_route.get_store().get(user_id).answers or {}
    asked = {k: answers.get(k) for k in ("help_family", "help_friends")}
    return summarize(events, asked, datetime.now(timezone.utc), window_days, _export(settings.engine_dir, "risk_years.json"))


@router.get("/circle/summary")
def get_circle_summary(
    user: CurrentUser,
    settings: Annotated[Settings, Depends(get_settings)],
    window_days: Annotated[int, Query(ge=7, le=90)] = 30,
) -> dict:
    """Metrics, LSNS-6 proxy, nudges, heatmap, alerts from this user's hashed events (contract section 3)."""
    return circle_summary(user.id, settings, window_days)
