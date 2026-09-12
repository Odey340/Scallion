from functools import lru_cache
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from ..auth import CurrentUser
from ..config import get_settings
from ..tts import Synth, build_synth

router = APIRouter()

MAX_CHARS = 300


@lru_cache
def get_synth() -> Synth | None:
    return build_synth(get_settings())


@router.get("/tts", response_class=Response, responses={200: {"content": {"audio/mpeg": {}}}})
def tts(
    user: CurrentUser,
    text: Annotated[str, Query(min_length=1, max_length=MAX_CHARS)],
    lang: Literal["en", "es"] = "en",
) -> Response:
    """One spoken sentence as MP3 (C's H10 device test; the coach's text fallback)."""
    synth = get_synth()
    if synth is None:
        raise HTTPException(status_code=503, detail="tts not configured: set ELEVENLABS_API_KEY or ELEVENLABS_FAKE=1")
    try:
        audio = synth.speak(text.strip(), lang)
    except Exception as e:  # upstream failure; never echo the key or the upstream body
        raise HTTPException(status_code=502, detail=f"tts failed: {e.__class__.__name__}") from e
    return Response(content=audio, media_type="audio/mpeg", headers={"cache-control": "private, max-age=3600"})
