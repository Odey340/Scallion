from typing import Annotated

from fastapi import APIRouter, Depends

from ..config import Settings, get_settings

router = APIRouter()
VERSION = "0.1.0"


@router.get("/health")
def health(settings: Annotated[Settings, Depends(get_settings)]) -> dict:
    return {
        "ok": True,
        "version": VERSION,
        "gemini": "fake" if settings.gemini_fake else "live",
        "auth": "bypass" if settings.dev_auth_bypass else "jwt",
    }
