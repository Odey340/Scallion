from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, Path

from ..auth import CurrentUser
from ..config import get_settings
from ..events.schema import EventsIn, EventsOut
from ..events.store import EventsStore, build_store

router = APIRouter()


@lru_cache
def get_store() -> EventsStore:
    return build_store(get_settings())


Store = Annotated[EventsStore, Depends(get_store)]


@router.post("/events", response_model=EventsOut)
def post_events(user: CurrentUser, store: Store, body: EventsIn) -> EventsOut:
    """B's hashed metadata batch. Idempotent: a re-sent batch inserts 0."""
    inserted = store.insert(user.id, body.events)
    return EventsOut(inserted=inserted, received=len(body.events), duplicates=len(body.events) - inserted)


@router.delete("/events")
def delete_all_events(user: CurrentUser, store: Store) -> dict:
    """One-tap delete-all (B's privacy card)."""
    return {"deleted": store.delete(user.id)}


@router.delete("/events/{contact}")
def forget_contact(
    user: CurrentUser,
    store: Store,
    contact: Annotated[str, Path(pattern=r"^[0-9a-f]{64}$")],
) -> dict:
    """Per-contact forget."""
    return {"deleted": store.delete(user.id, contact)}
