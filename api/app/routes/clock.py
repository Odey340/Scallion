from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends

from ..auth import CurrentUser
from ..clock.schema import ClockIn, ClockOut
from ..clock.store import ClockStore, build_store
from ..config import get_settings

router = APIRouter()


@lru_cache
def get_store() -> ClockStore:
    return build_store(get_settings())


Store = Annotated[ClockStore, Depends(get_store)]


@router.post("/clock", response_model=ClockOut)
def post_clock(user: CurrentUser, store: Store, body: ClockIn) -> ClockOut:
    """C posts the clock it computed in the browser from A's export, with the inputs that produced it."""
    return store.insert(user.id, body)


@router.get("/clock/latest", response_model=dict[str, ClockOut])
def latest_clock(user: CurrentUser, store: Store) -> dict[str, ClockOut]:
    return store.latest(user.id)
