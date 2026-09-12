"""Extractors. GeminiExtractor calls Gemini with a strict JSON response schema.
FakeExtractor returns canned output so tests and the demo fallback run offline."""
import json
from pathlib import Path
from typing import Protocol

from ..config import API_DIR, Settings
from .schema import GeminiExtraction

PROMPT = """You are reading a clinical laboratory report (a blood panel). Return every analyte result printed on it.

Rules:
- One entry per printed result row. Copy the analyte name into raw_name exactly as printed; do not translate, abbreviate or map it.
- value is the printed number. Drop flags like H, L, *, and strip < or > from the number (put them in source_text).
- unit exactly as printed; empty string if none. Do not convert units.
- ref_low / ref_high from the printed reference range, null if no range is printed.
- source_text is the complete printed line for that result, copied verbatim from the text layer when available.
- fasting: true or false only if the report prints a fasting status; otherwise null.
- lang: the language the report is printed in.
- Skip patient identifiers, dates, clinician names, addresses, and any narrative.
Return only the JSON object."""


class Extractor(Protocol):
    def extract(self, data: bytes, mime: str, text: str) -> GeminiExtraction: ...


class GeminiExtractor:
    def __init__(self, settings: Settings):
        from google import genai  # imported lazily so the fake path has no SDK dependency at runtime

        if not settings.gemini_api_key:
            raise RuntimeError("GEMINI_API_KEY is empty")
        self._client = genai.Client(api_key=settings.gemini_api_key)
        self._model = settings.gemini_model

    def extract(self, data: bytes, mime: str, text: str) -> GeminiExtraction:
        from google.genai import types

        parts = [types.Part.from_bytes(data=data, mime_type=mime)]
        if text.strip():
            parts.append(types.Part.from_text(text=f"Text layer of the same document:\n{text}"))
        parts.append(types.Part.from_text(text=PROMPT))
        resp = self._client.models.generate_content(
            model=self._model,
            contents=[types.Content(role="user", parts=parts)],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=GeminiExtraction,
                temperature=0,
            ),
        )
        if resp.parsed is not None:
            return GeminiExtraction.model_validate(resp.parsed)
        return GeminiExtraction.model_validate_json(resp.text or "{}")


class FakeExtractor:
    """Canned response, keyed loosely on the input: the synthetic fixture's answer by default."""

    def __init__(self, path: Path | None = None):
        self._path = path or API_DIR / "fixtures" / "gemini_fake_response.json"

    def extract(self, data: bytes, mime: str, text: str) -> GeminiExtraction:
        return GeminiExtraction.model_validate(json.loads(self._path.read_text()))


def build_extractor(settings: Settings) -> Extractor:
    if settings.gemini_fake:
        return FakeExtractor()
    return GeminiExtractor(settings)
