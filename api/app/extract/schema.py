"""Pydantic models. GeminiExtraction is the strict response schema sent to the model;
ExtractResponse is what the API returns (docs/contracts.md section 3, v2)."""
from typing import Literal

from pydantic import BaseModel, Field


class GeminiAnalyte(BaseModel):
    raw_name: str = Field(description="Analyte name exactly as printed on the report")
    value: float = Field(description="Numeric result as printed; decimal point, no thousands separator")
    unit: str = Field(description="Unit exactly as printed, empty string if none is printed")
    ref_low: float | None = Field(default=None, description="Lower bound of the printed reference range, null if absent")
    ref_high: float | None = Field(default=None, description="Upper bound of the printed reference range, null if absent")
    source_text: str = Field(description="The printed line containing this result, copied verbatim")


class GeminiExtraction(BaseModel):
    analytes: list[GeminiAnalyte]
    fasting: bool | None = Field(default=None, description="true/false only if the report prints a fasting status, else null")
    lang: Literal["en", "es", "other"] = Field(description="Language the report is printed in")


class Analyte(BaseModel):
    name: str  # canonical key from phenoage.json or "other:<raw_name>"
    value: float
    unit: str
    ref_low: float | None = None
    ref_high: float | None = None
    source_span: tuple[int, int] | None = None  # [start, end) offsets into ExtractResponse.text
    source_text: str
    raw_name: str
    # v4 (normalizer): value in the PhenoAge paper's unit, or null when the printed unit is unknown.
    si_value: float | None = None
    si_unit: str | None = None
    derived: str | None = None  # "lymph_pct_from_absolute" when computed from an absolute count
    note: str | None = None  # "unknown_unit:<printed>"


class ExtractResponse(BaseModel):
    analytes: list[Analyte]
    fasting: bool | None
    lang: Literal["en", "es", "other"]
    text: str
    missing: list[str]
