from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from ..auth import CurrentUser
from ..config import get_settings
from ..vitals.schema import VitalsIn, VitalsOut
from ..vitals.store import VitalsStore, build_store

router = APIRouter()


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
