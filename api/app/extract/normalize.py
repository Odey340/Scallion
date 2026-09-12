"""Unit normalizer: printed units -> the PhenoAge paper's units (phenoage.json "units").

albumin g/L, creatinine umol/L, glucose mmol/L, crp mg/dL, lymph_pct %, mcv fL, rdw %, alp U/L,
wbc 10^9/L. Also derives lymph_pct from an absolute lymphocyte count when the percentage is not
printed (flagged "derived", so C can show "8 of 9 markers printed, 1 derived").
Pure arithmetic on the canonical rows; the model never sees this step (CLAUDE.md rule 1).
"""
import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

from ..config import get_settings
from .schema import Analyte, ExtractResponse

# canonical key -> {normalised printed unit: factor to the target unit}
_FACTORS: dict[str, dict[str, float]] = {
    "albumin": {"g/l": 1.0, "g/dl": 10.0, "mg/dl": 0.01, "umol/l": 0.0665},  # 1 g/L = 15.04 umol/L
    "creatinine": {"umol/l": 1.0, "mg/dl": 88.42, "mg/l": 8.842, "mmol/l": 1000.0},
    "glucose": {"mmol/l": 1.0, "mg/dl": 1 / 18.016, "g/l": 100 / 18.016, "mg/l": 1 / 18016},
    "crp": {"mg/dl": 1.0, "mg/l": 0.1, "ug/ml": 0.1, "ng/ml": 0.0001, "nmol/l": 0.0105},  # 1 nmol/L = 0.105 mg/L
    "lymph_pct": {"%": 1.0, "pct": 1.0},
    "mcv": {"fl": 1.0, "um3": 1.0, "u3": 1.0},
    "rdw": {"%": 1.0, "pct": 1.0},
    "alp": {"u/l": 1.0, "ukat/l": 60.0},
    "wbc": {"10^9/l": 1.0, "g/l": 1.0, "10^3/ul": 1.0, "/nl": 1.0, "/ul": 0.001, "cells/ul": 0.001, "10^6/l": 0.001},  # G/L = giga per litre
}

_ABS_COUNT_FACTORS = _FACTORS["wbc"]  # absolute lymphocytes use the same count units as WBC

_UNIT_REWRITES = [
    (r"[µμ]", "u"),
    (r"\s+", ""),
    (r"^[x×]", ""),
    (r"[x×]10", "10"),
    (r"\*", "^"),
    (r"10(\d)", r"10^\1"),  # "103/uL" -> "10^3/uL"
    (r"10\^\^", "10^"),
    (r"e(\d)/", r"10^\1/"),  # "10e3/uL" style already caught; "e3/uL"
    (r"mm3|mm\^3|cumm|cmm", "ul"),
    (r"mcl", "ul"),
    (r"thou(sand)?/", "10^3/"),
    (r"^k/", "10^3/"),
    (r"^(iu|ui)/", "u/"),
    (r"cells/", "/"),
    (r"^u3$", "um3"),
    (r"percent|por\s*ciento", "%"),
]


def norm_unit(unit: str) -> str:
    u = unicodedata.normalize("NFKC", unit or "").strip().lower()
    for pat, rep in _UNIT_REWRITES:
        u = re.sub(pat, rep, u)
    return u


@lru_cache
def target_units() -> dict[str, str]:
    data = json.loads(Path(get_settings().phenoage_path).read_text())
    return {k: v for k, v in data["units"].items() if k != "age"}


def to_si(name: str, value: float, unit: str) -> tuple[float | None, str | None, str | None]:
    """(si_value, si_unit, note). note is None on success, or 'unknown_unit:<printed>'."""
    if name not in _FACTORS:
        return None, None, None
    table = _FACTORS[name]
    u = norm_unit(unit)
    if u == "" and name in ("lymph_pct", "rdw"):
        u = "%"  # percentages are often printed bare
    factor = table.get(u)
    if factor is None:
        return None, None, f"unknown_unit:{unit.strip() or '(none)'}"
    si_unit = target_units()[name]
    return round(value * factor, 3), si_unit, None


_LYMPH_ABS = re.compile(r"(lymph|linfocit)", re.IGNORECASE)
_ABS = re.compile(r"(\babs\b|absolut|#)", re.IGNORECASE)


def derive_lymph_pct(analytes: list[Analyte]) -> Analyte | None:
    """lymph_pct from absolute lymphocytes / WBC when the percentage row is missing."""
    if any(a.name == "lymph_pct" for a in analytes):
        return None
    wbc = next((a for a in analytes if a.name == "wbc" and a.si_value), None)
    if wbc is None:
        return None
    for a in analytes:
        if not a.name.startswith("other:") or not (_LYMPH_ABS.search(a.raw_name) and _ABS.search(a.raw_name)):
            continue
        factor = _ABS_COUNT_FACTORS.get(norm_unit(a.unit))
        if factor is None:
            continue
        pct = round(a.value * factor / wbc.si_value * 100, 1)
        if not 0 < pct <= 100:
            continue
        return Analyte(
            name="lymph_pct",
            value=pct,
            unit="%",
            ref_low=None,
            ref_high=None,
            source_span=a.source_span,
            source_text=a.source_text,
            raw_name=f"{a.raw_name} / {wbc.raw_name}",
            si_value=pct,
            si_unit="%",
            derived="lymph_pct_from_absolute",
        )
    return None


def normalize(resp: ExtractResponse) -> ExtractResponse:
    rows: list[Analyte] = []
    for a in resp.analytes:
        si_value, si_unit, note = to_si(a.name, a.value, a.unit)
        rows.append(a.model_copy(update={"si_value": si_value, "si_unit": si_unit, "note": note}))
    derived = derive_lymph_pct(rows)
    if derived is not None:
        rows.append(derived)
    present = {a.name for a in rows}
    missing = [k for k in target_units() if k not in present]
    return resp.model_copy(update={"analytes": rows, "missing": missing})
