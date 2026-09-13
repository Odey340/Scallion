import threading
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
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
# A Start is served for this long. One laptop attempt can take 3 min (camera lock, up to 2 min for a
# face, the recording), and a Start placed while the laptop is busy must still be pending when it
# frees up; the phone disarms when it gives up, so a long window does not leave zombie arms.
ARM_WINDOW_S = 300
_arms: dict[str, datetime] = {}
_notes: dict[str, str] = {}  # worker -> phone: why the last capture failed (PATCH), cleared by the next arm
# Last request from a presage-worker (GET with the x-scallion-worker header, or PATCH) per user. The
# watcher polls every 2 s (also while a capture child runs), so the phone reads "no laptop worker is
# running for this account" from a missing or stale stamp instead of waiting out a generic timeout.
_worker_seen: dict[str, datetime] = {}
_arm_lock = threading.Lock()
WORKER_HEADER = "x-scallion-worker"


def _now() -> datetime:  # monkeypatched in tests
    return datetime.now(timezone.utc)


class ArmOut(BaseModel):
    armed_at: datetime | None
    pending: bool
    window_s: int = ARM_WINDOW_S
    note: str | None = None  # from the worker when a capture fails; the phone shows it verbatim
    worker_seen_at: datetime | None = None  # last poll/note from a presage-worker for this user (v12 addendum)


class ArmNote(BaseModel):
    note: str = Field(min_length=1, max_length=300)
    final: bool = False  # true: the worker gave up on this arm, so pending clears and the phone stops waiting
    # The arm this note is about (H34). When given, a note for an arm that is no longer current (the
    # phone cancelled or pressed Start again while that capture ran) is dropped, so a stale failure can
    # neither end the newer arm nor show up on the phone for it. Omit it for the pre-H34 behaviour.
    armed_at: datetime | None = None


def clear_arms() -> None:
    with _arm_lock:
        _arms.clear()
        _notes.clear()
        _worker_seen.clear()


def _mark_worker_seen(user_id: str) -> None:
    with _arm_lock:
        _worker_seen[user_id] = _now()


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
        seen = _worker_seen.get(user_id)
    if armed is None:
        return ArmOut(armed_at=None, pending=False, note=note, worker_seen_at=seen)
    if _now() - armed > timedelta(seconds=ARM_WINDOW_S):
        return ArmOut(armed_at=armed, pending=False, note=note, worker_seen_at=seen)
    latest = store.latest(user_id)
    return ArmOut(armed_at=armed, pending=latest is None or latest.received_at < armed, note=note, worker_seen_at=seen)


@router.post("/vitals/arm", response_model=ArmOut)
def arm_vitals(user: CurrentUser, store: Store) -> ArmOut:
    """The phone pressed Start: ask the laptop worker (--watch) for one capture."""
    with _arm_lock:
        _arms[user.id] = _now()
        _notes.pop(user.id, None)
    return _arm_status(user.id, store)


@router.get("/vitals/arm", response_model=ArmOut)
def arm_status(
    user: CurrentUser, store: Store, x_scallion_worker: Annotated[str | None, Header(alias=WORKER_HEADER)] = None
) -> ArmOut:
    """Polled by the worker (with the x-scallion-worker header, which stamps worker_seen_at) and by
    the phone (without it): pending while the arm is fresh and no row has landed since."""
    if x_scallion_worker:
        _mark_worker_seen(user.id)
    return _arm_status(user.id, store)


@router.delete("/vitals/arm", response_model=ArmOut)
def disarm_vitals(user: CurrentUser, store: Store) -> ArmOut:
    """The phone pressed Cancel (or the capture finished)."""
    with _arm_lock:
        _arms.pop(user.id, None)
        _notes.pop(user.id, None)
        seen = _worker_seen.get(user.id)
    return ArmOut(armed_at=None, pending=False, worker_seen_at=seen)


@router.patch("/vitals/arm", response_model=ArmOut)
def note_arm(user: CurrentUser, store: Store, body: ArmNote) -> ArmOut:
    """From the worker: why the capture failed (webcam busy, no face), shown on the phone. final=true ends the arm."""
    with _arm_lock:
        _worker_seen[user.id] = _now()  # a note is the worker talking, so it counts as seen
        current = _arms.get(user.id)
        if body.armed_at is None or (current is not None and body.armed_at == current):
            _notes[user.id] = body.note
            if body.final:
                _arms.pop(user.id, None)
    return _arm_status(user.id, store)
