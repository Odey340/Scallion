"""Unit normalizer + lymph_pct derivation + Spanish aliases (Block 2)."""
import pytest

from app.extract.canonical import canonicalize
from app.extract.normalize import derive_lymph_pct, norm_unit, normalize, to_si
from app.extract.schema import Analyte, ExtractResponse


def A(name, value, unit, raw=None, **kw):
    return Analyte(name=name, value=value, unit=unit, source_text=f"{raw or name} {value} {unit}", raw_name=raw or name, **kw)


@pytest.mark.parametrize(
    "printed, expected",
    [
        ("10*3/uL", "10^3/ul"), ("10^3/µL", "10^3/ul"), ("K/uL", "10^3/ul"), ("x10^9/L", "10^9/l"), ("×10⁹/L", "10^9/l"),
        ("thousand/uL", "10^3/ul"), ("10^3/mm3", "10^3/ul"), ("cells/mcL", "/ul"), ("IU/L", "u/l"), ("UI/L", "u/l"),
        ("mg/dL", "mg/dl"), ("µmol/L", "umol/l"), ("fL", "fl"), ("%", "%"), (" g / dL ", "g/dl"),
    ],
)
def test_norm_unit(printed, expected):
    assert norm_unit(printed) == expected


@pytest.mark.parametrize(
    "name, value, unit, si",
    [
        ("albumin", 4.4, "g/dL", 44.0),
        ("albumin", 44, "g/L", 44.0),
        ("creatinine", 0.91, "mg/dL", 80.462),
        ("creatinine", 80, "umol/L", 80.0),
        ("glucose", 97, "mg/dL", 5.384),
        ("glucose", 5.4, "mmol/L", 5.4),
        ("crp", 0.80, "mg/L", 0.08),
        ("crp", 0.08, "mg/dL", 0.08),
        ("alp", 70, "IU/L", 70.0),
        ("alp", 70, "U/L", 70.0),
        ("wbc", 6.2, "10*3/uL", 6.2),
        ("wbc", 6200, "cells/uL", 6.2),
        ("wbc", 6.2, "x10^9/L", 6.2),
        ("mcv", 90, "fL", 90.0),
        ("rdw", 13.1, "%", 13.1),
        ("rdw", 13.1, "", 13.1),
        ("lymph_pct", 30, "%", 30.0),
    ],
)
def test_to_si(name, value, unit, si):
    v, u, note = to_si(name, value, unit)
    assert note is None
    assert v == pytest.approx(si, abs=1e-3)
    assert u  # target unit from phenoage.json


def test_unknown_unit_is_flagged_not_converted():
    v, u, note = to_si("glucose", 97, "furlongs")
    assert (v, u) == (None, None)
    assert note == "unknown_unit:furlongs"
    assert to_si("other:Hemoglobin", 14.9, "g/dL") == (None, None, None)


def test_lymph_pct_derived_from_absolute_when_percent_missing():
    rows = normalize(ExtractResponse(
        analytes=[A("wbc", 6.2, "10*3/uL", "WBC"), A("other:Lymphs (Absolute)", 1.9, "10*3/uL", "Lymphs (Absolute)")],
        fasting=None, lang="en", text="", missing=[],
    ))
    d = [a for a in rows.analytes if a.name == "lymph_pct"]
    assert len(d) == 1
    assert d[0].value == pytest.approx(30.6, abs=0.05)
    assert d[0].derived == "lymph_pct_from_absolute"
    assert d[0].raw_name == "Lymphs (Absolute) / WBC"
    assert "lymph_pct" not in rows.missing


def test_lymph_pct_not_derived_when_printed_or_no_wbc():
    printed = [A("wbc", 6.2, "10*3/uL"), A("lymph_pct", 30, "%"), A("other:Lymphs (Absolute)", 1.9, "10*3/uL", "Lymphs (Absolute)")]
    assert derive_lymph_pct(normalize(ExtractResponse(analytes=printed, fasting=None, lang="en", text="", missing=[])).analytes) is None
    no_wbc = [A("other:Linfocitos absolutos", 1.9, "10^3/uL", "Linfocitos absolutos")]
    assert derive_lymph_pct(normalize(ExtractResponse(analytes=no_wbc, fasting=None, lang="es", text="", missing=[])).analytes) is None


def test_missing_recomputed_after_normalization():
    r = normalize(ExtractResponse(analytes=[A("rdw", 13.1, "%")], fasting=None, lang="en", text="", missing=["wrong"]))
    assert "rdw" not in r.missing and "glucose" in r.missing and len(r.missing) == 8


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("Glucosa", "glucose"), ("Glucosa en ayunas", "glucose"), ("Glucemia", "glucose"),
        ("Creatinina", "creatinine"), ("Creatinina sérica", "creatinine"),
        ("Proteína C Reactiva", "crp"), ("PCR ultrasensible", "crp"), ("Proteína C reactiva de alta sensibilidad", "crp"),
        ("Leucocitos", "wbc"), ("Recuento de leucocitos", "wbc"), ("Glóbulos blancos", "wbc"),
        ("Linfocitos", "lymph_pct"), ("Linfocitos %", "lymph_pct"), ("Linfocitos relativos", "lymph_pct"),
        ("VCM", "mcv"), ("Volumen corpuscular medio", "mcv"),
        ("ADE", "rdw"), ("Amplitud de distribución eritrocitaria", "rdw"),
        ("Fosfatasa alcalina", "alp"), ("FAL", "alp"),
        ("Albúmina", "albumin"), ("Albúmina sérica", "albumin"),
    ],
)
def test_spanish_aliases(raw, expected):
    assert canonicalize(raw) == expected


@pytest.mark.parametrize("raw", ["Linfocitos absolutos", "Glucosa en orina", "HCM", "CHCM", "Hemoglobina"])
def test_spanish_non_phenoage_rows_are_other(raw):
    assert canonicalize(raw) == f"other:{raw}"
