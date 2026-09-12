"""Run a live /extract on a redacted fixture and store the response in api/fixtures/cache/<sha>.json.

    uv run python scripts/cache_extract.py ../fixtures/lab_report_synthetic.pdf [more.pdf ...]

Needs GEMINI_API_KEY. Only run on files that are safe to commit (no PHI): the cached JSON contains
the text layer.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import get_settings  # noqa: E402
from app.extract.cache import sha256, store  # noqa: E402
from app.extract.gemini import build_extractor  # noqa: E402
from app.extract.service import run_extract  # noqa: E402
from app.extract.textlayer import sniff_mime  # noqa: E402


def main(paths: list[str]) -> int:
    s = get_settings()
    if s.gemini_fake or not s.gemini_api_key:
        print("needs GEMINI_API_KEY and GEMINI_FAKE=0")
        return 2
    extractor = build_extractor(s)
    for arg in paths:
        data = Path(arg).read_bytes()
        mime = sniff_mime(data, None)
        resp = run_extract(data, mime, extractor)
        out = store(data, resp)
        nine = [a.name for a in resp.analytes if not a.name.startswith("other:")]
        print(f"{arg}: sha {sha256(data)[:12]}… {len(resp.analytes)} analytes, canonical {len(nine)}, missing {resp.missing} -> {out.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
