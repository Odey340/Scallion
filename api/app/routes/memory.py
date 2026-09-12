"""Coach memory + the two writing tools: log_meal and share_with_circle. Plus the agent session."""
from datetime import datetime, timezone
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import CurrentUser
from ..checkins.schema import CheckinIn, CheckinOut, MealIn, ShareIn
from ..checkins.store import CheckinStore, build_store
from ..config import Settings, get_settings
from . import persona as persona_route

router = APIRouter()


@lru_cache
def get_store() -> CheckinStore:
    return build_store(get_settings())


Store = Annotated[CheckinStore, Depends(get_store)]


@router.post("/coach/checkin", response_model=CheckinOut)
def post_checkin(user: CurrentUser, store: Store, body: CheckinIn) -> CheckinOut:
    """Store a check-in, nudge, reply or plan line. The coach's memory."""
    return store.insert(user.id, body)


@router.get("/coach/checkins", response_model=list[CheckinOut])
def list_checkins(user: CurrentUser, store: Store, limit: Annotated[int, Query(ge=1, le=100)] = 10, kind: str | None = None) -> list[CheckinOut]:
    return store.recent(user.id, limit, kind)


@router.post("/coach/meal")
def log_meal(user: CurrentUser, store: Store, body: MealIn) -> dict:
    """log_meal tool: the plate decision is recomputed by C from meal_grid.json; the API only records."""
    row = store.insert(user.id, CheckinIn(kind="meal", text=body.note, data={"carbs_g": body.carbs_g}))
    return {"ok": True, "carbs_g": body.carbs_g, "ts": row.ts.isoformat()}


@router.post("/coach/share")
def share_with_circle(user: CurrentUser, store: Store, body: ShareIn) -> dict:
    """share_with_circle tool: refuses unless Persona verified the user (contract section 4)."""
    profile = persona_route.get_store().get(user.id)
    if not profile.verified:
        raise HTTPException(status_code=403, detail="not verified: complete Persona verification before sharing")
    row = store.insert(user.id, CheckinIn(kind="share", text=body.text, data={"target_contact": body.target_contact}))
    return {"ok": True, "target_contact": body.target_contact, "ts": row.ts.isoformat()}


@router.get("/coach/session")
def coach_session(user: CurrentUser, settings: Annotated[Settings, Depends(get_settings)]) -> dict:
    """What C needs to start a voice session: the agent id and, when the key is present, a signed
    URL minted server-side so the ElevenLabs key never reaches the browser."""
    if not settings.elevenlabs_agent_id:
        raise HTTPException(status_code=503, detail="coach agent not configured: set ELEVENLABS_AGENT_ID")
    signed_url = None
    if settings.elevenlabs_api_key and not settings.elevenlabs_fake:
        import httpx

        try:
            r = httpx.get(
                "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url",
                params={"agent_id": settings.elevenlabs_agent_id},
                headers={"xi-api-key": settings.elevenlabs_api_key},
                timeout=15,
            )
            r.raise_for_status()
            signed_url = r.json().get("signed_url")
        except Exception as e:  # the agent id still lets C connect to a public agent
            signed_url = None
            detail = e.__class__.__name__
            return {"agent_id": settings.elevenlabs_agent_id, "signed_url": None, "note": f"signed url unavailable: {detail}"}
    return {"agent_id": settings.elevenlabs_agent_id, "signed_url": signed_url, "issued_at": datetime.now(timezone.utc).isoformat()}
