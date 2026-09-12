import os
import tempfile

import pytest
from pathlib import Path

from app.extract.canonical import canonical_keys
from tests.conftest import FIXTURE_PDF

NINE = set(canonical_keys())


def _snapshot(d: Path) -> set[str]:
    return {p.name for p in d.iterdir()}


def test_extract_synthetic_pdf_returns_nine_analytes(client):
    tmp = Path(tempfile.gettempdir())
    before = _snapshot(tmp)
    with FIXTURE_PDF.open("rb") as f:
        r = client.post("/extract", files={"file": ("report.pdf", f, "application/pdf")})
    assert r.status_code == 200, r.text
    body = r.json()

    names = {a["name"] for a in body["analytes"]}
    assert NINE <= names
    assert body["missing"] == []
    assert body["fasting"] is True  # the synthetic report prints "Fasting: Yes"
    assert body["lang"] == "en"
    assert "RDW" in body["text"]

    for a in body["analytes"]:
        if a["name"] in NINE:
            assert a["source_span"] is not None, a
            s, e = a["source_span"]
            assert body["text"][s:e].startswith(a["raw_name"]), a
    others = [a for a in body["analytes"] if a["name"].startswith("other:")]
    assert any(a["raw_name"] == "Lymphs (Absolute)" for a in others)

    # v4: every canonical row carries the paper's unit; nothing derived because Lymphs % is printed.
    si = {a["name"]: (a["si_value"], a["si_unit"]) for a in body["analytes"] if a["name"] in NINE}
    assert si["glucose"] == (pytest.approx(5.384, abs=1e-3), "mmol/L")
    assert si["creatinine"] == (pytest.approx(80.462, abs=1e-3), "umol/L")
    assert si["albumin"] == (44.0, "g/L")
    assert si["crp"] == (pytest.approx(0.08), "mg/dL")
    assert si["alp"] == (70.0, "U/L")
    assert si["wbc"] == (6.2, "10^9/L")
    assert si["lymph_pct"] == (30.0, "%")
    assert all(a["note"] is None for a in body["analytes"] if a["name"] in NINE)
    assert not any(a["derived"] for a in body["analytes"])

    # Nothing written anywhere.
    assert _snapshot(tmp) == before
    assert not any(p.suffix == ".pdf" for p in Path.cwd().rglob("*") if "fixtures" not in p.parts and ".venv" not in p.parts)


def test_rejects_non_document(client):
    r = client.post("/extract", files={"file": ("x.txt", b"hello", "text/plain")})
    assert r.status_code == 415


def test_rejects_empty(client):
    r = client.post("/extract", files={"file": ("x.pdf", b"", "application/pdf")})
    assert r.status_code == 400


def test_rejects_oversize(client, monkeypatch):
    from app.config import get_settings

    big = b"%PDF-" + os.urandom(get_settings().max_upload_mb * 1024 * 1024 + 10)
    r = client.post("/extract", files={"file": ("x.pdf", big, "application/pdf")})
    assert r.status_code == 413
