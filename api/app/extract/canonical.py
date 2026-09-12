"""Map printed analyte names to the canonical keys in phenoage.json.

Gemini never does this mapping; it copies names verbatim and this table decides.
Unknown names become "other:<raw>". English aliases only; the Spanish table is Block 2.
"""
import json
import re
from functools import lru_cache
from pathlib import Path

from ..config import get_settings

# alias -> canonical key. Keys are normalised with _norm before lookup.
_ALIASES: dict[str, str] = {
    # albumin g/L
    "albumin": "albumin",
    "albumin serum": "albumin",
    "alb": "albumin",
    # creatinine umol/L
    "creatinine": "creatinine",
    "creatinine serum": "creatinine",
    "creat": "creatinine",
    # glucose mmol/L
    "glucose": "glucose",
    "glucose serum": "glucose",
    "glucose fasting": "glucose",
    "fasting glucose": "glucose",
    "glucose plasma": "glucose",
    # crp mg/dL (hs-CRP is the same analyte; unit conversion is the normalizer's job)
    "crp": "crp",
    "hs crp": "crp",
    "hscrp": "crp",
    "c reactive protein": "crp",
    "high sensitivity c reactive protein": "crp",
    "c reactive protein high sensitivity": "crp",
    "crp high sensitivity": "crp",
    "cardio crp": "crp",
    "c reactive protein cardiac": "crp",
    "crp cardiac": "crp",
    "cardiac crp": "crp",
    "c reactive protein hs": "crp",
    # lymph_pct %
    "lymphocytes": "lymph_pct",
    "lymphocyte": "lymph_pct",
    "lymphs": "lymph_pct",
    "lymph": "lymph_pct",
    "lymphocytes pct": "lymph_pct",
    "lymphocytes percent": "lymph_pct",
    "lymphocyte percent": "lymph_pct",
    "lymphs pct": "lymph_pct",
    "lymphocytes relative": "lymph_pct",
    # mcv fL
    "mcv": "mcv",
    "mean corpuscular volume": "mcv",
    "mean cell volume": "mcv",
    # rdw %
    "rdw": "rdw",
    "rdw cv": "rdw",
    "red cell distribution width": "rdw",
    "red blood cell distribution width": "rdw",
    # alp U/L
    "alp": "alp",
    "alk phos": "alp",
    "alkaline phosphatase": "alp",
    "alkaline phosphatase serum": "alp",
    # wbc 10^9/L
    "wbc": "wbc",
    "white blood cell count": "wbc",
    "white blood cells": "wbc",
    "white cell count": "wbc",
    "leukocytes": "wbc",
    "leukocyte count": "wbc",
    "total leukocyte count": "wbc",
}

# Names that look like a canonical analyte but are a different measurement.
# They must never map to a PhenoAge key. (Block 2 derives lymph_pct from absolutes.)
_EXCLUDE_PATTERNS = [
    re.compile(r"\babs\b|\babsolute\b|\b#\s*$|\bcount\b.*\blymph|\blymph.*\bcount\b"),
    re.compile(r"\burine\b|\burinary\b|\bcsf\b"),
    re.compile(r"\bmch\b|\bmchc\b|\brdw\s*sd\b"),
    re.compile(r"\begfr\b|\bratio\b|\bbun\b"),
]


def _norm(raw: str) -> str:
    s = raw.lower().replace("%", " pct ")
    s = re.sub(r"[^a-z0-9#]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


@lru_cache
def canonical_keys() -> tuple[str, ...]:
    """The nine analyte keys, read from phenoage.json (units block minus age)."""
    data = json.loads(Path(get_settings().phenoage_path).read_text())
    return tuple(k for k in data["units"] if k != "age")


def canonicalize(raw_name: str) -> str:
    n = _norm(raw_name)
    if any(p.search(n) for p in _EXCLUDE_PATTERNS):
        return f"other:{raw_name.strip()}"
    key = _ALIASES.get(n)
    if key is None:
        # Try dropping trailing qualifiers such as "(serum)" already stripped, or "level".
        n2 = re.sub(r"\b(level|levels|result|serum|plasma|blood|whole blood)\b", " ", n)
        n2 = re.sub(r"\s+", " ", n2).strip()
        key = _ALIASES.get(n2)
    if key is None or key not in canonical_keys():
        return f"other:{raw_name.strip()}"
    return key
