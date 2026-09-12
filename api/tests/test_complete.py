"""'Complete your clock' block on /extract: panels for missing analytes, re-test date, fasting action."""
from app.extract.complete import collected_date, complete_your_clock, panels_for
from app.extract.schema import Analyte, ExtractResponse
from tests.conftest import FIXTURE_PDF


def test_panels_minimal_cover():
    order = panels_for(["crp"])
    assert [p["panel"] for p in order] == ["hscrp"]
    order = panels_for(["rdw", "mcv", "glucose"])
    assert {p["panel"] for p in order} == {"cbc_diff", "cmp"}
    assert panels_for([]) == []
    assert all(len(p["dtc_usd"]) == 2 for p in order)


def test_collected_date_formats():
    assert collected_date("Collected: 2026-08-14 07:52").isoformat() == "2026-08-14"
    assert collected_date("Collection Date 8/14/2026").isoformat() == "2026-08-14"
    assert collected_date("no date here") is None


def test_complete_block_shapes():
    r = ExtractResponse(analytes=[Analyte(name="rdw", value=13.1, unit="%", source_text="RDW 13.1", raw_name="RDW")],
                        fasting=False, lang="en", text="Collected: 2026-08-14", missing=["crp", "glucose"])
    c = complete_your_clock(r)
    assert c["retest_date"] == "2026-11-12" and c["collected_date"] == "2026-08-14"
    assert "not fasting" in c["fasting_action"]
    assert {p["panel"] for p in c["order"]} == {"hscrp", "cmp"}
    assert c["label"].startswith("reference")
    r2 = r.model_copy(update={"fasting": None, "text": ""})
    c2 = complete_your_clock(r2)
    assert c2["retest_date"] is None and "not printed" in c2["fasting_action"]


def test_extract_response_carries_complete(client):
    with FIXTURE_PDF.open("rb") as f:
        body = client.post("/extract", files={"file": ("report.pdf", f, "application/pdf")}).json()
    c = body["complete"]
    assert c["missing"] == [] and c["order"] == [] and c["fasting_action"] is None
    assert c["collected_date"] == "2026-08-14" and c["retest_date"] == "2026-11-12"
