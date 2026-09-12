"""Demo fallback: cached /extract responses keyed by the upload's sha256.

`api/fixtures/cache/<sha256>.json` is written by `scripts/cache_extract.py` from a live run on a
redacted fixture. At request time the cache is used only when the model fails (network, quota,
retired model) or when the client asks for it with `X-Scallion-Cache: prefer`. The upload itself is
still never stored; only its hash is compared."""
import hashlib
import json
from pathlib import Path

from ..config import API_DIR
from .schema import ExtractResponse

CACHE_DIR = API_DIR / "fixtures" / "cache"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def cached(data: bytes) -> ExtractResponse | None:
    p = CACHE_DIR / f"{sha256(data)}.json"
    if not p.exists():
        return None
    return ExtractResponse.model_validate_json(p.read_text(encoding="utf-8"))


def store(data: bytes, resp: ExtractResponse) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    p = CACHE_DIR / f"{sha256(data)}.json"
    p.write_text(resp.model_dump_json(indent=1), encoding="utf-8")
    return p
