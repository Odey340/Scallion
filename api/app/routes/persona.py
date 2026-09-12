"""Persona webhook -> verified + birthdate; GET /me; PUT /me/lang.

Persona signs each webhook: header `Persona-Signature: t=<unix>,v1=<hex>` where v1 is
HMAC-SHA256(secret, f"{t}.{raw body}"). Only inquiry.approved (or completed with status approved)
sets verified. The user is matched by the inquiry's reference-id, which C sets to the user's id
when it opens the hosted flow. Selfie-only templates return no birthdate; then verified is true
and over_65 stays false.
"""
import hashlib
import hmac
import json
import logging
import time
from datetime import date, datetime, timezone
from functools import lru_cache
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

from ..auth import CurrentUser
from ..config import Settings, get_settings
from ..profile.schema import Me, me_from
from ..profile.store import ProfileStore, build_store

log = logging.getLogger("scallion.persona")
router = APIRouter()

APPROVED_EVENTS = {"inquiry.approved", "inquiry.completed"}
SIGNATURE_MAX_AGE_S = 5 * 60


@lru_cache
def get_store() -> ProfileStore:
    return build_store(get_settings())


Store = Annotated[ProfileStore, Depends(get_store)]


def verify_signature(secret: str, header: str | None, body: bytes, now: float | None = None) -> None:
    if not secret:
        raise HTTPException(status_code=503, detail="persona webhook not configured")
    if not header:
        raise HTTPException(status_code=401, detail="missing Persona-Signature")
    parts = dict(kv.split("=", 1) for kv in header.split(",") if "=" in kv)
    t, v1 = parts.get("t"), parts.get("v1")
    if not t or not v1:
        raise HTTPException(status_code=401, detail="malformed Persona-Signature")
    if abs((now or time.time()) - float(t)) > SIGNATURE_MAX_AGE_S:
        raise HTTPException(status_code=401, detail="stale Persona-Signature")
    expected = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, cand.strip()) for cand in v1.split(" ")):
        raise HTTPException(status_code=401, detail="bad Persona-Signature")


def parse_inquiry(payload: dict) -> tuple[str, str, str | None, date | None, str | None]:
    """-> (event name, inquiry id, status, birthdate, reference id)."""
    attrs = payload.get("data", {}).get("attributes", {})
    name = attrs.get("name", "")
    inq = attrs.get("payload", {}).get("data", {})
    ia = inq.get("attributes", {})
    fields = ia.get("fields", {}) or {}
    bd_raw = (fields.get("birthdate") or {}).get("value")
    birthdate = date.fromisoformat(bd_raw) if bd_raw else None
    return name, inq.get("id", ""), ia.get("status"), birthdate, ia.get("reference-id") or ia.get("reference_id")


@router.post("/persona/webhook")
async def persona_webhook(
    request: Request,
    store: Store,
    settings: Annotated[Settings, Depends(get_settings)],
    persona_signature: Annotated[str | None, Header()] = None,
) -> dict:
    body = await request.body()
    verify_signature(settings.persona_webhook_secret, persona_signature, body)
    try:
        payload = json.loads(body)
        name, inquiry_id, status, birthdate, reference_id = parse_inquiry(payload)
    except (ValueError, AttributeError) as e:
        raise HTTPException(status_code=400, detail="unparseable webhook") from e
    if name not in APPROVED_EVENTS or status not in (None, "approved", "completed"):
        return {"ok": True, "applied": False, "event": name}
    if name == "inquiry.completed" and status != "approved":
        return {"ok": True, "applied": False, "event": name}
    if not reference_id:
        log.warning("persona %s %s without reference-id; cannot match a user", name, inquiry_id)
        return {"ok": True, "applied": False, "event": name}
    store.set_verified(reference_id, birthdate, inquiry_id)
    return {"ok": True, "applied": True, "event": name, "birthdate_present": birthdate is not None}


def _verify_url(settings: Settings, user_id: str) -> str | None:
    if not settings.persona_template_id:
        return None
    url = f"https://inquiry.withpersona.com/verify?inquiry-template-id={settings.persona_template_id}&reference-id={user_id}"
    if settings.persona_environment_id:
        url += f"&environment-id={settings.persona_environment_id}"
    return url


@router.get("/me", response_model=Me)
def me(user: CurrentUser, store: Store, settings: Annotated[Settings, Depends(get_settings)]) -> Me:
    return me_from(store.get(user.id), datetime.now(timezone.utc).date(), _verify_url(settings, user.id))


class LangIn(BaseModel):
    lang: Literal["en", "es"]


@router.put("/me/lang", response_model=Me)
def set_lang(user: CurrentUser, store: Store, body: LangIn, settings: Annotated[Settings, Depends(get_settings)]) -> Me:
    return me_from(store.set_lang(user.id, body.lang), datetime.now(timezone.utc).date(), _verify_url(settings, user.id))
