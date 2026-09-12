"""GET /coach/explain/{name}: curated text + the user's value from the latest posted clock inputs."""
import json
import re

import pytest

from app.config import API_DIR
from app.extract.canonical import canonical_keys
from app.routes import clock as clock_route

EXPL = json.loads((API_DIR / "app" / "coach" / "explanations.json").read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def fresh(client):
    clock_route.get_store().clear()
    yield
    clock_route.get_store().clear()


def test_every_analyte_has_en_es_and_a_source():
    assert set(EXPL["analytes"]) == set(canonical_keys())
    for name, e in EXPL["analytes"].items():
        assert len(e["en"]) > 200 and len(e["es"]) > 200 and e["source"], name
        # No digits in the narration itself (the validator only allows context numbers).
        assert not re.search(r"\d", e["en"]), name
        assert not re.search(r"\d", e["es"]), name


def test_explain_without_clock(client):
    r = client.get("/coach/explain/rdw")
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "rdw" and body["value"] is None and body["unit"] == "%"
    assert "distribution width" in body["text"] and body["source"] and body["disclaimer"]


def test_explain_with_clock_and_spanish(client):
    client.post("/clock", json={"clock": "phenoage", "years": 41.3, "chronological_age": 34,
                                "inputs": {"rdw": 13.1, "glucose": 5.4, "imputed": ["crp"]}})
    body = client.get("/coach/explain/rdw", params={"lang": "es"}).json()
    assert body["value"] == 13.1 and body["unit"] == "%" and body["imputed"] is False
    assert "amplitud" in body["text"].lower()
    assert client.get("/coach/explain/crp").json()["imputed"] is True


def test_explain_unknown_analyte_is_404(client):
    assert client.get("/coach/explain/hemoglobin").status_code == 404
