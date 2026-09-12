"""api/redaction_rules.json against the synthetic fixture's text layer and invented header lines.

The fixture already carries [REDACTED] placeholders, so the only line the rules may remove is
its header; every analyte row (and every canonical name) must survive untouched.
"""
import json
import re

import pytest

from app.extract.canonical import canonical_keys
from app.extract.textlayer import pdf_text
from app.redaction import RULES_PATH, load_rules, redact_line, redact_text
from tests.conftest import FIXTURE_PDF

RS = load_rules()

# Three invented header lines a real report might print (no real person).
INVENTED_HEADERS = [
    "Patient: DOE, JANE Q    DOB: 03/14/1975    Sex: F    MRN: 004417823",
    "Address: 4500 Old Spanish Trl Apt 12, Houston, TX 77021    Phone: (713) 555-0142",
    "Ordering Physician: Dr. A. Smith, MD    NPI 1234567890    Fax: 713-555-0199",
]

# Lines that must never be dropped: analyte rows and the fields the clock or re-test date needs.
MUST_KEEP = [
    "Protein, Total 7.0 g/dL 6.0-8.5",
    "Albumin 4.4 g/dL 3.8-4.9",
    "Vitamin D, 25-Hydroxy 32 ng/mL 30-100",
    "Creatinine 0.91 mg/dL 0.76-1.27",
    "Collected: 2026-08-14 07:52    Reported: 2026-08-14 15:10    Specimen: Serum / Whole blood",
    "Fasting: Yes",
    "Sex: F    Age: 51",
    "COMPREHENSIVE METABOLIC PANEL (CMP)",
    "Reference ranges apply to adults. Results are for the specimen as received.",
]


def test_rules_file_shape():
    raw = json.loads(RULES_PATH.read_text(encoding="utf-8"))
    assert raw["version"] == 1
    assert {"keep_if", "rules", "mask_token", "regex_dialect", "how_to_apply"} <= raw.keys()
    ids = [r["id"] for r in raw["rules"]]
    assert len(ids) == len(set(ids))
    for r in raw["rules"]:
        assert r["action"] in {"drop_line", "mask"}
        assert r["category"] in {"name", "dob", "mrn", "address", "physician", "contact"}
        # "(?" that is not an escaped literal paren "\(?" and not a plain group "(?:"
        assert not re.search(r"(?<!\\)\(\?(?!:)", r["pattern"]), "inline flags / lookbehind are not JS-safe"
    for cat in ("name", "dob", "mrn", "address", "physician"):
        assert any(r["category"] == cat for r in raw["rules"]), cat


def test_synthetic_fixture_loses_only_its_header():
    text = pdf_text(FIXTURE_PDF.read_bytes())
    res = redact_text(text, RS)
    dropped_lines = [line for _, _, line in res.dropped]
    assert dropped_lines == ["Patient: [REDACTED]    DOB: [REDACTED]    MRN: [REDACTED]"]
    assert res.masked == []
    for key in canonical_keys():
        assert key  # nine keys present in the contract
    for printed in ("WBC", "MCV", "RDW", "Lymphs", "Glucose", "Creatinine", "Albumin",
                    "Alkaline Phosphatase", "C-Reactive Protein, Cardiac", "Fasting: Yes", "Collected: 2026-08-14"):
        assert printed in res.text, printed
    # Every line other than the header is byte-identical.
    assert res.text == "\n".join(l for l in text.split("\n") if not l.startswith("Patient:"))


@pytest.mark.parametrize("line", INVENTED_HEADERS)
def test_invented_header_lines_are_dropped(line):
    new, drops, _ = redact_line(line, RS)
    assert new is None, (line, new)
    assert drops


def test_invented_headers_hit_the_expected_categories():
    cats = {r.id: r.category for r in RS.rules}
    hit = {cats[redact_line(line, RS)[1][0]] for line in INVENTED_HEADERS}
    assert hit == {"name", "address", "physician"}


@pytest.mark.parametrize("line", MUST_KEEP)
def test_result_rows_and_dates_survive(line):
    new, drops, masks = redact_line(line, RS)
    assert new == line, (drops, masks)


def test_mask_rules_redact_only_the_identifier():
    line = "Accession #: AB123456    Specimen: Serum    Email: someone@example.org"
    new, drops, masks = redact_line(line, RS)
    assert new is not None and not drops
    assert "AB123456" not in new and "someone@example.org" not in new
    assert "Specimen: Serum" in new
    assert {rule for rule, _ in masks} == {"accession_or_specimen_id", "email"}


def test_spanish_labels():
    for line in ("Paciente: PEREZ, MARIA", "Fecha de nacimiento: 14/03/1975", "Médico: Dra. Lopez", "Expediente: 99182"):
        assert redact_line(line, RS)[0] is None, line
    assert redact_line("Glucosa 97 mg/dL 70-99", RS)[0] == "Glucosa 97 mg/dL 70-99"
