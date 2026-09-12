from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, File, Header, HTTPException, Response, UploadFile

from ..auth import CurrentUser
from ..config import Settings, get_settings
from ..extract import cache
from ..extract.gemini import Extractor, build_extractor
from ..extract.schema import ExtractResponse
from ..extract.service import run_extract
from ..extract.textlayer import ALLOWED_MIMES, sniff_mime

router = APIRouter()


@lru_cache
def get_extractor() -> Extractor:
    return build_extractor(get_settings())


@router.post("/extract", response_model=ExtractResponse)
async def extract(
    user: CurrentUser,
    settings: Annotated[Settings, Depends(get_settings)],
    response: Response,
    file: UploadFile = File(...),
    x_scallion_cache: Annotated[str | None, Header()] = None,
) -> ExtractResponse:
    """Extract analytes from a redacted lab PDF or image. The upload is held in memory
    for this request only and never written anywhere; the response is the only output."""
    limit = settings.max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    await file.close()
    if len(data) > limit:
        raise HTTPException(status_code=413, detail=f"file larger than {settings.max_upload_mb} MB")
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    mime = sniff_mime(data, file.content_type)
    if mime not in ALLOWED_MIMES:
        raise HTTPException(status_code=415, detail="upload a PDF, PNG, JPEG or WebP")
    hit = cache.cached(data)  # demo fallback keyed by the upload's hash; the upload itself is not stored
    if hit is not None and x_scallion_cache == "prefer":
        response.headers["x-scallion-cache"] = "hit"
        return hit
    try:
        result = run_extract(data, mime, get_extractor())
    except Exception as e:  # model or parse failure; never leak the document
        if hit is not None:
            response.headers["x-scallion-cache"] = "hit"
            return hit
        raise HTTPException(status_code=502, detail=f"extraction failed: {e.__class__.__name__}") from e
    response.headers["x-scallion-cache"] = "miss"
    return result
