import threading
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import CurrentUser
from ..config import get_settings
from ..vitals.schema import VitalsIn, VitalsOut
from ..vitals.store import VitalsStore, build_store

router = APIRouter()

# "Arm" a capture (contract v12): the camera screen POSTs /vitals/arm when the presenter presses
# Start, and the presage-worker in --watch mode polls GET /vitals/arm and runs one capture per arm.
# The state is one timestamp per user in this process (uvicorn runs a single worker); it is
# transient by design, so no table. `pending` clears as soon as a vitals row lands after the arm.
ARM_WINDOW_S = 120
_arms: dict[str, datetime] = {}
_notes: dict[str, str] = {}  # worker -> phone: why the last capture failed (PATCH), cleared by the next arm
_arm_lock = threading.Lock()


def _now() -> datetime:  # monkeypatched in tests
    return datetime.now(timezone.utc)


class ArmOut(BaseModel):
    armed_at: datetime | None
    pending: bool
    window_s: int = ARM_WINDOW_S
    note: str | None = None  # from the worker when a capture fails; the phone shows it verbatim


class ArmNote(BaseModel):
    note: str = Field(min_length=1, max_length=300)
    final: bool = False  # true: the worker gave up on this arm, so pending clears and the phone stops waiting


def clear_arms() -> None:
    with _arm_lock:
        _arms.clear()
        _notes.clear()


@lru_cache
def get_store() -> VitalsStore:
    return build_store(get_settings())


Store = Annotated[VitalsStore, Depends(get_store)]


@router.post("/vitals")
def post_vitals(user: CurrentUser, store: Store, body: VitalsIn) -> dict:
    """One capture from the presage-worker (or a manual entry). Numbers only; no frames."""
    store.insert(user.id, body)
    return {"ok": True}


@router.get("/vitals/latest", response_model=VitalsOut)
def latest_vitals(user: CurrentUser, store: Store) -> VitalsOut:
    row = store.latest(user.id)
    if row is None:
        raise HTTPException(status_code=404, detail="no vitals yet")
    return row


def _arm_status(user_id: str, store: VitalsStore) -> ArmOut:
    with _arm_lock:
        armed = _arms.get(user_id)
        note = _notes.get(user_id)
    if armed is None:
        return ArmOut(armed_at=None, pending=False, note=note)
    if _now() - armed > timedelta(seconds=ARM_WINDOW_S):
        return ArmOut(armed_at=armed, pending=False, note=note)
    latest = store.latest(user_id)
    return ArmOut(armed_at=armed, pending=latest is None or latest.received_at < armed, note=note)


@router.post("/vitals/arm", response_model=ArmOut)
def arm_vitals(user: CurrentUser, store: Store) -> ArmOut:
    """The phone pressed Start: ask the laptop worker (--watch) for one capture."""
    with _arm_lock:
        _arms[user.id] = _now()
        _notes.pop(user.id, None)
    return _arm_status(user.id, store)


@router.get("/vitals/arm", response_model=ArmOut)
def arm_status(user: CurrentUser, store: Store) -> ArmOut:
    """Polled by the worker: pending while the arm is fresh and no row has landed since."""
    return _arm_status(user.id, store)


@router.delete("/vitals/arm", response_model=ArmOut)
def disarm_vitals(user: CurrentUser, store: Store) -> ArmOut:
    """The phone pressed Cancel (or the capture finished)."""
    with _arm_lock:
        _arms.pop(user.id, None)
        _notes.pop(user.id, None)
    return ArmOut(armed_at=None, pending=False)


@router.patch("/vitals/arm", response_model=ArmOut)
def note_arm(user: CurrentUser, store: Store, body: ArmNote) -> ArmOut:
    """From the worker: why the capture failed (webcam busy, no face), shown on the phone. final=true ends the arm."""
    with _arm_lock:
        _notes[user.id] = body.note
        if body.final:
            _arms.pop(user.id, None)
    return _arm_status(user.id, store)
