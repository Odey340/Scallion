import pytest

from app.extract.canonical import canonical_keys, canonicalize


def test_nine_keys_from_phenoage_json():
    assert set(canonical_keys()) == {"albumin", "creatinine", "glucose", "crp", "lymph_pct", "mcv", "rdw", "alp", "wbc"}


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("RDW", "rdw"),
        ("RDW-CV", "rdw"),
        ("Red Cell Distribution Width", "rdw"),
        ("MCV", "mcv"),
        ("WBC", "wbc"),
        ("White Blood Cell Count", "wbc"),
        ("Leukocytes", "wbc"),
        ("Lymphs", "lymph_pct"),
        ("Lymphocytes %", "lymph_pct"),
        ("Lymphocytes", "lymph_pct"),
        ("Albumin", "albumin"),
        ("Albumin, Serum", "albumin"),
        ("Creatinine", "creatinine"),
        ("Glucose", "glucose"),
        ("Glucose, Fasting", "glucose"),
        ("C-Reactive Protein, Cardiac", "crp"),
        ("hs-CRP", "crp"),
        ("High Sensitivity C-Reactive Protein", "crp"),
        ("Alkaline Phosphatase", "alp"),
        ("Alk Phos", "alp"),
        ("ALP", "alp"),
    ],
)
def test_aliases(raw, expected):
    assert canonicalize(raw) == expected


@pytest.mark.parametrize(
    "raw",
    ["Lymphs (Absolute)", "Lymphocytes Abs", "MCH", "MCHC", "RDW-SD", "BUN/Creatinine Ratio", "eGFR", "Hemoglobin", "Glucose, Urine"],
)
def test_non_phenoage_rows_are_other(raw):
    assert canonicalize(raw) == f"other:{raw}"
